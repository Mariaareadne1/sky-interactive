/**
 * Records what the visitor sees: the WebGL canvas with the pen line (an SVG
 * overlay) composited on top, but none of the interface chrome. The container
 * is negotiated — MP4/H.264 where the browser can encode it, else WebM.
 */

const CANDIDATES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickRecordingType(isSupported: (t: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)): string | null {
  return CANDIDATES.find((t) => isSupported(t)) ?? null;
}

export interface Recording {
  blob: Blob;
  type: string;
  extension: 'mp4' | 'webm';
  durationMs: number;
}

export interface RecordOptions {
  seconds: number;
  fps?: number;
  /** SVG holding the ink paths to draw over the scene. */
  ink?: SVGSVGElement | null;
  /** Resolves early when it settles (for scripted demos). */
  until?: Promise<unknown>;
}

function drawInk(ctx: CanvasRenderingContext2D, ink: SVGSVGElement, scale: number, origin: DOMRect): void {
  const box = ink.getBoundingClientRect();
  for (const path of ink.querySelectorAll('path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const style = getComputedStyle(path);
    const opacity = Number(style.opacity);
    if (opacity <= 0.01) continue;
    const p = new Path2D(d);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.setTransform(scale, 0, 0, scale, (box.left - origin.left) * scale, (box.top - origin.top) * scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // a traced line is rubbed out behind its plane: honour the dash that hides the flown part
    const dash = style.strokeDasharray && style.strokeDasharray !== 'none' ? style.strokeDasharray.split(/[ ,]+/).map(parseFloat).filter(Number.isFinite) : [];
    ctx.setLineDash(dash);
    ctx.lineDashOffset = parseFloat(style.strokeDashoffset) || 0;
    ctx.lineWidth = (parseFloat(style.strokeWidth) || 2.2) + 1.6;
    ctx.strokeStyle = 'rgba(30, 40, 30, 0.25)';
    ctx.stroke(p);
    ctx.lineWidth -= 1.6;
    ctx.strokeStyle = style.stroke;
    ctx.stroke(p);
    ctx.restore();
  }
}

export async function recordCanvas(canvas: HTMLCanvasElement, options: RecordOptions): Promise<Recording> {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video.');
  const type = pickRecordingType();
  if (!type) throw new Error('No supported video format for recording.');
  const fps = options.fps ?? 60;

  // composite into a 2D canvas each frame, just after the scene has drawn
  const out = document.createElement('canvas');
  out.width = canvas.width - (canvas.width % 2);
  out.height = canvas.height - (canvas.height % 2);
  const ctx = out.getContext('2d');
  if (!ctx || typeof out.captureStream !== 'function') throw new Error('This browser cannot record the canvas.');
  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    if (options.ink) drawInk(ctx, options.ink, out.width / canvas.clientWidth, canvas.getBoundingClientRect());
  };
  // queue behind the engine's own frame callback so the drawing buffer is fresh
  requestAnimationFrame(() => (raf = requestAnimationFrame(frame)));

  const stream = out.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 18_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('Recording failed.'));
  });
  const started = performance.now();
  recorder.start(250);
  await Promise.race([new Promise((r) => setTimeout(r, options.seconds * 1000)), options.until ?? new Promise(() => {})]);
  recorder.stop();
  await stopped;
  cancelAnimationFrame(raf);
  stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: type.split(';')[0] });
  if (blob.size === 0) throw new Error('The recording came out empty.');
  return { blob, type, extension: type.startsWith('video/mp4') ? 'mp4' : 'webm', durationMs: performance.now() - started };
}
