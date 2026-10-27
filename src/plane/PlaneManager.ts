import * as THREE from 'three';
import { Plane } from './Plane';
import type { Landed, SkyDoc } from '../state/document';
import type { WorldUniforms } from '../scene/world';

/**
 * Keeps the live planes in step with the document. New records fold and
 * fly (or simply rest where they were saved); removed ones unfold and drift
 * off; a changed path sends the plane off along it; a moved landing moves a
 * resting plane. Each frame it advances every plane to the engine's time.
 */
export class PlaneManager {
  readonly group = new THREE.Group();
  private readonly live = new Map<string, Plane>();
  private readonly leaving = new Set<Plane>();
  /** A plane came to rest: where (saved without an undo step). */
  onLanded: ((id: string, landed: Landed) => void) | null = null;
  selectedId: string | null = null;
  hoverId: string | null = null;

  constructor(private readonly world: WorldUniforms, private readonly calm: boolean) {
    this.group.name = 'planes';
  }

  get(id: string): Plane | undefined {
    return this.live.get(id);
  }

  all(): Plane[] {
    return [...this.live.values()];
  }

  sync(doc: SkyDoc, now: number): void {
    const ids = new Set(doc.planes.map((p) => p.id));
    for (const [id, plane] of this.live) {
      if (ids.has(id)) continue;
      plane.leave(now);
      this.leaving.add(plane);
      this.live.delete(id);
    }
    for (const rec of doc.planes) {
      const plane = this.live.get(rec.id);
      if (!plane) {
        const p = new Plane(rec, this.world, this.calm, now);
        p.onLanded = (landed) => this.onLanded?.(rec.id, landed);
        this.live.set(rec.id, p);
        this.group.add(p.mesh, p.streak.mesh);
        continue;
      }
      if (rec.path !== plane.record.path) {
        plane.redirect(rec, now);
        continue;
      }
      // a resting plane follows its saved landing (dragging, and undoing a drag)
      const at = plane.resting;
      if (at && rec.landed && Math.hypot(at.x - rec.landed.x, at.z - rec.landed.z, at.y - rec.landed.y) > 1e-3) plane.placeAt(rec.landed, now);
      plane.record = rec;
    }
  }

  update(now: number, dt: number, camera: THREE.Camera): void {
    for (const p of this.live.values()) {
      p.highlight = p.id === this.selectedId ? 1 : p.id === this.hoverId ? 0.45 : 0;
      p.update(now, dt, camera);
    }
    for (const p of this.leaving) {
      p.update(now, dt, camera);
      if (p.gone) {
        this.group.remove(p.mesh, p.streak.mesh);
        p.dispose();
        this.leaving.delete(p);
      }
    }
  }

  /** The plane under a screen point: nearest centre within a generous radius. */
  pick(clientX: number, clientY: number, camera: THREE.Camera, rect: DOMRect, pixelsPerMeter: (p: THREE.Vector3) => number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    const v = new THREE.Vector3();
    for (const p of this.live.values()) {
      v.copy(p.position).project(camera);
      if (v.z > 1) continue;
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      const r = Math.max(24, pixelsPerMeter(p.position) * 0.65);
      if (d < r && d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    return best;
  }

  dispose(): void {
    for (const p of [...this.live.values(), ...this.leaving]) p.dispose();
    this.live.clear();
    this.leaving.clear();
  }
}
