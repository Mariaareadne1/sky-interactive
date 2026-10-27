import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { meshSDF, sdCapsule, sdEllipsoid, smin } from './sdf';
import { woolField } from './wool';
import { CAT, GARDENS, TILE, TREES, WALL, groundHeight } from './town';
import { chimneyTops } from './buildings';
import { paintMaterial, tint, withAO } from './paint';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { SHADOW_LAYER } from '../engine/shadows';
import type { WorldUniforms } from './world';

/**
 * The town's still life and its few quiet signs of life: round puff trees,
 * clouds drifting along the tile's edges, curls of chimney smoke, washing
 * swaying on a line and a cat on the churchyard wall flicking its tail.
 * Nothing here competes with the planes.
 */

const caster = <T extends THREE.Object3D>(m: T): T => {
  m.layers.enable(SHADOW_LAYER);
  return m;
};

// --- puff material (trees and clouds): dry-brush silhouettes ------------------------

const puffVertex = /* glsl */ `
attribute float aAO;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying float vAO;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vAO = aAO;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const puffFragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
uniform vec3 uColor;
uniform vec3 uShadeTint;
uniform float uCloud;
uniform float uSeed;
uniform float uFade;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying float vAO;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = max(dot(N, V), 0.0);
  float speck = hash13(floor(vWorld * 22.0) + uSeed);
  if (speck > smoothstep(0.0, 0.28, facing) * 1.1 * uFade) discard;
  float grain = vnoise3(vLocal * 9.0 + uSeed) * 0.6 + vnoise3(vLocal * 26.0) * 0.4;
  vec3 albedo = uColor * (0.9 + 0.18 * grain);
  float ao = mix(0.35, 1.0, vAO);
  float sunVis = uCloud > 0.5 ? 1.0 : castLight(vWorld, 0.08);
  vec3 col = paintLight(albedo, N, sunVis, ao, uCloud > 0.5 ? 0.35 : 0.15);
  float hi = smoothstep(0.55, 0.9, dot(N, uSunDir)) * sunVis;
  col = mix(col, col * vec3(1.12, 1.12, 0.95) + vec3(0.03, 0.03, 0.0), hi * (1.0 - uCloud) * 0.8);
  float shade = 1.0 - smoothstep(-0.2, 0.5, dot(N, uSunDir));
  col = mix(col, col * uShadeTint, shade * 0.6);
  gl_FragColor = vec4(col, 1.0);
}
`;

function puffMaterial(world: WorldUniforms, color: string, shadeTint: string, cloud: boolean, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...world,
      uColor: { value: new THREE.Color(color) },
      uShadeTint: { value: new THREE.Color(shadeTint) },
      uCloud: { value: cloud ? 1 : 0 },
      uSeed: { value: seed },
      uFade: { value: 1 },
    },
    vertexShader: puffVertex,
    fragmentShader: puffFragment,
  });
}

function canopy(seed: number, r: number): THREE.BufferGeometry {
  const base = (x: number, y: number, z: number) => sdEllipsoid(x, y, z, 0, 0, 0, r, r * 0.88, r);
  const ext = r * 1.35;
  return meshSDF(
    woolField(base, {
      seed,
      min: [-ext, -ext, -ext],
      max: [ext, ext, ext],
      inset: r * 0.14,
      layers: [{ count: 30, rMin: r * 0.26, rMax: r * 0.4 }, { count: 44, rMin: r * 0.14, rMax: r * 0.22 }],
      blend: r * 0.12,
      curl: 0.004,
    }),
    { min: [-ext, -ext, -ext], max: [ext, ext, ext], cell: r / 13, ao: true },
  );
}

function cloudShape(seed: number): THREE.BufferGeometry {
  const base = (x: number, y: number, z: number) =>
    Math.min(
      sdEllipsoid(x, y, z, 0, 0, 0, 2.1, 0.75, 1.4),
      sdEllipsoid(x, y, z, 0.9, 0.35, 0.3, 1.1, 0.75, 0.95),
      sdEllipsoid(x, y, z, -1.0, 0.2, -0.3, 0.95, 0.6, 0.9),
    );
  return meshSDF(
    woolField(base, {
      seed,
      min: [-3.2, -1.2, -2.3],
      max: [3.2, 1.6, 2.3],
      inset: 0.22,
      layers: [{ count: 36, rMin: 0.45, rMax: 0.75 }, { count: 60, rMin: 0.22, rMax: 0.38 }],
      blend: 0.25,
      curl: 0.01,
    }),
    { min: [-3.8, -1.6, -2.8], max: [3.8, 2.3, 2.8], cell: 0.1, ao: true },
  );
}

// --- the cat ------------------------------------------------------------------------

function catBody(): THREE.BufferGeometry {
  // a loaf of a cat, sitting, facing +x
  const body = (x: number, y: number, z: number) => {
    let d = sdEllipsoid(x, y, z, 0, 0.1, 0, 0.13, 0.1, 0.085);
    d = smin(d, sdEllipsoid(x, y, z, 0.1, 0.2, 0, 0.075, 0.07, 0.072), 0.04); // head
    d = smin(d, sdCapsule(x, y, z, 0.12, 0.25, 0.04, 0.115, 0.31, 0.055, 0.016), 0.012); // ears
    d = smin(d, sdCapsule(x, y, z, 0.12, 0.25, -0.04, 0.115, 0.31, -0.055, 0.016), 0.012);
    return d;
  };
  return meshSDF(body, { min: [-0.18, -0.02, -0.13], max: [0.22, 0.36, 0.13], cell: 0.009, ao: true });
}

function catTail(): THREE.BufferGeometry {
  // hangs down the wall from the rump; swished by rotating about its root
  const g = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.06, -0.05, 0), new THREE.Vector3(-0.08, -0.16, 0.01), new THREE.Vector3(-0.05, -0.26, 0.03)]),
    12, 0.017, 6,
  );
  g.deleteAttribute('uv');
  return withAO(g);
}

// --- washing line -------------------------------------------------------------------

interface Washing {
  group: THREE.Group;
  cloths: { mesh: THREE.Mesh; rest: Float32Array; phase: number }[];
}

function washingLine(world: WorldUniforms): Washing | null {
  const g = GARDENS[0];
  if (!g) return null;
  const group = new THREE.Group();
  group.name = 'washing line';
  const len = Math.min(1.5, g.hu * 1.7);
  const y0 = groundHeight(g.x, g.z);
  group.position.set(g.x, y0, g.z);
  group.rotation.y = g.rot;
  const wood = paintMaterial(world, { color: '#8a6a4e', softness: 0.15 });
  for (const s of [-1, 1]) {
    const post = caster(new THREE.Mesh(withAO(new THREE.CylinderGeometry(0.02, 0.025, 0.55, 6).translate(0, 0.275, 0)), wood));
    post.position.set((s * len) / 2, 0, 0);
    group.add(post);
  }
  const line = new THREE.Mesh(
    withAO(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-len / 2, 0.52, 0), new THREE.Vector3(0, 0.44, 0), new THREE.Vector3(len / 2, 0.52, 0)), 16, 0.005, 4)),
    paintMaterial(world, { color: '#efe9dd' }),
  );
  group.add(line);
  const colors = ['#f6f2ea', '#8fb4d9', '#e9a3a3', '#f6f2ea', '#e8cf7a'];
  const cloths: Washing['cloths'] = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const u = -len / 2 + (len * (i + 0.6)) / (n + 0.2);
    const w = 0.16 + (i % 2) * 0.05, h = 0.18 + ((i * 7) % 3) * 0.03;
    const geo = withAO(new THREE.PlaneGeometry(w, h, 4, 4).translate(0, -h / 2, 0));
    geo.deleteAttribute('uv');
    const sag = 0.44 + 0.08 * Math.pow((2 * u) / len, 2);
    const mesh = caster(new THREE.Mesh(geo, paintMaterial(world, { color: colors[i % colors.length], side: THREE.DoubleSide, softness: 0.3 })));
    mesh.position.set(u, sag + 0.005, 0);
    group.add(mesh);
    cloths.push({ mesh, rest: Float32Array.from(geo.getAttribute('position').array as Float32Array), phase: i * 1.3 });
  }
  group.traverse((o) => o.layers.enable(SHADOW_LAYER));
  return { group, cloths };
}

// --- chimney smoke ------------------------------------------------------------------

const smokeVertex = /* glsl */ `
attribute float aPhase;
attribute float aChimney;
uniform float uTime;
uniform vec3 uTops[3];
varying float vAlpha;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  // each puff rises from its chimney, swelling and drifting downwind, then fades
  float age = fract(uTime * 0.16 + aPhase);
  vec3 top = aChimney < 0.5 ? uTops[0] : aChimney < 1.5 ? uTops[1] : uTops[2];
  vec3 drift = vec3(0.55, 0.0, -0.2) * age * age + vec3(sin(age * 6.0 + aPhase * 9.0) * 0.06, 0.0, 0.0);
  float size = mix(0.05, 0.2, age);
  vec3 wp = top + vec3(0.0, age * 0.8, 0.0) + drift + position * size;
  vAlpha = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.45, 1.0, age));
  vNormalW = normal;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const smokeFragment = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uShadeColor;
varying float vAlpha;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(vNormalW);
  float lit = smoothstep(-0.3, 0.6, dot(N, uSunDir));
  vec3 col = mix(vec3(0.82, 0.83, 0.9) * uShadeColor * 1.1, vec3(0.97, 0.96, 0.93), lit);
  gl_FragColor = vec4(col, vAlpha * 0.75);
}
`;

function smoke(world: WorldUniforms): THREE.Mesh | null {
  // the two chimneys nearest the middle of town keep a fire going
  const tops = chimneyTops().sort((a, b) => Math.hypot(a.x + 1, a.z - 1) - Math.hypot(b.x + 1, b.z - 1)).slice(0, 2);
  if (!tops.length) return null;
  const puffs: THREE.BufferGeometry[] = [];
  const per = 6;
  tops.forEach((_, c) => {
    for (let i = 0; i < per; i++) {
      const s = new THREE.IcosahedronGeometry(1, 1);
      s.deleteAttribute('uv');
      const n = s.getAttribute('position').count;
      s.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).fill(i / per + c * 0.37), 1));
      s.setAttribute('aChimney', new THREE.BufferAttribute(new Float32Array(n).fill(c), 1));
      puffs.push(s);
    }
  });
  const uTops = [0, 1, 2].map((i) => tops[Math.min(i, tops.length - 1)].clone());
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: world.uTime, uSunDir: world.uSunDir, uShadeColor: world.uShadeColor, uTops: { value: uTops } },
    vertexShader: smokeVertex,
    fragmentShader: smokeFragment,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(mergeGeometries(puffs), mat);
  mesh.frustumCulled = false;
  mesh.name = 'smoke';
  mesh.renderOrder = 2;
  return mesh;
}

// --- everything ---------------------------------------------------------------------

interface Cloud { mesh: THREE.Mesh; speed: number; size: number; axis: 'x' | 'z'; span: number }

export interface Props {
  group: THREE.Group;
  update(dt: number, time: number): void;
}

export function createProps(world: WorldUniforms, reducedMotion = false): Props {
  const group = new THREE.Group();
  group.name = 'props';

  // trees: a trunk and a puff crown
  const trunkGeo = withAO(new THREE.CylinderGeometry(0.06, 0.09, 1, 7).translate(0, 0.5, 0));
  const trunkMat = paintMaterial(world, { color: '#7a5a3e' });
  for (const t of TREES) {
    const y = groundHeight(t.x, t.z);
    const trunk = caster(new THREE.Mesh(trunkGeo, trunkMat));
    trunk.position.set(t.x, y - 0.05, t.z);
    trunk.scale.set(1, t.r * 1.5, 1);
    const crown = caster(new THREE.Mesh(canopy(t.seed, t.r), puffMaterial(world, t.color, t.color === '#e8a7b7' ? '#b8a6dc' : '#8c9fd0', false, t.seed)));
    crown.position.set(t.x, y + t.r * 1.45, t.z);
    crown.name = 'tree';
    group.add(trunk, crown);
  }

  // the churchyard wall and its cat
  const wallLen = WALL.z1 - WALL.z0;
  const stoneGeo = withAO(new THREE.BoxGeometry(WALL.thick, WALL.height, wallLen, 1, 1, 8));
  const wall = caster(new THREE.Mesh(stoneGeo, paintMaterial(world, { color: '#cfc5b2', softness: 0.15 })));
  const wz = (WALL.z0 + WALL.z1) / 2;
  wall.position.set(WALL.x, groundHeight(WALL.x, wz) + WALL.height / 2 - 0.02, wz);
  group.add(wall);
  const cat = new THREE.Group();
  cat.name = 'cat';
  const fur = paintMaterial(world, { color: '#3b3634', softness: 0.2 });
  const body = caster(new THREE.Mesh(catBody(), fur));
  const tail = caster(new THREE.Mesh(catTail(), fur));
  tail.position.set(-0.1, 0.06, 0.02);
  const eyes = new THREE.Mesh(
    mergeGeometries([0.032, -0.032].map((z) => tint(new THREE.SphereGeometry(0.011, 6, 4).translate(0.17, 0.215, z).toNonIndexed().deleteAttribute('uv'), '#c9d36a'))),
    paintMaterial(world, { vertexColors: true }),
  );
  cat.add(body, tail, eyes);
  cat.position.set(CAT.x, groundHeight(CAT.x, CAT.z) + WALL.height - 0.02, CAT.z);
  // facing out over the lane, toward the camera
  cat.rotation.y = -Math.PI / 2 + 0.5;
  group.add(cat);

  const washing = washingLine(world);
  if (washing) group.add(washing.group);
  const smokeMesh = smoke(world);
  if (smokeMesh) group.add(smokeMesh);

  // clouds travel along the edges of the tile, as in the references, so they never park over the middle
  const clouds: Cloud[] = [];
  const cloudDefs = [
    { x: -4, y: 5.4, z: -TILE.halfZ - 1.4, s: 0.9, seed: 11, speed: 0.16, axis: 'x' as const, span: 15 },
    { x: TILE.halfX + 1.6, y: 5.0, z: 1, s: 0.7, seed: 12, speed: -0.12, axis: 'z' as const, span: 10 },
    { x: -TILE.halfX - 1.2, y: 4.4, z: 4, s: 0.6, seed: 13, speed: 0.1, axis: 'z' as const, span: 10 },
  ];
  for (const c of cloudDefs) {
    const mesh = caster(new THREE.Mesh(cloudShape(c.seed), puffMaterial(world, '#fbfaf6', '#dfe2f5', true, c.seed)));
    mesh.position.set(c.x, c.y, c.z);
    mesh.scale.setScalar(c.s);
    mesh.name = 'cloud';
    group.add(mesh);
    clouds.push({ mesh, speed: c.speed, size: c.s, axis: c.axis, span: c.span });
  }

  const calm = reducedMotion ? 0.4 : 1;
  return {
    group,
    update(dt: number, time: number) {
      for (const c of clouds) {
        const p = c.mesh.position;
        p[c.axis] += c.speed * dt * calm;
        if (p[c.axis] > c.span) p[c.axis] = -c.span;
        if (p[c.axis] < -c.span) p[c.axis] = c.span;
        // they gently dissolve as they reach the end of their run, then return
        const fade = Math.min(1, (c.span - Math.abs(p[c.axis])) / 3.5);
        c.mesh.scale.setScalar(c.size * Math.max(0.001, fade * fade * (3 - 2 * fade)));
      }
      // the cat's tail swishes now and then
      const swish = Math.sin(time * 0.9) > 0.55 ? Math.sin(time * 6) * 0.35 : 0;
      tail.rotation.x = swish * calm;
      tail.rotation.z = 0.15 * Math.sin(time * 0.7) * calm;
      // washing sways and billows in the breeze
      if (washing) {
        for (const cl of washing.cloths) {
          const pos = cl.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
          for (let i = 0; i < pos.count; i++) {
            const x = cl.rest[i * 3], y = cl.rest[i * 3 + 1];
            const hang = -y; // 0 at the peg, more toward the hem
            const billow = (Math.sin(time * 2.1 + cl.phase + x * 8) * 0.5 + Math.sin(time * 3.3 + cl.phase * 2) * 0.3) * hang * 0.35 * calm;
            pos.setZ(i, cl.rest[i * 3 + 2] + billow);
            pos.setX(i, x + Math.sin(time * 1.3 + cl.phase) * hang * 0.05 * calm);
          }
          pos.needsUpdate = true;
          cl.mesh.geometry.computeVertexNormals();
        }
      }
    },
  };
}
