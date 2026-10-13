import type { Publication, Workspace } from '../data/schema';
import { PLATFORM_LABEL } from '../data/schema';
import { addDays, startOfDay, startOfWeek, DAY } from './time';

export interface Gap {
  platform: Publication['platform'];
  day?: string; // ISO date of a preferred day with nothing planned
  weekStart: string;
  planned: number;
  target: number;
  message: string;
}

/** Compare planned publications for this and next week against the optional cadence targets. */
export function cadenceGaps(ws: Workspace | undefined, pubs: Publication[], now = Date.now(), horizonDays = 7): Gap[] {
  if (!ws?.cadence?.length) return [];
  const out: Gap[] = [];
  const today = startOfDay(now).getTime();
  const end = today + horizonDays * DAY;
  for (const c of ws.cadence) {
    if (!c.perWeek) continue;
    const mine = pubs.filter((p) => !p.deletedAt && p.platform === c.platform && p.status !== 'cancelled' && (p.scheduledAt || p.publishedAt));
    const at = (p: Publication) => Date.parse((p.publishedAt ?? p.scheduledAt)!);
    const weekStart = startOfWeek(now).getTime();
    const thisWeek = mine.filter((p) => at(p) >= weekStart && at(p) < weekStart + 7 * DAY).length;
    if (thisWeek < c.perWeek) {
      const remainingDays = Math.max(1, Math.round((weekStart + 7 * DAY - today) / DAY));
      out.push({
        platform: c.platform,
        weekStart: new Date(weekStart).toISOString(),
        planned: thisWeek,
        target: c.perWeek,
        message: `${PLATFORM_LABEL[c.platform]}: ${thisWeek}/${c.perWeek} planned this week (${remainingDays} day${remainingDays > 1 ? 's' : ''} left)`,
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
            message: `${date.toLocaleDateString(undefined, { weekday: 'short' })}: no ${PLATFORM_LABEL[c.platform]} planned`,
          });
      }
    }
  }
  return out;
}

export function nextSlots(_days = 7, now = Date.now()): Date[] {
  return Array.from({ length: _days }, (_, i) => addDays(startOfDay(now), i));
}
