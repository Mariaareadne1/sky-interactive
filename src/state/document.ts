import type { PathPoint } from '../flight/path';
import { MAX_PATH_POINTS } from '../flight/path';
import { buildFlight } from '../flight/flight';
import { TILE } from '../scene/town';

/**
 * The persisted sky: plain, versioned, immutable data. Each plane keeps the
 * flight it was drawn with and where it last came to rest (null while its
 * first flight is still in the air). Everything else — where it is right
 * now, its fold, its wobble — is a pure function of these and time.
 */

export interface Landed {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
}

export interface PlaneRecord {
  readonly id: string;
  readonly path: readonly PathPoint[];
  readonly landed: Landed | null;
  readonly seed: number;
}

export interface SkyDoc {
  readonly version: 1;
  readonly planes: readonly PlaneRecord[];
}

export const DOC_VERSION = 1;
export const MAX_PLANES = 8;

export const emptyDoc = (): SkyDoc => ({ version: DOC_VERSION, planes: [] });

let counter = 0;
export function newPlaneId(): string {
  counter = (counter + 1) % 1e6;
  return `p${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newSeed(): number {
  return Math.floor(Math.random() * 1e6);
}

export const findPlane = (doc: SkyDoc, id: string) => doc.planes.find((p) => p.id === id) ?? null;

/** Add a plane; past the cap, the oldest one gives up its place. */
export function addPlane(doc: SkyDoc, plane: PlaneRecord): SkyDoc {
  return { ...doc, planes: [...doc.planes, plane].slice(-MAX_PLANES) };
}

export function removePlane(doc: SkyDoc, id: string): SkyDoc {
  return { ...doc, planes: doc.planes.filter((p) => p.id !== id) };
}

export function updatePlane(doc: SkyDoc, id: string, patch: Partial<Omit<PlaneRecord, 'id'>>): SkyDoc {
  return { ...doc, planes: doc.planes.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

// --- validation -----------------------------------------------------------------------

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const within = (n: unknown, lim: number): n is number => finite(n) && Math.abs(n) <= lim;
const LIMIT_X = TILE.halfX + 3, LIMIT_Z = TILE.halfZ + 3, LIMIT_Y = 12;

function parsePoint(raw: unknown): PathPoint | null {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length > 5) return null;
  const [x, y, z, v, l = 0] = raw;
  if (!within(x, LIMIT_X) || !finite(y) || y < -1 || y > LIMIT_Y || !within(z, LIMIT_Z) || !finite(v) || v <= 0 || v > 20) return null;
  return [x, y, z, v, l === 1 ? 1 : 0];
}

function parseLanded(raw: unknown): Landed | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'object' || raw === undefined) return undefined;
  const o = raw as Record<string, unknown>;
  if (!within(o.x, LIMIT_X) || !finite(o.y) || o.y < -1 || o.y > LIMIT_Y || !within(o.z, LIMIT_Z) || !finite(o.heading)) return undefined;
  return { x: o.x, y: o.y, z: o.z, heading: o.heading };
}

function parsePlane(raw: unknown): PlaneRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 64) return null;
  if (!Array.isArray(o.path) || o.path.length < 2 || o.path.length > MAX_PATH_POINTS) return null;
  const path: PathPoint[] = [];
  for (const p of o.path) {
    const q = parsePoint(p);
    if (!q) return null;
    path.push(q);
  }
  const landed = parseLanded(o.landed ?? null);
  if (landed === undefined) return null;
  if (!finite(o.seed)) return null;
  return { id: o.id, path, landed, seed: Math.floor(o.seed) };
}

/** Validate untrusted JSON (storage or an imported file). Bad planes are dropped; a bad shape is rejected. */
export function parseDoc(raw: unknown): SkyDoc | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== DOC_VERSION || !Array.isArray(o.planes)) return null;
  const planes: PlaneRecord[] = [];
  const ids = new Set<string>();
  for (const p of o.planes.slice(0, MAX_PLANES * 4)) {
    const plane = parsePlane(p);
    if (plane && !ids.has(plane.id)) {
      ids.add(plane.id);
      planes.push(plane);
    }
  }
  return { version: DOC_VERSION, planes: planes.slice(-MAX_PLANES) };
}

// --- built-in scenes ----------------------------------------------------------------------

/** A path from a parametric curve over the town (world units), with a steady drawn speed. */
function curve(f: (t: number) => [number, number, number], v: number, loops: [number, number][] = []): PathPoint[] {
  const out: PathPoint[] = [];
  let prev = f(0);
  out.push([...prev, v, 0]);
  for (let t = 0.002; t <= 1; t += 0.002) {
    const p = f(t);
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) < 0.12) continue;
    const inLoop = loops.some(([a, b]) => t > a && t < b) ? 1 : 0;
    out.push([...p, v, inLoop]);
    prev = p;
  }
  return out.map(([x, y, z, vv, l]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000, vv, l]);
}

/** A long swoop over the town with one loop-the-loop in the middle. */
export function swoopWithLoop(): PathPoint[] {
  const loopAt = 0.45, loopLen = 0.12, R = 0.8;
  return curve((t) => {
    // the ground track: a lazy S from the near left to the far right
    const track = (u: number): [number, number] => [-8.5 + u * 16, 4.5 - u * 9 + Math.sin(u * Math.PI * 1.6) * 2.4];
    if (t > loopAt && t < loopAt + loopLen) {
      const [x0, z0] = track(loopAt), [x1, z1] = track(loopAt + 0.01);
      const dl = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / dl, dz = (z1 - z0) / dl;
      const phi = ((t - loopAt) / loopLen) * Math.PI * 2;
      return [x0 + dx * R * Math.sin(phi), 3.3 + R * (1 - Math.cos(phi)), z0 + dz * R * Math.sin(phi)];
    }
    const u = t < loopAt ? t : t - loopLen;
    const [x, z] = track(u / (1 - loopLen));
    return [x, 3.3 + 0.25 * Math.sin(t * 9), z];
  }, 3.6, [[loopAt + 0.004, loopAt + loopLen - 0.004]]);
}

const SHOWCASE: { path: () => PathPoint[]; seed: number }[] = [
  { path: swoopWithLoop, seed: 11 },
  // a wide circle round the church tower
  { path: () => curve((t) => [-8.2 + 3.2 * Math.cos(t * Math.PI * 1.7), 3.6 - t * 0.5, -3.7 - 2.6 * Math.sin(t * Math.PI * 1.7)], 3.0), seed: 23 },
  // a quick dash across the green
  { path: () => curve((t) => [3 - t * 8, 3.0 - Math.sin(t * Math.PI) * 0.4, 6 - t * 3 + Math.sin(t * 6) * 0.6], 5.5), seed: 37 },
  // a lazy curve over the high street
  { path: () => curve((t) => [6 + Math.sin(t * 3) * 2, 3.4, -6 + t * 9], 2.4), seed: 41 },
];

function plane(id: string, path: PathPoint[], seed: number, landed: Landed | null): PlaneRecord {
  return { id, path, seed, landed };
}

/** Where a path's flight comes to rest, worked out ahead of time. */
function settled(path: PathPoint[], seed: number): Landed {
  const { rest } = buildFlight(path, { seed });
  return { x: rest.x, y: rest.y, z: rest.z, heading: rest.heading };
}

/** First visit: a couple of planes already resting in town, waiting to be flown again. */
export function defaultDoc(): SkyDoc {
  const a = SHOWCASE[1], b = SHOWCASE[2];
  return { version: DOC_VERSION, planes: [plane('rest-1', a.path(), a.seed, settled(a.path(), a.seed)), plane('rest-2', b.path(), b.seed, settled(b.path(), b.seed))] };
}

/** Several flights in the air at once. */
export function showcaseDoc(): SkyDoc {
  return { version: DOC_VERSION, planes: SHOWCASE.map((s, i) => plane(`show-${i}-${Date.now().toString(36)}`, s.path(), s.seed, null)) };
}
