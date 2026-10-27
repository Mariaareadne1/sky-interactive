import { describe, expect, it } from 'vitest';
import { buildFoldModel, DEFAULT_SHAPE, foldedPositions } from '../../src/plane/fold';
import { KEEL } from '../../src/flight/flight';

const model = buildFoldModel();
const n = model.flat.length / 2;
const at = (progress: number, flex = 0) => foldedPositions(model, progress, flex, new Float32Array(n * 3));

function extent(p: Float32Array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], p[i * 3 + k]);
    max[k] = Math.max(max[k], p[i * 3 + k]);
  }
  return { min, max };
}

describe('the fold', () => {
  it('starts as a flat square sheet', () => {
    const { min, max } = extent(at(0));
    expect(max[1] - min[1]).toBeLessThan(1e-6);
    expect(max[0] - min[0]).toBeCloseTo(DEFAULT_SHAPE.size, 5);
    expect(max[2] - min[2]).toBeCloseTo(DEFAULT_SHAPE.size, 5);
  });

  it('ends as a dart: symmetric, pointed nose forward, keel below, wings spread', () => {
    const p = at(1);
    const { min, max } = extent(p);
    // symmetric about the keel
    expect(max[0] + min[0]).toBeCloseTo(0, 2);
    // narrower than the sheet it came from, about as long
    expect(max[0] - min[0]).toBeLessThan(DEFAULT_SHAPE.size * 0.9);
    expect(max[0] - min[0]).toBeGreaterThan(DEFAULT_SHAPE.size * 0.35);
    expect(max[2] - min[2]).toBeGreaterThan(DEFAULT_SHAPE.size * 0.9);
    // the keel hangs about KEEL below the origin
    expect(min[1]).toBeGreaterThan(-KEEL * 1.3);
    expect(min[1]).toBeLessThan(-KEEL * 0.6);
    // the nose is a point: near the front, the plane is narrow
    let noseWidth = 0;
    for (let i = 0; i < n; i++) if (p[i * 3 + 2] > max[2] - 0.05) noseWidth = Math.max(noseWidth, Math.abs(p[i * 3]));
    expect(noseWidth).toBeLessThan(0.08);
  });

  it('folds continuously, crease by crease', () => {
    let prev = at(0);
    for (let k = 1; k <= 200; k++) {
      const cur = at(k / 200);
      let maxMove = 0;
      for (let i = 0; i < cur.length; i++) {
        expect(Number.isFinite(cur[i])).toBe(true);
        maxMove = Math.max(maxMove, Math.abs(cur[i] - prev[i]));
      }
      expect(maxMove).toBeLessThan(0.08);
      prev = cur;
    }
  });

  it('bends the wings up under load', () => {
    const still = extent(at(1, 0)).max[1];
    const flexed = extent(at(1, 1)).max[1];
    expect(flexed).toBeGreaterThan(still + 0.005);
  });
});
