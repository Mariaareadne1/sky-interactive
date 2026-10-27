import type { Pt } from './stroke';

/**
 * The pen line, drawn in an SVG over the canvas: thin, cream, with a soft
 * halo. An accepted line is handed to its plane, which rubs it out behind
 * itself as it flies, like a pencil line being followed and erased; a
 * rejected one shivers away.
 */

const NS = 'http://www.w3.org/2000/svg';

export function pathData(pts: readonly Pt[]): string {
  if (pts.length === 0) return '';
  if (pts.length < 3) return `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')}`;
  // quadratic curves through midpoints: smooth without overshoot
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
}

export class DrawingOverlay {
  readonly svg: SVGSVGElement;
  private live: SVGPathElement | null = null;

  constructor(parent: HTMLElement) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.classList.add('ink');
    this.svg.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.svg);
  }

  /** Start a line; `armed` lines (a plane's next flight) are tinted. */
  begin(armed = false): void {
    this.settle(null);
    this.live = document.createElementNS(NS, 'path');
    this.live.classList.add('ink-line');
    if (armed) this.live.classList.add('armed');
    this.svg.append(this.live);
  }

  update(pts: readonly Pt[]): void {
    this.live?.setAttribute('d', pathData(pts));
  }

  /**
   * Finish the line. Accepted (a plane id): it stays as a ghost for the
   * plane to trace, and is returned. Rejected (null): it shivers away.
   */
  settle(acceptedBy: string | null): SVGPathElement | null {
    const line = this.live;
    this.live = null;
    if (!line) return null;
    if (acceptedBy) {
      line.classList.add('ink-trace');
      line.dataset.plane = acceptedBy;
      // in case its plane never takes it (e.g. undone at once)
      window.setTimeout(() => line.isConnected && !line.style.strokeDashoffset && line.classList.add('ink-gone'), 4000);
      window.setTimeout(() => line.remove(), 60_000);
      return line;
    }
    line.classList.add('ink-reject');
    const done = () => line.remove();
    line.addEventListener('animationend', done, { once: true });
    window.setTimeout(done, 1500); // in case animations are disabled
    return null;
  }

  dispose(): void {
    this.svg.remove();
  }
}
