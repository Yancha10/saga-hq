import type { Publication, Workspace } from '../data/schema';
import { addDays, DAY, startOfDay, startOfWeek } from './time';

/** Language-neutral gap description; rendered by i18n. */
export interface Gap {
  platform: Publication['platform'];
  day?: string; // ISO date of a preferred day with nothing planned
  weekStart: string;
  planned: number;
  target: number;
  remainingDays: number;
}

/** Compare planned publications against the optional cadence targets (never schedules anything). */
export function cadenceGaps(
  ws: Workspace | undefined,
  pubs: Publication[],
  now = Date.now(),
  horizonDays = 7,
): Gap[] {
  if (!ws?.cadence?.length) return [];
  const out: Gap[] = [];
  const today = startOfDay(now).getTime();
  const end = today + horizonDays * DAY;
  for (const c of ws.cadence) {
    if (!c.perWeek) continue;
    const mine = pubs.filter(
      (p) =>
        !p.deletedAt &&
        p.platform === c.platform &&
        p.status !== 'cancelled' &&
        (p.scheduledAt || p.publishedAt),
    );
    const at = (p: Publication) => Date.parse((p.publishedAt ?? p.scheduledAt)!);
    const weekStart = startOfWeek(now).getTime();
    const thisWeek = mine.filter((p) => at(p) >= weekStart && at(p) < weekStart + 7 * DAY).length;
    const remainingDays = Math.max(1, Math.round((weekStart + 7 * DAY - today) / DAY));
    if (thisWeek < c.perWeek) {
      out.push({
        platform: c.platform,
        weekStart: new Date(weekStart).toISOString(),
        planned: thisWeek,
        target: c.perWeek,
        remainingDays,
      });
    }
    for (const dow of c.preferredDays ?? []) {
      for (let d = today; d < end; d += DAY) {
        const date = new Date(d);
        if (date.getDay() !== dow) continue;
        const has = mine.some((p) => startOfDay(at(p)).getTime() === d);
        if (!has)
          out.push({
            platform: c.platform,
            day: date.toISOString(),
            weekStart: startOfWeek(d).toISOString(),
            planned: 0,
            target: c.perWeek,
            remainingDays,
          });
      }
    }
  }
  return out;
}

export function nextSlots(days = 7, now = Date.now()): Date[] {
  return Array.from({ length: days }, (_, i) => addDays(startOfDay(now), i));
}
