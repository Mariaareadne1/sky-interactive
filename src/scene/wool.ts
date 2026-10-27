import { noise3, seededRandom } from './noise';
import { smin, type SDF } from './sdf';

/**
 * Turns a smooth body field into a soft clumped surface (hedges, ferns, bee
 * fuzz): rounded puffs are scattered over the surface and smoothly unioned with a
 * slightly shrunken body, giving painterly cauliflower clumping, then fine
 * curl noise on top. (Adapted from MEADOW's fleece.)
 */

interface Puff { x: number; y: number; z: number; r: number }

export interface WoolOptions {
  seed: number;
  min: [number, number, number];
  max: [number, number, number];
  inset: number;
  layers: { count: number; rMin: number; rMax: number }[];
  blend: number;
  curl: number;
  /** Optional mask (0..1) that scales puff size by position — e.g. tighter wool on the legs. */
  sizeAt?: (x: number, y: number, z: number) => number;
}

function gradient(f: SDF, x: number, y: number, z: number): [number, number, number] {
  const e = 0.004;
  const gx = f(x + e, y, z) - f(x - e, y, z);
  const gy = f(x, y + e, z) - f(x, y - e, z);
  const gz = f(x, y, z + e) - f(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

function scatterPuffs(base: SDF, opts: WoolOptions): Puff[] {
  const rand = seededRandom(opts.seed);
  const puffs: Puff[] = [];
  const [x0, y0, z0] = opts.min;
  const [x1, y1, z1] = opts.max;
  for (const layer of opts.layers) {
    let placed = 0;
    let attempts = 0;
    while (placed < layer.count && attempts < layer.count * 400) {
      attempts++;
      let x = x0 + rand() * (x1 - x0);
      let y = y0 + rand() * (y1 - y0);
      let z = z0 + rand() * (z1 - z0);
      const d = base(x, y, z);
      if (Math.abs(d) > 0.05) continue;
      const [gx, gy, gz] = gradient(base, x, y, z);
      x -= gx * d;
      y -= gy * d;
      z -= gz * d;
      const scale = opts.sizeAt ? opts.sizeAt(x, y, z) : 1;
      if (scale <= 0.05) continue;
      const r = (layer.rMin + rand() * (layer.rMax - layer.rMin)) * scale;
      puffs.push({ x, y, z, r });
      placed++;
    }
  }
  return puffs;
}

export function woolField(base: SDF, opts: WoolOptions): SDF {
  const puffs = scatterPuffs(base, opts);
  const maxR = puffs.reduce((m, p) => Math.max(m, p.r), 0.01);
  const cellSize = maxR * 2 + opts.blend;

  // dense CSR grid over the puffs' bounds: cell -> contiguous run of puff data
  let gx0 = Infinity, gy0 = Infinity, gz0 = Infinity;
  for (const p of puffs) { gx0 = Math.min(gx0, p.x); gy0 = Math.min(gy0, p.y); gz0 = Math.min(gz0, p.z); }
  gx0 -= cellSize; gy0 -= cellSize; gz0 -= cellSize;
  let gnx = 1, gny = 1, gnz = 1;
  for (const p of puffs) {
    gnx = Math.max(gnx, Math.floor((p.x - gx0) / cellSize) + 2);
    gny = Math.max(gny, Math.floor((p.y - gy0) / cellSize) + 2);
    gnz = Math.max(gnz, Math.floor((p.z - gz0) / cellSize) + 2);
  }
  const cellOf = (p: Puff) =>
    Math.floor((p.x - gx0) / cellSize) + gnx * (Math.floor((p.y - gy0) / cellSize) + gny * Math.floor((p.z - gz0) / cellSize));
  const counts = new Int32Array(gnx * gny * gnz + 1);
  for (const p of puffs) counts[cellOf(p) + 1]++;
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
  const fill = counts.slice();
  const data = new Float32Array(puffs.length * 4);
  for (const p of puffs) {
    const o = fill[cellOf(p)]++ * 4;
    data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.z; data[o + 3] = p.r;
  }

  const { inset, blend, curl } = opts;
  return (x, y, z) => {
    let d = base(x, y, z) + inset;
    // far from the surface the puffs cannot matter: return a cheap, still-valid bound
    if (d > maxR * 2.5) return d - inset;
    if (d < -maxR * 1.5) return d;
    const ci = Math.floor((x - gx0) / cellSize);
    const cj = Math.floor((y - gy0) / cellSize);
    const ck = Math.floor((z - gz0) / cellSize);
    for (let k = Math.max(0, ck - 1); k <= Math.min(gnz - 1, ck + 1); k++) {
      for (let j = Math.max(0, cj - 1); j <= Math.min(gny - 1, cj + 1); j++) {
        for (let i = Math.max(0, ci - 1); i <= Math.min(gnx - 1, ci + 1); i++) {
          const c = i + gnx * (j + gny * k);
          for (let n = counts[c]; n < counts[c + 1]; n++) {
            const o = n * 4;
            const dx = x - data[o], dy = y - data[o + 1], dz = z - data[o + 2];
            d = smin(d, Math.sqrt(dx * dx + dy * dy + dz * dz) - data[o + 3], blend);
          }
        }
      }
    }
    return d + curl * noise3(x * 48, y * 48, z * 48) + curl * 0.5 * noise3(x * 110 + 3.1, y * 110, z * 110);
  };
}
