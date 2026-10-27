// GPU-synced frame benchmark: node scripts/perf.mjs [flowers=30]
// Renders back-to-back frames with a pixel readback after each (forces the GPU to finish).
import { chromium } from '@playwright/test';
import { loadavg, cpus } from 'node:os';

const n = Number(process.argv[2] ?? 30);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:5386/?empty');
await page.waitForFunction(() => window.__sky && !window.__sky.store.get().loading, null, { timeout: 90000 });
await page.evaluate((n) => {
  const h = window.__sky;
  const kinds = ['sunflower', 'rose', 'daisy', 'lavender', 'poppy', 'allium', 'foxglove'];
  const beds = [[-5.5, 3.3, 2.0, 1.4], [4.5, 1.4, 2.8, 1.6], [2.6, -3.9, 3.0, 0.7]];
  const flowers = Array.from({ length: n }, (_, i) => {
    const b = beds[i % 3];
    return { id: `p${i}`, kind: kinds[i % 7], x: b[0] + (((i * 0.37) % 1) - 0.5) * b[2] * 1.8, z: b[1] + (((i * 0.61) % 1) - 0.5) * b[3] * 1.8, heading: 0, height: 1.3, stem: [[0, 0], [0.05, 0.5], [0, 1]], palette: i, seed: i, scale: 1, open: true };
  });
  h.app.loadDoc({ version: 1, flowers, hive: h.store.doc.hive });
}, n);
await page.waitForFunction(() => window.__sky.app.living.colony.colony.bees.filter((b) => b.state !== 'inside').length >= 13, null, { timeout: 90000 });
const res = await page.evaluate(async () => {
  const h = window.__sky, e = h.engine, gl = e.renderer.getContext();
  e.stop();
  e.adaptive = false;
  const px = new Uint8Array(4);
  const times = [];
  for (let i = 0; i < 240; i++) {
    const t0 = performance.now();
    e.tick(1 / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    times.push(performance.now() - t0);
  }
  e.start();
  times.sort((a, b) => a - b);
  const q = (p) => times[Math.floor(times.length * p)];
  return { median: q(0.5), p90: q(0.9), p99: q(0.99), bees: h.app.living.colony.colony.bees.filter((b) => b.state !== 'inside').length, flowers: h.store.doc.flowers.length, w: e.canvas.width, ht: e.canvas.height, calls: e.renderer.info.render.calls };
});
console.log(JSON.stringify({ ...res, load: loadavg().map((l) => l.toFixed(1)).join(' '), cores: cpus().length }));
await browser.close();
