import { getMeta, setMeta } from '../data/db';
import { dayOf, dueReminders, GIVEN, loadBigEvents, slidePlan } from '../data/plan';
import { logger } from '../diagnostics/logger';
import { t } from '../i18n';
import { syncStatus } from '../sync/runner';
import type { Session } from './session';

const EVERY_MS = 30 * 60_000;

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/** Shows a system notification (through the service worker when there is one, as iOS requires). */
async function notify(title: string, body: string, tag: string): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (reg) await reg.showNotification(title, { body, tag, icon: 'icon-192.png', badge: 'icon-192.png' });
  else new Notification(title, { body, tag });
}

/** Sends the two-week and one-week reminders that are due and not given yet (once per device). */
export async function remindBigEvents(s: Session, now = Date.now()): Promise<number> {
  const given = new Set((await getMeta<string[]>(s.db, GIVEN)) ?? []);
  const due = dueReminders(await loadBigEvents(s), dayOf(now), given);
  if (!due.length) return 0;
  const granted = notificationsSupported() && Notification.permission === 'granted';
  for (const r of due) {
    if (granted)
      await notify(
        r.ev.title,
        r.days === 0 ? t('plan.remind_today') : t('plan.remind_in', { count: r.days }),
        r.ev.key,
      ).catch((e) => logger.warn('plan', 'notification failed', e));
    for (const k of r.mark) given.add(k);
  }
  // Without permission the reminders still show on Today; only mark them once really notified.
  if (granted) await setMeta(s.db, GIVEN, [...given].slice(-500));
  return due.length;
}

/** Keeps the plan up to date while the app is open: slides late work and gives reminders. */
export function startPlanKeeper(s: Session): () => void {
  let busy = false;
  // A synced workspace slides only after this device has pulled the latest changes, so stale data
  // (say, a task already done on the other device) never moves the plan.
  let synced = s.ref.kind !== 'account';
  let prev = syncStatus.get().phase;
  const unsub = syncStatus.subscribe(() => {
    const phase = syncStatus.get().phase;
    if (prev === 'syncing' && phase === 'idle' && !synced) {
      synced = true;
      void run();
    }
    prev = phase;
  });
  const run = async () => {
    if (busy || document.hidden) return;
    busy = true;
    try {
      if (synced) await slidePlan(s);
      await remindBigEvents(s);
    } catch (e) {
      logger.warn('plan', 'plan keeper failed', e);
    } finally {
      busy = false;
    }
  };
  const onVis = () => void run();
  const first = setTimeout(run, 1500);
  const timer = setInterval(run, EVERY_MS);
  document.addEventListener('visibilitychange', onVis);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVis);
    unsub();
  };
}
