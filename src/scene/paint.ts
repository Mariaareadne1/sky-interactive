import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import type { WorldUniforms } from './world';

/**
 * The painted material shared by the garden's props (hedge, stones, can,
 * dish, ferns, snail…): albedo from a uniform or per-vertex colour, laid over
 * the shared two-tone light ramp, with pigment grain, a dab of warm highlight
 * and — for soft foliage — a dry-brush silhouette that breaks into specks.
 */

export interface PaintOptions {
  color?: string;
  /** Use the geometry's `color` attribute (sRGB-linear) instead of `color`. */
  vertexColors?: boolean;
  /** Foliage: the edge breaks up like dry brush. */
  ragged?: boolean;
  /** Softness of the light ramp (foliage is softer). */
  softness?: number;
  /** Extra highlight strength (glazed or metal things). */
  gloss?: number;
  shadeTint?: string;
  side?: THREE.Side;
}

const vertex = /* glsl */ `
attribute float aAO;
#ifdef VCOLOR
attribute vec3 color;
varying vec3 vColor;
#endif
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
#ifdef VCOLOR
  vColor = color;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
uniform vec3 uColor;
uniform vec3 uShadeTint;
uniform float uSoftness;
uniform float uGloss;
uniform float uSeed;
uniform float uHighlight;
#ifdef VCOLOR
varying vec3 vColor;
#endif
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vLocal;
varying float vAO;
void main() {
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
#ifdef RAGGED
  float facing = max(dot(N, V), 0.0);
  if (hash13(floor(vWorld * 40.0) + uSeed) > smoothstep(0.0, 0.3, facing) * 1.1) discard;
#endif
#ifdef VCOLOR
  vec3 base = vColor;
#else
  vec3 base = uColor;
#endif
  float grain = vnoise3(vLocal * 14.0 + uSeed) * 0.6 + vnoise3(vLocal * 40.0) * 0.4;
  vec3 albedo = base * (0.92 + 0.15 * grain);
  float ao = mix(0.4, 1.0, vAO);
  float sunVis = castLight(vWorld, 0.02);
  vec3 col = paintLight(albedo, N, sunVis, ao, uSoftness);
  // a dab of sunlit highlight
  vec3 H = normalize(uSunDir + V);
  float hi = smoothstep(0.82, 0.97, dot(N, H)) * sunVis;
  col += uSunColor * hi * uGloss * (0.25 + 0.4 * uWet);
  float lift = smoothstep(0.55, 0.9, dot(N, uSunDir)) * sunVis;
  col = mix(col, col * vec3(1.1, 1.1, 0.96), lift * 0.6);
  float shade = 1.0 - smoothstep(-0.2, 0.5, dot(N, uSunDir));
  col = mix(col, col * uShadeTint, shade * 0.5);
  col += vec3(0.12, 0.3, 0.75) * uHighlight * pow(1.0 - max(dot(N, V), 0.0), 2.5) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

let seedCounter = 0;

export function paintMaterial(world: WorldUniforms, opts: PaintOptions = {}): THREE.ShaderMaterial {
  const defines: Record<string, number> = {};
  if (opts.vertexColors) defines.VCOLOR = 1;
  if (opts.ragged) defines.RAGGED = 1;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...world,
      uColor: { value: new THREE.Color(opts.color ?? '#ffffff') },
      uShadeTint: { value: new THREE.Color(opts.shadeTint ?? '#c8c4e8') },
      uSoftness: { value: opts.softness ?? 0.15 },
      uGloss: { value: opts.gloss ?? 0.2 },
      uSeed: { value: (seedCounter++ * 7.31) % 97 },
      uHighlight: { value: 0 },
    },
    defines,
    vertexShader: vertex,
    fragmentShader: fragment,
    side: opts.side ?? THREE.FrontSide,
  });
}

/** Give a plain geometry a flat ambient-occlusion attribute (paintMaterial expects one). */
export function withAO(geo: THREE.BufferGeometry, value = 1): THREE.BufferGeometry {
  if (!geo.getAttribute('aAO')) {
    geo.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(value), 1));
  }
  return geo;
}

/** Paint every vertex of a geometry one colour (for merging parts with different colours). */
export function tint(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return withAO(geo);
}
