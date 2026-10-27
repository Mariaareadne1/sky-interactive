// Scripted ~23 s demo, recorded by the app's own ink-compositing recorder.
// node scripts/demo.mjs [width] [height]  ->  artifacts/hive-demo.(mp4|webm)
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { shapePoints } from './shapes.mjs';

const [W = '1600', H = '900'] = process.argv.slice(2);
const w = Number(W), h = Number(H);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5386/?empty');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__sky && !window.__sky.store.get().loading, null, { timeout: 90000 });
await page.waitForTimeout(2500);
const sleep = (ms) => page.waitForTimeout(ms);
const ground = (x, z) => page.evaluate(([x, z]) => {
  const hv = window.__sky, p = hv.engine.camera.position.clone().set(x, 0.1, z).project(hv.engine.camera);
  return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
}, [x, z]);

async function draw(shape, x, z, ms = 1000, scale = 1) {
  const [cx, cy] = await ground(x, z);
  const raw = shapePoints(shape, cx, cy);
  // strokes are described around their base; scale about the base
  const by = Math.max(...raw.map((p) => p[1]));
  const pts = raw.map(([px, py]) => [cx + (px - cx) * scale, by + (py - by) * scale]);
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    await page.mouse.move(p[0], p[1]);
    await sleep(ms / pts.length);
  }
  await page.mouse.up();
}

await page.evaluate(() => {
  const m = window.__sky;
  m.store.set({ uiHidden: true, hasDrawn: true });
  m.engine.adaptive = false;
  // a sleepy hive: the first bee peeks out early
  window.__demoDone = new Promise((r) => (window.__finishDemo = r));
  window.__demo = import('/src/capture/recorder.ts').then(({ recordCanvas }) =>
    recordCanvas(m.engine.canvas, { seconds: 40, ink: m.input.ink, until: window.__demoDone }),
  );
});
await sleep(2000);
await draw('line', 1.6, -3.7, 1300, 1.25);                 // a tall line in the back bed: a sunflower
await sleep(1500);
await page.evaluate(() => {
  const hv = window.__sky, f = hv.store.doc.flowers[0];
  hv.app.flower.callBee(f.id);                             // the bee wakes and goes to it
});
await sleep(2400);
await draw('spiral', 4.0, 1.3, 1000, 1.5);                      // a rose
await sleep(300);
await draw('loops', 6.2, 1.6, 1000, 1.5);                       // lavender
await sleep(300);
await draw('circle', -5.4, 3.4, 700, 1.5);                      // a poppy
await sleep(1800);                                          // more bees come out
await page.evaluate(() => {
  const hv = window.__sky, rose = hv.store.doc.flowers.find((f) => f.kind === 'rose');
  hv.store.set({ selection: { kind: 'flower', id: rose.id } });
  hv.app.flower.water(rose.id);
  hv.store.set({ selection: null });
});
await sleep(2000);
await page.evaluate(() => window.__sky.app.bees.swarm());
await sleep(2600);
for (let i = 0; i <= 30; i++) {                             // golden hour
  await page.evaluate((t) => window.__sky.app.bees.setGolden(t), i / 30);
  await sleep(60);
}
await sleep(2000);
await page.evaluate(() => window.__finishDemo());
const out = await page.evaluate(async () => {
  const rec = await window.__demo;
  const buf = new Uint8Array(await rec.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), ext: rec.extension, ms: rec.durationMs, type: rec.type };
});
const file = `artifacts/hive-demo.${out.ext}`;
writeFileSync(file, Buffer.from(out.b64, 'base64'));
console.log(file, out.type, `${(out.ms / 1000).toFixed(1)} s`);
await browser.close();
