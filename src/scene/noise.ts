// Deterministic value noise for CPU-side geometry (terrain heights, wool SDF).
// The GLSL twin lives in shaderChunks.ts; the two do not need to match because
// the CPU noise shapes geometry and the GPU noise only shades it.

function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function hash3(ix: number, iy: number, iz: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 2D value noise in [-1, 1]. */
export function noise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy) * 2 - 1;
}

/** 3D value noise in [-1, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const n000 = hash3(ix, iy, iz);
  const n100 = hash3(ix + 1, iy, iz);
  const n010 = hash3(ix, iy + 1, iz);
  const n110 = hash3(ix + 1, iy + 1, iz);
  const n001 = hash3(ix, iy, iz + 1);
  const n101 = hash3(ix + 1, iy, iz + 1);
  const n011 = hash3(ix, iy + 1, iz + 1);
  const n111 = hash3(ix + 1, iy + 1, iz + 1);
  const x00 = lerp(n000, n100, fx);
  const x10 = lerp(n010, n110, fx);
  const x01 = lerp(n001, n101, fx);
  const x11 = lerp(n011, n111, fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz) * 2 - 1;
}

export function fbm2(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq + i * 17.3, y * freq - i * 9.1);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

/** Mulberry32 — small seeded PRNG for stable per-sheep variation. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
