import * as THREE from 'three';

/**
 * Final pass: exposure, a neutral photographic tone curve, the cool
 * blue-violet shadow grade, a soft vignette, and fine grain + dither.
 * The scene renders linear HDR into a multisampled target; this writes sRGB.
 */

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragment = /* glsl */ `
uniform sampler2D tScene;
uniform float uExposure;
uniform float uTime;
uniform float uGrain;
uniform vec2 uResolution;
varying vec2 vUv;

// Khronos PBR Neutral: keeps albedo hues honest, rolls off highlights gently.
vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 hdr = texture2D(tScene, vUv).rgb * uExposure;
  vec3 c = neutral(hdr);

  // grade: pull shadows toward slate blue-violet, keep highlights warm and clean
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 shadowTint = vec3(0.93, 0.95, 1.10);
  vec3 highTint = vec3(1.02, 1.0, 0.97);
  c *= mix(shadowTint, highTint, smoothstep(0.05, 0.55, luma));
  c = mix(vec3(luma), c, 0.93); // a touch of restraint on saturation

  // soft vignette
  vec2 q = vUv - 0.5;
  q.x *= uResolution.x / uResolution.y;
  c *= 1.0 - 0.16 * smoothstep(0.35, 1.05, length(q));

  vec3 outc = toSRGB(clamp(c, 0.0, 1.0));
  float n = hash(vUv * uResolution + fract(uTime) * 91.7) - 0.5;
  outc += n * uGrain + (hash(vUv * uResolution * 1.37) - 0.5) / 255.0;
  gl_FragColor = vec4(outc, 1.0);
}
`;

export class PostPass {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  constructor(samples: number) {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
        uExposure: { value: 1.12 },
        uTime: { value: 0 },
        uGrain: { value: 0.012 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.material.uniforms.uResolution.value.set(width, height);
  }

  render(renderer: THREE.WebGLRenderer, time: number, output: THREE.WebGLRenderTarget | null = null): void {
    this.material.uniforms.uTime.value = time;
    renderer.setRenderTarget(output);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
