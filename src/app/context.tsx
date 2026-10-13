import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { AccountEntry } from '../account/registry';
import type { SearchClient } from '../search/client';
import type { SyncRunner } from '../sync/runner';
import type { Session } from './session';
import type { Store } from './status';

export interface AppCtx {
  session: Session;
  search: SearchClient;
  runner: SyncRunner | null;
  account: AccountEntry | null;
  startSync: () => Promise<void>;
  openCapture: (preset?: { text?: string; mode?: 'text' | 'task' | 'link' }) => void;
  openPalette: () => void;
  toggleSecretary: (opts?: {
    focus?: { entity: 'content' | 'idea' | 'project'; id: string };
    intent?: string;
    question?: string;
  }) => void;
  secretaryOpen: boolean;
}

const Ctx = createContext<AppCtx | null>(null);
export function AppProvider({ value, children }: { value: AppCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('No app context');
  return v;
}
export function useSession(): Session {
  return useApp().session;
}

/** Reactive Dexie query bound to the current session's database. */
export function useLive<T>(fn: (s: Session) => Promise<T> | T, deps: unknown[], fallback: T): T {
  const s = useSession();
  const v = useLiveQuery(() => (s.isLive() ? fn(s) : fallback), [s.generation, ...deps]);
  return v === undefined ? fallback : v;
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}
export const useIsPhone = () => useMedia('(max-width: 639px)');

export function useOnline(): boolean {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => {
      window.removeEventListener('online', a);
      window.removeEventListener('offline', b);
    };
  }, []);
  return on;
}
