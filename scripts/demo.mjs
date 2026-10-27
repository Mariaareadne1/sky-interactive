// Scripted ~18 s demo, recorded by the app's own ink-compositing recorder:
//   quiet town → a long swoop with a loop-the-loop → the plane folds and flies it,
//   its shadow sliding over the roofs → it lands on the church roof → two quick
//   flights crisscross → "Fly again".
// node scripts/demo.mjs [width] [height]  ->  artifacts/sky-demo.(mp4|webm)
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

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
await page.waitForTimeout(1500);
const sleep = (ms) => page.waitForTimeout(ms);

/** A ground track over the town (world x, z), lifted onto the flight sheet and projected to the screen. */
const toScreen = (track) => page.evaluate((track) => import('/src/scene/town.ts').then(({ sheetHeight }) => {
  const s = window.__sky, cam = s.engine.camera, r = s.engine.canvas.getBoundingClientRect();
  return track.map(([x, z]) => {
    const v = cam.position.clone().set(x, sheetHeight(x, z), z).project(cam);
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  });
}), track);

/** The hero swoop: in from the front right, a curl over the town, then round to the church from the front. */
function heroTrack(endZ) {
  const ctrl = [[7.5, 5.8], [4.6, 4.4], [2.2, 2.2], [-0.4, 2.2], [-3.6, 2.8], [-6.6, endZ + 2.2], [-7.1, endZ]];
  const out = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < 14; k++) {
      const t = k / 14, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

/** Add a curl (a little loop) to a screen polyline at fraction `at`. */
function curl(pts, at = 0.42, r = 46) {
  const i = Math.floor(pts.length * at);
  const [x, y] = pts[i];
  const [nx, ny] = pts[i + 1];
  const d = Math.hypot(nx - x, ny - y) || 1;
  const tx = (nx - x) / d, ty = (ny - y) / d;
  const loop = [];
  for (let k = 1; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    // up and over: the curl rises above the line (screen-up is the plane's left here)
    loop.push([x + tx * Math.sin(a) * r + ty * (1 - Math.cos(a)) * r * 1.05, y + ty * Math.sin(a) * r - tx * (1 - Math.cos(a)) * r * 1.05]);
  }
  return [...pts.slice(0, i + 1), ...loop, ...pts.slice(i + 1)];
}

/** Timestamps for a stroke drawn in `ms`, easing in and out like a hand. */
const timed = (pts, ms) => pts.map(([x, y], i) => ({ x, y, t: ms * (0.5 - 0.5 * Math.cos((Math.PI * i) / (pts.length - 1))) }));

// choose where the hero line ends so its glide comes down on the church roof — in the middle
// of a run of ends that all do, so a hand's few centimetres of difference can't miss it
const tries = [];
for (let endZ = 3.2; endZ >= -2.4; endZ -= 0.1) {
  const pts = timed(curl(await toScreen(heroTrack(endZ)), 0.36), 2400);
  const rest = await page.evaluate((pts) => Promise.all([import('/src/flight/path.ts'), import('/src/flight/flight.ts'), import('/src/scene/town.ts')]).then(([P, F, T]) => {
    const s = window.__sky;
    const r = P.strokeToPath(pts, { project: (x, y) => s.app.sheetAt(x, y), inside: (x, z) => T.edgeDistance(x, z) > 0.2, clamp: (p) => p });
    if (!r.ok) return null;
    const n = T.CHURCH.nave;
    // nudge the whole line up and down a little: does it still land on the nave?
    return [-0.06, 0, 0.06].every((dy) => {
      const plan = F.buildFlight(r.path.map((q) => [q[0], q[1] + dy, q[2], q[3], q[4]]), { seed: 1, fold: true });
      // on the slope that faces us
      return Math.abs(plan.rest.x - n.x) < n.w / 2 - 0.25 && plan.rest.z > n.z + 0.1 && plan.rest.z < n.z + n.d / 2;
    });
  }), pts);
  tries.push({ endZ, pts, ok: !!rest });
}
let run = [], bestRun = [];
for (const t of tries) {
  run = t.ok ? [...run, t] : [];
  if (run.length > bestRun.length) bestRun = run;
}
if (!bestRun.length) throw new Error('No hero line lands on the church roof — adjust the track.');
const best = bestRun[Math.floor(bestRun.length / 2)];
console.log('hero line ends at z =', best.endZ.toFixed(2), `(${bestRun.length} neighbouring ends land on the nave)`);

async function draw(pts) {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  let t0 = Date.now();
  for (const p of pts.slice(1)) {
    const wait = p.t - (Date.now() - t0);
    if (wait > 1) await sleep(wait);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  t0 = 0;
}

await page.evaluate(() => {
  const s = window.__sky;
  s.store.set({ uiHidden: true, hasDrawn: true });
  s.engine.adaptive = false;
  window.__demoDone = new Promise((r) => (window.__finishDemo = r));
  window.__demo = import('/src/capture/recorder.ts').then(({ recordCanvas }) =>
    recordCanvas(s.engine.canvas, { seconds: 40, ink: s.input.ink, until: window.__demoDone }),
  );
});
await sleep(1800); // the quiet town
await draw(best.pts); // the hero swoop with its loop
// it folds, flies, loops and comes down on the church
await page.waitForFunction(() => window.__sky.store.doc.planes[0]?.landed, null, { timeout: 30000 });
console.log('landed on', await page.evaluate(() => {
  const p = window.__sky.app.planes.all()[0];
  return p.whereabouts().surface;
}));
await sleep(900);
// two quick flights crisscross over the high street
const a = timed(await toScreen([[-4.5, 5.5], [-1.5, 2.5], [2.5, -0.5], [5.5, -3.5]]), 420);
const b = timed(await toScreen([[6.5, 5.0], [3.0, 2.8], [-0.5, 0.5], [-4.0, -2.0]]), 420);
const dense = (pts) => pts.flatMap((p, i) => (i === 0 ? [p] : Array.from({ length: 8 }, (_, k) => ({ x: pts[i - 1].x + ((p.x - pts[i - 1].x) * (k + 1)) / 8, y: pts[i - 1].y + ((p.y - pts[i - 1].y) * (k + 1)) / 8, t: pts[i - 1].t + ((p.t - pts[i - 1].t) * (k + 1)) / 8 }))));
await draw(dense(a));
await sleep(250);
await draw(dense(b));
await sleep(3600);
// "Fly again": the church plane takes off and flies its line once more
await page.evaluate(() => {
  const s = window.__sky, id = s.store.doc.planes[0].id;
  s.store.set({ selection: { kind: 'plane', id } });
  s.app.flyAgain(id);
  s.store.set({ selection: null });
});
await sleep(4200);
await page.evaluate(() => window.__finishDemo());
const out = await page.evaluate(async () => {
  const rec = await window.__demo;
  const buf = new Uint8Array(await rec.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), ext: rec.extension, ms: rec.durationMs, type: rec.type };
});
const file = `artifacts/sky-demo.${out.ext}`;
writeFileSync(file, Buffer.from(out.b64, 'base64'));
console.log(file, out.type, `${(out.ms / 1000).toFixed(1)} s`);
await browser.close();
