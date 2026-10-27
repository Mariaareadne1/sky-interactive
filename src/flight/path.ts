import { decimate, smooth, strokeLength, type Pt } from '../interaction/stroke';

/**
 * Stroke → flight path. A 2D line drawn on the screen becomes a 3D route
 * over the town:
 *
 *   1. every point is projected onto the flight sheet (an invisible, gently
 *      curved surface above the roofs), so the plane flies exactly over the
 *      line you drew;
 *   2. how fast you drew sets how fast it flies — a careful stroke is a lazy
 *      glide, a flick is a zippy swoop;
 *   3. wherever the line crosses itself, that little loop is lifted into a
 *      real vertical loop-the-loop.
 *
 * Pure: the projection is passed in, so tests can use a plain camera.
 */

/** x, y, z (world), speed (units/s), 1 inside a loop-the-loop else 0. */
export type PathPoint = readonly [number, number, number, number, number];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Loop2D {
  /** Index of the segment where the loop starts (enters) and the one that closes it. */
  start: number;
  end: number;
  /** Where the line crosses itself. */
  x: number;
  y: number;
  /** +1 drawn anticlockwise on screen, -1 clockwise. */
  turn: 1 | -1;
}

export const MIN_SPEED = 1.5;
export const MAX_SPEED = 7;
const DEFAULT_SPEED = 3.4;
/** Spacing of stored path points (world units). */
export const PATH_SPACING = 0.12;
export const MAX_PATH_POINTS = 500;

function segmentHit(a: Pt, b: Pt, c: Pt, d: Pt): { t: number; x: number; y: number } | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, x: a.x + rx * t, y: a.y + ry * t };
}

/**
 * Little loops in a line: places where it crosses itself. Each loop is the
 * shortest closed stretch starting at a segment; scanning resumes after it,
 * so a curly line yields one loop per curl.
 */
export function findLoops(pts: readonly Pt[], minPerimeter = 50, maxPerimeter = 900): Loop2D[] {
  const loops: Loop2D[] = [];
  let i = 0;
  while (i < pts.length - 3) {
    let found: Loop2D | null = null;
    let perim = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    for (let j = i + 2; j < pts.length - 1; j++) {
      perim += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y);
      if (perim > maxPerimeter) break;
      const hit = segmentHit(pts[i], pts[i + 1], pts[j], pts[j + 1]);
      if (!hit || perim < minPerimeter) continue;
      // which way round: the sign of the enclosed area
      let area = 0;
      for (let k = i + 1; k <= j; k++) area += pts[k - 1].x * pts[k].y - pts[k].x * pts[k - 1].y;
      found = { start: i, end: j, x: hit.x, y: hit.y, turn: area < 0 ? 1 : -1 };
      break;
    }
    if (found) {
      loops.push(found);
      i = found.end + 1;
    } else i++;
  }
  return loops;
}

/** Drawing speed (world units per second) → flying speed, softly compressed. */
export function speedFromDrawing(worldPerSecond: number): number {
  if (!Number.isFinite(worldPerSecond) || worldPerSecond <= 0) return DEFAULT_SPEED;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, 1.1 * Math.pow(worldPerSecond, 0.75)));
}

export type StrokeToPath =
  | { ok: true; path: PathPoint[]; u: number[]; loops: number }
  | { ok: false; reason: 'short' | 'off' };

export interface StrokeToPathOptions {
  /** Screen → point on the flight sheet (null when the ray misses). */
  project: (x: number, y: number) => Vec3 | null;
  /** Whether a sheet point is over the town tile. */
  inside: (x: number, z: number) => boolean;
  /** Clamp a sheet point that strays past the tile back over it. */
  clamp: (p: Vec3) => Vec3;
  reducedMotion?: boolean;
}

interface Raw {
  p: Vec3;
  v: number;
  u: number;
  loop: number;
  /** Index into the smoothed stroke it came from. */
  si: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function len(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function strokeToPath(points: readonly Pt[], opts: StrokeToPathOptions): StrokeToPath {
  if (points.length < 2 || strokeLength(points) < 40) return { ok: false, reason: 'short' };
  const dec = decimate(points, 3);
  const loops2d = opts.reducedMotion ? [] : findLoops(dec);
  const sm = smooth(dec, 2);
  const total2d = strokeLength(sm) || 1;

  // project every point onto the sheet
  let insideCount = 0;
  const projected: (Vec3 | null)[] = sm.map((p) => opts.project(p.x, p.y));
  const first = projected[0];
  if (!first || !opts.inside(first.x, first.z)) return { ok: false, reason: 'off' };
  for (const p of projected) if (p && opts.inside(p.x, p.z)) insideCount++;
  if (insideCount < projected.length * 0.6) return { ok: false, reason: 'off' };

  // keep hits, clamped over the tile; carry each one's fraction along the drawn line
  const raw: Raw[] = [];
  let acc = 0;
  sm.forEach((p, i) => {
    if (i > 0) acc += Math.hypot(p.x - sm[i - 1].x, p.y - sm[i - 1].y);
    const hit = projected[i];
    if (hit) raw.push({ p: opts.clamp(hit), v: 0, u: acc / total2d, loop: 0, si: i });
  });
  if (raw.length < 2) return { ok: false, reason: 'off' };

  // drawing speed, in world units per second, over a small window
  const times = sm.map((p) => p.t);
  const hasTime = times.every((t) => typeof t === 'number') && (times[times.length - 1] as number) > (times[0] as number);
  for (let i = 0; i < raw.length; i++) {
    if (!hasTime) {
      raw[i].v = DEFAULT_SPEED;
      continue;
    }
    const a = Math.max(0, i - 4), b = Math.min(raw.length - 1, i + 4);
    let dist = 0;
    for (let k = a + 1; k <= b; k++) dist += len(sub(raw[k].p, raw[k - 1].p));
    const dt = ((times[raw[b].si] as number) - (times[raw[a].si] as number)) / 1000;
    raw[i].v = dt > 0.004 ? speedFromDrawing(dist / dt) : MAX_SPEED;
  }
  // and a gentle overall smoothing so speed never jumps
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < raw.length - 1; i++) raw[i].v = (raw[i - 1].v + 2 * raw[i].v + raw[i + 1].v) / 4;
  }
  if (opts.reducedMotion) for (const r of raw) r.v = Math.max(MIN_SPEED, r.v * 0.7);

  // lift each drawn loop into a vertical loop-the-loop
  const withLoops = liftLoops(raw, loops2d, sm, total2d, opts.project);
  const path = resample(withLoops.points);
  return { ok: true, path: path.map(toPathPoint), u: path.map((r) => r.u), loops: withLoops.count };
}

function toPathPoint(r: Raw): PathPoint {
  const q = (n: number) => Math.round(n * 1000) / 1000;
  return [q(r.p.x), q(r.p.y), q(r.p.z), q(r.v), r.loop > 0.5 ? 1 : 0];
}

/**
 * Replace the stretch of path inside each drawn loop with a vertical circle:
 * it starts where the line crosses itself, pulls up over the top (upside
 * down) and comes back down to the same spot, bulging a little sideways
 * over the top like a real loop.
 */
function liftLoops(raw: Raw[], loops: Loop2D[], sm: Pt[], total2d: number, project: StrokeToPathOptions['project']): { points: Raw[]; count: number } {
  if (!loops.length) return { points: raw, count: 0 };
  // fraction along the line at each smoothed-stroke index
  const uAt: number[] = [0];
  for (let i = 1; i < sm.length; i++) uAt.push(uAt[i - 1] + Math.hypot(sm[i].x - sm[i - 1].x, sm[i].y - sm[i - 1].y) / total2d);
  const out: Raw[] = [];
  let k = 0;
  let count = 0;
  for (const loop of loops) {
    const u0 = uAt[Math.min(loop.start, uAt.length - 1)], u1 = uAt[Math.min(loop.end + 1, uAt.length - 1)];
    const i0 = raw.findIndex((r) => r.u >= u0);
    let i1 = raw.findIndex((r) => r.u >= u1);
    if (i1 < 0) i1 = raw.length - 1;
    if (i0 < 1 || i1 <= i0 + 2 || i0 < k) continue;
    while (k < i0) out.push(raw[k++]);
    // the loop starts and ends exactly where the line crosses itself
    const entry = raw[i0].p;
    const exit = raw[i1].p;
    const centre = project(loop.x, loop.y) ?? { x: (entry.x + exit.x) / 2, y: (entry.y + exit.y) / 2, z: (entry.z + exit.z) / 2 };
    // heading into the loop (horizontal)
    const back = raw[Math.max(0, i0 - 3)].p;
    let dx = entry.x - back.x, dz = entry.z - back.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    let perim = 0;
    for (let i = i0 + 1; i <= i1; i++) perim += len(sub(raw[i].p, raw[i - 1].p));
    const R = Math.min(1.1, Math.max(0.5, perim / (2 * Math.PI)));
    const lateral = { x: -dz * loop.turn, z: dx * loop.turn };
    const n = Math.ceil((2 * Math.PI * R) / 0.08);
    const vAvg = raw.slice(i0, i1 + 1).reduce((s, r) => s + r.v, 0) / (i1 - i0 + 1);
    for (let j = 0; j <= n; j++) {
      const phi = (j / n) * Math.PI * 2;
      // bulging a little sideways over the top, as real loops do, and back in line at the bottom
      const drift = Math.sin(phi / 2) * R * 0.18;
      out.push({
        p: {
          x: centre.x + dx * R * Math.sin(phi) + lateral.x * drift,
          y: centre.y + R * (1 - Math.cos(phi)),
          z: centre.z + dz * R * Math.sin(phi) + lateral.z * drift,
        },
        v: vAvg,
        u: raw[i0].u + (raw[i1].u - raw[i0].u) * (j / n),
        loop: j === 0 || j === n ? 0 : 1,
        si: raw[i0].si,
      });
    }
    k = i1 + 1;
    count++;
  }
  while (k < raw.length) out.push(raw[k++]);
  return { points: out, count };
}

/** Even spacing along the path, interpolating speed, line fraction and the loop flag. */
function resample(pts: Raw[]): Raw[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i].p, pts[i - 1].p)));
  const total = cum[cum.length - 1];
  const spacing = Math.max(PATH_SPACING, total / (MAX_PATH_POINTS - 1));
  const out: Raw[] = [pts[0]];
  let i = 1;
  // loops are tight: they keep denser points so the circle survives
  for (let s = spacing; s < total; ) {
    while (i < pts.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const a = pts[i - 1], b = pts[i];
    const loop = a.loop > 0.5 || b.loop > 0.5 ? 1 : 0;
    out.push({
      p: { x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t, z: a.p.z + (b.p.z - a.p.z) * t },
      v: a.v + (b.v - a.v) * t,
      u: a.u + (b.u - a.u) * t,
      loop,
      si: a.si,
    });
    s += loop ? Math.min(spacing, 0.09) : spacing;
  }
  out.push(pts[pts.length - 1]);
  return out.slice(0, MAX_PATH_POINTS);
}
