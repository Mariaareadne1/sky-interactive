import type { SkyApp } from '../app/SkyApp';
import { DrawingOverlay } from './DrawingOverlay';
import { analyzeStroke, smooth, type Pt } from './stroke';

/**
 * One pointer state machine for mouse, pen and touch:
 *   press on a plane   → select it; move past a few pixels → drag it (if it's resting)
 *   press anywhere else → draw a flight
 * A second finger, pointercancel or Escape abandons a stroke cleanly.
 */

type Gesture =
  | { kind: 'none' }
  | { kind: 'press'; id: string; x: number; y: number; pointerId: number }
  | { kind: 'drag'; pointerId: number }
  | { kind: 'stroke'; points: Pt[]; pointerId: number };

const DRAG_THRESHOLD = 4;

export class PointerInput {
  private gesture: Gesture = { kind: 'none' };
  private readonly overlay: DrawingOverlay;
  private readonly activePointers = new Set<number>();
  private hoverRaf = 0;
  private lastHover: { x: number; y: number } | null = null;
  /** Feedback hook (toasts) for rejected strokes. */
  onMessage: ((text: string) => void) | null = null;

  constructor(private readonly el: HTMLElement, private readonly app: SkyApp) {
    this.overlay = new DrawingOverlay(el);
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('lostpointercapture', this.lost);
    el.addEventListener('contextmenu', this.noMenu);
  }

  get isDrawing(): boolean {
    return this.gesture.kind === 'stroke';
  }

  get ink(): SVGSVGElement {
    return this.overlay.svg;
  }

  /** Only the canvas itself is drawable; the interface floats above it. */
  private onCanvas(e: Event): boolean {
    return (e.target as Element | null)?.tagName === 'CANVAS';
  }

  private down = (e: PointerEvent) => {
    if (!this.onCanvas(e)) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.activePointers.add(e.pointerId);
    if (this.activePointers.size > 1) {
      this.abort(); // pinch / two-finger: not ours
      return;
    }
    e.preventDefault();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone (or synthetic); events still arrive on the element
    }
    const armed = this.app.store.get().armed !== null;
    const sel = armed ? null : this.app.pickAt(e.clientX, e.clientY);
    if (sel) {
      this.app.select(sel);
      this.gesture = { kind: 'press', id: sel.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      this.setCursor(this.app.canDrag(sel.id) ? 'grabbing' : 'pointer');
      return;
    }
    this.gesture = { kind: 'stroke', points: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }], pointerId: e.pointerId };
    this.overlay.begin(armed);
    if (!armed) this.app.store.set({ selection: null });
  };

  private move = (e: PointerEvent) => {
    const g = this.gesture;
    if (g.kind === 'none') {
      if (!this.onCanvas(e)) return;
      this.lastHover = { x: e.clientX, y: e.clientY };
      if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(this.hover);
      return;
    }
    if ('pointerId' in g && g.pointerId !== e.pointerId) return;
    if (g.kind === 'press') {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > DRAG_THRESHOLD && this.app.beginDrag(g.id, g.x, g.y)) {
        this.gesture = { kind: 'drag', pointerId: g.pointerId };
        this.app.dragTo(e.clientX, e.clientY);
      }
      return;
    }
    if (g.kind === 'drag') {
      const ok = this.app.dragTo(e.clientX, e.clientY);
      this.setCursor(ok ? 'grabbing' : 'not-allowed');
      return;
    }
    if (g.kind === 'stroke') {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const c of events.length ? events : [e]) g.points.push({ x: c.clientX, y: c.clientY, t: c.timeStamp || e.timeStamp });
      this.overlay.update(smooth(g.points, 1));
    }
  };

  private up = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    const g = this.gesture;
    if (g.kind === 'none' || ('pointerId' in g && g.pointerId !== e.pointerId)) return;
    this.gesture = { kind: 'none' };
    if (g.kind === 'drag') this.app.endDrag();
    else if (g.kind === 'stroke') this.finishStroke(g.points);
    this.updateHover(e.clientX, e.clientY);
  };

  private finishStroke(points: Pt[]): void {
    const a = analyzeStroke(points);
    if (a.length < 6) {
      // a tap on the town: just clears the selection
      this.overlay.settle(null);
      if (this.app.store.get().armed) this.app.store.set({ armed: null });
      return;
    }
    if (!a.valid) {
      this.overlay.settle(null);
      this.onMessage?.('Draw a longer line — a swoop, a loop, a zigzag…');
      return;
    }
    const result = this.app.createFromStroke(points);
    if (!result.ok) {
      this.overlay.settle(null);
      this.onMessage?.(result.message);
      return;
    }
    const el = this.overlay.settle(result.id);
    if (el) this.app.attachInk(result.id, el, result.u);
  }

  private cancel = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    this.abort();
  };

  private lost = (e: PointerEvent) => {
    // capture lost without pointerup (e.g. window blur): treat as cancel
    if ('pointerId' in this.gesture && this.gesture.pointerId === e.pointerId && !this.activePointers.has(e.pointerId)) this.abort();
  };

  /** Abandon whatever is in progress without creating or committing anything. */
  abort(): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    if (g.kind === 'stroke') this.overlay.settle(null);
    if (g.kind === 'drag') this.app.endDrag(true);
  }

  private noMenu = (e: Event) => e.preventDefault();

  private hover = () => {
    this.hoverRaf = 0;
    if (this.lastHover) this.updateHover(this.lastHover.x, this.lastHover.y);
  };

  private updateHover(x: number, y: number): void {
    const armed = this.app.store.get().armed !== null;
    const sel = armed ? null : this.app.pickAt(x, y);
    this.app.hoverId = sel?.id ?? null;
    if (sel) this.setCursor(this.app.canDrag(sel.id) ? 'grab' : 'pointer');
    else this.setCursor(this.app.canDrawAt(x, y) ? 'draw' : 'nope');
  }

  private setCursor(c: 'grab' | 'grabbing' | 'draw' | 'not-allowed' | 'nope' | 'pointer'): void {
    this.el.dataset.cursor = c;
  }

  dispose(): void {
    cancelAnimationFrame(this.hoverRaf);
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.cancel);
    this.el.removeEventListener('lostpointercapture', this.lost);
    this.el.removeEventListener('contextmenu', this.noMenu);
    this.overlay.dispose();
  }
}
