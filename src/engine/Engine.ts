import * as THREE from 'three';
import { createWorldUniforms, type WorldUniforms } from '../scene/world';
import { createCamera, frameCamera } from '../scene/camera';
import { PostPass } from './post';
import { SunShadows } from './shadows';

/**
 * The renderer, camera, painted light rig and frame loop. What lives in the
 * town is added by the app (TownScene, the planes); the engine
 * only knows how to draw it, keep it smooth, and capture it.
 */

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  quality: 'high' | 'low';
}

type FrameListener = (dt: number, time: number) => void;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly world: WorldUniforms;
  readonly post: PostPass;
  readonly shadows: SunShadows;
  readonly quality: 'high' | 'low';
  private readonly clock = new THREE.Clock();
  private readonly frameListeners = new Set<FrameListener>();
  private readonly beforeRender = new Set<FrameListener>();
  private raf = 0;
  private time = 0;
  private running = false;
  private pixelRatio: number;
  private readonly maxPixelRatio: number;
  /** Dynamic resolution: the fraction of the device pixel ratio actually rendered. */
  renderScale = 1;
  adaptive = true;
  private readonly frameTimes: number[] = [];
  private adaptTimer = 0;
  private raiseLockout = 0;
  private size = { width: 1, height: 1 };
  /** Fixed-step override used by tests and recording for deterministic playback. */
  fixedStep: number | null = null;
  paused = false;
  /** prefers-reduced-motion: gentler, slower flights and no loops. */
  readonly reducedMotion: boolean;
  frameCount = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  fps = 0;

  constructor(private readonly options: EngineOptions) {
    const { canvas, quality } = options;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = true;
    this.maxPixelRatio = Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.25);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);

    this.quality = quality;
    this.world = createWorldUniforms();
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (this.reducedMotion) this.world.uWind.value = 0.25;
    this.camera = createCamera();
    this.post = new PostPass(quality === 'high' ? 4 : 2);

    // the tile floats on a sheet of paper
    this.renderer.setClearColor(this.world.uPaper.value, 1);
    this.shadows = new SunShadows(this.world, quality === 'high' ? 2048 : 1024);
  }

  /** Pixels per world metre at a point (CSS pixels): how big things look there. */
  pixelsPerMeterAt(p: THREE.Vector3): number {
    const d = this.tmp.copy(p).applyMatrix4(this.camera.matrixWorldInverse).z * -1;
    return this.size.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * Math.max(0.1, d));
  }
  private readonly tmp = new THREE.Vector3();

  /** Debug/inspection: look at a point from somewhere else (tests and QA screenshots). */
  debugView(position: THREE.Vector3Like, target: THREE.Vector3Like, fov?: number): void {
    this.camera.position.set(position.x, position.y, position.z);
    if (fov) this.camera.fov = fov;
    this.camera.lookAt(target.x, target.y, target.z);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  get canvas(): HTMLCanvasElement {
    return this.options.canvas;
  }

  get elapsed(): number {
    return this.time;
  }

  onFrame(fn: FrameListener): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  onBeforeRender(fn: FrameListener): () => void {
    this.beforeRender.add(fn);
    return () => this.beforeRender.delete(fn);
  }

  resize(width: number, height: number): void {
    this.size = { width, height };
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    frameCamera(this.camera, width, height);
    this.post.setSize(Math.round(width * this.pixelRatio), Math.round(height * this.pixelRatio));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const real = Math.min(this.clock.getDelta(), 1 / 15);
      this.tick(this.fixedStep ?? real, real);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Advance the simulation by dt and draw one frame. */
  tick(dt: number, realDt = dt): void {
    const step = this.paused ? 0 : dt;
    this.time += step;
    this.frameCount++;
    this.fpsAccum += realDt;
    this.fpsFrames++;
    this.adapt(realDt);
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    this.world.uTime.value = this.time;
    for (const fn of this.frameListeners) fn(step, this.time);
    this.render();
  }

  /**
   * Keep motion smooth on dense displays: drop render resolution in steps when
   * frames run long, creep back up when there is headroom. Never below 1x CSS
   * pixels, and with a lockout so it cannot oscillate.
   */
  private adapt(realDt: number): void {
    if (!this.adaptive || this.fixedStep !== null) return;
    this.frameTimes.push(realDt);
    this.adaptTimer += realDt;
    this.raiseLockout = Math.max(0, this.raiseLockout - realDt);
    if (this.adaptTimer < 1.5) return;
    this.adaptTimer = 0;
    // the median ignores one-off hitches (garbage collection, a geometry build finishing)
    const sorted = this.frameTimes.splice(0).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 1 / 60;
    const minScale = Math.min(1, 1 / this.maxPixelRatio);
    let next = this.renderScale;
    if (median > 1 / 52 && this.renderScale > minScale) {
      next = Math.max(minScale, this.renderScale * 0.85);
      this.raiseLockout = 20;
    } else if (median < 1 / 58 && this.renderScale < 1 && this.raiseLockout === 0) {
      next = Math.min(1, this.renderScale * 1.08);
    }
    if (next !== this.renderScale) {
      this.renderScale = next;
      this.pixelRatio = this.maxPixelRatio * next;
      this.resize(this.size.width, this.size.height);
    }
  }

  render(output: THREE.WebGLRenderTarget | null = null): void {
    for (const fn of this.beforeRender) fn(0, this.time);
    this.shadows.render(this.renderer, this.scene);
    this.renderer.setRenderTarget(this.post.target);
    this.renderer.render(this.scene, this.camera);
    this.post.render(this.renderer, this.time, output);
  }

  /** Render the current frame and read it back as a PNG blob. */
  async capturePNG(scale = 1): Promise<Blob> {
    const canvas = this.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const prevRatio = this.pixelRatio;
    if (scale !== 1) {
      this.pixelRatio = prevRatio * scale;
      this.resize(w, h);
    }
    this.render();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (scale !== 1) {
      this.pixelRatio = prevRatio;
      this.resize(w, h);
      this.render();
    }
    if (!blob) throw new Error('The browser could not encode the image.');
    return blob;
  }

  dispose(): void {
    this.stop();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.shadows.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}
