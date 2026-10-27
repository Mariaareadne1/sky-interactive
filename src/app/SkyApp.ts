import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { Store, Selection } from '../state/store';
import { addPlane, emptyDoc, findPlane, MAX_PLANES, newPlaneId, newSeed, removePlane, updatePlane, type Landed, type PlaneRecord, type SkyDoc } from '../state/document';
import { saveDoc } from '../state/persistence';
import { strokeToPath } from '../flight/path';
import { KEEL } from '../flight/flight';
import type { Pt } from '../interaction/stroke';
import { screenToSheet, screenToTerrain } from '../interaction/terrainRay';
import { TownScene } from '../scene/TownScene';
import { PlaneManager } from '../plane/PlaneManager';
import { edgeDistance, surfaceHeight, TILE } from '../scene/town';

/**
 * Application commands. UI and pointer input call these; they turn intent
 * into document edits (undoable: drawing, redirecting, moving, removing) or
 * live requests to a plane (not undoable: fly again, loop).
 */

export type StrokeResult = { ok: true; id: string; u: number[] } | { ok: false; message: string };

interface Drag {
  id: string;
  start: Landed;
  offsetX: number;
  offsetZ: number;
  valid: boolean;
}

export class SkyApp {
  readonly town: TownScene;
  readonly planes: PlaneManager;
  private drag: Drag | null = null;
  private saveTimer = 0;
  private readonly unsub: (() => void)[] = [];
  private warnedFull = false;
  hoverId: string | null = null;

  constructor(readonly engine: Engine, readonly store: Store) {
    this.town = new TownScene(engine);
    this.planes = new PlaneManager(engine.world, engine.reducedMotion);
    engine.scene.add(this.planes.group);
  }

  start(): void {
    let prevDoc: SkyDoc | null = null;
    const onChange = () => {
      const doc = this.store.doc;
      if (doc === prevDoc) return;
      prevDoc = doc;
      this.planes.sync(doc, this.engine.elapsed);
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => saveDoc(this.store.doc), 250);
    };
    this.unsub.push(this.store.subscribe(onChange));
    onChange();
    // where a flight comes to rest is remembered, but isn't an undo step
    this.planes.onLanded = (id, landed) => {
      if (findPlane(this.store.doc, id)) this.store.amend(updatePlane(this.store.doc, id, { landed }));
    };
    this.unsub.push(
      this.engine.onFrame((dt, t) => {
        const sel = this.store.get().selection;
        this.planes.selectedId = sel?.id ?? null;
        this.planes.hoverId = this.hoverId;
        this.planes.update(t, dt, this.engine.camera);
      }),
    );
    this.store.set({ loading: false });
  }

  get rect(): DOMRect {
    return this.engine.canvas.getBoundingClientRect();
  }

  // --- drawing ---------------------------------------------------------------

  /** Screen point on the flight sheet, if it is over (or near) the town. */
  sheetAt(clientX: number, clientY: number): THREE.Vector3 | null {
    return screenToSheet(this.engine.camera, this.rect, clientX, clientY);
  }

  canDrawAt(clientX: number, clientY: number): boolean {
    const p = this.sheetAt(clientX, clientY);
    return !!p && edgeDistance(p.x, p.z) > 0;
  }

  createFromStroke(points: readonly Pt[]): StrokeResult {
    const r = strokeToPath(points, {
      project: (x, y) => this.sheetAt(x, y),
      inside: (x, z) => edgeDistance(x, z) > 0.2,
      clamp: (p) => ({ x: Math.max(-TILE.halfX + 0.4, Math.min(TILE.halfX - 0.4, p.x)), y: p.y, z: Math.max(-TILE.halfZ + 0.4, Math.min(TILE.halfZ - 0.4, p.z)) }),
      reducedMotion: this.engine.reducedMotion,
    });
    if (!r.ok) return { ok: false, message: r.reason === 'short' ? 'Draw a longer line — a swoop, a loop, a zigzag…' : 'Draw your flight over the town.' };

    const armed = this.store.get().armed;
    const target = armed ? findPlane(this.store.doc, armed) : null;
    if (target) {
      // "Draw its next flight": this plane takes the new line
      this.store.commit(updatePlane(this.store.doc, target.id, { path: r.path }), { armed: null, hasDrawn: true, selection: { kind: 'plane', id: target.id } });
      return { ok: true, id: target.id, u: r.u };
    }
    if (this.store.doc.planes.length >= MAX_PLANES && !this.warnedFull) {
      this.warnedFull = true;
      this.store.toast('Eight planes is a full sky — the oldest one has flown off.');
    }
    const record: PlaneRecord = { id: newPlaneId(), path: r.path, landed: null, seed: newSeed() };
    this.store.commit(addPlane(this.store.doc, record), { hasDrawn: true, armed: null });
    return { ok: true, id: record.id, u: r.u };
  }

  /** Hand the drawn line to its plane, to be rubbed out as it flies. */
  attachInk(id: string, el: SVGPathElement, u: number[]): void {
    const plane = this.planes.get(id);
    if (!plane) {
      el.remove();
      return;
    }
    plane.attachGhost({ el, u, length: el.getTotalLength() });
  }

  // --- selection ------------------------------------------------------------

  pickAt(clientX: number, clientY: number): Selection {
    const id = this.planes.pick(clientX, clientY, this.engine.camera, this.rect, (p) => this.engine.pixelsPerMeterAt(p));
    return id ? { kind: 'plane', id } : null;
  }

  select(sel: Selection): void {
    const cur = this.store.get().selection;
    if (cur?.id !== sel?.id) this.store.set({ selection: sel, armed: null });
  }

  private target(id?: string): string | null {
    return id ?? this.store.get().selection?.id ?? null;
  }

  // --- the four actions -------------------------------------------------------

  flyAgain(id?: string): void {
    const t = this.target(id);
    if (t) this.planes.get(t)?.flyAgain(this.engine.elapsed);
  }

  loop(id?: string): void {
    const t = this.target(id);
    if (t) this.planes.get(t)?.loop(this.engine.elapsed);
  }

  /** The next stroke becomes this plane's flight. Toggles. */
  armNextFlight(id?: string): void {
    const t = this.target(id);
    if (!t) return;
    this.store.set({ armed: this.store.get().armed === t ? null : t });
  }

  remove(id?: string): void {
    const t = this.target(id);
    if (!t || !findPlane(this.store.doc, t)) return;
    this.store.commit(removePlane(this.store.doc, t), { selection: null, armed: null });
  }

  // --- dragging a resting plane --------------------------------------------------

  canDrag(id: string): boolean {
    return !!this.planes.get(id)?.resting;
  }

  beginDrag(id: string, clientX: number, clientY: number): boolean {
    const plane = this.planes.get(id);
    const at = plane?.resting;
    if (!plane || !at) return false;
    const hit = screenToTerrain(this.engine.camera, this.rect, clientX, clientY);
    this.drag = { id, start: at, offsetX: hit ? at.x - hit.x : 0, offsetZ: hit ? at.z - hit.z : 0, valid: true };
    return true;
  }

  /** Perspective-correct: the plane stays under the pointer, on whatever surface is there. */
  dragTo(clientX: number, clientY: number): boolean {
    const d = this.drag;
    if (!d) return false;
    const plane = this.planes.get(d.id);
    const hit = screenToTerrain(this.engine.camera, this.rect, clientX, clientY);
    if (!plane || !hit) return (d.valid = false);
    const x = hit.x + d.offsetX, z = hit.z + d.offsetZ;
    d.valid = edgeDistance(x, z) > 0.6;
    if (!d.valid) return false;
    const y = surfaceHeight(x, z) + KEEL * 0.85;
    plane.placeAt({ x, y, z, heading: d.start.heading }, this.engine.elapsed);
    return true;
  }

  endDrag(cancel = false): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const plane = this.planes.get(d.id);
    const at = plane?.resting;
    if (!plane || !at) return;
    if (cancel || !d.valid) {
      plane.placeAt(d.start, this.engine.elapsed);
      if (!cancel) this.store.toast('Set it down over the town.');
      return;
    }
    if (Math.hypot(at.x - d.start.x, at.z - d.start.z) > 0.01) this.store.commit(updatePlane(this.store.doc, d.id, { landed: at }));
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  // --- the whole sky ------------------------------------------------------------------

  reset(): void {
    if (this.store.doc.planes.length === 0) return;
    this.store.commit(emptyDoc(), { selection: null, armed: null });
    this.store.toast('The sky is clear. Undo brings the planes back.');
  }

  loadDoc(doc: SkyDoc): void {
    this.store.commit(doc, { selection: null, armed: null });
  }

  undo(): void {
    this.store.undo();
  }

  redo(): void {
    this.store.redo();
  }

  dispose(): void {
    window.clearTimeout(this.saveTimer);
    for (const u of this.unsub) u();
    this.planes.dispose();
    this.town.dispose();
  }
}
