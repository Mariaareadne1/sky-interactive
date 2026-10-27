import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from '../scene/shaderChunks';
import type { WorldUniforms } from '../scene/world';

/**
 * Folded paper: cream stock with a faint fibre grain, a ruled line or two
 * and a pale margin, lit by the shared painted light. Normals come from
 * screen-space derivatives, so every facet between creases is flat and
 * each crease reads as a crisp change of tone. Thin paper lets a little
 * warm light through when the sun is behind a facet.
 */

const vertex = /* glsl */ `
attribute vec2 aFlat;
varying vec3 vWorld;
varying vec2 vFlat;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vFlat = aFlat;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
uniform vec3 uTint;
uniform float uAlpha;
uniform float uHighlight;
uniform float uSeed;
varying vec3 vWorld;
varying vec2 vFlat;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  // fibre grain and the faintest mottling
  vec3 albedo = uTint * (0.965 + 0.05 * vnoise(vFlat * 90.0 + uSeed) + 0.025 * vnoise(vFlat * 9.0 - uSeed));
  // a couple of faint ruled lines across the page, and a pale pink margin
  float ruled = 1.0 - smoothstep(0.0025, 0.006, abs(fract((vFlat.y + 0.03) / 0.15) - 0.5) * 0.15);
  ruled *= step(-0.33, vFlat.y) * step(vFlat.y, 0.2);
  albedo = mix(albedo, albedo * vec3(0.8, 0.88, 1.02), ruled * 0.55);
  float margin = 1.0 - smoothstep(0.002, 0.005, abs(vFlat.x + 0.31));
  albedo = mix(albedo, albedo * vec3(1.02, 0.86, 0.88), margin * 0.5);

  float sunVis = castLightFast(vWorld, 0.05);
  vec3 col = paintLight(albedo, N, sunVis, 1.0, 0.1);
  // light through thin paper on the shaded side
  float back = max(0.0, -dot(N, uSunDir));
  col += albedo * uSunColor * vec3(1.0, 0.93, 0.8) * back * 0.18;
  // a soft sheen where the sun catches a facet
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * smoothstep(0.88, 0.99, dot(N, H)) * 0.12 * sunVis;
  // selection: a blue rim
  col += vec3(0.12, 0.3, 0.75) * uHighlight * (0.25 + 0.75 * pow(1.0 - abs(dot(N, V)), 2.0));
  gl_FragColor = vec4(col, uAlpha);
}
`;

const TINTS = ['#f8f3e7', '#f6efe0', '#faf6ee', '#f6ece4', '#f1f1ea', '#f8f1dc'];

export function paperMaterial(world: WorldUniforms, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...world,
      uTint: { value: new THREE.Color(TINTS[Math.abs(seed) % TINTS.length]) },
      uAlpha: { value: 1 },
      uHighlight: { value: 0 },
      uSeed: { value: (seed % 97) * 0.37 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.DoubleSide,
  });
}

// --- the speed streak ---------------------------------------------------------------

const streakVertex = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const streakFragment = /* glsl */ `
varying float vAlpha;
void main() { gl_FragColor = vec4(1.0, 0.99, 0.96, vAlpha); }
`;

/** A faint white ribbon behind the plane while it loops. */
export class Streak {
  readonly mesh: THREE.Mesh;
  private readonly points: THREE.Vector3[] = [];
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly side = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();
  private strength = 0;

  constructor(private readonly n = 26) {
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < n - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ vertexShader: streakVertex, fragmentShader: streakFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  update(tip: THREE.Vector3, looping: number, camera: THREE.Camera, dt: number): void {
    this.strength += ((looping > 0.3 ? 1 : 0) - this.strength) * Math.min(1, dt * 5);
    this.points.unshift(tip.clone());
    if (this.points.length > this.n) this.points.length = this.n;
    this.mesh.visible = this.strength > 0.01;
    if (!this.mesh.visible) return;
    for (let i = 0; i < this.n; i++) {
      const p = this.points[Math.min(i, this.points.length - 1)];
      const q = this.points[Math.min(i + 1, this.points.length - 1)];
      this.toCam.copy(camera.position).sub(p).normalize();
      this.side.copy(p).sub(q).cross(this.toCam).normalize();
      const k = i / (this.n - 1);
      const w = 0.035 * (1 - k);
      this.pos.set([p.x + this.side.x * w, p.y + this.side.y * w, p.z + this.side.z * w], i * 6);
      this.pos.set([p.x - this.side.x * w, p.y - this.side.y * w, p.z - this.side.z * w], i * 6 + 3);
      const a = 0.42 * this.strength * (1 - k) * (1 - k);
      this.alpha[i * 2] = a;
      this.alpha[i * 2 + 1] = a;
    }
    this.mesh.geometry.getAttribute('position').needsUpdate = true;
    this.mesh.geometry.getAttribute('aAlpha').needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
