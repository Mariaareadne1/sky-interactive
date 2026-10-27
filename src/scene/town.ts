import { noise2, seededRandom } from './noise';

/**
 * The town is a painted tile — 24 × 17 world units of village and fields —
 * seen from above at a three-quarter angle. y is up, the camera sits on the
 * +z side looking toward -z. One world unit is six "town metres": a house is
 * about eight metres tall, and labels speak in town metres.
 *
 * Everything that needs the ground (the mesh, the painted lanes, landing
 * planes, dragging) calls these functions, and the GLSL twin in groundGlsl.ts
 * is generated from the same numbers, so nothing can disagree.
 */

export const TILE = { halfX: 12, halfZ: 8.5 };
/** Town metres per world unit (for labels). */
export const TOWN_SCALE = 6;

export type V2 = readonly [number, number];

const smoothstep = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

// --- lanes --------------------------------------------------------------------

export interface Lane {
  readonly pts: readonly V2[];
  readonly hw: number;
}

/** Catmull–Rom densify a polyline so painted lanes curve instead of kinking. */
export function densify(pts: readonly V2[], per = 6): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export const LANES: readonly Lane[] = [
  // the high street: in from the front edge, past the green, out the back
  { pts: densify([[1.7, 9.3], [0.9, 6.0], [1.2, 2.8], [2.6, 0.1], [3.6, -3.0], [3.1, -6.0], [2.3, -9.3]]), hw: 0.42 },
  // the cross lane, west to east
  { pts: densify([[-12.8, 1.0], [-8.6, 0.6], [-4.6, 0.0], [-0.8, -0.3], [2.6, 0.1], [6.6, -0.5], [12.8, -0.9]]), hw: 0.37 },
  // a back lane down to the front fields on the west side
  { pts: densify([[-6.2, 0.35], [-6.9, 3.2], [-6.5, 6.0], [-7.2, 9.3]]), hw: 0.32 },
  // the path up to the church door
  { pts: densify([[-4.6, 0.0], [-5.1, -1.2], [-5.9, -2.0]]), hw: 0.24 },
];

function segDist(px: number, pz: number, a: V2, b: V2): number {
  const bx = b[0] - a[0], bz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * bx + (pz - a[1]) * bz) / (bx * bx + bz * bz || 1)));
  return Math.hypot(px - a[0] - bx * t, pz - a[1] - bz * t);
}

/** Signed distance (m) to the nearest lane's edge: negative on the lane. */
export function laneDistance(x: number, z: number): number {
  let d = Infinity;
  for (const lane of LANES) {
    for (let i = 0; i < lane.pts.length - 1; i++) d = Math.min(d, segDist(x, z, lane.pts[i], lane.pts[i + 1]) - lane.hw);
  }
  return d;
}

// --- rounded boxes ------------------------------------------------------------

export interface Box {
  readonly x: number;
  readonly z: number;
  /** Half extents in the box's own frame (u along x, v along z). */
  readonly hu: number;
  readonly hv: number;
  /** Yaw, three.js convention (rotation.y). */
  readonly rot: number;
  readonly r: number;
}

/** World → a box's local (u, v), matching three.js rotation.y. */
export function toLocal(b: { x: number; z: number; rot: number }, x: number, z: number): [number, number] {
  const dx = x - b.x, dz = z - b.z;
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return [dx * c - dz * s, dx * s + dz * c];
}

export function boxDistance(b: Box, x: number, z: number): number {
  const [u, v] = toLocal(b, x, z);
  const qx = Math.abs(u) - b.hu + b.r, qz = Math.abs(v) - b.hv + b.r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - b.r;
}

/** The village green, between the lanes. */
export const GREEN: Box = { x: -1.95, z: 3.45, hu: 2.25, hv: 1.65, rot: 0.04, r: 1.1 };
/** The churchyard: a paler, cropped green behind a low stone wall. */
export const CHURCHYARD: Box = { x: -7.6, z: -3.75, hu: 2.75, hv: 1.75, rot: 0, r: 0.5 };

// --- the church -----------------------------------------------------------------

export const CHURCH = {
  nave: { x: -7.15, z: -3.75, w: 3.0, d: 1.45, rot: 0, wallH: 1.15, roofH: 0.72 },
  tower: { x: -9.15, z: -3.75, half: 0.52, height: 2.35, spire: 0.62 },
};

// --- houses -----------------------------------------------------------------------

export type RoofKind = 'terracotta' | 'slate' | 'cream';

export interface House {
  readonly x: number;
  readonly z: number;
  /** Yaw; the ridge runs along the local u axis. */
  readonly rot: number;
  /** Ridge length and depth. */
  readonly w: number;
  readonly d: number;
  readonly wallH: number;
  readonly roofH: number;
  readonly roof: RoofKind;
  readonly wall: string;
  /** Chimney position along the ridge (fraction of w/2), or null. */
  readonly chimney: number | null;
  /** Which local side (+1 / -1 on v) faces the lane: the front door. */
  readonly front: 1 | -1;
}

export const ROOF_OVERHANG = 0.1;

export interface Garden extends Box {
  readonly house: number;
}

/** Distance inside the tile's edge (m); negative outside. */
export function edgeDistance(x: number, z: number): number {
  return Math.min(TILE.halfX - Math.abs(x), TILE.halfZ - Math.abs(z));
}

const WALLS = ['#f3ead8', '#efe2c8', '#f6efe2', '#ead9bd', '#f1e4cf', '#e9dcc9'];
const ROOFS: RoofKind[] = ['terracotta', 'terracotta', 'slate', 'terracotta', 'cream', 'slate', 'terracotta'];

/**
 * Houses line the lanes: walk each lane, step a cottage's width at a time,
 * and stand one on either side wherever it fits — clear of the lanes, the
 * green, the churchyard, the edge and each other. Seeded, so the town is
 * the same every visit.
 */
function layoutTown(): { houses: House[]; gardens: Garden[] } {
  const rand = seededRandom(1907);
  const houses: House[] = [];
  const gardens: Garden[] = [];
  const radius = (h: { w: number; d: number }) => Math.hypot(h.w, h.d) / 2;
  for (const lane of LANES.slice(0, 3)) {
    // arc length along the densified lane
    const pts = lane.pts;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    for (let s = 1.1; s < total - 1; s += 1.6 + rand() * 0.5) {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1]);
      const a = pts[i - 1], b = pts[i];
      const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      for (const side of [1, -1] as const) {
        if (rand() < 0.12) continue; // a gap: someone's orchard
        const w = 1.25 + rand() * 0.55;
        const d = 0.95 + rand() * 0.3;
        const set = lane.hw + d / 2 + 0.3 + rand() * 0.25;
        // the lane's left normal is (-tz, tx)
        const x = px - tz * set * side;
        const z = pz + tx * set * side;
        const rot = Math.atan2(-tz, tx) + (rand() - 0.5) * 0.12;
        const cand = { x, z, w, d, rot };
        const r = radius(cand);
        if (edgeDistance(x, z) < r + 0.9) continue;
        if (laneDistance(x, z) < d / 2 + 0.12) continue;
        // all four corners clear of the lanes too
        const c = Math.cos(rot), sn = Math.sin(rot);
        let clear = true;
        for (const [cu, cv] of [[w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]) {
          const wx = x + cu * c + cv * sn, wz = z - cu * sn + cv * c;
          if (laneDistance(wx, wz) < 0.12 || boxDistance(GREEN, wx, wz) < 0.25 || boxDistance(CHURCHYARD, wx, wz) < 0.3) clear = false;
        }
        if (!clear) continue;
        if (houses.some((h) => Math.hypot(h.x - x, h.z - z) < radius(h) + r + 0.05)) continue;
        // which local side faces the lane
        const [, vLane] = toLocal({ x, z, rot }, px, pz);
        const front: 1 | -1 = vLane >= 0 ? 1 : -1;
        const roof = ROOFS[houses.length % ROOFS.length];
        houses.push({
          x, z, rot, w, d,
          wallH: 0.72 + rand() * 0.22,
          roofH: 0.42 + rand() * 0.16,
          roof,
          wall: WALLS[Math.floor(rand() * WALLS.length)],
          chimney: rand() < 0.75 ? (rand() - 0.5) * 1.2 : null,
          front,
        });
        if (houses.length % 2 === 0 || rand() < 0.3) {
          // a back garden, away from the lane
          const gd = 0.9 + rand() * 0.5;
          const off = d / 2 + gd / 2 + 0.08;
          const gx = x + (-front) * off * sn, gz = z + (-front) * off * c;
          if (edgeDistance(gx, gz) > 1.2 && laneDistance(gx, gz) > gd / 2 + 0.1) {
            gardens.push({ x: gx, z: gz, hu: w / 2 * 1.02, hv: gd / 2, rot, r: 0.08, house: houses.length - 1 });
          }
        }
      }
    }
  }
  return { houses, gardens };
}

const LAYOUT = layoutTown();
export const HOUSES: readonly House[] = LAYOUT.houses;
/** Back gardens; painted on the ground, kept clear of houses. */
export const GARDENS: readonly Garden[] = LAYOUT.gardens.filter(
  (g) => !LAYOUT.houses.some((h, i) => i !== g.house && Math.hypot(h.x - g.x, h.z - g.z) < Math.hypot(h.w, h.d) / 2 + Math.hypot(g.hu, g.hv) - 0.2),
);

// --- trees, the wall and the cat ---------------------------------------------------

export interface Tree {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly color: string;
  readonly seed: number;
}

const TREE_SPOTS: Tree[] = [
  { x: -3.1, z: 2.95, r: 0.62, color: '#78b653', seed: 1 },
  { x: -0.85, z: 4.05, r: 0.5, color: '#86c05c', seed: 2 },
  { x: -10.6, z: -6.6, r: 0.85, color: '#6fae4f', seed: 3 },
  { x: 10.4, z: -6.7, r: 0.75, color: '#7cb956', seed: 4 },
  { x: -10.6, z: 6.4, r: 0.8, color: '#72b04f', seed: 5 },
  { x: 10.1, z: 6.3, r: 0.7, color: '#88c25d', seed: 6 },
  { x: 7.4, z: -5.6, r: 0.6, color: '#e8a7b7', seed: 7 }, // a blossom tree
  { x: -5.2, z: -6.7, r: 0.65, color: '#7cb956', seed: 8 },
  { x: 6.9, z: 5.2, r: 0.62, color: '#6fae4f', seed: 9 },
  { x: -7.4, z: 5.6, r: 0.7, color: '#84bd59', seed: 10 },
  { x: -9.5, z: -1.6, r: 0.5, color: '#7cb956', seed: 11 },
];

export const TREES: readonly Tree[] = TREE_SPOTS.filter(
  (t) => !HOUSES.some((h) => Math.hypot(h.x - t.x, h.z - t.z) < Math.hypot(h.w, h.d) / 2 + t.r + 0.1) && laneDistance(t.x, t.z) > t.r * 0.6,
);

/** A low stone wall along the churchyard's east side. A cat sits on it. */
export const WALL = { x: CHURCHYARD.x + CHURCHYARD.hu + 0.05, z0: -5.2, z1: -2.45, height: 0.26, thick: 0.17 };
export const CAT = { x: WALL.x, z: -3.55 };

// --- height -------------------------------------------------------------------------

export function groundHeight(x: number, z: number): number {
  // almost level: the faintest roll so the light moves across the fields
  return 0.05 * noise2(x / 6 + 3.1, z / 6 - 1.7) + 0.012 * noise2(x / 1.6, z / 1.6);
}

/** Height of a gabled roof (ridge along u) at local (u, v); -Infinity outside it. */
export function gableHeight(u: number, v: number, w: number, d: number, wallH: number, roofH: number): number {
  const o = ROOF_OVERHANG;
  if (Math.abs(u) > w / 2 + o || Math.abs(v) > d / 2 + o) return -Infinity;
  const slope = roofH / (d / 2);
  if (Math.abs(v) > d / 2) {
    // under the overhang: the eave hangs above open air
    return wallH + roofH - slope * Math.abs(v);
  }
  return wallH + roofH - slope * Math.abs(v);
}

export type SurfaceKind = 'roof' | 'lawn' | 'lane' | 'green' | 'garden' | 'tower' | 'tree' | 'wall' | 'field' | 'paper';

/**
 * The top of whatever is at (x, z): ground, a roof, the tower, a tree's
 * crown or the wall. This is where a gliding plane comes to rest.
 */
export function surfaceAt(x: number, z: number): { y: number; kind: SurfaceKind } {
  const g = groundHeight(x, z);
  let y = g;
  let kind: SurfaceKind = groundKind(x, z);
  for (const h of HOUSES) {
    if (Math.abs(x - h.x) > 1.6 || Math.abs(z - h.z) > 1.6) continue;
    const [u, v] = toLocal(h, x, z);
    const r = gableHeight(u, v, h.w, h.d, h.wallH, h.roofH);
    if (r > -Infinity && groundHeight(h.x, h.z) + r > y) {
      y = groundHeight(h.x, h.z) + r;
      kind = 'roof';
    }
  }
  const n = CHURCH.nave;
  {
    const [u, v] = toLocal(n, x, z);
    const r = gableHeight(u, v, n.w, n.d, n.wallH, n.roofH);
    if (r > -Infinity && r > y) {
      y = r;
      kind = 'roof';
    }
  }
  const t = CHURCH.tower;
  const ax = Math.abs(x - t.x), az = Math.abs(z - t.z);
  if (ax < t.half && az < t.half) {
    const top = t.height + t.spire * (1 - Math.max(ax, az) / t.half);
    if (top > y) {
      y = top;
      kind = 'tower';
    }
  }
  for (const tr of TREES) {
    const dd = Math.hypot(x - tr.x, z - tr.z);
    if (dd < tr.r * 0.95) {
      const top = groundHeight(tr.x, tr.z) + tr.r * 1.45 + tr.r * 0.85 * Math.sqrt(1 - (dd / tr.r) ** 2 * 0.9);
      if (top > y) {
        y = top;
        kind = 'tree';
      }
    }
  }
  if (Math.abs(x - WALL.x) < WALL.thick / 2 + 0.02 && z > WALL.z0 && z < WALL.z1 && g + WALL.height > y) {
    y = g + WALL.height;
    kind = 'wall';
  }
  return { y, kind };
}

export function surfaceHeight(x: number, z: number): number {
  return surfaceAt(x, z).y;
}

export function surfaceNormal(x: number, z: number, eps = 0.03): [number, number, number] {
  const hx = surfaceHeight(x + eps, z) - surfaceHeight(x - eps, z);
  const hz = surfaceHeight(x, z + eps) - surfaceHeight(x, z - eps);
  // a ridge or a wall edge: fall back to flat rather than a cliff
  if (Math.abs(hx) > eps * 3 || Math.abs(hz) > eps * 3) return [0, 1, 0];
  const nx = -hx, ny = 2 * eps, nz = -hz;
  const len = Math.hypot(nx, ny, nz);
  return [nx / len, ny / len, nz / len];
}

export function groundKind(x: number, z: number): SurfaceKind {
  if (edgeDistance(x, z) < 0) return 'paper';
  if (laneDistance(x, z) < 0) return 'lane';
  if (boxDistance(GREEN, x, z) < 0) return 'green';
  if (GARDENS.some((g) => boxDistance(g, x, z) < 0)) return 'garden';
  return townWeight(x, z) > 0.5 ? 'lawn' : 'field';
}

/** 1 in the village, fading to 0 out in the fields at the edges of the tile. */
export function townWeight(x: number, z: number): number {
  const e = Math.hypot(x / 9.6, z / 6.6);
  return 1 - smoothstep(0.85, 1.05, e);
}

/** Friendly words for where a plane came down. */
export function surfaceWords(kind: SurfaceKind): string {
  switch (kind) {
    case 'roof': return 'on a roof';
    case 'tower': return 'on the tower';
    case 'tree': return 'in a tree';
    case 'wall': return 'on the wall';
    case 'lane': return 'in the lane';
    case 'green': return 'on the green';
    case 'garden': return 'in a garden';
    case 'field': return 'in a field';
    default: return 'on the lawn';
  }
}

// --- the flight sheet ------------------------------------------------------------------

/**
 * The invisible surface strokes are projected onto: a gently curved sheet
 * floating over the town, higher at the far side and lower near the camera
 * (about 4–9 town metres above the roofs), domed a touch in the middle.
 */
export function sheetHeight(x: number, z: number): number {
  const far = Math.min(1.2, Math.max(-0.2, 0.5 - z / (2 * TILE.halfZ)));
  const dome = 1 - Math.min(1, (x / TILE.halfX) ** 2);
  return 2.7 + 1.2 * far + 0.22 * dome;
}

/** Where a plane may wander before it is steered back toward the town. */
export const SAFE = { halfX: TILE.halfX - 1.4, halfZ: TILE.halfZ - 1.3 };
