import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildFlight, flightDuration, KEEL, sampleFlight, FOLD_TIME } from '../../src/flight/flight';
import { strokeToPath } from '../../src/flight/path';
import { surfaceHeight, TILE } from '../../src/scene/town';
import { flatProjection, leftArc, rightArc, straightPath, swoop } from './fixtures';

const up = (q: THREE.Quaternion) => new THREE.Vector3(0, 1, 0).applyQuaternion(q);
const fwd = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, 1).applyQuaternion(q);

describe('flight', () => {
  it('is continuous: no jumps in position or orientation from launch to rest', () => {
    const plan = buildFlight(straightPath(), { seed: 7, fold: true });
    const end = flightDuration(plan) + 1;
    const prev = sampleFlight(plan, 0);
    let prevPos = prev.pos.clone(), prevQ = prev.quat.clone();
    for (let t = 1 / 60; t < end; t += 1 / 60) {
      const s = sampleFlight(plan, t);
      expect(s.pos.distanceTo(prevPos)).toBeLessThan(0.2);
      expect(s.quat.angleTo(prevQ)).toBeLessThan(0.2);
      prevPos = s.pos.clone();
      prevQ = s.quat.clone();
    }
  });

  it('is deterministic: the same path, time and seed give the same pose', () => {
    const a = buildFlight(leftArc(), { seed: 3, fold: true });
    const b = buildFlight(leftArc(), { seed: 3, fold: true });
    for (const t of [0.2, 1.3, 2.7, 5]) {
      expect(sampleFlight(a, t).pos.toArray()).toEqual(sampleFlight(b, t).pos.toArray());
      expect(sampleFlight(a, t).quat.toArray()).toEqual(sampleFlight(b, t).quat.toArray());
    }
  });

  it('folds first, then flies along the path facing forward', () => {
    const plan = buildFlight(straightPath(), { seed: 1, fold: true });
    expect(sampleFlight(plan, FOLD_TIME * 0.5).phase).toBe('fold');
    const s = sampleFlight(plan, FOLD_TIME + 1.5);
    expect(s.phase).toBe('fly');
    expect(fwd(s.quat).x).toBeGreaterThan(0.95);
    expect(Math.abs(s.pos.z - 2)).toBeLessThan(0.05);
  });

  it('banks into turns: left turns roll left, right turns roll right', () => {
    const left = buildFlight(leftArc(), { seed: 1 });
    const right = buildFlight(rightArc(), { seed: 1 });
    const mid = (p: typeof left) => p.time[Math.floor(p.pathEnd / 2)];
    const sl = sampleFlight(left, mid(left));
    const sr = sampleFlight(right, mid(right));
    expect(sl.bank).toBeGreaterThan(0.1);
    expect(sr.bank).toBeLessThan(-0.1);
    // the wing on the inside of the turn is lower: up tilts toward the turn's centre (the origin)
    const inward = sl.pos.clone().setY(0).multiplyScalar(-1).normalize();
    expect(up(sl.quat).dot(inward)).toBeGreaterThan(0.1);
  });

  it('speeds up in a dive and slows in a climb', () => {
    const path = straightPath().map(([x, , z, v, l], i) => [x, 3.2 + Math.sin(i / 25) * 0.8, z, v, l] as const);
    const plan = buildFlight(path, { seed: 1 });
    let hi = 0, lo = 0;
    for (let i = 0; i < plan.pathEnd; i++) {
      if (plan.pos[i * 3 + 1] > plan.pos[hi * 3 + 1]) hi = i;
      if (plan.pos[i * 3 + 1] < plan.pos[lo * 3 + 1]) lo = i;
    }
    expect(plan.speed[lo]).toBeGreaterThan(plan.speed[hi] + 0.5);
  });

  it('turns a drawn curl into a loop-the-loop: inverted at the top', () => {
    const r = strokeToPath(swoop(true), flatProjection);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.loops).toBe(1);
    const plan = buildFlight(r.path, { seed: 2 });
    // the highest point of the loop
    let top = 0;
    for (let i = 0; i < plan.n; i++) if (plan.loop[i] && plan.pos[i * 3 + 1] > plan.pos[top * 3 + 1]) top = i;
    const s = sampleFlight(plan, plan.time[top]);
    expect(up(s.quat).y).toBeLessThan(-0.7);
    // and level again afterwards
    const after = sampleFlight(plan, plan.time[Math.min(plan.pathEnd, top + 120)]);
    expect(up(after.quat).y).toBeGreaterThan(0.5);
  });

  it('lands on the surface under it and comes to rest', () => {
    for (const path of [straightPath(), leftArc(), rightArc(3, 3.6)]) {
      const plan = buildFlight(path, { seed: 4 });
      const end = flightDuration(plan) + 0.5;
      const s = sampleFlight(plan, end);
      expect(s.phase).toBe('rest');
      expect(s.pos.y - KEEL * 0.85).toBeCloseTo(surfaceHeight(s.pos.x, s.pos.z), 2);
      expect(Math.abs(s.pos.x)).toBeLessThan(TILE.halfX);
      expect(Math.abs(s.pos.z)).toBeLessThan(TILE.halfZ);
      // still: two moments apart at rest barely move
      expect(sampleFlight(plan, end + 1).pos.distanceTo(s.pos)).toBeLessThan(1e-6);
      // descends: never below the surface on the way down
      for (let t = 0; t < end; t += 0.05) {
        const p = sampleFlight(plan, t).pos;
        expect(p.y).toBeGreaterThan(surfaceHeight(p.x, p.z) + KEEL * 0.5);
      }
    }
  });

  it('steers back over the town when its line ends heading off the edge', () => {
    const path = straightPath(3.6, 0).filter(([x]) => x > 4);
    const plan = buildFlight(path, { seed: 5 });
    expect(Math.abs(plan.rest.x)).toBeLessThan(TILE.halfX - 0.5);
  });

  it('reports progress along the drawn line', () => {
    const plan = buildFlight(straightPath(), { seed: 1 });
    const early = sampleFlight(plan, plan.time[Math.floor(plan.pathEnd * 0.25)]);
    const late = sampleFlight(plan, plan.time[Math.floor(plan.pathEnd * 0.75)]);
    expect(early.progress).toBeGreaterThan(0.15);
    expect(late.progress).toBeGreaterThan(early.progress);
    expect(late.progress).toBeLessThanOrEqual(1);
  });

  it('flies a take-off arc from where it rests back to the head of its line', () => {
    const plan = buildFlight(straightPath(), { seed: 1, from: { pos: [0, 0.2, 5], dir: [0, 0, -1], grounded: true } });
    const s = sampleFlight(plan, 0);
    expect(s.pos.distanceTo(new THREE.Vector3(0, 0.2, 5))).toBeLessThan(0.05);
    expect(plan.pathStart).toBeGreaterThan(10);
  });
});
