import type { PathPoint, StrokeToPathOptions } from '../../src/flight/path';
import type { Pt } from '../../src/interaction/stroke';
import { TILE, sheetHeight } from '../../src/scene/town';

/** A straight, level path along +x. */
export function straightPath(y = 3.2, z = 2, v = 3): PathPoint[] {
  const out: PathPoint[] = [];
  for (let x = -6; x <= 6; x += 0.12) out.push([x, y, z, v, 0]);
  return out;
}

/** A level arc turning left (anticlockwise seen from above), starting heading -z. */
export function leftArc(r = 4, y = 3.2, v = 3.5): PathPoint[] {
  const out: PathPoint[] = [];
  for (let a = 0; a <= Math.PI; a += 0.12 / r) out.push([r * Math.cos(a), y, -r * Math.sin(a), v, 0]);
  return out;
}

/** The same arc mirrored: turning right. */
export function rightArc(r = 4, y = 3.2, v = 3.5): PathPoint[] {
  return leftArc(r, y, v).map(([x, yy, z, vv, l]) => [-x, yy, z, vv, l]);
}

/**
 * A flat stand-in for the camera: 50 px per world unit, the screen centre
 * over the middle of the tile, every point landing on the flight sheet.
 */
export const flatProjection: StrokeToPathOptions = {
  project: (x, y) => {
    const wx = (x - 720) / 50, wz = (y - 450) / 50;
    return { x: wx, y: sheetHeight(wx, wz), z: wz };
  },
  inside: (x, z) => Math.abs(x) < TILE.halfX && Math.abs(z) < TILE.halfZ,
  clamp: (p) => ({ x: Math.max(-TILE.halfX, Math.min(TILE.halfX, p.x)), y: p.y, z: Math.max(-TILE.halfZ, Math.min(TILE.halfZ, p.z)) }),
};

/** A left-to-right swoop drawn in `ms` milliseconds; optionally with a little curl in the middle. */
export function swoop(withLoop: boolean, ms = 1200, n = 160): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x = 420 + t * 600;
    let y = 450 + Math.sin(t * Math.PI) * -60;
    if (withLoop && t > 0.4 && t < 0.6) {
      // a curl: a full circle of radius 40 px
      const a = ((t - 0.4) / 0.2) * Math.PI * 2;
      x = 420 + 0.4 * 600 + 120 * ((t - 0.4) / 0.2) + Math.sin(a) * 40;
      y += -(1 - Math.cos(a)) * 40;
    } else if (withLoop && t >= 0.6) {
      x = 420 + t * 600;
    }
    pts.push({ x, y, t: t * ms });
  }
  return pts;
}
