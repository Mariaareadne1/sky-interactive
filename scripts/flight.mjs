// Film a drawn flight frame by frame (fixed-step, deterministic):
// node scripts/flight.mjs [name=flight] [curl=1] [frames=8] [every=0.6]
// -> artifacts/<name>-NN.png and a contact sheet artifacts/<name>-sheet.png
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [name = 'flight', curl = '1', frames = '8', every = '0.6'] = process.argv.slice(2);
const base = process.env.SKY_URL ?? 'http://localhost:5386/';
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await page.goto(base + '?empty');
await page.waitForFunction(() => window.__sky && !window.__sky.store.get().loading, null, { timeout: 90000 });
await page.waitForTimeout(800);
console.log(await page.evaluate(() => import('/src/scene/town.ts').then((m) => ({ houses: m.HOUSES.length, gardens: m.GARDENS.length, trees: m.TREES.length }))));

// a swoop across the town, with a curl in the middle
const pts = [];
const n = 120, cx = 700, cy = 470, w = 640;
for (let i = 0; i <= n; i++) {
  const t = i / n;
  let x = cx - w / 2 + t * w, y = cy + 40 - Math.sin(t * Math.PI) * 150;
  if (curl === '1' && t > 0.45 && t < 0.6) {
    const a = ((t - 0.45) / 0.15) * Math.PI * 2;
    x = cx - w / 2 + 0.45 * w + (t - 0.45) * w * 0.5 + Math.sin(a) * 42;
    y -= (1 - Math.cos(a)) * 42;
  } else if (curl === '1' && t >= 0.6) x -= 0.15 * w * 0.5;
  pts.push([x, y]);
}
await page.mouse.move(...pts[0]);
await page.mouse.down();
for (const p of pts.slice(1)) {
  await page.mouse.move(p[0], p[1]);
  await page.waitForTimeout(8);
}
await page.mouse.up();
await page.evaluate(() => {
  const e = window.__sky.engine;
  e.stop();
  e.adaptive = false;
});
const files = [];
for (let f = 0; f < Number(frames); f++) {
  await page.evaluate((dt) => {
    const e = window.__sky.engine;
    const steps = Math.round(dt * 60);
    for (let i = 0; i < steps; i++) e.tick(1 / 60);
  }, f === 0 ? 0.05 : Number(every));
  const file = `artifacts/${name}-${String(f).padStart(2, '0')}.png`;
  // a close crop around the plane (and down-right of it, where its shadow falls)
  const at = await page.evaluate(() => {
    const s = window.__sky, p = s.store.doc.planes[0] && s.app.planes.get(s.store.doc.planes[0].id);
    if (!p) return null;
    const v = p.position.clone().project(s.engine.camera);
    return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  });
  const clip = at ? { x: Math.max(0, Math.min(1440 - 420, at[0] - 150)), y: Math.max(0, Math.min(900 - 300, at[1] - 110)), width: 420, height: 300 } : undefined;
  await page.screenshot({ path: file, clip });
  files.push(file);
}
const info = await page.evaluate(() => {
  const s = window.__sky;
  const p = s.store.doc.planes[0];
  const live = p && s.app.planes.get(p.id);
  return p && { points: p.path.length, loops: p.path.filter((q) => q[4]).length, state: live?.state, landed: p.landed, pos: live?.position.toArray().map((v) => +v.toFixed(2)) };
});
console.log(JSON.stringify(info));
execFileSync('node', ['scripts/sheet.mjs', `artifacts/${name}-sheet.png`, ...files], { stdio: 'inherit' });
await browser.close();
