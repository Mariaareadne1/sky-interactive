import { describe, expect, it } from 'vitest';
import { findLoops, speedFromDrawing, strokeToPath, MAX_SPEED, MIN_SPEED } from '../../src/flight/path';
import { sheetHeight } from '../../src/scene/town';
import { flatProjection, swoop } from './fixtures';

describe('stroke → path', () => {
  it('finds no loops in a plain swoop and one in a curl', () => {
    expect(findLoops(swoop(false))).toHaveLength(0);
    const loops = findLoops(swoop(true));
    expect(loops).toHaveLength(1);
    expect(loops[0].end).toBeGreaterThan(loops[0].start + 2);
  });

  it('finds one loop per curl in a curly line', () => {
    const pts = [];
    for (let i = 0; i <= 300; i++) {
      const t = i / 100;
      const a = t * Math.PI * 2;
      pts.push({ x: 400 + t * 120 + Math.sin(a) * 35, y: 450 - (1 - Math.cos(a)) * 35 });
    }
    expect(findLoops(pts)).toHaveLength(3);
  });

  it('projects onto the flight sheet and resamples evenly', () => {
    const r = strokeToPath(swoop(false), flatProjection);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const [x, y, z] of r.path) expect(y).toBeCloseTo(sheetHeight(x, z), 1);
    for (let i = 1; i < r.path.length - 1; i++) {
      const d = Math.hypot(r.path[i][0] - r.path[i - 1][0], r.path[i][1] - r.path[i - 1][1], r.path[i][2] - r.path[i - 1][2]);
      expect(d).toBeGreaterThan(0.05);
      expect(d).toBeLessThan(0.2);
    }
    expect(r.u[0]).toBe(0);
    expect(r.u[r.u.length - 1]).toBeCloseTo(1, 2);
  });

  it('maps drawing speed to flying speed: slow strokes glide, flicks zip', () => {
    const slow = strokeToPath(swoop(false, 4000), flatProjection);
    const fast = strokeToPath(swoop(false, 300), flatProjection);
    if (!slow.ok || !fast.ok) throw new Error('rejected');
    const avg = (p: typeof slow.path) => p.reduce((s, q) => s + q[3], 0) / p.length;
    expect(avg(fast.path)).toBeGreaterThan(avg(slow.path) * 1.6);
    expect(speedFromDrawing(0.1)).toBe(MIN_SPEED);
    expect(speedFromDrawing(1000)).toBe(MAX_SPEED);
  });

  it('lifts a loop into a vertical circle above the line', () => {
    const r = strokeToPath(swoop(true), flatProjection);
    if (!r.ok) throw new Error('rejected');
    const loopPts = r.path.filter((p) => p[4] === 1);
    expect(loopPts.length).toBeGreaterThan(20);
    const base = Math.min(...loopPts.map((p) => p[1]));
    const top = Math.max(...loopPts.map((p) => p[1]));
    expect(top - base).toBeGreaterThan(0.9);
  });

  it('flattens loops when motion is reduced', () => {
    const r = strokeToPath(swoop(true), { ...flatProjection, reducedMotion: true });
    if (!r.ok) throw new Error('rejected');
    expect(r.loops).toBe(0);
    expect(r.path.every((p) => p[4] === 0)).toBe(true);
  });

  it('rejects strokes that are too short or start off the town', () => {
    expect(strokeToPath([{ x: 700, y: 450 }, { x: 710, y: 452 }], flatProjection)).toEqual({ ok: false, reason: 'short' });
    const off = swoop(false).map((p) => ({ ...p, x: p.x - 1100 }));
    expect(strokeToPath(off, flatProjection)).toEqual({ ok: false, reason: 'off' });
  });
});
