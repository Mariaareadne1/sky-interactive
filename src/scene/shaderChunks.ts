// GLSL shared by every world material: noise, the painted light model and
// the one sun shadow map everything in the town casts into.

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s;
}
float fbm2lite(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s / 0.875 * 0.97;
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p = p * 2.07 + vec3(17.1, 9.3, 4.7); a *= 0.5; }
  return s;
}
`;

export const WORLD_UNIFORMS_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uShadeColor;
uniform vec3 uPaper;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowUvPerMeter;
uniform float uShadowDepthRange;
uniform float uShadowEnabled;
uniform float uWind;
uniform float uWet;
uniform float uGolden;
`;

export const LIGHTING_GLSL = /* glsl */ `
const vec2 POISSON[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);

// Cast shadows (planes, houses, trees) with a contact-hardening penumbra: the
// farther the occluder is above the receiver — a plane in flight — the
// softer its shadow. 1 = lit.
float castLight(vec3 wp, float bias) {
  if (uShadowEnabled < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(wp, 1.0);
  vec3 c = sc.xyz / sc.w;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float receiver = c.z - bias / uShadowDepthRange;
  float rot = hash12(gl_FragCoord.xy) * 6.2831;
  mat2 R = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));
  float searchR = 0.6 * uShadowUvPerMeter;
  float blockSum = 0.0, blockN = 0.0;
  for (int i = 0; i < 12; i++) {
    float d = texture2D(uShadowMap, c.xy + R * POISSON[i] * searchR).r;
    if (d < receiver) { blockSum += d; blockN += 1.0; }
  }
  if (blockN < 0.5) return 1.0;
  float gap = max(0.0, receiver - blockSum / blockN) * uShadowDepthRange;
  float penumbra = (0.02 + gap * 0.011) * uShadowUvPerMeter;
  float lit = 0.0;
  for (int i = 0; i < 12; i++) {
    float d = texture2D(uShadowMap, c.xy + R * POISSON[i] * penumbra).r;
    lit += d < receiver ? 0.0 : 1.0;
  }
  // a plane high in the sky throws a fainter shadow as well as a softer one
  return mix(lit / 12.0, 1.0, smoothstep(1.0, 9.0, gap) * 0.3);
}

// Five fixed taps, no blocker search: for fur shells and small parts.
float castLightFast(vec3 wp, float bias) {
  if (uShadowEnabled < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(wp, 1.0);
  vec3 c = sc.xyz / sc.w;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float receiver = c.z - bias / uShadowDepthRange;
  float r = 0.05 * uShadowUvPerMeter;
  float lit = 0.0;
  for (int i = 0; i < 5; i++) lit += texture2D(uShadowMap, c.xy + POISSON[i * 2] * r).r < receiver ? 0.0 : 1.0;
  return lit / 5.0;
}

// Painted light: a soft two-tone ramp. Form turning from the sun and cast
// shadow cross into the same cool lavender shade, as in gouache.
vec3 paintLight(vec3 albedo, vec3 N, float sunVis, float ao, float softness) {
  float ndl = dot(N, uSunDir);
  float form = smoothstep(-0.25 - softness, 0.35 + softness, ndl);
  float lit = form * sunVis;
  vec3 shade = albedo * uShadeColor * mix(0.78, 1.0, ao);
  vec3 light = albedo * uSunColor * (0.94 + 0.12 * smoothstep(0.5, 1.0, ndl)) * mix(0.9, 1.0, ao);
  return mix(shade, light, lit);
}
`;
