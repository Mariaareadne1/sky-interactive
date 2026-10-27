import type { Page } from '@playwright/test';

export async function openSky(page: Page, query = 'empty'): Promise<void> {
  await page.goto(query ? `/?${query}` : '/');
  await page.waitForFunction(() => window.__sky && !window.__sky.store.get().loading, null, { timeout: 90_000 });
}

/** A world point (x, y, z) in client pixels. */
export async function worldToClient(page: Page, x: number, y: number, z: number): Promise<[number, number]> {
  return page.evaluate(([x, y, z]) => {
    const s = window.__sky!;
    const p = s.engine.camera.position.clone().set(x, y, z).project(s.engine.camera);
    const r = s.engine.canvas.getBoundingClientRect();
    return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height] as [number, number];
  }, [x, y, z]);
}

/** A swoop across the middle of the screen, with an optional little curl (a loop-the-loop). */
export function swoopPoints(cx: number, cy: number, width = 520, curl = false): [number, number][] {
  const pts: [number, number][] = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x = cx - width / 2 + t * width;
    let y = cy - Math.sin(t * Math.PI) * 70;
    if (curl && t > 0.42 && t < 0.58) {
      const a = ((t - 0.42) / 0.16) * Math.PI * 2;
      x = cx - width / 2 + 0.42 * width + (t - 0.42) * width * 0.6 + Math.sin(a) * 38;
      y -= (1 - Math.cos(a)) * 38;
    } else if (curl && t >= 0.58) {
      x = cx - width / 2 + t * width - 0.16 * width * 0.4;
    }
    pts.push([x, y]);
  }
  return pts;
}

/** Draw a stroke with real pointer events, taking about `ms`. */
export async function drawStroke(page: Page, pts: [number, number][], ms = 900): Promise<void> {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  const per = ms / pts.length;
  for (const [x, y] of pts.slice(1)) {
    await page.mouse.move(x, y, { steps: 1 });
    if (per > 2) await page.waitForTimeout(per);
  }
  await page.mouse.up();
}

export async function planes(page: Page) {
  return page.evaluate(() => window.__sky!.store.doc.planes.map((p) => ({ id: p.id, landed: p.landed, points: p.path.length, loops: p.path.filter((q) => q[4] === 1).length })));
}

/** Live state of a plane: where it is on screen, its phase, its shadow. */
export async function planeState(page: Page, id: string) {
  return page.evaluate((id) => {
    const s = window.__sky!;
    const p = s.app.planes.get(id);
    if (!p) return null;
    const v = p.position.clone().project(s.engine.camera);
    const r = s.engine.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, wy: p.position.y, wx: p.position.x, wz: p.position.z, state: p.state, resting: p.resting };
  }, id);
}

/** Render a PNG through the app's capture path and measure its pixels in the page. */
export async function captureStats(page: Page) {
  return page.evaluate(async () => {
    const blob = await window.__sky!.engine.capturePNG(1);
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let paper = 0, green = 0, roof = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      n++;
      if (r > 215 && g > 210 && Math.max(r, g, b) - Math.min(r, g, b) < 30) paper++;
      if (g > r + 10 && g > b + 10) green++;
      if (r > g + 40 && r > b + 50) roof++;
    }
    return { width: bmp.width, height: bmp.height, size: blob.size, paper: paper / n, green: green / n, roof: roof / n };
  });
}
