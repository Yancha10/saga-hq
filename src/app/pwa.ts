import { logger } from '../diagnostics/logger';
import { createStore, dirtyEdits } from './status';

/**
 * Safe PWA updates: a new service worker WAITS. The user is told an update is ready and applies it
 * with one tap; it is never applied while edits are unsaved. Unapplied updates take effect on the
 * next cold start (all tabs closed), never mid-work.
 */
export const updateReady = createStore(false);
let apply: ((reload?: boolean) => Promise<void>) | null = null;

export async function initPwa(): Promise<void> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    apply = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateReady.set(true);
      },
      onRegisterError(e: unknown) {
        logger.warn('pwa', 'service worker registration failed', e);
      },
    });
  } catch (e) {
    logger.warn('pwa', 'pwa init failed', e);
  }
}

export function canApplyUpdate(): boolean {
  return dirtyEdits.get() === 0 && !document.querySelector('[role="dialog"]');
}

export async function applyUpdate(): Promise<boolean> {
  (document.activeElement as HTMLElement | null)?.blur?.(); // flush focused autosave fields
  await new Promise((r) => setTimeout(r, 900));
  if (!canApplyUpdate() || !apply) return false;
  await apply(true);
  return true;
}

export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
