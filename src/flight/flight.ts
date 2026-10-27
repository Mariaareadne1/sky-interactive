import * as THREE from 'three';
import type { PathPoint } from './path';
import { SAFE, surfaceAt, surfaceHeight, surfaceNormal, type SurfaceKind } from '../scene/town';

/**
 * A paper plane's flight is a pure function of (path, time, seed).
 *
 * buildFlight() turns a stored path into a dense plan: an even ribbon of
 * samples with a time, a speed and an orientation each, then a glide that
 * carries on from the end of the line, steers back over the town if it must,
 * and comes down on whatever is under it — a roof, the green, a lane — with
 * a short slide and a little bounce. sampleFlight() reads that plan at any
 * moment. Nothing depends on frame rate or randomness, so a flight can be
 * tested, recorded and replayed exactly.
 *
 * Feel:
 *   - speed follows the drawing, then an energy model: dives speed up,
 *     climbs (and the top of a loop) slow down;
 *   - orientation is a rolling (rotation-minimising) frame along the curve —
 *     no snapping at sharp corners — gently righted toward level flight
 *     except inside loops, where it rolls right over so the plane is upside
 *     down at the top;
 *   - it banks into turns from the horizontal curvature, like a real plane
 *     (tan bank = v²κ / g), and wobbles very slightly in the air.
 */

/** Spacing of plan samples (world units). */
export const DS = 0.04;
/** How long the origami fold takes before a fresh plane launches (s). */
export const FOLD_TIME = 0.75;
/** Height of the plane's origin above its keel when it rests on something. */
export const KEEL = 0.11;
const G_ENERGY = 2.2;
const G_BANK = 9.8;
const MAX_BANK = 1.0;
const GLIDE_SPEED = 2.4;
const MIN_FLY_SPEED = 1.05;
const MAX_ENERGY = 9 * 9;

export type V3 = [number, number, number];

export interface FlightStart {
  pos: V3;
  /** Direction of travel; for a grounded plane, its heading. */
  dir: V3;
  grounded: boolean;
}

export interface FlightOptions {
  seed: number;
  /** Where the plane is now, when it isn't starting fresh at the head of the line. */
  from?: FlightStart | null;
  /** Fold the plane from a flat sheet before it launches. */
  fold?: boolean;
  reducedMotion?: boolean;
}

export interface Rest {
  x: number;
  y: number;
  z: number;
  heading: number;
  kind: SurfaceKind;
}

export interface FlightPlan {
  readonly n: number;
  readonly pos: Float32Array;
  readonly quat: Float32Array;
  readonly time: Float32Array;
  /** Index into the drawn path (fractional), -1 for take-off arcs and the glide. */
  readonly src: Float32Array;
  readonly speed: Float32Array;
  readonly bank: Float32Array;
  /** Lateral load (g) — the wings flex under it. */
  readonly load: Float32Array;
  readonly loop: Uint8Array;
  readonly foldTime: number;
  /** First and last sample of the drawn path. */
  readonly pathStart: number;
  readonly pathEnd: number;
  readonly touchTime: number;
  readonly slide: { dir: V3; dist: number; duration: number };
  readonly rest: Rest;
  readonly restQuat: THREE.Quaternion;
  readonly restTime: number;
  readonly seed: number;
  readonly calm: number;
}

export type Phase = 'fold' | 'fly' | 'glide' | 'land' | 'rest';

export interface FlightSample {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  phase: Phase;
  speed: number;
  bank: number;
  /** Wing flex, 0 (flat) .. ~1 (tight turn or loop). */
  flex: number;
  /** Fraction (0..1) of the drawn line flown so far, or -1 when not on it. */
  progress: number;
  /** 0..1 through the fold. */
  fold: number;
  /** 0..1: how far into a loop-the-loop it is (for the speed streak). */
  looping: number;
}

// --- small vector helpers on tuples (fast, allocation-light) ------------------------

const v = (x = 0, y = 0, z = 0): V3 => [x, y, z];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const subV = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const smoothstep = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
/** A stable per-seed number in [0, 1). */
export function seedHash(seed: number, k = 0): number {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// --- dense resampling ---------------------------------------------------------------

interface Ctrl {
  p: V3;
  v: number;
  src: number;
  loop: number;
}

/** Centripetal Catmull–Rom through the control points, then even spacing every DS. */
function densify(ctrl: Ctrl[]): Ctrl[] {
  if (ctrl.length === 1) return [ctrl[0]];
  const fine: Ctrl[] = [];
  const knot = (a: V3, b: V3) => Math.max(1e-4, Math.sqrt(length(subV(b, a))));
  for (let i = 0; i < ctrl.length - 1; i++) {
    const c0 = ctrl[Math.max(0, i - 1)], c1 = ctrl[i], c2 = ctrl[i + 1], c3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const p0 = i === 0 ? add(c1.p, subV(c1.p, c2.p)) : c0.p;
    const p3 = i + 2 >= ctrl.length ? add(c2.p, subV(c2.p, c1.p)) : c3.p;
    const t0 = 0, t1 = t0 + knot(p0, c1.p), t2 = t1 + knot(c1.p, c2.p), t3 = t2 + knot(c2.p, p3);
    const steps = Math.max(2, Math.ceil(length(subV(c2.p, c1.p)) / 0.01));
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      const t = t1 + (t2 - t1) * f;
      const lerp = (a: V3, b: V3, ta: number, tb: number): V3 => add(a, subV(b, a), (t - ta) / (tb - ta || 1));
      const a1 = lerp(p0, c1.p, t0, t1), a2 = lerp(c1.p, c2.p, t1, t2), a3 = lerp(c2.p, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
      fine.push({
        p: lerp(b1, b2, t1, t2),
        v: c1.v + (c2.v - c1.v) * f,
        src: c1.src < 0 || c2.src < 0 ? -1 : c1.src + (c2.src - c1.src) * f,
        loop: c1.loop > 0.5 && c2.loop > 0.5 ? 1 : c1.loop > 0.5 || c2.loop > 0.5 ? 0.5 : 0,
      });
    }
  }
  fine.push(ctrl[ctrl.length - 1]);
  // even arc-length spacing
  const out: Ctrl[] = [fine[0]];
  let acc = 0;
  for (let i = 1; i < fine.length; i++) {
    const seg = length(subV(fine[i].p, fine[i - 1].p));
    acc += seg;
    while (acc >= DS) {
      acc -= DS;
      const t = 1 - acc / (seg || 1);
      const a = fine[i - 1], b = fine[i];
      out.push({ p: add(a.p, subV(b.p, a.p), t), v: a.v + (b.v - a.v) * t, src: a.src < 0 || b.src < 0 ? -1 : a.src + (b.src - a.src) * t, loop: t < 0.5 ? a.loop : b.loop });
    }
  }
  const last = fine[fine.length - 1];
  if (length(subV(last.p, out[out.length - 1].p)) > DS * 0.3) out.push(last);
  return out;
}

/** A take-off arc from where the plane is to the head of its line. */
function takeoff(from: FlightStart, to: V3, toDir: V3): Ctrl[] {
  const dist = length(subV(to, from.pos));
  if (dist < 0.25) return [];
  let d0 = norm(from.dir);
  if (from.grounded) {
    const h = norm([d0[0], 0, d0[2]]);
    d0 = norm([h[0] * Math.cos(0.65), Math.sin(0.65), h[2] * Math.cos(0.65)]);
  }
  const d1 = norm(toDir);
  const m = Math.min(4, dist * 0.85);
  const n = Math.max(6, Math.ceil(dist / 0.1));
  const lift = 0.45 * Math.min(1, dist / 3);
  const out: Ctrl[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const p: V3 = [0, 1, 2].map((k) => h00 * from.pos[k] + h10 * m * d0[k] + h01 * to[k] + h11 * m * d1[k]) as V3;
    p[1] += lift * Math.sin(Math.PI * t);
    out.push({ p, v: 3.2, src: -1, loop: 0 });
  }
  return out;
}

// --- the glide down -----------------------------------------------------------------

interface Glide {
  pts: Ctrl[];
  dir: V3;
  speed: number;
  pitch: number;
}

/**
 * Carry on from the end of the line: settle into a glide slope, steer back
 * over the town if the glide would leave it,
 * flare near the ground, lift over a low wall, bank away from a tall one —
 * and come down on a roof slope like anywhere else.
 */
function glideDown(start: V3, dir: V3, speed: number): Glide {
  let p = start;
  let h = norm([dir[0], 0, dir[2]]);
  if (!Number.isFinite(h[0]) || length([dir[0], 0, dir[2]]) < 1e-3) h = [0, 0, -1];
  let pitch = Math.asin(Math.max(-1, Math.min(1, dir[1])));
  let spd = speed;
  const pts: Ctrl[] = [];
  for (let step = 0; step < 1200; step++) {
    const ground = surfaceHeight(p[0], p[2]);
    const alt = p[1] - KEEL - ground;
    // steer back over the town when the glide is heading off it
    // where the glide would come down from here
    const look = Math.min(5, Math.max(1.2, alt * 2.1));
    const px = p[0] + h[0] * look, pz = p[2] + h[2] * look;
    if (Math.abs(px) > SAFE.halfX || Math.abs(pz) > SAFE.halfZ) {
      const want = norm([-p[0], 0, -p[2]]);
      const turn = Math.sign(cross(h, want)[1]) || 1;
      const a = Math.min(Math.acos(Math.max(-1, Math.min(1, dot(h, want)))), 1.5 * DS);
      const c = Math.cos(a * turn), s = Math.sin(a * turn);
      h = norm([h[0] * c + h[2] * s, 0, -h[0] * s + h[2] * c]);
    }
    let target = -0.55;
    if (alt < 0.55) target = -0.13; // flare
    // Walls (a sudden step up: the side of a house, the tower) are cleared or
    // avoided; roof slopes are fine to come down on, so they are not walls.
    const bottom = p[1] - KEEL;
    const wallAhead = (dx: number, dz: number, reach: number): number => {
      let prev = ground;
      for (let k = 0.1; k <= reach + 1e-6; k += 0.1) {
        const s2 = surfaceHeight(p[0] + dx * k, p[2] + dz * k);
        if (s2 - prev > 0.12 && s2 > bottom - 0.02) return s2 - bottom; // how far above the keel its top is
        prev = s2;
      }
      return -1;
    };
    const wall = wallAhead(h[0], h[2], 1.4);
    if (wall >= 0 && wall < 0.35) target = 0.25; // a low wall: lift over it
    else if (wall >= 0.35) {
      // too tall to clear: bank away from it and come down before it
      const lt: V3 = [h[2], 0, -h[0]];
      const side = wallAhead(lt[0], lt[2], 1.4) >= 0 ? -1 : 1;
      const a = 1.4 * DS * side;
      h = norm([h[0] * Math.cos(a) + h[2] * Math.sin(a), 0, -h[0] * Math.sin(a) + h[2] * Math.cos(a)]);
      target = -0.5;
    }
    pitch += (target - pitch) * 0.09;
    const T: V3 = [h[0] * Math.cos(pitch), Math.sin(pitch), h[2] * Math.cos(pitch)];
    const next = add(p, T, DS);
    const nextGround = surfaceHeight(next[0], next[2]);
    if (nextGround - (next[1] - KEEL) > 0.05 && nextGround - ground > 0.12) {
      // nose against a wall after all: stop here and flutter down beside it
      return { pts, dir: T, speed: spd, pitch };
    }
    spd = Math.sqrt(Math.max(MIN_FLY_SPEED ** 2, spd * spd - 2 * G_ENERGY * (next[1] - p[1])));
    spd += (GLIDE_SPEED - spd) * 0.01;
    // touching down: end on the last point still above the surface (the slide covers the last centimetre)
    if (next[1] - KEEL <= nextGround || step === 1199) return { pts, dir: T, speed: spd, pitch };
    p = next;
    pts.push({ p, v: spd, src: -1, loop: 0 });
  }
  return { pts, dir: h, speed: spd, pitch };
}

// --- orientation -------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/** Plane body axes: +x left, +y up, +z forward (nose). */
function quatFromBasis(forward: V3, up: V3, out: THREE.Quaternion): THREE.Quaternion {
  const left = norm(cross(up, forward));
  const u = cross(forward, left);
  _x.set(left[0], left[1], left[2]);
  _y.set(u[0], u[1], u[2]);
  _z.set(forward[0], forward[1], forward[2]);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

function orthUp(T: V3): V3 | null {
  const u = subV([0, 1, 0], [T[0] * T[1], T[1] * T[1], T[2] * T[1]]);
  return length(u) < 0.2 ? null : norm(u);
}

/** Box-filter moving average over ±radius samples, applied twice (≈ a soft gaussian). */
function smoothArray(a: Float32Array, radius: number): void {
  const n = a.length;
  const sum = new Float64Array(n + 1);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + a[i];
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - radius), hi = Math.min(n - 1, i + radius);
      a[i] = (sum[hi + 1] - sum[lo]) / (hi - lo + 1);
    }
  }
}

/** The plane's resting pose on the surface at (x, z), facing heading, tipped onto a wingtip by its seed. */
export function restPose(rest: { x: number; y: number; z: number; heading: number }, seed: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const n = surfaceNormal(rest.x, rest.z);
  let f: V3 = [Math.sin(rest.heading), 0, Math.cos(rest.heading)];
  f = norm(subV(f, [n[0] * dot(f, n), n[1] * dot(f, n), n[2] * dot(f, n)]));
  const tilt = (seedHash(seed, 3) - 0.5) * 0.3;
  const left = norm(cross(n, f));
  const up = norm(add([n[0] * Math.cos(tilt), n[1] * Math.cos(tilt), n[2] * Math.cos(tilt)], left, Math.sin(tilt)));
  return quatFromBasis(f, up, out);
}

// --- build ---------------------------------------------------------------------------------

export function buildFlight(path: readonly PathPoint[], opts: FlightOptions): FlightPlan {
  const calm = opts.reducedMotion ? 0.4 : 1;
  const ctrl: Ctrl[] = path.map((q, i) => ({ p: [q[0], q[1], q[2]], v: q[3], src: i, loop: q[4] }));
  if (ctrl.length === 0) ctrl.push({ p: opts.from?.pos ?? v(0, 3, 0), v: 3, src: -1, loop: 0 });
  let prefix: Ctrl[] = [];
  if (opts.from && ctrl.length > 1) {
    const d = norm(subV(ctrl[Math.min(2, ctrl.length - 1)].p, ctrl[0].p));
    prefix = takeoff(opts.from, ctrl[0].p, d);
  }
  const dense = densify([...prefix, ...ctrl]);
  const pathStart = Math.max(0, dense.findIndex((c) => c.src >= 0));
  let pathEnd = dense.length - 1;
  while (pathEnd > 0 && dense[pathEnd].src < 0) pathEnd--;

  // tangent and speed at the end of the line, to carry into the glide
  const nEnd = dense.length;
  const endDir = norm(subV(dense[nEnd - 1].p, dense[Math.max(0, nEnd - 4)].p));
  const glide = glideDown(dense[nEnd - 1].p, nEnd > 1 ? endDir : [0, -0.3, -1], dense[nEnd - 1].v);
  const all = [...dense, ...glide.pts];
  const n = all.length;

  const pos = new Float32Array(n * 3);
  all.forEach((c, i) => pos.set(c.p, i * 3));
  const P = (i: number): V3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const tangent: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = P(Math.max(0, i - 1)), b = P(Math.min(n - 1, i + 1));
    const t = subV(b, a);
    tangent.push(length(t) > 1e-6 ? norm(t) : i > 0 ? tangent[i - 1] : [0, 0, -1]);
  }

  // speed: the drawing's, then energy — dives speed up, climbs slow down. Height
  // trades against speed sample by sample, while the "thrust" of the drawn
  // speed pulls it back over a couple of metres.
  const speed = new Float32Array(n);
  const loopFlag = new Uint8Array(n);
  all.forEach((c, i) => (loopFlag[i] = c.loop > 0.25 ? 1 : 0));
  const ramped = opts.fold || opts.from?.grounded;
  let e = all[0].v * all[0].v;
  for (let i = 0; i < n; i++) {
    const vd = all[i].v;
    if (i > 0) e += 2 * G_ENERGY * (pos[(i - 1) * 3 + 1] - pos[i * 3 + 1]);
    e += (vd * vd - e) * (loopFlag[i] ? 0.004 : 0.01);
    e = Math.max(MIN_FLY_SPEED ** 2, Math.min(MAX_ENERGY, e));
    let s = Math.sqrt(e);
    if (ramped) s *= 0.3 + 0.7 * smoothstep(0, 1.1, i * DS);
    speed[i] = s;
  }
  smoothArray(speed, 5);

  // bank from horizontal curvature, load from total curvature
  const bank = new Float32Array(n);
  const load = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = tangent[Math.max(0, i - 2)], b = tangent[Math.min(n - 1, i + 2)];
    const span = (Math.min(n - 1, i + 2) - Math.max(0, i - 2)) * DS || DS;
    const turn = cross(a, b)[1] / span; // > 0 turning left
    const curv = length(subV(b, a)) / span;
    const v2 = speed[i] * speed[i];
    bank[i] = loopFlag[i] ? 0 : Math.max(-MAX_BANK, Math.min(MAX_BANK, Math.atan((0.7 * v2 * turn) / G_BANK)));
    load[i] = Math.min(2, (v2 * curv) / G_BANK);
  }
  smoothArray(bank, 7);
  smoothArray(load, 6);

  // rolling frame, righted toward level flight outside loops, then banked
  const quat = new Float32Array(n * 4);
  const q = new THREE.Quaternion();
  let up: V3 = orthUp(tangent[0]) ?? [0, 0, 1];
  for (let i = 0; i < n; i++) {
    const T = tangent[i];
    if (i > 0) {
      // double reflection (Wang et al. 2008)
      const v1 = subV(P(i), P(i - 1));
      const c1 = dot(v1, v1);
      if (c1 > 1e-10) {
        const rL = subV(up, [v1[0] * (2 / c1) * dot(v1, up), v1[1] * (2 / c1) * dot(v1, up), v1[2] * (2 / c1) * dot(v1, up)]);
        const Tp = tangent[i - 1];
        const tL = subV(Tp, [v1[0] * (2 / c1) * dot(v1, Tp), v1[1] * (2 / c1) * dot(v1, Tp), v1[2] * (2 / c1) * dot(v1, Tp)]);
        const v2 = subV(T, tL);
        const c2 = dot(v2, v2);
        up = c2 > 1e-10 ? subV(rL, [v2[0] * (2 / c2) * dot(v2, rL), v2[1] * (2 / c2) * dot(v2, rL), v2[2] * (2 / c2) * dot(v2, rL)]) : rL;
      }
      if (!loopFlag[i]) {
        const level = orthUp(T);
        if (level && dot(up, level) > -0.2) up = add(up, subV(level, up), 0.12);
      }
      up = norm(subV(up, [T[0] * dot(up, T), T[1] * dot(up, T), T[2] * dot(up, T)]));
    }
    // bank: tilt up toward the inside of the turn (left for a left turn)
    const left = norm(cross(up, T));
    const b = bank[i] * calm + (1 - calm) * bank[i] * 0.6;
    const banked = norm(add([up[0] * Math.cos(b), up[1] * Math.cos(b), up[2] * Math.cos(b)], left, Math.sin(b)));
    quatFromBasis(T, banked, q);
    quat.set([q.x, q.y, q.z, q.w], i * 4);
    bank[i] = b;
  }

  // time along the ribbon
  const time = new Float32Array(n);
  for (let i = 1; i < n; i++) time[i] = time[i - 1] + DS / ((speed[i - 1] + speed[i]) / 2);
  const src = new Float32Array(n);
  all.forEach((c, i) => (src[i] = c.src));

  // touchdown, slide and rest
  const touch = P(n - 1);
  const hdir = norm([glide.dir[0], 0, glide.dir[2]]);
  const vH = Math.max(0.5, glide.speed * Math.cos(glide.pitch));
  let dist = Math.min(0.4, Math.max(0.1, vH * 0.16));
  // don't slide into a wall
  for (let d = 0.04; d <= dist; d += 0.04) {
    if (surfaceHeight(touch[0] + hdir[0] * d, touch[2] + hdir[2] * d) - (touch[1] - KEEL) > 0.06) {
      dist = Math.max(0, d - 0.06);
      break;
    }
  }
  // a plane that stalled against a wall flutters the last of the way down
  const drop = Math.max(0, touch[1] - KEEL - surfaceHeight(touch[0], touch[2]));
  const duration = Math.max(Math.min(0.9, Math.max(0.3, (2 * dist) / vH)), drop > 0.1 ? 0.45 + drop * 1.1 : 0);
  const rx = touch[0] + hdir[0] * dist, rz = touch[2] + hdir[2] * dist;
  const surf = surfaceAt(rx, rz);
  const rest: Rest = { x: rx, y: surf.y + KEEL * 0.85, z: rz, heading: Math.atan2(hdir[0], hdir[2]), kind: surf.kind };
  const restQuat = restPose(rest, opts.seed);
  const foldTime = opts.fold ? FOLD_TIME : 0;
  const touchTime = time[n - 1];

  return {
    n, pos, quat, time, src, speed, bank, load, loop: loopFlag,
    foldTime,
    pathStart,
    pathEnd,
    touchTime,
    slide: { dir: hdir, dist, duration },
    rest,
    restQuat,
    restTime: touchTime + duration,
    seed: opts.seed,
    calm,
  };
}

// --- sample ----------------------------------------------------------------------------------

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qw = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'ZXY');

export function createSample(): FlightSample {
  return { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), phase: 'fold', speed: 0, bank: 0, flex: 0, progress: -1, fold: 0, looping: 0 };
}

function find(time: Float32Array, t: number): number {
  let lo = 0, hi = time.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Where the plane is, and how it is turned, `t` seconds after its flight began. */
export function sampleFlight(plan: FlightPlan, t: number, out: FlightSample = createSample()): FlightSample {
  const s = plan.seed;
  const ft = t - plan.foldTime;
  out.fold = plan.foldTime > 0 ? Math.min(1, Math.max(0, t / plan.foldTime)) : 1;
  out.progress = -1;
  out.flex = 0;
  out.looping = 0;
  if (ft < 0) {
    // folding: hovering at the head of the line, bobbing faintly
    out.phase = 'fold';
    out.pos.set(plan.pos[0], plan.pos[1] + 0.03 * Math.sin(t * 5), plan.pos[2]);
    out.quat.fromArray(plan.quat, 0);
    out.speed = 0;
    out.bank = 0;
    return out;
  }
  if (ft < plan.touchTime) {
    const i = find(plan.time, ft);
    const j = Math.min(plan.n - 1, i + 1);
    const f = plan.time[j] > plan.time[i] ? (ft - plan.time[i]) / (plan.time[j] - plan.time[i]) : 0;
    out.pos.set(
      plan.pos[i * 3] + (plan.pos[j * 3] - plan.pos[i * 3]) * f,
      plan.pos[i * 3 + 1] + (plan.pos[j * 3 + 1] - plan.pos[i * 3 + 1]) * f,
      plan.pos[i * 3 + 2] + (plan.pos[j * 3 + 2] - plan.pos[i * 3 + 2]) * f,
    );
    _qa.fromArray(plan.quat, i * 4);
    _qb.fromArray(plan.quat, j * 4);
    out.quat.slerpQuaternions(_qa, _qb, f);
    out.speed = plan.speed[i] + (plan.speed[j] - plan.speed[i]) * f;
    out.bank = plan.bank[i] + (plan.bank[j] - plan.bank[i]) * f;
    out.flex = Math.min(1, (plan.load[i] + (plan.load[j] - plan.load[i]) * f) * 0.6);
    out.phase = i < plan.pathEnd ? 'fly' : 'glide';
    out.looping = plan.loop[i] + (plan.loop[j] - plan.loop[i]) * f;
    const srcNow = plan.src[i] < 0 || plan.src[j] < 0 ? -1 : plan.src[i] + (plan.src[j] - plan.src[i]) * f;
    const last = plan.src[plan.pathEnd];
    if (srcNow >= 0 && last > 0) out.progress = srcNow / last;
    else if (i >= plan.pathEnd) out.progress = 1;
    // the faintest wobble: paper in moving air
    const w = plan.calm * Math.min(1, out.speed / 3);
    _e.set(0.02 * Math.sin(ft * 2.9 + s) * w, 0, (0.035 * Math.sin(ft * 2.1 + s * 1.7) + 0.02 * Math.sin(ft * 4.7 + s * 3.1)) * w);
    out.quat.multiply(_qw.setFromEuler(_e));
    return out;
  }
  const tl = ft - plan.touchTime;
  const { slide, rest } = plan;
  const tx = plan.pos[(plan.n - 1) * 3], ty = plan.pos[(plan.n - 1) * 3 + 1], tz = plan.pos[(plan.n - 1) * 3 + 2];
  out.speed = 0;
  out.bank = 0;
  out.progress = 1;
  if (tl < slide.duration) {
    // sliding to a stop with a little bounce at touchdown
    out.phase = 'land';
    const k = tl / slide.duration;
    const frac = 1 - (1 - k) * (1 - k);
    const x = tx + slide.dir[0] * slide.dist * frac, z = tz + slide.dir[2] * slide.dist * frac;
    const ground = surfaceHeight(x, z) + KEEL * 0.85;
    const y = Math.max(ground, ty + (rest.y - ty) * smoothstep(0, 0.4, k)) + 0.045 * Math.abs(Math.sin((Math.PI * tl) / 0.2)) * Math.exp(-tl * 7);
    out.pos.set(x, y, z);
    _qa.fromArray(plan.quat, (plan.n - 1) * 4);
    out.quat.slerpQuaternions(_qa, plan.restQuat, smoothstep(0, Math.min(0.45, slide.duration), tl));
    out.speed = (1 - k) * 2;
    return out;
  }
  out.phase = 'rest';
  out.pos.set(rest.x, rest.y, rest.z);
  out.quat.copy(plan.restQuat);
  rock(out.quat, t, s, plan.calm);
  return out;
}

/** At rest, the plane rocks very slightly in the breeze. */
export function rock(q: THREE.Quaternion, t: number, seed: number, calm = 1): void {
  const gust = 0.6 + 0.4 * Math.sin(t * 0.37 + seed);
  _e.set(0.006 * Math.sin(t * 2.3 + seed * 2) * calm * gust, 0, (0.018 * Math.sin(t * 1.6 + seed) + 0.008 * Math.sin(t * 3.7 + seed * 5)) * calm * gust);
  q.multiply(_qw.setFromEuler(_e));
}

/** Total time until the plane is at rest. */
export function flightDuration(plan: FlightPlan): number {
  return plan.foldTime + plan.restTime;
}

/** Position and direction of travel at time t (for re-planning mid-air). */
export function flightState(plan: FlightPlan, t: number): { pos: V3; dir: V3; airborne: boolean; src: number } {
  const smp = sampleFlight(plan, t);
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(smp.quat);
  const airborne = smp.phase === 'fly' || smp.phase === 'glide' || smp.phase === 'fold';
  let src = -1;
  if (airborne && smp.phase !== 'fold') {
    const i = find(plan.time, t - plan.foldTime);
    src = plan.src[i];
  }
  return { pos: [smp.pos.x, smp.pos.y, smp.pos.z], dir: [f.x, f.y, f.z], airborne, src };
}
