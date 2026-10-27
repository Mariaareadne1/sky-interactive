import * as THREE from 'three';

/**
 * One light rig shared by every material. The look is painted rather than
 * photographic: a warm sun over a soft two-tone ramp, with shade that turns
 * cool lavender instead of simply darker. Colours are linear-light.
 *
 * Golden hour is a single 0..1 dial: the sun sinks toward the west, warms,
 * and the shade deepens toward violet, so shadows lengthen across the roofs.
 */

// THREE.Color parses hex as sRGB and stores linear values (ColorManagement is on).
const linear = (hex: string) => new THREE.Color(hex);

export const PAPER_HEX = '#f4efe4';

const SUN_DAY = new THREE.Vector3(-0.62, 0.74, 0.26).normalize();
const SUN_GOLDEN = new THREE.Vector3(-0.86, 0.36, 0.36).normalize();
const SUN_COLOR_DAY = linear('#fff7ea');
const SUN_COLOR_GOLDEN = linear('#ffd9a0');
const SHADE_DAY = linear('#bdb9e3');
const SHADE_GOLDEN = linear('#a59ad8');

export const SUN_DIR = SUN_DAY.clone();

export interface WorldUniforms {
  [name: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uShadeColor: THREE.IUniform<THREE.Color>;
  uPaper: THREE.IUniform<THREE.Color>;
  uShadowMap: THREE.IUniform<THREE.Texture | null>;
  uShadowMatrix: THREE.IUniform<THREE.Matrix4>;
  uShadowUvPerMeter: THREE.IUniform<number>;
  uShadowDepthRange: THREE.IUniform<number>;
  uShadowEnabled: THREE.IUniform<number>;
  uWind: THREE.IUniform<number>;
  /** 0 dry .. 1 just rained: darker soil, glossier petals. */
  uWet: THREE.IUniform<number>;
  /** 0 noon .. 1 golden hour. */
  uGolden: THREE.IUniform<number>;
}

export function createWorldUniforms(): WorldUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: SUN_DAY.clone() },
    uSunColor: { value: SUN_COLOR_DAY.clone() },
    uShadeColor: { value: SHADE_DAY.clone() },
    uPaper: { value: linear(PAPER_HEX) },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowUvPerMeter: { value: 0.02 },
    uShadowDepthRange: { value: 40 },
    uShadowEnabled: { value: 0 },
    uWind: { value: 1 },
    uWet: { value: 0 },
    uGolden: { value: 0 },
  };
}

/** Set the time of day (0 noon .. 1 golden hour). */
export function setGolden(world: WorldUniforms, t: number): void {
  const k = Math.min(1, Math.max(0, t));
  world.uGolden.value = k;
  world.uSunDir.value.copy(SUN_DAY).lerp(SUN_GOLDEN, k).normalize();
  world.uSunColor.value.copy(SUN_COLOR_DAY).lerp(SUN_COLOR_GOLDEN, k);
  world.uShadeColor.value.copy(SHADE_DAY).lerp(SHADE_GOLDEN, k);
}
