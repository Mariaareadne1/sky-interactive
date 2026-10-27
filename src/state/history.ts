import type { SkyDoc } from './document';

/** Undo/redo over immutable document snapshots. */

export interface History {
  readonly past: readonly SkyDoc[];
  readonly present: SkyDoc;
  readonly future: readonly SkyDoc[];
}

const LIMIT = 100;

export const createHistory = (doc: SkyDoc): History => ({ past: [], present: doc, future: [] });

export function commit(h: History, doc: SkyDoc): History {
  if (doc === h.present) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: doc, future: [] };
}

/** Replace the present without an undo step (e.g. where a jump landed). */
export function amend(h: History, doc: SkyDoc): History {
  return { ...h, present: doc };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;
