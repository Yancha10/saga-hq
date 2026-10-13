import { logger } from '../diagnostics/logger';
import { createStore, dirtyEdits } from './status';

/**
 * Safe PWA updates: a new service worker WAITS and is applied automatically only at safe moments —
 * right after launch, or when the app goes to the background — and never while edits are unsaved
 * or a dialog is open. The user can also apply it with one tap from the banner.
 * (Installed iPhone apps rarely cold-start, so waiting for a full restart could take days.)
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
        // Found within the first seconds of a launch: nothing is in progress yet, apply now.
        if (performance.now() < 15_000 && canApplyUpdate()) void apply?.(true);
      },
      onRegisterError(e: unknown) {
        logger.warn('pwa', 'service worker registration failed', e);
      },
    });
  } catch (e) {
    logger.warn('pwa', 'pwa init failed', e);
  }
  // Leaving the app (home screen, app switcher, another tab): apply a waiting update while hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && updateReady.get() && canApplyUpdate()) void apply?.(true);
  });
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
