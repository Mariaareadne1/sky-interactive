// GPU-synced frame benchmark with eight planes in the air: node scripts/perf.mjs [dpr=2]
// Renders back-to-back frames with a pixel readback after each (forces the GPU to finish),
// so the numbers are frame cost, not vsync. The dev machine is often busy: load is printed.
import { chromium } from '@playwright/test';
import { loadavg, cpus } from 'node:os';

const dpr = Number(process.argv[2] ?? 2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
await page.goto('http://localhost:5386/?empty');
await page.waitForFunction(() => window.__sky && !window.__sky.store.get().loading, null, { timeout: 90000 });
// eight flights, drawn with real strokes while time stands still
await page.evaluate(() => (window.__sky.engine.paused = true));
for (let i = 0; i < 8; i++) {
  const cx = 470 + (i % 4) * 160, cy = 360 + Math.floor(i / 4) * 160;
  await page.mouse.move(cx - 180, cy + 40);
  await page.mouse.down();
  for (let k = 1; k <= 30; k++) await page.mouse.move(cx - 180 + k * 12, cy + 40 - Math.sin(k / 9) * 90);
  await page.mouse.up();
}
const res = await page.evaluate(async () => {
  const s = window.__sky, e = s.engine, gl = e.renderer.getContext();
  e.paused = false;
  e.stop();
  e.adaptive = false;
  for (let i = 0; i < 60; i++) e.tick(1 / 60); // past the folds
  const flying = s.app.planes.all().filter((p) => p.state === 'flying').length;
  const px = new Uint8Array(4);
  const times = [];
  for (let i = 0; i < 150; i++) {
    const t0 = performance.now();
    e.tick(1 / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    times.push(performance.now() - t0);
  }
  e.start();
  times.sort((a, b) => a - b);
  const q = (p) => times[Math.floor(times.length * p)];
  return { median: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), p99: +q(0.99).toFixed(2), planes: s.store.doc.planes.length, flying, w: e.canvas.width, h: e.canvas.height, calls: e.renderer.info.render.calls };
});
console.log(JSON.stringify({ ...res, load: loadavg().map((l) => l.toFixed(1)).join(' '), cores: cpus().length }));
await browser.close();
