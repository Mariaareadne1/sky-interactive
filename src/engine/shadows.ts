import * as THREE from 'three';
import { TILE } from '../scene/town';
import type { WorldUniforms } from '../scene/world';

/** Objects on this layer cast into the sun's shadow map. */
export const SHADOW_LAYER = 1;

/**
 * Meshes whose vertex shader moves geometry (swaying washing, a swishing tail) keep a matching depth-only material in userData.depth, so
 * their shadows move with them. Everything else uses a plain depth material.
 */
export function setDepthMaterial(mesh: THREE.Object3D, depth: THREE.Material): void {
  mesh.userData.depth = depth;
}

/**
 * Real-time cast shadows for everything that stands on or flies over the
 * tile. Receivers sample the map with a contact-hardening filter, so a plane's
 * shadow is soft and faint when it flies high and crisp when it skims a roof.
 */
export class SunShadows {
  readonly target: THREE.WebGLRenderTarget;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly depthMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  private readonly bias = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
  );
  private readonly lightSpace = new THREE.Vector3();
  private readonly swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];

  constructor(private readonly world: WorldUniforms, size: number) {
    this.target = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(size, size, THREE.FloatType),
    });
    this.target.depthTexture!.minFilter = THREE.NearestFilter;
    this.target.depthTexture!.magFilter = THREE.NearestFilter;
    this.camera.layers.set(SHADOW_LAYER);
    world.uShadowMap.value = this.target.depthTexture;
  }

  /** The sun camera covers the whole tile, from just under the ground to the top of the highest loop. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const sun = this.world.uSunDir.value;
    this.camera.position.set(0, 0, 0).addScaledVector(sun, 60);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    const inv = this.camera.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const x of [-TILE.halfX, TILE.halfX]) for (const z of [-TILE.halfZ, TILE.halfZ]) for (const y of [-0.5, 8]) {
      this.lightSpace.set(x, y, z).applyMatrix4(inv);
      minX = Math.min(minX, this.lightSpace.x);
      maxX = Math.max(maxX, this.lightSpace.x);
      minY = Math.min(minY, this.lightSpace.y);
      maxY = Math.max(maxY, this.lightSpace.y);
      minZ = Math.min(minZ, this.lightSpace.z);
      maxZ = Math.max(maxZ, this.lightSpace.z);
    }
    // square, so texels are isotropic
    const size = Math.max(maxX - minX, maxY - minY, 4);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.camera.left = cx - size / 2;
    this.camera.right = cx + size / 2;
    this.camera.bottom = cy - size / 2;
    this.camera.top = cy + size / 2;
    this.camera.near = Math.max(0.1, -maxZ - 1);
    this.camera.far = -minZ + 1;
    this.camera.updateProjectionMatrix();

    // animated casters draw with their own depth shader, the rest with the plain one
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.layers.isEnabled(SHADOW_LAYER)) return;
      this.swapped.push({ mesh, material: mesh.material });
      mesh.material = (mesh.userData.depth as THREE.Material | undefined) ?? this.depthMaterial;
    });
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.camera);
    for (const s of this.swapped) s.mesh.material = s.material;
    this.swapped.length = 0;
    renderer.setRenderTarget(null);

    this.world.uShadowMatrix.value
      .copy(this.bias)
      .multiply(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);
    this.world.uShadowUvPerMeter.value = 1 / size;
    this.world.uShadowDepthRange.value = this.camera.far - this.camera.near;
    this.world.uShadowEnabled.value = 1;
  }

  dispose(): void {
    this.target.dispose();
    this.depthMaterial.dispose();
  }
}
