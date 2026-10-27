// Screenshot helper for visual QA: node scripts/shoot.mjs <name> [query] [w] [h] [waitMs]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [name = 'shot', query = '', w = '1440', h = '900', wait = '2500'] = process.argv.slice(2);
const base = process.env.SKY_URL ?? 'http://localhost:5386/';
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(base + (query ? `?${query}` : ''));
await page.waitForTimeout(Number(wait));
if (process.env.SKY_EVAL) {
  const out = await page.evaluate(process.env.SKY_EVAL);
  if (out !== undefined) console.log('eval:', JSON.stringify(out));
  await page.waitForTimeout(Number(process.env.SKY_EVAL_WAIT ?? 800));
}
await page.screenshot({ path: `artifacts/${name}.png` });
const fps = await page.evaluate(() => window.__sky?.engine?.fps);
console.log(`artifacts/${name}.png fps=${fps?.toFixed?.(1)}`);
for (const l of logs.slice(0, 20)) console.log(l);
await browser.close();
