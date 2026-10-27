import * as THREE from 'three';
import { buildFlight, createSample, flightDuration, flightState, rock, restPose, sampleFlight, seedHash, KEEL, type FlightPlan, type FlightSample, type V3 } from '../flight/flight';
import type { PathPoint } from '../flight/path';
import { buildFoldModel, DEFAULT_SHAPE, foldedPositions, type FoldModel } from './fold';
import { paperMaterial, Streak } from './paper';
import { SHADOW_LAYER } from '../engine/shadows';
import { surfaceAt, surfaceHeight } from '../scene/town';
import type { Landed, PlaneRecord } from '../state/document';
import type { WorldUniforms } from '../scene/world';

/**
 * One paper plane in the town: its folded mesh, its current flight (or its
 * resting place), and the little things that make it feel like paper — the
 * fold-in, the wobble, the wing flex, the streak through a loop and the
 * unfold when it leaves. Everything it shows is read from its flight plan
 * at the engine's time, so it is exactly reproducible.
 */

type Mode =
  | { kind: 'flying'; plan: FlightPlan; start: number }
  | { kind: 'resting'; at: Landed; since: number }
  | { kind: 'leaving'; from: THREE.Vector3; quat: THREE.Quaternion; start: number; dir: THREE.Vector3 };

/** The drawn line a fresh flight traces, rubbed out behind the plane. */
export interface Ghost {
  el: SVGPathElement;
  /** Fraction of the line (0..1) at each path point. */
  u: readonly number[];
  length: number;
}

const LEAVE_TIME = 1.6;
const tmpV = new THREE.Vector3();

export class Plane {
  readonly mesh: THREE.Mesh;
  readonly streak = new Streak();
  readonly model: FoldModel;
  private mode: Mode;
  private readonly positions: Float32Array;
  private lastFold = -1;
  private lastFlex = -1;
  private readonly sample: FlightSample = createSample();
  private ghost: Ghost | null = null;
  /** The route this plane is flying now (a loop or a take-off may wrap the drawn path). */
  private active: readonly PathPoint[];
  /** Set when its flight comes to rest; the manager saves it. */
  onLanded: ((landed: Landed) => void) | null = null;
  /** Mid-reveal planes stay pickable. */
  readonly bounds = new THREE.Sphere(new THREE.Vector3(), 0.75);
  highlight = 0;

  constructor(public record: PlaneRecord, world: WorldUniforms, private readonly calm: boolean, now: number) {
    // every plane is folded by the same hand, a little differently
    const s = record.seed;
    this.model = buildFoldModel({
      ...DEFAULT_SHAPE,
      nose: DEFAULT_SHAPE.nose + (seedHash(s, 1) - 0.5) * 0.06,
      dihedral: 0.07 + seedHash(s, 2) * 0.12,
      keel: DEFAULT_SHAPE.keel * (0.95 + seedHash(s, 4) * 0.1),
    });
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.model.flat.length / 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFlat', new THREE.BufferAttribute(this.model.flat, 2));
    geo.setIndex(new THREE.BufferAttribute(this.model.index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    this.mesh = new THREE.Mesh(geo, paperMaterial(world, s));
    this.mesh.name = `plane ${record.id}`;
    this.mesh.layers.enable(SHADOW_LAYER);
    this.active = record.path;
    if (record.landed) {
      this.mode = { kind: 'resting', at: record.landed, since: now };
      this.setShape(1, 0);
    } else {
      this.mode = { kind: 'flying', plan: buildFlight(record.path, { seed: s, fold: true, reducedMotion: calm }), start: now };
      this.setShape(0, 0);
    }
  }

  get id(): string {
    return this.record.id;
  }

  get state(): Mode['kind'] {
    return this.mode.kind;
  }

  get resting(): Landed | null {
    return this.mode.kind === 'resting' ? this.mode.at : null;
  }

  get position(): THREE.Vector3 {
    return this.mesh.position;
  }

  /** The current flight, if any. */
  get plan(): FlightPlan | null {
    return this.mode.kind === 'flying' ? this.mode.plan : null;
  }

  get flightStart(): number {
    return this.mode.kind === 'flying' ? this.mode.start : 0;
  }

  attachGhost(ghost: Ghost): void {
    this.dropGhost();
    this.ghost = ghost;
  }

  private dropGhost(): void {
    if (!this.ghost) return;
    const el = this.ghost.el;
    el.classList.add('ink-gone');
    window.setTimeout(() => el.remove(), 600);
    this.ghost = null;
  }

  /** Where it is and which way it's going, for planning the next flight from here. */
  private here(now: number): { pos: V3; dir: V3; grounded: boolean } {
    if (this.mode.kind === 'flying') {
      const st = flightState(this.mode.plan, now - this.mode.start);
      return { pos: st.pos, dir: st.dir, grounded: !st.airborne };
    }
    const at = this.mode.kind === 'resting' ? this.mode.at : null;
    const p = this.mesh.position;
    const heading = at?.heading ?? 0;
    return { pos: [p.x, p.y, p.z], dir: [Math.sin(heading), 0, Math.cos(heading)], grounded: true };
  }

  private fly(path: readonly PathPoint[], now: number): void {
    const from = this.here(now);
    this.active = path;
    this.mode = { kind: 'flying', plan: buildFlight(path, { seed: this.record.seed, from, reducedMotion: this.calm }), start: now };
  }

  /** Fly the drawn path again, from wherever it is via a short arc to the start. */
  flyAgain(now: number): void {
    this.dropGhost();
    this.fly(this.record.path, now);
  }

  /** A new path for this plane (Draw its next flight): it flies there from here. */
  redirect(record: PlaneRecord, now: number): void {
    this.record = record;
    this.fly(record.path, now);
  }

  /** One loop-the-loop where it is, then on with the rest of its flight. */
  loop(now: number): void {
    const here = this.here(now);
    let h = new THREE.Vector3(here.dir[0], 0, here.dir[2]);
    if (h.lengthSq() < 1e-4) h.set(0, 0, -1);
    h = h.normalize();
    const start = new THREE.Vector3(...here.pos);
    if (here.grounded) start.addScaledVector(h, 1.6).setY(Math.max(start.y + 1.5, surfaceHeight(start.x, start.z) + 1.5));
    const v = 3.4;
    const pts: PathPoint[] = [];
    const R = 0.75;
    if (this.calm) {
      // reduced motion: a gentle rise and dip instead of a loop
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        pts.push([start.x + h.x * t * 3, start.y + Math.sin(t * Math.PI) * 0.5, start.z + h.z * t * 3, 2.4, 0]);
      }
    } else {
      const n = Math.ceil((2 * Math.PI * R) / 0.08);
      for (let j = 0; j <= n; j++) {
        const phi = (j / n) * Math.PI * 2;
        pts.push([start.x + h.x * R * Math.sin(phi), start.y + R * (1 - Math.cos(phi)), start.z + h.z * R * Math.sin(phi), v, j === 0 || j === n ? 0 : 1]);
      }
    }
    // then the rest of the route it was on, or a short run out of the loop
    let rest: PathPoint[] = [];
    if (this.mode.kind === 'flying' && !here.grounded) {
      const st = flightState(this.mode.plan, now - this.mode.start);
      if (st.src >= 0) rest = this.active.slice(Math.ceil(st.src) + 1);
    }
    if (rest.length < 2) {
      const end = pts[pts.length - 1];
      for (let i = 1; i <= 12; i++) rest.push([end[0] + h.x * i * 0.15, end[1], end[2] + h.z * i * 0.15, 3, 0]);
    }
    this.dropGhost();
    if (here.grounded) {
      this.active = [...pts, ...rest];
      this.mode = { kind: 'flying', plan: buildFlight(this.active, { seed: this.record.seed, from: here, reducedMotion: this.calm }), start: now };
    } else {
      // already in the air: the loop begins exactly where it is
      this.active = [...pts, ...rest];
      this.mode = { kind: 'flying', plan: buildFlight(this.active, { seed: this.record.seed, reducedMotion: this.calm }), start: now };
    }
  }

  /** Put a resting plane somewhere else (dragging, undo of a drag). */
  placeAt(landed: Landed, now: number): void {
    this.mode = { kind: 'resting', at: landed, since: now };
  }

  /** Unfold back into a flat sheet and drift away. */
  leave(now: number): void {
    if (this.mode.kind === 'leaving') return;
    this.dropGhost();
    const dir = new THREE.Vector3(0.6, 0.9, -0.3).normalize();
    this.mode = { kind: 'leaving', from: this.mesh.position.clone(), quat: this.mesh.quaternion.clone(), start: now, dir };
  }

  get gone(): boolean {
    return this.mode.kind === 'leaving' && this.leaveT >= 1;
  }
  private leaveT = 0;

  private setShape(fold: number, flex: number): void {
    const f = Math.round(fold * 400) / 400, x = Math.round(flex * 40) / 40;
    if (f === this.lastFold && x === this.lastFlex) return;
    this.lastFold = f;
    this.lastFlex = x;
    foldedPositions(this.model, f, x, this.positions);
    this.mesh.geometry.getAttribute('position').needsUpdate = true;
  }

  /** Advance to engine time `now`. */
  update(now: number, dt: number, camera: THREE.Camera): void {
    const mat = this.mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uHighlight.value = this.highlight;
    const m = this.mode;
    if (m.kind === 'flying') {
      const t = now - m.start;
      const s = sampleFlight(m.plan, t, this.sample);
      this.mesh.position.copy(s.pos);
      this.mesh.quaternion.copy(s.quat);
      // the sheet appears with a little pop, then folds
      const appear = m.plan.foldTime > 0 ? Math.min(1, t / 0.14) : 1;
      this.mesh.scale.setScalar(0.6 + 0.4 * appear * appear * (3 - 2 * appear));
      this.setShape(s.fold, s.flex);
      this.streak.update(s.pos, s.looping, camera, dt);
      if (this.ghost) {
        if (s.phase === 'fly' && s.progress >= 0) this.traceGhost(s.progress);
        else if (s.phase !== 'fold' && s.phase !== 'fly') this.dropGhost();
      }
      if (t >= flightDuration(m.plan)) {
        const r = m.plan.rest;
        const landed: Landed = { x: r.x, y: r.y, z: r.z, heading: r.heading };
        this.mode = { kind: 'resting', at: landed, since: now };
        this.onLanded?.(landed);
      }
    } else if (m.kind === 'resting') {
      restPose(m.at, this.record.seed, this.mesh.quaternion);
      rock(this.mesh.quaternion, now, this.record.seed, this.calm ? 0.4 : 1);
      this.mesh.position.set(m.at.x, m.at.y, m.at.z);
      this.mesh.scale.setScalar(1);
      this.setShape(1, 0);
      this.streak.update(this.mesh.position, 0, camera, dt);
    } else {
      // unfolding into a flat sheet, lifting on the breeze, fading
      const k = Math.min(1, (now - m.start) / LEAVE_TIME);
      this.leaveT = k;
      this.setShape(1 - Math.min(1, k * 1.6), 0);
      const rise = k * k * 2.2;
      this.mesh.position.copy(m.from).addScaledVector(m.dir, rise).add(tmpV.set(Math.sin(k * 7) * 0.12 * k, 0, 0));
      this.mesh.quaternion.copy(m.quat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(k * 5) * 0.4 * k, k * 1.2, Math.sin(k * 4) * 0.3 * k)));
      mat.uniforms.uAlpha.value = 1 - smooth(0.45, 1, k);
      mat.transparent = true;
      mat.depthWrite = k < 0.5;
      // shrink at the very end so the shadow goes with it
      this.mesh.scale.setScalar(1 - smooth(0.7, 1, k) * 0.9);
      this.streak.update(this.mesh.position, 0, camera, dt);
    }
    this.bounds.center.copy(this.mesh.position);
  }

  private traceGhost(progress: number): void {
    const g = this.ghost!;
    const n = g.u.length - 1;
    const x = Math.min(n, Math.max(0, progress * n));
    const i = Math.floor(x);
    const u = g.u[i] + ((g.u[Math.min(n, i + 1)] ?? g.u[i]) - g.u[i]) * (x - i);
    // the stretch already flown is rubbed out
    g.el.style.strokeDasharray = `${g.length} ${g.length}`;
    g.el.style.strokeDashoffset = `${-u * g.length}`;
  }

  /** Words for the selection label: where it is. */
  whereabouts(): { altitude: number; surface: string | null } {
    const p = this.mesh.position;
    const s = surfaceAt(p.x, p.z);
    if (this.mode.kind === 'resting') return { altitude: 0, surface: s.kind };
    return { altitude: Math.max(0, p.y - KEEL - s.y), surface: null };
  }

  dispose(): void {
    this.dropGhost();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.streak.dispose();
  }
}

function smooth(a: number, b: number, t: number): number {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}
