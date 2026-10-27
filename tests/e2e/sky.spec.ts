import { expect, test, type Page } from '@playwright/test';
import { captureStats, drawStroke, openSky, planes, planeState, swoopPoints } from './helpers';
import { surfaceHeight } from '../../src/scene/town';

/** Step the engine deterministically by `seconds` (it keeps running afterwards). */
async function advance(page: Page, seconds: number): Promise<void> {
  await page.evaluate((s) => {
    const e = window.__sky!.engine;
    e.stop();
    for (let i = 0; i < Math.round(s * 60); i++) e.tick(1 / 60);
    e.start();
  }, seconds);
}

async function settleAll(page: Page): Promise<void> {
  await advance(page, 25);
  await expect.poll(async () => (await planes(page)).every((p) => p.landed !== null)).toBe(true);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('the town renders, painted, on paper', async ({ page }) => {
  const errors = collectErrors(page);
  await openSky(page);
  const s = await captureStats(page);
  expect(s.width).toBeGreaterThan(1000);
  expect(s.paper).toBeGreaterThan(0.08); // the sheet round the tile
  expect(s.green).toBeGreaterThan(0.18); // fields and grass
  expect(s.roof).toBeGreaterThan(0.005); // terracotta roofs
  await expect(page.getByRole('heading', { name: 'SKY' })).toBeVisible();
  await expect(page.getByText('Draw a flight.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('drawing folds a plane that follows the line, casts a shadow and lands', async ({ page }) => {
  const errors = collectErrors(page);
  await openSky(page);
  const stroke = swoopPoints(720, 470, 560);
  await drawStroke(page, stroke, 900);
  await expect.poll(async () => (await planes(page)).length).toBe(1);
  const [{ id }] = await planes(page);
  // the drawn line is handed to the plane to trace
  await expect(page.locator('.ink-trace')).toHaveCount(1);

  // while it flies, its screen position stays on the drawn line
  const distToStroke = (x: number, y: number) => {
    let best = Infinity;
    for (let i = 1; i < stroke.length; i++) {
      const [ax, ay] = stroke[i - 1], [bx, by] = stroke[i];
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
      best = Math.min(best, Math.hypot(x - ax - (bx - ax) * t, y - ay - (by - ay) * t));
    }
    return best;
  };
  let samples = 0;
  for (let k = 0; k < 6; k++) {
    await advance(page, k === 0 ? 1.0 : 0.4);
    const st = await planeState(page, id);
    const phase = await page.evaluate((i) => {
      const s = window.__sky!, p = s.app.planes.get(i)!;
      return p.plan ? (s.engine.elapsed - p.flightStart < p.plan.foldTime + p.plan.time[p.plan.pathEnd] ? 'fly' : 'other') : 'rest';
    }, id);
    if (phase !== 'fly' || !st) continue;
    samples++;
    expect(distToStroke(st.x, st.y)).toBeLessThan(18);
  }
  expect(samples).toBeGreaterThanOrEqual(3);

  // its shadow lies on the ground down-sun of it: hiding the plane brightens that spot
  const shadow = await page.evaluate(async (i) => {
    const s = window.__sky!, e = s.engine, p = s.app.planes.get(i)!;
    e.stop();
    const sun = e.world.uSunDir.value;
    const ground = p.position.clone().addScaledVector(sun, -(p.position.y - 0.05) / sun.y);
    const v = ground.clone().project(e.camera);
    const read = async () => {
      const bmp = await createImageBitmap(await e.capturePNG(1));
      const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
      c.drawImage(bmp, 0, 0);
      const px = Math.round(((v.x + 1) / 2) * bmp.width), py = Math.round(((1 - v.y) / 2) * bmp.height);
      const d = c.getImageData(px - 2, py - 2, 5, 5).data;
      let sum = 0;
      for (let k = 0; k < d.length; k += 4) sum += d[k] + d[k + 1] + d[k + 2];
      return sum / 25;
    };
    const withPlane = await read();
    p.mesh.visible = false;
    const without = await read();
    p.mesh.visible = true;
    e.start();
    return { withPlane, without };
  }, id);
  expect(shadow.without - shadow.withPlane).toBeGreaterThan(25);

  // it lands on whatever is below and rests there
  await settleAll(page);
  const [landed] = await planes(page);
  const surface = surfaceHeight(landed.landed!.x, landed.landed!.z);
  expect(landed.landed!.y).toBeGreaterThan(surface);
  expect(landed.landed!.y - surface).toBeLessThan(0.2);
  expect((await planeState(page, id))!.state).toBe('resting');
  await expect(page.locator('.ink-trace')).toHaveCount(0, { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('a curl in the line becomes a loop-the-loop', async ({ page }) => {
  await openSky(page);
  await drawStroke(page, swoopPoints(720, 480, 600, true), 1000);
  await expect.poll(async () => (await planes(page)).length).toBe(1);
  expect((await planes(page))[0].loops).toBeGreaterThan(10);
});

test('too-short strokes and strokes off the town shiver away with a message', async ({ page }) => {
  await openSky(page);
  await drawStroke(page, [[700, 450], [712, 452], [722, 455]], 100);
  await expect(page.getByRole('status')).toContainText('longer line');
  await drawStroke(page, swoopPoints(720, 860, 400).map(([x, y]) => [x, y + 10] as [number, number]), 400);
  await expect(page.getByRole('status')).toContainText('over the town');
  expect(await planes(page)).toHaveLength(0);
});

test('the four actions: fly again, loop, draw its next flight, remove', async ({ page }) => {
  await openSky(page);
  await drawStroke(page, swoopPoints(700, 470, 420), 700);
  await settleAll(page);
  const [{ id, landed }] = await planes(page);

  const select = async () => {
    const st = (await planeState(page, id))!;
    await page.mouse.click(st.x, st.y);
    await expect(page.getByRole('toolbar', { name: 'Selected plane' })).toBeVisible();
  };
  await select();
  await expect(page.locator('.select-label')).toContainText('0.30 m');

  // Fly again: it takes off and flies its line again
  await page.getByRole('button', { name: 'Fly again' }).click();
  expect((await planeState(page, id))!.state).toBe('flying');
  await advance(page, 1.5);
  expect((await planeState(page, id))!.wy).toBeGreaterThan(landed!.y + 0.5);
  await settleAll(page);

  // Loop: a loop-the-loop, upside down at the top
  await select();
  await page.getByRole('button', { name: 'Loop' }).click();
  const minUp = await page.evaluate((i) => {
    const s = window.__sky!, e = s.engine, p = s.app.planes.get(i)!;
    e.stop();
    let lowest = 1;
    for (let k = 0; k < 60 * 6; k++) {
      e.tick(1 / 60);
      const q = p.mesh.quaternion;
      lowest = Math.min(lowest, 1 - 2 * (q.x * q.x + q.z * q.z)); // world-up component of the plane's up
    }
    e.start();
    return lowest;
  }, id);
  expect(minUp).toBeLessThan(-0.6);
  const loopInfo = await page.evaluate((i) => {
    const p = window.__sky!.app.planes.get(i)!;
    return p.plan ? Array.from(p.plan.loop).filter((x) => x).length : 0;
  }, id);
  expect(loopInfo).toBeGreaterThan(20);
  await settleAll(page);

  // Draw its next flight: the next stroke becomes this plane's path
  await select();
  const before = await page.evaluate((i) => window.__sky!.store.doc.planes.find((p) => p.id === i)!.path, id);
  await page.getByRole('button', { name: 'Draw its next flight' }).click();
  await expect(page.getByText('Draw its next flight.')).toBeVisible();
  await drawStroke(page, swoopPoints(760, 380, 380).map(([x, y]) => [x, y + 60] as [number, number]), 600);
  const after = await planes(page);
  expect(after).toHaveLength(1);
  const pathAfter = await page.evaluate((i) => window.__sky!.store.doc.planes.find((p) => p.id === i)!.path, id);
  expect(pathAfter).not.toEqual(before);
  expect((await planeState(page, id))!.state).toBe('flying');
  await settleAll(page);

  // Remove: it unfolds and drifts off; undo brings it back
  await select();
  await page.getByRole('button', { name: 'Remove plane' }).click();
  expect(await planes(page)).toHaveLength(0);
  await page.keyboard.press('Meta+z');
  expect(await planes(page)).toHaveLength(1);
});

test('keyboard: Tab selects, F flies again, L loops, Delete removes, Escape deselects', async ({ page }) => {
  await openSky(page, '');
  expect((await planes(page)).length).toBe(2); // the first visit has two planes resting in town
  await page.keyboard.press('Tab');
  const sel = await page.evaluate(() => window.__sky!.store.get().selection);
  expect(sel?.kind).toBe('plane');
  await page.keyboard.press('f');
  expect((await planeState(page, sel!.id))!.state).toBe('flying');
  await page.keyboard.press('l');
  expect(await page.evaluate((i) => Array.from(window.__sky!.app.planes.get(i)!.plan!.loop).some((x) => x), sel!.id)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__sky!.store.get().selection)).toBeNull();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Delete');
  expect(await planes(page)).toHaveLength(1);
});

test('a resting plane can be dragged somewhere else, and the move undoes', async ({ page }) => {
  await openSky(page);
  await drawStroke(page, swoopPoints(700, 470, 420), 700);
  await settleAll(page);
  const [{ id, landed }] = await planes(page);
  const st = (await planeState(page, id))!;
  // toward the middle of town
  const dx = st.x > 720 ? -120 : 120, dy = st.y > 450 ? -40 : 40;
  await page.mouse.move(st.x, st.y);
  await page.mouse.down();
  await page.mouse.move(st.x + dx / 3, st.y + dy / 3, { steps: 4 });
  await page.mouse.move(st.x + dx, st.y + dy, { steps: 6 });
  await page.mouse.up();
  const [moved] = await planes(page);
  expect(Math.hypot(moved.landed!.x - landed!.x, moved.landed!.z - landed!.z)).toBeGreaterThan(1);
  // it follows the pointer on screen (perspective-correct)
  const now = (await planeState(page, id))!;
  expect(Math.hypot(now.x - (st.x + dx), now.y - (st.y + dy))).toBeLessThan(30);
  await page.keyboard.press('Meta+z');
  const [back] = await planes(page);
  expect(back.landed!.x).toBeCloseTo(landed!.x, 3);
});

test('undo, redo, clear and reload keep the sky', async ({ page }) => {
  await openSky(page);
  await page.evaluate(() => localStorage.clear());
  await drawStroke(page, swoopPoints(640, 450, 380), 500);
  await drawStroke(page, swoopPoints(760, 520, 380), 500);
  expect(await planes(page)).toHaveLength(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await planes(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect(await planes(page)).toHaveLength(2);
  await settleAll(page);
  await page.waitForTimeout(400); // the save is debounced
  const saved = await planes(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__sky && !window.__sky.store.get().loading);
  const reloaded = await planes(page);
  expect(reloaded.map((p) => p.id)).toEqual(saved.map((p) => p.id));
  // planes come back resting where they landed
  expect(await page.evaluate(() => window.__sky!.app.planes.all().every((p) => p.state === 'resting'))).toBe(true);
  await page.getByRole('button', { name: 'Sky menu' }).click();
  await page.getByRole('button', { name: 'Clear the sky' }).click();
  expect(await planes(page)).toHaveLength(0);
  await page.keyboard.press('Meta+z');
  expect(await planes(page)).toHaveLength(2);
});

test('corrupt storage is ignored, a bad import is refused', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('sky.scene', '{"version":1,"planes":[{"id":"x","path":"nope"}]}'));
  await page.goto('/');
  await page.waitForFunction(() => window.__sky && !window.__sky.store.get().loading);
  expect(await planes(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Sky menu' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import scene…' }).click();
  await (await chooser).setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByRole('status')).toContainText('not a SKY scene');
});

test('Save image downloads a PNG of the real scene', async ({ page }) => {
  await openSky(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save image' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^sky-.*\.png$/);
  const stream = await d.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect(buf.length).toBeGreaterThan(200_000);
});

test('eight planes in the air at once, without errors; a ninth retires the oldest', async ({ page }) => {
  const errors = collectErrors(page);
  await openSky(page);
  // time stands still while they are drawn, so all eight are up together
  await page.evaluate(() => (window.__sky!.engine.paused = true));
  for (let i = 0; i < 9; i++) await drawStroke(page, swoopPoints(560 + (i % 3) * 140, 330 + Math.floor(i / 3) * 110, 300), 250);
  expect(await planes(page)).toHaveLength(8);
  await page.evaluate(() => (window.__sky!.engine.paused = false));
  await advance(page, 1.2);
  const flying = await page.evaluate(() => window.__sky!.app.planes.all().filter((p) => p.state === 'flying').length);
  expect(flying).toBeGreaterThanOrEqual(7);
  await settleAll(page);
  expect(errors).toEqual([]);
});

test('reduced motion: gentler, slower flights and no loops', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await openSky(page);
  expect(await page.evaluate(() => window.__sky!.engine.reducedMotion)).toBe(true);
  await drawStroke(page, swoopPoints(720, 480, 600, true), 1000);
  await expect.poll(async () => (await planes(page)).length).toBe(1);
  expect((await planes(page))[0].loops).toBe(0);
  await ctx.close();
});

test('mobile: portrait layout and a touch-drawn flight', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await openSky(page);
  expect(await page.evaluate(() => window.__sky!.engine.camera.rotation.y)).toBeCloseTo(-Math.PI / 2, 2);
  const cdp = await ctx.newCDPSession(page);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i++) pts.push([120 + Math.sin(i / 8) * 60, 300 + i * 7]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
  for (const [x, y] of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await planes(page)).length).toBe(1);
  await expect(page.getByRole('navigation', { name: 'Tools' })).toBeVisible();
  await ctx.close();
});
