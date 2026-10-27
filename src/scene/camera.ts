import * as THREE from 'three';
import { TILE } from './town';

/**
 * An elevated three-quarter view of the tile, like the aerial illustrations:
 * high enough to read the whole patchwork, low enough that the far side is
 * genuinely farther away (so planes shrink as they go). It is a real
 * perspective camera; its distance is solved so the tile, with a margin of
 * paper, fills the frame at any aspect ratio. Tall screens turn a quarter
 * turn so the tile's long side runs down the phone.
 */

const PITCH = THREE.MathUtils.degToRad(-46); // looking down
const PITCH_PORTRAIT = THREE.MathUtils.degToRad(-56); // steeper on tall screens, so the tile's length isn't foreshortened away
const FOV = 38;
const NUDGE = 1.0; // aim a little nearer than the centre, so the tile sits high above the toolbar
const MARGIN_LANDSCAPE = 0.9; // fraction of NDC the tile may fill
const MARGIN_PORTRAIT_Y = 0.82;

export function createCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.5, 400);
  camera.rotation.set(PITCH, 0, 0, 'YXZ');
  return camera;
}

// the tile, plus the airspace over its far edge where flights climb and loop
const CORNERS = [
  new THREE.Vector3(-TILE.halfX, 0, -TILE.halfZ),
  new THREE.Vector3(TILE.halfX, 0, -TILE.halfZ),
  new THREE.Vector3(-TILE.halfX, 0, TILE.halfZ),
  new THREE.Vector3(TILE.halfX, 0, TILE.halfZ),
  new THREE.Vector3(-TILE.halfX * 0.8, 4.2, -TILE.halfZ * 0.8),
  new THREE.Vector3(TILE.halfX * 0.8, 4.2, -TILE.halfZ * 0.8),
];
const tmp = new THREE.Vector3();

function place(camera: THREE.PerspectiveCamera, yaw: number, distance: number): void {
  const euler = new THREE.Euler(yaw === 0 ? PITCH : PITCH_PORTRAIT, yaw, 0, 'YXZ');
  const back = new THREE.Vector3(0, 0, 1).applyEuler(euler);
  const target = new THREE.Vector3(0, 0, NUDGE).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  camera.position.copy(target).addScaledVector(back, distance);
  camera.rotation.copy(euler);
  camera.updateMatrixWorld(true);
}

/** Largest |NDC| the tile's corners reach, per axis. */
function extent(camera: THREE.PerspectiveCamera): { x: number; y: number } {
  let x = 0, y = 0;
  for (const c of CORNERS) {
    tmp.copy(c).project(camera);
    x = Math.max(x, Math.abs(tmp.x));
    y = Math.max(y, Math.abs(tmp.y));
  }
  return { x, y };
}

/** The camera's yaw: 0 on wide screens, a quarter turn on tall ones. */
export function cameraYaw(width: number, height: number): number {
  return width < height ? -Math.PI / 2 : 0;
}

export function frameCamera(camera: THREE.PerspectiveCamera, width: number, height: number): void {
  const aspect = width / Math.max(1, height);
  camera.aspect = aspect;
  camera.fov = FOV;
  camera.updateProjectionMatrix();
  const portrait = aspect < 1;
  const yaw = cameraYaw(width, height);
  // bisection on distance: the closest camera at which the tile still fits
  let lo = 4;
  let hi = 200;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    place(camera, yaw, mid);
    const e = extent(camera);
    // tall screens fill top to bottom and may let the sides run a little off the page
    const fits = portrait ? e.y <= MARGIN_PORTRAIT_Y && e.x <= 1.45 : e.x <= MARGIN_LANDSCAPE && e.y <= MARGIN_LANDSCAPE;
    if (fits) hi = mid;
    else lo = mid;
  }
  place(camera, yaw, hi);
}
