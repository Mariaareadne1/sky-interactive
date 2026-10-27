import * as THREE from 'three';
import { TILE, groundHeight } from './town';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { GROUND_GLSL } from './groundGlsl';
import type { WorldUniforms } from './world';

/**
 * The painted ground. Colour is laid in the way a gouache illustrator would:
 * a patchwork of fields with dark hedgerows round a village of grass, sandy
 * lanes, a bright green and little back gardens — then pigment grain, pale
 * dry-brush flecks and a ragged edge where the paint runs out onto the paper.
 *
 * The layout paint is baked once into a texture (it is static and costly);
 * light, shadow, grain and the edge are painted live.
 */

/** Baked texels per world unit. */
const BAKE_DENSITY = 112;
const BAKE_PAD = 0.6;

const bakeVertex = /* glsl */ `
varying vec2 vXZ;
uniform vec4 uBounds; // minX, minZ, sizeX, sizeZ
void main() {
  vXZ = uBounds.xy + uv * uBounds.zw;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const bakeFragment = /* glsl */ `
${NOISE_GLSL}
${GROUND_GLSL}
varying vec2 vXZ;
void main() {
  float grassy;
  vec3 c = groundPaint(vXZ, grassy);
  gl_FragColor = vec4(c, grassy);
}
`;

const vertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
uniform sampler2D uGround;
uniform vec4 uBounds;
varying vec3 vWorld;
varying vec3 vNormal;

float paintEdgeLive(vec2 xz) {
  vec2 q = abs(xz) - vec2(${TILE.halfX.toFixed(2)}, ${TILE.halfZ.toFixed(2)}) + 1.0;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 1.0;
  float rough = (vnoise(xz * 1.1) - 0.5) * 0.5 + (vnoise(xz * 4.0) - 0.5) * 0.24;
  return -box + rough;
}

void main() {
  vec2 xz = vWorld.xz;
  // dry-brush edge: paint thins, then breaks into specks on the paper
  float edge = paintEdgeLive(xz);
  float cover = smoothstep(-0.05, 0.55, edge);
  if (hash12(floor(xz * 26.0)) > cover * 1.08) discard;

  vec4 baked = texture2D(uGround, (xz - uBounds.xy) / uBounds.zw);
  vec3 albedo = baked.rgb;
  float grassy = baked.a;
  // pigment grain: a fine stipple, and the odd pale fleck of dry brush
  albedo *= 0.95 + 0.1 * vnoise(xz * 30.0);
  float fleck = step(0.985, hash12(floor(xz * 13.0))) * grassy;
  albedo = mix(albedo, albedo * 1.25 + vec3(0.02, 0.018, 0.0), fleck * 0.8);
  // tiny daisies and buttercups in the grass
  float flower = step(0.993, hash12(floor(xz * 21.0) + 5.0)) * grassy;
  albedo = mix(albedo, hash12(floor(xz * 21.0)) > 0.5 ? vec3(0.95, 0.93, 0.85) : vec3(0.95, 0.75, 0.2), flower * 0.85);

  vec3 N = normalize(vNormal);
  float sunVis = castLight(vWorld, 0.03);
  vec3 col = paintLight(albedo, N, sunVis, 1.0, 0.2);
  // where the paint thins at the edge, the paper shows through
  col = mix(uPaper, col, 0.55 + 0.45 * smoothstep(0.0, 0.7, edge));
  gl_FragColor = vec4(col, 1.0);
}
`;

function buildGeometry(): THREE.BufferGeometry {
  const step = 0.08;
  const cols = Math.round((TILE.halfX * 2) / step);
  const rows = Math.round((TILE.halfZ * 2) / step);
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    const z = -TILE.halfZ + r * step;
    for (let c = 0; c <= cols; c++) {
      const x = -TILE.halfX + c * step;
      positions[k] = x;
      positions[k + 1] = groundHeight(x, z);
      positions[k + 2] = z;
      k += 3;
    }
  }
  const index = new Uint32Array(cols * rows * 6);
  let o = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      index.set([a, b, a + 1, a + 1, b, b + 1], o);
      o += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export interface Terrain {
  mesh: THREE.Mesh;
  /** Paint the layout texture (again, after a lost context). */
  bake(renderer: THREE.WebGLRenderer): void;
  dispose(): void;
}

export function createTerrain(world: WorldUniforms): Terrain {
  const minX = -TILE.halfX - BAKE_PAD, minZ = -TILE.halfZ - BAKE_PAD;
  const sizeX = 2 * (TILE.halfX + BAKE_PAD), sizeZ = 2 * (TILE.halfZ + BAKE_PAD);
  const bounds = new THREE.Vector4(minX, minZ, sizeX, sizeZ);
  const target = new THREE.WebGLRenderTarget(Math.round(sizeX * BAKE_DENSITY), Math.round(sizeZ * BAKE_DENSITY), {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const material = new THREE.ShaderMaterial({
    uniforms: { ...world, uGround: { value: target.texture }, uBounds: { value: bounds } },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
  const mesh = new THREE.Mesh(buildGeometry(), material);
  mesh.name = 'terrain';

  const bakeScene = new THREE.Scene();
  const bakeMat = new THREE.ShaderMaterial({ uniforms: { uBounds: { value: bounds } }, vertexShader: bakeVertex, fragmentShader: bakeFragment, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMat);
  quad.frustumCulled = false;
  bakeScene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    mesh,
    bake(renderer) {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(bakeScene, cam);
      renderer.setRenderTarget(prev);
    },
    dispose() {
      target.dispose();
      bakeMat.dispose();
      quad.geometry.dispose();
    },
  };
}
