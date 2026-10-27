// The origami fold-in, frame by frame, close up at 2x:
// node scripts/fold.mjs [frames=8]  -> artifacts/fold-NN.png, artifacts/fold-sheet.png
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const frames = Number(process.argv[2] ?? 8);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5386/?empty');
await page.waitForFunction(() => window.__sky && !window.__sky.store.get().loading, null, { timeout: 90000 });
await page.evaluate(() => {
  const s = window.__sky;
  s.store.set({ uiHidden: true });
  s.engine.stop();
});
// a stroke over the green, drawn left to right
await page.mouse.move(560, 520);
await page.mouse.down();
for (let i = 1; i <= 40; i++) await page.mouse.move(560 + i * 9, 520 - Math.sin(i / 13) * 60);
await page.mouse.up();
const files = [];
for (let f = 0; f < frames; f++) {
  await page.evaluate((k) => {
    const e = window.__sky.engine;
    if (k > 0) for (let i = 0; i < 6; i++) e.tick(1 / 60);
    else e.tick(1 / 60);
  }, f);
  const at = await page.evaluate(() => {
    const s = window.__sky, p = s.app.planes.all()[0];
    const v = p.position.clone().project(s.engine.camera);
    return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  });
  const file = `artifacts/fold-${String(f).padStart(2, '0')}.png`;
  await page.screenshot({ path: file, clip: { x: at[0] - 90, y: at[1] - 70, width: 180, height: 140 } });
  files.push(file);
}
execFileSync('node', ['scripts/sheet.mjs', 'artifacts/fold-sheet.png', ...files], { stdio: 'inherit' });
await browser.close();
