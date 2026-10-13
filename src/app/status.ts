/** Tiny observable stores for app-wide state (save status, sync status, toasts, update prompt). */
export interface Store<T> {
  get(): T;
  set(v: T | ((p: T) => T)): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      value = typeof v === 'function' ? (v as (p: T) => T)(value) : v;
      for (const s of subs) s();
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export type SaveState = { state: 'idle' | 'saving' | 'saved' | 'error'; error?: string; at?: number };
export const saveStatus = createStore<SaveState>({ state: 'idle' });

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
  timeoutMs?: number;
}
export const toasts = createStore<Toast[]>([]);
let toastId = 0;
export function toast(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}): void {
  const t: Toast = { id: ++toastId, message, kind: opts.kind ?? 'info', ...opts };
  toasts.set((p) => [...p.slice(-3), t]);
  const ms = t.timeoutMs ?? (t.action ? 8000 : 4000);
  setTimeout(() => toasts.set((p) => p.filter((x) => x.id !== t.id)), ms);
}
export function dismissToast(id: number): void {
  toasts.set((p) => p.filter((x) => x.id !== id));
}

/** Persistent (non-disappearing) problems: storage failures, sync blocked, degraded state. */
export interface Banner {
  id: string;
  kind: 'warning' | 'error' | 'info';
  message: string;
  action?: { label: string; run: () => void };
}
export const banners = createStore<Banner[]>([]);
export function setBanner(b: Banner): void {
  banners.set((p) => [...p.filter((x) => x.id !== b.id), b]);
}
export function clearBanner(id: string): void {
  banners.set((p) => p.filter((x) => x.id !== id));
}

/** Count of in-progress edits; the PWA updater never reloads while this is > 0. */
export const dirtyEdits = createStore<number>(0);
export function markDirty(delta: 1 | -1): void {
  dirtyEdits.set((n) => Math.max(0, n + delta));
}
