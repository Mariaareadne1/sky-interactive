/** Pure 2D stroke processing: smoothing, decimation and measuring a doodle. */

export interface Pt {
  x: number;
  y: number;
  /** When the pointer was here (ms); drawing speed sets flying speed. */
  t?: number;
}

export interface StrokeAnalysis {
  valid: boolean;
  reason?: 'short' | 'small';
  length: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
}

export const MIN_STROKE_LENGTH = 60;
export const MIN_STROKE_SIZE = 24;

export function strokeLength(pts: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/** Drop points closer than minDist to the last kept one (keeps the final point). */
export function decimate(pts: readonly Pt[], minDist: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) >= minDist) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Centred moving average; endpoints (and timestamps) stay put so the line does not shrink. */
export function smooth(pts: readonly Pt[], radius = 2): Pt[] {
  if (pts.length < 3) return pts.slice();
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    let sx = 0, sy = 0, n = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(pts.length - 1, i + radius); k++) {
      sx += pts[k].x;
      sy += pts[k].y;
      n++;
    }
    return { x: sx / n, y: sy / n, t: p.t };
  });
}

export function analyzeStroke(pts: readonly Pt[]): StrokeAnalysis {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const length = strokeLength(pts);
  let reason: StrokeAnalysis['reason'];
  if (length < MIN_STROKE_LENGTH) reason = 'short';
  else if (Math.max(width, height) < MIN_STROKE_SIZE) reason = 'small';
  return { valid: !reason, reason, length, bbox: { minX, minY, maxX, maxY, width, height } };
}
