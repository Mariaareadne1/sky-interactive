// Close-ups for visual QA: node scripts/inspect.mjs <name> <flowerId|hive|bee> [distance] [height] [query]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [name = 'inspect', target = 'sc-sun1', dist = '1.6', lift = '0.6', query = 'showcase'] = process.argv.slice(2);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5386/?${query}`);
await page.waitForFunction(() => window.__sky?.engine, null, { timeout: 60000 });
await page.waitForTimeout(Number(process.env.WAIT ?? 3500));
await page.evaluate(([target, dist, lift]) => {
  const h = window.__sky; const L = h.app.living;
  let c;
  if (target === 'hive') c = L.garden.hive.group.position.clone().setY(0.8);
  else if (target === 'bee') { const b = L.colony.colony.bees.find((b) => b.state === 'forage') ?? L.colony.colony.bees.find((b) => b.state !== 'inside'); c = L.colony.renderer.drawn.get(b.id).clone(); }
  else c = L.flowers.get(target).headCentre(L.flowers.get(target).head.position.clone());
  h.engine.paused = true;
  h.engine.debugView({ x: c.x + dist * 0.15, y: c.y + lift * dist, z: c.z + dist }, c, 30);
  h.engine.paused = false;
}, [target, Number(dist), Number(lift)]);
await page.waitForTimeout(400);
await page.screenshot({ path: `artifacts/${name}.png` });
console.log(`artifacts/${name}.png`);
await browser.close();
