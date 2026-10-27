import { useSyncExternalStore } from 'react';
import { amend, commit, createHistory, redo, undo, type History } from './history';
import type { SkyDoc } from './document';

/** Minimal external store: React reads it through useSyncExternalStore. */

/** What is selected: a plane, by id. */
export type Selection = { kind: 'plane'; id: string } | null;

export interface AppState {
  readonly history: History;
  readonly selection: Selection;
  readonly hasDrawn: boolean;
  readonly uiHidden: boolean;
  readonly toast: { id: number; text: string } | null;
  readonly loading: boolean;
  readonly recording: boolean;
  readonly fatal: string | null;
  /** "Draw its next flight": the next stroke becomes this plane's path. */
  readonly armed: string | null;
}

type Listener = () => void;

export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  private toastId = 0;

  constructor(doc: SkyDoc) {
    this.state = {
      history: createHistory(doc),
      selection: null,
      hasDrawn: false,
      uiHidden: false,
      toast: null,
      loading: true,
      recording: false,
      fatal: null,
      armed: null,
    };
  }

  get = (): AppState => this.state;

  get doc(): SkyDoc {
    return this.state.history.present;
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  commit(doc: SkyDoc, patch: Partial<AppState> = {}): void {
    this.set({ ...patch, history: commit(this.state.history, doc) });
  }

  amend(doc: SkyDoc): void {
    this.set({ history: amend(this.state.history, doc) });
  }

  undo(): void {
    this.set({ history: undo(this.state.history) });
    this.dropMissingSelection();
  }

  redo(): void {
    this.set({ history: redo(this.state.history) });
    this.dropMissingSelection();
  }

  toast(text: string): void {
    this.set({ toast: { id: ++this.toastId, text } });
  }

  private dropMissingSelection(): void {
    const s = this.state.selection;
    if (s && !this.doc.planes.some((p) => p.id === s.id)) this.set({ selection: null });
    const armed = this.state.armed;
    if (armed && !this.doc.planes.some((p) => p.id === armed)) this.set({ armed: null });
  }
}

export function useAppState<T>(store: Store, select: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
