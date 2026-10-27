// Documentation stills: node scripts/gallery.mjs  ->  docs/media/*.jpg
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
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

// the hero: a busy garden, bees out
let page = await open('showcase');
await page.waitForTimeout(14000);
await page.screenshot({ path: 'artifacts/g-01.png' });
jpg('artifacts/g-01.png', 'docs/media/01-garden.jpg');
// golden hour over the same garden
await page.evaluate(() => window.__sky.app.bees.setGolden(1));
await page.waitForTimeout(4000);
await page.screenshot({ path: 'artifacts/g-02.png' });
jpg('artifacts/g-02.png', 'docs/media/02-golden-hour.jpg');
// with the interface and a selection
await page.evaluate(() => { const h = window.__sky; h.app.bees.setGolden(0); h.store.set({ uiHidden: false, selection: { kind: 'flower', id: 'sc-sun1' } }); });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'artifacts/g-03.png' });
jpg('artifacts/g-03.png', 'docs/media/03-selected.jpg');
await page.close();

// mobile portrait
page = await open('showcase', { width: 390, height: 844 });
await page.evaluate(() => window.__sky.store.set({ uiHidden: false }));
await page.waitForTimeout(8000);
await page.screenshot({ path: 'artifacts/g-04.png' });
jpg('artifacts/g-04.png', 'docs/media/04-mobile.jpg', 390);
await page.close();
await browser.close();

// strips made by draw.mjs and inspect.mjs, if present
try {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', 'artifacts/g-sun-strip.png', '-vf', 'scale=1600:-2', '-q:v', '3', 'docs/media/reveal-strip.jpg']);
} catch {
  console.log('run scripts/draw.mjs g-sun line first for the reveal strip');
}
console.log('docs/media updated');
