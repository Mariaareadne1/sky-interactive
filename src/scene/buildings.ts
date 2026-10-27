import * as THREE from 'three';
import { CHURCH, HOUSES, ROOF_OVERHANG, groundHeight, type House, type RoofKind } from './town';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { SHADOW_LAYER } from '../engine/shadows';
import type { WorldUniforms } from './world';

/**
 * Every building in one painted mesh: cottages with gabled roofs and
 * chimneys, and the church with its clock tower and slate spire. Faces carry
 * what they are (wall, front wall, roof, brick, stone, spire) and their own
 * surface coordinates, so the shader can paint windows, a door, tile courses
 * and a clock face the way an illustrator would — flat colour, a few marks.
 */

// what a face is, for the shader (aPaint.x)
const WALL = 1, FRONT = 2, GABLE = 3, ROOF = 4, BRICK = 5, TOWER = 6, SPIRE = 7, NAVE = 8;

const ROOF_COLORS: Record<RoofKind, string> = { terracotta: '#cf6f4f', slate: '#7686a3', cream: '#e6cf9c' };

class Builder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly paint: number[] = [];
  private readonly c = new THREE.Color();
  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  constructor(readonly m: THREE.Matrix4, readonly nm: THREE.Matrix3) {}

  /** A flat polygon (fan-triangulated), its local face coordinates per vertex. */
  face(verts: [number, number, number][], uv: [number, number][], kind: number, len: number, hex: string): void {
    const [a, b, c] = verts;
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    this.n.crossVectors(ab, ac).normalize().applyMatrix3(this.nm).normalize();
    this.c.set(hex);
    for (let i = 1; i < verts.length - 1; i++) {
      for (const k of [0, i, i + 1]) {
        this.v.set(...verts[k]).applyMatrix4(this.m);
        this.pos.push(this.v.x, this.v.y, this.v.z);
        this.nrm.push(this.n.x, this.n.y, this.n.z);
        this.col.push(this.c.r, this.c.g, this.c.b);
        this.paint.push(kind, uv[k][0], uv[k][1], len);
      }
    }
  }

  /** Four upright walls of a box from y0 to y1, outward faces. */
  walls(hx: number, hz: number, y0: number, y1: number, kinds: [number, number, number, number], hex: string): void {
    const h = y1 - y0;
    const sides: [[number, number], [number, number], number][] = [
      [[-hx, hz], [hx, hz], kinds[0]], // +z
      [[hx, hz], [hx, -hz], kinds[1]], // +x
      [[hx, -hz], [-hx, -hz], kinds[2]], // -z
      [[-hx, -hz], [-hx, hz], kinds[3]], // -x
    ];
    for (const [p, q, kind] of sides) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      this.face(
        [[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]],
        [[0, 0], [len, 0], [len, h], [0, h]],
        kind, len, hex,
      );
    }
  }

  /** A box's top, for chimneys and the tower. */
  top(hx: number, hz: number, y: number, kind: number, hex: string): void {
    this.face([[-hx, y, hz], [hx, y, hz], [hx, y, -hz], [-hx, y, -hz]], [[0, 0], [1, 0], [1, 1], [0, 1]], kind, 1, hex);
  }
}

function geometryFrom(b: Builder[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const cat = (k: 'pos' | 'nrm' | 'col' | 'paint') => b.flatMap((x) => x[k]);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(cat('pos'), 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(cat('nrm'), 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cat('col'), 3));
  geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(cat('paint'), 4));
  geo.computeBoundingSphere();
  return geo;
}

function placed(x: number, y: number, z: number, rot: number): Builder {
  const m = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
  return new Builder(m, new THREE.Matrix3().getNormalMatrix(m));
}

/** A gabled house: walls, gable ends, two roof slopes with an overhang, verge boards and a chimney. */
function gabled(b: Builder, w: number, d: number, wallH: number, roofH: number, wallKind: number, frontKind: number, front: 1 | -1, wallHex: string, roofHex: string, chimney: number | null): void {
  const hx = w / 2, hz = d / 2, o = ROOF_OVERHANG;
  b.walls(hx, hz, -0.05, wallH, [front === 1 ? frontKind : wallKind, GABLE, front === -1 ? frontKind : wallKind, GABLE], wallHex);
  const ridge = wallH + roofH;
  // gable triangles
  b.face([[hx, wallH, hz], [hx, wallH, -hz], [hx, ridge, 0]], [[0, wallH], [d, wallH], [hz, ridge]], GABLE, d, wallHex);
  b.face([[-hx, wallH, -hz], [-hx, wallH, hz], [-hx, ridge, 0]], [[0, wallH], [d, wallH], [hz, ridge]], GABLE, d, wallHex);
  // roof slopes: from the ridge down past the eaves
  const slope = roofH / hz;
  const eaveY = wallH - slope * o;
  const run = Math.hypot(hz + o, roofH + slope * o);
  const ux = hx + o;
  b.face([[-ux, ridge, 0], [-ux, eaveY, hz + o], [ux, eaveY, hz + o], [ux, ridge, 0]], [[0, 0], [0, run], [2 * ux, run], [2 * ux, 0]], ROOF, 2 * ux, roofHex);
  b.face([[ux, ridge, 0], [ux, eaveY, -hz - o], [-ux, eaveY, -hz - o], [-ux, ridge, 0]], [[0, 0], [0, run], [2 * ux, run], [2 * ux, 0]], ROOF, 2 * ux, roofHex);
  // a little thickness at the eaves and verges, so the roof reads as tiles on rafters
  const t = 0.045;
  for (const s of [1, -1]) {
    const ez = s * (hz + o);
    b.face([[-ux, eaveY, ez], [ux, eaveY, ez], [ux, eaveY - t, ez], [-ux, eaveY - t, ez]], [[0, 0], [1, 0], [1, 1], [0, 1]], BRICK, 1, '#8c7366');
    for (const x of [ux, -ux]) {
      b.face([[x, ridge, 0], [x, eaveY, ez], [x, eaveY - t, ez], [x, ridge - t, 0]], [[0, 0], [1, 0], [1, 1], [0, 1]], BRICK, 1, '#8c7366');
    }
  }
  if (chimney !== null) {
    // built in the house's frame, then carried into the town with it
    const cx = chimney * hx, cz = 0.12, ch = 0.075;
    const yb = wallH + roofH * 0.4, yt = ridge + 0.2;
    const c = new Builder(new THREE.Matrix4().makeTranslation(cx, 0, cz), new THREE.Matrix3());
    c.walls(ch, ch, yb, yt, [BRICK, BRICK, BRICK, BRICK], '#b86a4c');
    c.top(ch + 0.012, ch + 0.012, yt, BRICK, '#5a4a44');
    appendLocal(b, c);
  }
}

/** Append a builder made in a house's local frame into the house's (placed) builder. */
function appendLocal(target: Builder, local: Builder): void {
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < local.pos.length; i += 3) {
    v.set(local.pos[i], local.pos[i + 1], local.pos[i + 2]).applyMatrix4(target.m);
    n.set(local.nrm[i], local.nrm[i + 1], local.nrm[i + 2]).applyMatrix3(target.nm).normalize();
    target.pos.push(v.x, v.y, v.z);
    target.nrm.push(n.x, n.y, n.z);
  }
  target.col.push(...local.col);
  target.paint.push(...local.paint);
}

function house(h: House): Builder {
  const b = placed(h.x, groundHeight(h.x, h.z), h.z, h.rot);
  gabled(b, h.w, h.d, h.wallH, h.roofH, WALL, FRONT, h.front, h.wall, ROOF_COLORS[h.roof], h.chimney);
  return b;
}

function church(): Builder[] {
  const n = CHURCH.nave;
  const nave = placed(n.x, groundHeight(n.x, n.z), n.z, n.rot);
  gabled(nave, n.w, n.d, n.wallH, n.roofH, NAVE, NAVE, 1, '#e3dccd', '#6f7d99', null);
  const t = CHURCH.tower;
  const tower = placed(t.x, groundHeight(t.x, t.z), t.z, 0);
  tower.walls(t.half, t.half, -0.05, t.height, [TOWER, TOWER, TOWER, TOWER], '#ddd4c3');
  // a parapet lip, then the spire
  tower.walls(t.half + 0.04, t.half + 0.04, t.height - 0.08, t.height + 0.02, [BRICK, BRICK, BRICK, BRICK], '#c9bfae');
  tower.top(t.half + 0.04, t.half + 0.04, t.height + 0.02, BRICK, '#bdb3a3');
  const tip: [number, number, number] = [0, t.height + t.spire + 0.02, 0];
  const s = t.half * 0.92, y = t.height + 0.02;
  const corners: [number, number][] = [[-s, s], [s, s], [s, -s], [-s, -s]];
  const run = Math.hypot(s, t.spire);
  for (let i = 0; i < 4; i++) {
    const a = corners[i], c = corners[(i + 1) % 4];
    tower.face([[a[0], y, a[1]], [c[0], y, c[1]], tip], [[0, run], [2 * s, run], [s, 0]], SPIRE, 2 * s, '#6c7a95');
  }
  return [nave, tower];
}

const vertex = /* glsl */ `
attribute vec3 color;
attribute vec4 aPaint;
varying vec3 vColor;
varying vec4 vPaint;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vColor = color;
  vPaint = aPaint;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
varying vec3 vColor;
varying vec4 vPaint;
varying vec3 vWorld;
varying vec3 vNormalW;

vec3 srgbC(vec3 c) { return pow(c, vec3(2.2)); }
float box(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return max(d.x, d.y); }
float fillAA(float d, float w) { return 1.0 - smoothstep(-w, w, d); }

// a cottage window: glass, a cream frame and a cross of glazing bars
vec3 window(vec3 c, vec2 p, vec2 centre, vec2 half_, float aa) {
  float outer = fillAA(box(p, centre, half_ + 0.018), aa);
  float glass = fillAA(box(p, centre, half_), aa);
  vec3 frame = srgbC(vec3(0.97, 0.95, 0.9));
  vec3 g = mix(srgbC(vec3(0.33, 0.42, 0.55)), srgbC(vec3(0.62, 0.72, 0.82)), smoothstep(centre.y - half_.y, centre.y + half_.y, p.y) * 0.6);
  // a pale reflection streak
  g = mix(g, g * 1.5, smoothstep(0.02, 0.0, abs(p.x - centre.x - (p.y - centre.y) * 0.8 + half_.x * 0.3)) * 0.5);
  float bars = max(fillAA(abs(p.x - centre.x) - 0.007, aa), fillAA(abs(p.y - centre.y) - 0.007, aa));
  c = mix(c, frame, outer);
  c = mix(c, g, glass);
  c = mix(c, frame, glass * bars);
  // a sill: a thin shadow line under the window
  c *= 1.0 - 0.3 * fillAA(box(p, centre - vec2(0.0, half_.y + 0.03), vec2(half_.x + 0.03, 0.008)), aa);
  return c;
}

vec3 paintWall(vec3 c, float kind, vec2 p, float len, float aa) {
  float n = max(1.0, floor(len / 0.42));
  float spacing = len / n;
  float i = floor(p.x / spacing);
  float cx = (i + 0.5) * spacing;
  bool front = kind > 1.5 && kind < 2.5;
  bool doorCell = front && abs(i - floor(n * 0.5)) < 0.5;
  // upper storey
  if (kind < 3.5) c = window(c, p, vec2(cx, 0.55), vec2(0.075, 0.075), aa);
  if (doorCell) {
    vec3 door;
    float h = hash12(floor(vWorld.xz * 0.7));
    door = h < 0.25 ? srgbC(vec3(0.44, 0.6, 0.51)) : h < 0.5 ? srgbC(vec3(0.31, 0.44, 0.6)) : h < 0.75 ? srgbC(vec3(0.7, 0.34, 0.25)) : srgbC(vec3(0.33, 0.4, 0.33));
    float dd = box(p, vec2(cx, 0.15), vec2(0.07, 0.15));
    c = mix(c, srgbC(vec3(0.95, 0.93, 0.88)), fillAA(dd - 0.016, aa));
    c = mix(c, door * (0.9 + 0.2 * smoothstep(0.0, 0.3, p.y)), fillAA(dd, aa));
    c = mix(c, srgbC(vec3(0.85, 0.7, 0.3)), fillAA(length(p - vec2(cx + 0.04, 0.15)) - 0.01, aa)); // knob
  } else if (kind < 3.5) {
    c = window(c, p, vec2(cx, 0.24), vec2(0.075, 0.07), aa);
  }
  return c;
}

void main() {
  float kind = vPaint.x;
  vec2 p = vPaint.yz;
  float len = vPaint.w;
  float aa = max(fwidth(p.x), fwidth(p.y)) * 0.8 + 0.001;
  // faces are wound either way: light the side we see
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 c = vColor;
  float grain = vnoise(p * 24.0 + kind * 7.0) * 0.6 + vnoise(p * 70.0) * 0.4;

  if (kind < 3.5) {
    // plaster walls: a soft wash, darker at the foot, windows and a door
    c *= 0.95 + 0.08 * grain;
    c *= 0.82 + 0.18 * smoothstep(0.0, 0.2, p.y);
    c = paintWall(c, kind, p, len, aa);
  } else if (kind < 4.5 || (kind > 6.5 && kind < 7.5)) {
    // tiles: courses down the slope, staggered breaks, a darker ridge
    float course = p.y / 0.07;
    float row = floor(course);
    float tile = floor(p.x / 0.085 + row * 0.5);
    c *= 0.9 + 0.16 * hash12(vec2(tile, row));
    c *= 1.0 - 0.22 * smoothstep(0.75, 1.0, fract(course));
    c *= 1.0 - 0.12 * smoothstep(0.08, 0.0, abs(fract(p.x / 0.085 + row * 0.5) - 0.5) - 0.42) * step(0.2, fract(course));
    c *= 1.0 - 0.18 * smoothstep(0.05, 0.0, p.y);
    // a few dabs of lichen
    c = mix(c, srgbC(vec3(0.7, 0.72, 0.45)), step(0.985, hash12(floor(p * 18.0) + kind)) * 0.5);
    c *= 0.94 + 0.08 * grain;
  } else if (kind < 5.5) {
    // brick and timber: small dark marks
    c *= 0.88 + 0.16 * hash12(floor(vec2(p.x * 22.0 + floor(p.y * 30.0) * 0.5, p.y * 30.0)));
  } else {
    // stone: tower and nave
    float row = floor(p.y / 0.11);
    float block = hash12(vec2(floor(p.x / 0.18 + row * 0.5), row));
    c *= 0.92 + 0.12 * block;
    c *= 1.0 - 0.1 * smoothstep(0.85, 1.0, fract(p.y / 0.11));
    c *= 0.82 + 0.18 * smoothstep(0.0, 0.25, p.y);
    if (kind < 6.5) {
      // the clock, high on every face
      vec2 cc = vec2(len * 0.5, 1.92);
      float r = length(p - cc);
      c = mix(c, srgbC(vec3(0.24, 0.27, 0.36)), fillAA(r - 0.165, aa));
      c = mix(c, srgbC(vec3(0.97, 0.95, 0.88)), fillAA(r - 0.14, aa));
      float hourA = 6.2832 * (10.0 / 12.0) + uTime * 0.0012;
      float minA = 6.2832 * (10.0 / 60.0) + uTime * 0.0145;
      vec2 q = p - cc;
      for (int k = 0; k < 12; k++) {
        float a = float(k) * 0.5236;
        c = mix(c, srgbC(vec3(0.2)), fillAA(length(q - vec2(sin(a), cos(a)) * 0.115) - 0.008, aa));
      }
      vec2 hd = vec2(sin(hourA), cos(hourA)), md = vec2(sin(minA), cos(minA));
      float hh = length(q - hd * clamp(dot(q, hd), 0.0, 0.07)) - 0.009;
      float mh = length(q - md * clamp(dot(q, md), 0.0, 0.11)) - 0.006;
      c = mix(c, srgbC(vec3(0.15)), fillAA(min(hh, mh), aa));
      // a tall belfry slit under the clock, and a door at the foot
      c = mix(c, srgbC(vec3(0.28, 0.3, 0.38)), fillAA(box(p, vec2(len * 0.5, 1.45), vec2(0.04, 0.14)), aa));
    } else {
      // church windows: tall, arched, leaded
      float n = max(1.0, floor(len / 0.5));
      float sp = len / n;
      float cx = (floor(p.x / sp) + 0.5) * sp;
      vec2 q = p - vec2(cx, 0.55);
      float arch = q.y < 0.18 ? box(q, vec2(0.0), vec2(0.07, 0.18)) : length(q - vec2(0.0, 0.18)) - 0.07;
      c = mix(c, srgbC(vec3(0.92, 0.9, 0.84)), fillAA(arch - 0.018, aa));
      vec3 glass = mix(srgbC(vec3(0.36, 0.45, 0.6)), srgbC(vec3(0.62, 0.48, 0.6)), step(0.5, hash12(floor(q * 25.0) + cx)));
      c = mix(c, glass, fillAA(arch, aa));
    }
  }

  float sunVis = castLight(vWorld, 0.02);
  vec3 col = paintLight(c, N, sunVis, 1.0, 0.12);
  float lift = smoothstep(0.55, 0.9, dot(N, uSunDir)) * sunVis;
  col = mix(col, col * vec3(1.08, 1.07, 0.97), lift * 0.6);
  float shade = 1.0 - smoothstep(-0.2, 0.5, dot(N, uSunDir));
  col = mix(col, col * vec3(0.86, 0.87, 1.02), shade * 0.4);
  // a faint warm bounce on walls from the sunlit ground
  col += c * vec3(0.05, 0.04, 0.02) * (1.0 - abs(N.y)) * (1.0 - smoothstep(0.0, 0.6, vWorld.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createBuildings(world: WorldUniforms): THREE.Mesh {
  const geo = geometryFrom([...HOUSES.map(house), ...church()]);
  const material = new THREE.ShaderMaterial({ uniforms: world, vertexShader: vertex, fragmentShader: fragment, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'buildings';
  mesh.layers.enable(SHADOW_LAYER);
  return mesh;
}

/** Where each smoking chimney's top is, in world space. */
export function chimneyTops(): THREE.Vector3[] {
  return HOUSES.filter((h) => h.chimney !== null).map((h) => {
    const cx = (h.chimney as number) * h.w / 2, cz = 0.12;
    const c = Math.cos(h.rot), s = Math.sin(h.rot);
    return new THREE.Vector3(h.x + cx * c + cz * s, groundHeight(h.x, h.z) + h.wallH + h.roofH + 0.22, h.z - cx * s + cz * c);
  });
}
