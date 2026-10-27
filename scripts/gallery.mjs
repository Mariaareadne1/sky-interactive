// Documentation stills: node scripts/gallery.mjs  ->  docs/media/*.jpg
// (run scripts/fold.mjs and scripts/flight.mjs loop 1 16 0.35 first for the strips)
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';

mkdirSync('docs/media', { recursive: true });
mkdirSync('artifacts', { recursive: true });
const jpg = (png, out, w = 1600) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', png, '-vf', `scale=${w}:-2`, '-q:v', '3', out]);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });

async function open(query, viewport = { width: 1600, height: 1000 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:5386/?${query}`);
  await page.waitForFunction(() => window.__sky && !window.__sky.store.get().loading, null, { timeout: 90000 });
  await page.evaluate(() => window.__sky.store.set({ uiHidden: true }));
  return page;
}
const step = (page, seconds) => page.evaluate((s) => {
  const e = window.__sky.engine;
  e.stop();
  for (let i = 0; i < Math.round(s * 60); i++) e.tick(1 / 60);
}, seconds);

// the town at rest
let page = await open('empty');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'artifacts/g-01.png' });
jpg('artifacts/g-01.png', 'docs/media/01-town.jpg');
await page.close();

// the showcase: four flights in the air, shadows on the roofs
page = await open('showcase');
await step(page, 3.4);
await page.screenshot({ path: 'artifacts/g-02.png' });
jpg('artifacts/g-02.png', 'docs/media/02-flights.jpg');
await page.close();

// first visit, with the interface and a resting plane selected
page = await open('');
await page.evaluate(() => {
  const s = window.__sky;
  s.store.set({ uiHidden: false, selection: { kind: 'plane', id: 'rest-2' } });
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'artifacts/g-03.png' });
jpg('artifacts/g-03.png', 'docs/media/03-selected.jpg');
await page.close();

// mobile portrait
page = await open('', { width: 390, height: 844 });
await page.evaluate(() => window.__sky.store.set({ uiHidden: false }));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'artifacts/g-04.png' });
jpg('artifacts/g-04.png', 'docs/media/04-mobile.jpg', 390);
await page.close();
await browser.close();

for (const [src, out] of [['artifacts/fold-sheet.png', 'docs/media/fold-strip.jpg'], ['artifacts/loop-sheet.png', 'docs/media/flight-strip.jpg']]) {
  if (existsSync(src)) jpg(src, out, 1600);
  else console.log(`missing ${src}`);
}
console.log('docs/media updated');
