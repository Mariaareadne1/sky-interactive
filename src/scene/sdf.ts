import * as THREE from 'three';

/** Signed distance helpers and a naive surface-nets mesher. */

export type SDF = (x: number, y: number, z: number) => number;

export function sdEllipsoid(
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number,
): number {
  const px = (x - cx) / rx;
  const py = (y - cy) / ry;
  const pz = (z - cz) / rz;
  const k0 = Math.hypot(px, py, pz);
  const k1 = Math.hypot(px / rx, py / ry, pz / rz);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

export function sdCapsule(
  x: number, y: number, z: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number,
): number {
  const pax = x - ax, pay = y - ay, paz = z - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

/** Polynomial smooth minimum. */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export interface MeshOptions {
  min: [number, number, number];
  max: [number, number, number];
  cell: number;
  /** Extra per-vertex attribute derived from the field (e.g. ambient occlusion). */
  ao?: boolean;
}

/**
 * Surface nets: one vertex per sign-changing cell, placed at the mean of its
 * edge crossings, joined into quads across every sign-changing grid edge.
 * Normals come from the field gradient, so the result shades smoothly.
 */
export function meshSDF(sdf: SDF, opts: MeshOptions): THREE.BufferGeometry {
  const { min, max, cell } = opts;
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const field = new Float32Array(nx * ny * nz);
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);

  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * cell;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * cell;
      for (let i = 0; i < nx; i++) field[idx(i, j, k)] = sdf(min[0] + i * cell, y, z);
    }
  }

  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const positions: number[] = [];
  const cornerOffsets = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const vals = new Float32Array(8);

  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = cornerOffsets[c];
          vals[c] = field[idx(i + o[0], j + o[1], k + o[2])];
          if (vals[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          const va = vals[a];
          const vb = vals[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          const oa = cornerOffsets[a];
          const ob = cornerOffsets[b];
          sx += oa[0] + (ob[0] - oa[0]) * t;
          sy += oa[1] + (ob[1] - oa[1]) * t;
          sz += oa[2] + (ob[2] - oa[2]) * t;
          n++;
        }
        cellVertex[idx(i, j, k)] = positions.length / 3;
        positions.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
      }
    }
  }

  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, b, c, d);
    else indices.push(a, b, c, c, b, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const inside = field[idx(i, j, k)] < 0;
        // x-edge (i,j,k)->(i+1,j,k): cells sharing it vary in j,k
        if (i < nx - 1 && inside !== field[idx(i + 1, j, k)] < 0) {
          quad(cellVertex[idx(i, j - 1, k - 1)], cellVertex[idx(i, j, k - 1)], cellVertex[idx(i, j - 1, k)], cellVertex[idx(i, j, k)], !inside);
        }
        if (j < ny - 1 && inside !== field[idx(i, j + 1, k)] < 0) {
          quad(cellVertex[idx(i - 1, j, k - 1)], cellVertex[idx(i - 1, j, k)], cellVertex[idx(i, j, k - 1)], cellVertex[idx(i, j, k)], !inside);
        }
        if (k < nz - 1 && inside !== field[idx(i, j, k + 1)] < 0) {
          quad(cellVertex[idx(i - 1, j - 1, k)], cellVertex[idx(i, j - 1, k)], cellVertex[idx(i - 1, j, k)], cellVertex[idx(i, j, k)], !inside);
        }
      }
    }
  }

  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);
  const ao = opts.ao ? new Float32Array(count) : null;
  const e = cell * 0.5;
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    let gx = sdf(x + e, y, z) - sdf(x - e, y, z);
    let gy = sdf(x, y + e, z) - sdf(x, y - e, z);
    let gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const len = Math.hypot(gx, gy, gz) || 1;
    gx /= len; gy /= len; gz /= len;
    normals[v * 3] = gx;
    normals[v * 3 + 1] = gy;
    normals[v * 3 + 2] = gz;
    if (ao) {
      // field-sampled ambient occlusion: how quickly the field closes in along the normal
      let occ = 0;
      let scale = 1;
      for (let s = 1; s <= 5; s++) {
        const h = 0.012 * s + 0.004 * s * s;
        occ += (h - sdf(x + gx * h, y + gy * h, z + gz * h)) * scale;
        scale *= 0.7;
      }
      ao[v] = Math.max(0, Math.min(1, 1 - 4.2 * occ));
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (ao) geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
