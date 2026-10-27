import { CHURCH, CHURCHYARD, GARDENS, GREEN, HOUSES, LANES, TILE, WALL, type Box } from './town';

/**
 * GLSL twin of town.ts — the painted ground. The layout numbers are written
 * in from the TypeScript data so the two can never disagree. groundPaint()
 * is heavy (a hundred lane segments, every garden and footprint), so the
 * terrain bakes it into a texture once; only grain and the ragged edge are
 * painted live.
 */

const f = (n: number) => n.toFixed(4);

function boxFn(name: string, b: Box): string {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return `float ${name}(vec2 p) {
  vec2 d = p - vec2(${f(b.x)}, ${f(b.z)});
  vec2 l = abs(vec2(${f(c)} * d.x - ${f(s)} * d.y, ${f(s)} * d.x + ${f(c)} * d.y));
  vec2 q = l - vec2(${f(b.hu - b.r)}, ${f(b.hv - b.r)});
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - ${f(b.r)};
}`;
}

const laneSegs = LANES.flatMap((lane) =>
  lane.pts.slice(0, -1).map((a, i) => {
    const b = lane.pts[i + 1];
    return `  d = min(d, segD(p, vec2(${f(a[0])}, ${f(a[1])}), vec2(${f(b[0])}, ${f(b[1])})) - ${f(lane.hw)});`;
  }),
).join('\n');

const gardenFns = GARDENS.map((g, i) => boxFn(`garden${i}`, g)).join('\n');
const gardenPick = GARDENS.map((_, i) => `  d = min(d, garden${i}(p));`).join('\n');

// every building's footprint, for the soft painted contact shade and the worn ground at the door
const footprints: Box[] = [
  ...HOUSES.map((h) => ({ x: h.x, z: h.z, hu: h.w / 2, hv: h.d / 2, rot: h.rot, r: 0.04 })),
  { x: CHURCH.nave.x, z: CHURCH.nave.z, hu: CHURCH.nave.w / 2, hv: CHURCH.nave.d / 2, rot: CHURCH.nave.rot, r: 0.04 },
  { x: CHURCH.tower.x, z: CHURCH.tower.z, hu: CHURCH.tower.half, hv: CHURCH.tower.half, rot: 0, r: 0.03 },
  { x: (WALL.x0 + WALL.x1) / 2, z: WALL.z, hu: (WALL.x1 - WALL.x0) / 2, hv: WALL.thick / 2, rot: 0, r: 0.02 },
];
const footFns = footprints.map((b, i) => boxFn(`foot${i}`, b)).join('\n');
const footPick = footprints.map((_, i) => `  d = min(d, foot${i}(p));`).join('\n');

export const GROUND_GLSL = /* glsl */ `
const float HALF_X = ${f(TILE.halfX)};
const float HALF_Z = ${f(TILE.halfZ)};

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float segD(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float laneDist(vec2 p) {
  float d = 99.0;
${laneSegs}
  return d;
}
${boxFn('greenDist', GREEN)}
${boxFn('yardDist', CHURCHYARD)}
${gardenFns}
float gardenDist(vec2 p) {
  float d = 99.0;
${gardenPick}
  return d;
}
${footFns}
float footDist(vec2 p) {
  float d = 99.0;
${footPick}
  return d;
}

/** 1 in the village, 0 out in the fields. */
float townWeight(vec2 p) {
  return 1.0 - smoothstep(0.85, 1.05, length(p / vec2(9.6, 6.6)));
}

vec3 grassPaint(vec2 xz) {
  float wash = fbm2lite(xz * 0.11 + 4.0);
  vec3 c = mix(srgb(vec3(0.53, 0.72, 0.33)), srgb(vec3(0.65, 0.78, 0.36)), smoothstep(0.3, 0.75, wash));
  // warm light pooling, like a glaze
  float glow = fbm2lite(xz * 0.09 - 2.0);
  c = mix(c, c * vec3(1.1, 1.08, 0.9) + srgb(vec3(0.06, 0.05, 0.0)), smoothstep(0.5, 0.8, glow) * 0.6);
  // long dry-brush strokes
  float stroke = vnoise(vec2(xz.x * 0.7, xz.y * 7.5)) * 0.65 + vnoise(vec2(xz.x * 2.0, xz.y * 17.0)) * 0.35;
  return c * (0.93 + 0.13 * stroke);
}

/**
 * Fields beyond the village: a patchwork of parcels (fresh green, yellow-green,
 * gold, one ploughed) divided by dark, feathered hedgerows, as in the aerial
 * illustrations.
 */
vec3 fieldPaint(vec2 xz, out float grassy) {
  vec2 q = xz * 0.2 + (vec2(vnoise(xz * 0.35), vnoise(xz * 0.35 + 7.0)) - 0.5) * 0.5;
  vec2 cell = floor(q);
  float best = 9.0, second = 9.0;
  vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(i, j);
    vec2 o = c + 0.2 + 0.6 * hash22(c);
    float d = length(q - o);
    if (d < best) { second = best; best = d; id = c; }
    else if (d < second) second = d;
  }
  float h = hash12(id + 3.7);
  vec3 c = grassPaint(xz);
  grassy = 1.0;
  if (h < 0.28) c = mix(c, srgb(vec3(0.76, 0.8, 0.38)), 0.75);            // yellow-green
  else if (h < 0.44) { c = srgb(vec3(0.86, 0.74, 0.38)); grassy = 0.4; }    // gold, ready to cut
  else if (h < 0.52) { c = srgb(vec3(0.62, 0.47, 0.33)); grassy = 0.0; }    // ploughed
  // rows across a cut or ploughed field
  float rowAng = h * 6.28;
  float rows = sin(dot(xz, vec2(cos(rowAng), sin(rowAng))) * 9.0);
  c *= 1.0 - (1.0 - grassy) * 0.12 * smoothstep(0.2, 1.0, rows);
  c *= 0.94 + 0.1 * vnoise(vec2(xz.x * 0.8, xz.y * 6.0) + h * 20.0);
  // hedgerows on the parcel borders: deep green, feathered
  float edge = second - best;
  float hedge = 1.0 - smoothstep(0.03, 0.09, edge + (vnoise(xz * 3.0) - 0.5) * 0.05);
  c = mix(c, srgb(vec3(0.27, 0.45, 0.23)) * (0.9 + 0.2 * vnoise(xz * 6.0)), hedge * 0.92);
  grassy = mix(grassy, 0.6, hedge);
  return c;
}

vec3 lanePaint(vec2 xz, float d) {
  // packed sandy earth, paler down the middle, darker wheel ruts
  vec3 c = srgb(vec3(0.9, 0.82, 0.66));
  c *= 0.93 + 0.1 * vnoise(xz * 2.5) + 0.04 * vnoise(xz * 11.0);
  c = mix(c, c * vec3(0.9, 0.88, 0.86), smoothstep(-0.05, -0.18, d) * smoothstep(-0.32, -0.2, d) * 0.6);
  vec2 cell = floor(xz * 14.0);
  c *= 1.0 - step(0.93, hash12(cell)) * 0.16;
  return c;
}

vec3 gardenPaint(vec2 xz, float d) {
  // a kitchen garden: rows of greens on dark soil, a grass strip, a hedge border
  vec3 soil = srgb(vec3(0.5, 0.36, 0.25)) * (0.9 + 0.15 * vnoise(xz * 3.0));
  float rowCoord = xz.x * 0.8 + xz.y * 0.6;
  float row = smoothstep(0.0, 0.5, sin(rowCoord * 26.0 + vnoise(xz * 2.0) * 1.5));
  vec3 leaf = mix(srgb(vec3(0.36, 0.6, 0.28)), srgb(vec3(0.5, 0.68, 0.3)), vnoise(xz * 9.0));
  // little round heads of cabbage along the rows
  vec2 cell = floor(xz * 12.0);
  float head = smoothstep(0.42, 0.2, length(fract(xz * 12.0) - 0.5)) * step(0.45, hash12(cell)) * row;
  vec3 c = mix(soil, leaf * (0.85 + 0.25 * vnoise(xz * 22.0)), row * 0.8);
  c = mix(c, srgb(vec3(0.55, 0.74, 0.36)), head * 0.8);
  float border = smoothstep(-0.09, -0.02, d);
  return mix(c, srgb(vec3(0.33, 0.52, 0.27)), border * 0.7);
}

/** The town's base paint at a point, before light. grassy = 1 where grass can fleck. */
vec3 groundPaint(vec2 xz, out float grassy) {
  float fieldGrass;
  vec3 field = fieldPaint(xz, fieldGrass);
  vec3 town = grassPaint(xz) * vec3(1.02, 1.01, 0.98);
  float tw = townWeight(xz);
  vec3 c = mix(field, town, tw);
  grassy = mix(fieldGrass, 1.0, tw);

  // the churchyard: cropped paler grass
  float yd = yardDist(xz);
  c = mix(c, c * vec3(1.06, 1.05, 0.96), (1.0 - smoothstep(-0.05, 0.05, yd)) * 0.7);

  // the village green: brighter, with a mown ring path round it
  float gd = greenDist(xz) + (vnoise(xz * 2.0) - 0.5) * 0.08;
  float inGreen = 1.0 - smoothstep(-0.03, 0.03, gd);
  vec3 green = mix(srgb(vec3(0.6, 0.8, 0.36)), srgb(vec3(0.7, 0.84, 0.4)), smoothstep(0.3, 0.7, fbm2lite(xz * 0.5)));
  green *= 0.95 + 0.08 * smoothstep(0.35, 0.65, abs(fract(xz.x * 0.9 + vnoise(xz) * 0.3) - 0.5) * 2.0);
  c = mix(c, green, inGreen);
  c = mix(c, c * vec3(1.08, 1.05, 0.9), smoothstep(0.1, 0.0, abs(gd + 0.25)) * 0.5 * inGreen);

  // back gardens
  float gard = gardenDist(xz);
  float inGarden = 1.0 - smoothstep(-0.02, 0.02, gard);
  c = mix(c, gardenPaint(xz, gard), inGarden);
  grassy *= 1.0 - inGarden * 0.6;

  // lanes, with ragged edges and a faint grassy verge line
  float ld = laneDist(xz) + (vnoise(xz * 3.3) - 0.5) * 0.07;
  float onLane = 1.0 - smoothstep(-0.03, 0.04, ld);
  c *= 1.0 - smoothstep(0.12, 0.0, abs(ld - 0.04)) * 0.1;
  c = mix(c, lanePaint(xz, ld), onLane);
  grassy *= 1.0 - onLane;

  // a soft painted shade hugging every building, and worn earth round it
  float fd = footDist(xz);
  c = mix(c, c * vec3(0.95, 0.92, 0.86), smoothstep(0.3, 0.04, fd) * 0.35 * (1.0 - onLane));
  c *= 1.0 - 0.25 * smoothstep(0.14, 0.0, fd);
  return c;
}

/** Signed distance inside the tile's rounded edge, roughened like dry-brush paint. */
float paintEdge(vec2 xz) {
  vec2 q = abs(xz) - vec2(HALF_X, HALF_Z) + 1.0;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 1.0;
  float rough = (vnoise(xz * 1.1) - 0.5) * 0.5 + (vnoise(xz * 4.0) - 0.5) * 0.24;
  return -box + rough;
}
`;
