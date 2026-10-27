/**
 * The origami. A square sheet is a fine grid of points; a classic dart is
 * four steps of folds, each a rotation of some of those points about a
 * crease line:
 *
 *   A. the two top corners fold in to the centre line;
 *   B. the new slanted edges fold in again, making the nose sharp;
 *   C. the sheet folds in half along the centre (keel down, a slim V);
 *   D. each wing folds back out along a line parallel to the keel.
 *
 * Who moves in each fold is decided on the sheet as it lay before that
 * step, so layers already folded travel with the paper under them. Folds
 * stop a hair short of flat, which leaves the springy thickness of real
 * paper and keeps layers from z-fighting. Triangles that straddle a crease
 * stretch over it and read as a soft, rounded fold.
 *
 * Body axes: +x left, +y up, +z the nose. Pure; no three.js.
 */

export type P3 = [number, number, number];

export interface Fold {
  /** A point on the crease and its direction. */
  a: P3;
  d: P3;
  /** Signed full angle. */
  angle: number;
  /** Which grid points move in this fold. */
  members: Uint8Array;
}

export interface FoldModel {
  /** Grid resolution (points per side). */
  res: number;
  /** Flat sheet positions (x, z) per point, for painting the paper. */
  flat: Float32Array;
  /** Triangle indices. */
  index: Uint32Array;
  steps: Fold[][];
  /** Positions after each completed step: states[0] is flat, states[4] the finished plane. */
  states: Float32Array[];
  /** Per point: 0 body/keel, 1 wing (for flex), with its distance out from the wing crease. */
  wing: Float32Array;
  /** Shift that centres the finished plane on its origin. */
  offset: P3;
}

export interface FoldShape {
  /** Sheet side (world units). */
  size: number;
  /** Depth of the keel, from the wing crease to the bottom of the V. */
  keel: number;
  /** Angle of each half of the V from vertical-ish (radians). */
  vee: number;
  /** Wing dihedral (radians). */
  dihedral: number;
  /** How sharp the nose is: the second crease's angle from the centre line. */
  nose: number;
}

// drawn larger than life, like MEADOW's sheep: a toy dart over a model village
export const DEFAULT_SHAPE: FoldShape = { size: 1.25, keel: 0.13, vee: 0.17, dihedral: 0.12, nose: 0.39 };

const FLAT_GAP = 0.05;

function rotate(p: P3, a: P3, d: P3, angle: number): P3 {
  // Rodrigues about the axis through a
  const x = p[0] - a[0], y = p[1] - a[1], z = p[2] - a[2];
  const c = Math.cos(angle), s = Math.sin(angle);
  const k = d[0] * x + d[1] * y + d[2] * z;
  const cx = d[1] * z - d[2] * y, cy = d[2] * x - d[0] * z, cz = d[0] * y - d[1] * x;
  return [
    a[0] + x * c + cx * s + d[0] * k * (1 - c),
    a[1] + y * c + cy * s + d[1] * k * (1 - c),
    a[2] + z * c + cz * s + d[2] * k * (1 - c),
  ];
}

const normalize = (v: P3): P3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Choose the sign of a fold so its moving points head toward `toward` as it starts. */
function signed(state: Float32Array, members: Uint8Array, a: P3, d: P3, magnitude: number, toward: P3): number {
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (let i = 0; i < members.length; i++) {
    if (!members[i]) continue;
    cx += state[i * 3]; cy += state[i * 3 + 1]; cz += state[i * 3 + 2]; n++;
  }
  if (!n) return magnitude;
  const c: P3 = [cx / n, cy / n, cz / n];
  const moved = rotate(c, a, d, 0.01);
  const dot = (moved[0] - c[0]) * toward[0] + (moved[1] - c[1]) * toward[1] + (moved[2] - c[2]) * toward[2];
  return dot >= 0 ? magnitude : -magnitude;
}

function apply(state: Float32Array, folds: Fold[], progress: number, out: Float32Array): Float32Array {
  out.set(state);
  for (const f of folds) {
    const ang = f.angle * progress;
    for (let i = 0; i < f.members.length; i++) {
      if (!f.members[i]) continue;
      const p = rotate([state[i * 3], state[i * 3 + 1], state[i * 3 + 2]], f.a, f.d, ang);
      out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2];
    }
  }
  return out;
}

export function buildFoldModel(shape: FoldShape = DEFAULT_SHAPE, res = 49): FoldModel {
  const h = shape.size / 2;
  const n = res * res;
  const cell = (2 * h) / (res - 1);
  const flat = new Float32Array(n * 2);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i;
      flat[k * 2] = -h + cell * i;
      flat[k * 2 + 1] = -h + cell * j;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < res - 1; j++) {
    for (let i = 0; i < res - 1; i++) {
      const a = j * res + i, b = a + 1, c = a + res, d = c + 1;
      // split each cell along the diagonal that runs with the first creases on its side
      if (i < (res - 1) / 2) index.push(a, c, d, a, d, b);
      else index.push(a, c, b, b, c, d);
    }
  }

  const steps: Fold[][] = [];
  /** A point's position after the first `upto` steps, starting flat at (x, z). */
  const forward = (k: number, upto: number, x: number, z: number): P3 => {
    let p: P3 = [x, 0, z];
    for (let st = 0; st < upto; st++) for (const f of steps[st]) if (f.members[k]) p = rotate(p, f.a, f.d, f.angle);
    return p;
  };
  const stateAfter = (upto: number): Float32Array => {
    const out = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) out.set(forward(k, upto, flat[k * 2], flat[k * 2 + 1]), k * 3);
    return out;
  };
  /**
   * Pull the grid points nearest a crease exactly onto it, so the fold
   * follows a straight edge instead of the grid's staircase. The crease is a
   * line in the sheet as it lies before step `upto`; earlier folds are rigid,
   * so one Newton step through them lands the point exactly.
   */
  const snap = (upto: number, half: number, ax: number, az: number, dx: number, dz: number) => {
    const l = Math.hypot(dx, dz);
    const nx = -dz / l, nz = dx / l;
    const e = 1e-4;
    for (let k = 0; k < n; k++) {
      if (half * flat[k * 2] <= 0) continue;
      const x = flat[k * 2], z = flat[k * 2 + 1];
      const p = forward(k, upto, x, z);
      const dist = (p[0] - ax) * nx + (p[2] - az) * nz;
      if (Math.abs(dist) > cell * 0.55 || Math.abs(dist) < 1e-7) continue;
      const px = forward(k, upto, x + e, z), pz = forward(k, upto, x, z + e);
      const j00 = (px[0] - p[0]) / e, j01 = (pz[0] - p[0]) / e, j10 = (px[2] - p[2]) / e, j11 = (pz[2] - p[2]) / e;
      const det = j00 * j11 - j01 * j10;
      if (Math.abs(det) < 1e-6) continue;
      const tx = -dist * nx, tz = -dist * nz;
      const fx = x + (j11 * tx - j01 * tz) / det, fz = z + (-j10 * tx + j00 * tz) / det;
      // the sheet's own edge stays where it is
      const onEdge = Math.abs(Math.abs(x) - h) < 1e-6 || Math.abs(Math.abs(z) - h) < 1e-6;
      if (onEdge || Math.abs(fx) > h || Math.abs(fz) > h) continue;
      flat[k * 2] = fx;
      flat[k * 2 + 1] = fz;
    }
  };

  const nose: P3 = [0, 0, h];
  const up: P3 = [0, 1, 0];

  // A: top corners to the centre line
  {
    const s0 = stateAfter(0);
    const folds: Fold[] = [];
    for (const side of [1, -1]) {
      const d = normalize([side * h, 0, -h]);
      const members = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        const x = flat[k * 2], z = flat[k * 2 + 1];
        // beyond the crease from (0, h) to (side·h, 0)
        members[k] = side * x > 0 && side * x + z > h + 1e-6 ? 1 : 0;
      }
      folds.push({ a: nose, d, members, angle: signed(s0, members, nose, d, Math.PI - FLAT_GAP, up) });
    }
    steps.push(folds);
  }
  // B: the slanted edges to the centre again
  {
    const t = Math.tan(shape.nose);
    for (const side of [1, -1]) snap(1, side, 0, h, side * t, -1);
    const prev = stateAfter(1);
    const folds: Fold[] = [];
    for (const side of [1, -1]) {
      const d = normalize([side * t, 0, -1]);
      const members = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        const x = prev[k * 3], z = prev[k * 3 + 2];
        members[k] = side * flat[k * 2] > 0 && side * x > (h - z) * t + 1e-6 ? 1 : 0;
      }
      // lifted a hair so the new layer sits on the corner flap, not in it
      const a: P3 = [0, 0.006, h];
      folds.push({ a, d, members, angle: signed(prev, members, a, d, Math.PI - FLAT_GAP * 1.6, up) });
    }
    steps.push(folds);
  }
  // C: fold in half, keel down — each half rises to a slim V
  {
    const prev = stateAfter(2);
    const folds: Fold[] = [];
    for (const side of [1, -1]) {
      const members = new Uint8Array(n);
      for (let k = 0; k < n; k++) members[k] = side * flat[k * 2] > 0 ? 1 : 0;
      const a: P3 = [0, 0, 0], d: P3 = [0, 0, 1];
      folds.push({ a, d, members, angle: signed(prev, members, a, d, Math.PI / 2 - shape.vee, up) });
    }
    steps.push(folds);
  }
  // D: the wings fold back out, just above level
  const wing = new Float32Array(n);
  {
    for (const side of [1, -1]) snap(2, side, side * shape.keel, 0, 0, 1);
    const prevB = stateAfter(2);
    const prev = stateAfter(3);
    const folds: Fold[] = [];
    const rise = Math.PI / 2 - shape.vee;
    for (const side of [1, -1]) {
      const members = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        const out = side * prevB[k * 3];
        members[k] = side * flat[k * 2] > 0 && out > shape.keel + 1e-6 ? 1 : 0;
        if (members[k]) wing[k] = out - shape.keel;
      }
      // the crease, where the half has carried it
      const a: P3 = [side * shape.keel * Math.cos(rise), shape.keel * Math.sin(rise), 0];
      const d: P3 = [0, 0, 1];
      folds.push({ a, d, members, angle: signed(prev, members, a, d, rise - shape.dihedral, [side, 0, 0]) });
    }
    steps.push(folds);
  }
  const states = [0, 1, 2, 3, 4].map(stateAfter);

  // centre the finished plane: keel bottom KEEL below the origin, middle of its length at z = 0
  const fin = states[4];
  let minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < n; k++) {
    minZ = Math.min(minZ, fin[k * 3 + 2]);
    maxZ = Math.max(maxZ, fin[k * 3 + 2]);
  }
  const offset: P3 = [0, -shape.keel * Math.sin(Math.PI / 2 - shape.vee) * 0.85, -(minZ + maxZ) / 2];
  return { res, flat, index: Uint32Array.from(index), steps, states, wing, offset };
}

/** Easing for each fold: a quick start and a soft, paper-like settle. */
const ease = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
};

/**
 * Positions at a point in the fold, 0 (a flat sheet) .. 1 (a finished
 * plane), centred so the sheet and the plane share an origin. Wing flex
 * bends the wings up from their crease under load.
 */
export function foldedPositions(m: FoldModel, progress: number, flex: number, out: Float32Array): Float32Array {
  const steps = m.steps.length;
  const p = Math.min(1, Math.max(0, progress)) * steps;
  const step = Math.min(steps - 1, Math.floor(p));
  const local = p >= steps ? 1 : ease(p - step);
  apply(m.states[step], m.steps[step], local, out);
  // the sheet's centre drifts to the plane's centre as it folds
  const k = Math.min(1, progress);
  for (let i = 0; i < m.wing.length; i++) {
    out[i * 3] += m.offset[0] * k;
    out[i * 3 + 1] += m.offset[1] * k;
    out[i * 3 + 2] += m.offset[2] * k;
    if (flex > 0 && progress >= 1 && m.wing[i] > 0) out[i * 3 + 1] += flex * 0.12 * m.wing[i] * m.wing[i];
  }
  return out;
}
