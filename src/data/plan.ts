import type { Session } from '../app/session';
import { nowIso } from '../core/util';
import { getMeta, setMeta } from './db';
import type { Content, HQEvent, Project, Publication, RadarItem, Task, Workspace } from './schema';
import { type Mutator, mutate, undoEntry } from './store';

/**
 * The plan keeper: pausing (all or one project), sliding overdue work forward with everything after
 * it, and reminders before big events. Pure planning functions are separate from the writes so they
 * can be tested without a database.
 */

// ---------- Calendar days (local time, DST-safe) ----------

/** Local calendar day as an integer (days since 1970-01-01 in local time). */
export function dayOf(t: string | number | Date): number {
  const d = new Date(t);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
/** Day of a plain YYYY-MM-DD string, read as a local date. */
export function dayOfDate(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / 86400000);
}
/** Moves an instant by whole local days, keeping its time of day. */
export function shiftIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// ---------- What the plan is made of ----------

export type PlanTable = 'tasks' | 'publications' | 'events';
export interface PlanItem {
  table: PlanTable;
  id: string;
  at: string;
  endAt?: string;
  /** Root project (series and seasons slide together), or null for loose items. */
  group: string | null;
  /** Not done yet: being late on it is what makes the plan slide. */
  pending: boolean;
  title: string;
}
export interface Move {
  table: PlanTable;
  id: string;
  patch: Record<string, string>;
}

export function rootOf(projects: Map<string, Project>, id: string | null | undefined): string | null {
  let cur = id ? projects.get(id) : undefined;
  for (let i = 0; cur?.parentId && i < 10; i++) {
    const up = projects.get(cur.parentId);
    if (!up) break;
    cur = up;
  }
  return cur?.id ?? null;
}

/**
 * Movable items only: unfinished tasks without a fixed date, planned (not yet scheduled on a
 * platform) publications, and production blocks/milestones. Deadlines, external events, radar dates,
 * published or platform-scheduled pieces never move.
 */
export function planItems(d: {
  projects: Project[];
  tasks: Task[];
  publications: Publication[];
  content: Content[];
  events: HQEvent[];
}): PlanItem[] {
  const projects = new Map(d.projects.filter((p) => !p.deletedAt).map((p) => [p.id, p]));
  const content = new Map(d.content.map((c) => [c.id, c]));
  const out: PlanItem[] = [];
  for (const x of d.tasks) {
    if (x.deletedAt || !x.dueAt || x.status === 'done' || x.hardDeadline) continue;
    const pid = x.projectId ?? (x.contentId ? content.get(x.contentId)?.projectId : undefined);
    out.push({
      table: 'tasks',
      id: x.id,
      at: x.dueAt,
      group: rootOf(projects, pid),
      pending: true,
      title: x.title,
    });
  }
  for (const p of d.publications) {
    const c = content.get(p.contentId);
    if (p.deletedAt || p.status !== 'planned' || !p.scheduledAt || !c || c.deletedAt || c.archivedAt)
      continue;
    if (c.status === 'published' || c.status === 'reviewed') continue;
    out.push({
      table: 'publications',
      id: p.id,
      at: p.scheduledAt,
      group: rootOf(projects, c.projectId),
      pending: true,
      title: c.title,
    });
  }
  for (const e of d.events) {
    if (e.deletedAt || (e.kind !== 'production_block' && e.kind !== 'milestone')) continue;
    out.push({
      table: 'events',
      id: e.id,
      at: e.startAt,
      ...(e.endAt ? { endAt: e.endAt } : {}),
      group: rootOf(projects, e.projectId),
      pending: false,
      title: e.title,
    });
  }
  return out;
}

function moveOf(it: PlanItem, days: number): Move {
  const field = it.table === 'tasks' ? 'dueAt' : it.table === 'publications' ? 'scheduledAt' : 'startAt';
  const patch: Record<string, string> = { [field]: shiftIso(it.at, days) };
  if (it.endAt) patch.endAt = shiftIso(it.endAt, days);
  return { table: it.table, id: it.id, patch };
}

export interface SlideGroup {
  group: string | null;
  days: number;
  count: number;
}
export interface Slide {
  moves: Move[];
  groups: SlideGroup[];
}

/**
 * Overdue work slides to today and everything after it in the same project moves by the same number
 * of days, so the spacing of the plan is kept. Loose items (no project) only move themselves.
 * `skipGroups` holds paused projects.
 */
export function computeSlide(items: PlanItem[], today: number, skipGroups: Set<string> = new Set()): Slide {
  const byGroup = new Map<string | null, PlanItem[]>();
  for (const it of items) {
    if (it.group && skipGroups.has(it.group)) continue;
    const list = byGroup.get(it.group) ?? [];
    list.push(it);
    byGroup.set(it.group, list);
  }
  const moves: Move[] = [];
  const groups: SlideGroup[] = [];
  for (const [group, list] of byGroup) {
    const overdue = list.filter((it) => it.pending && dayOf(it.at) < today);
    if (!overdue.length) continue;
    if (group === null) {
      for (const it of overdue) moves.push(moveOf(it, today - dayOf(it.at)));
      groups.push({
        group,
        days: Math.max(...overdue.map((it) => today - dayOf(it.at))),
        count: overdue.length,
      });
      continue;
    }
    const oldest = Math.min(...overdue.map((it) => dayOf(it.at)));
    const days = today - oldest;
    const moving = list.filter((it) => dayOf(it.at) >= oldest);
    for (const it of moving) moves.push(moveOf(it, days));
    groups.push({ group, days, count: moving.length });
  }
  return { moves, groups };
}

/** Everything dated from the pause day on moves forward by the days the plan was on hold. */
export function computeResume(
  items: PlanItem[],
  pausedDay: number,
  today: number,
  scope: { group?: string; skipGroups?: Set<string> } = {},
): Move[] {
  const days = today - pausedDay;
  if (days <= 0) return [];
  return items
    .filter((it) => (scope.group ? it.group === scope.group : !(it.group && scope.skipGroups?.has(it.group))))
    .filter((it) => dayOf(it.at) >= pausedDay)
    .map((it) => moveOf(it, days));
}

// ---------- Reading and writing ----------

async function loadPlan(s: Session) {
  const [workspace, projects, tasks, publications, content, events] = await Promise.all([
    s.db.workspace.get('workspace'),
    s.db.projects.toArray(),
    s.db.tasks.toArray(),
    s.db.publications.toArray(),
    s.db.content.toArray(),
    s.db.events.toArray(),
  ]);
  return { workspace, projects, items: planItems({ projects, tasks, publications, content, events }) };
}

const pausedGroups = (projects: Project[]) =>
  new Set(projects.filter((p) => !p.deletedAt && p.status === 'paused' && !p.parentId).map((p) => p.id));

async function applyMoves(m: Mutator, moves: Move[]) {
  for (const mv of moves) await m.update(mv.table, mv.id, mv.patch as never);
}

/** Puts the whole plan (or one project) on hold. */
export async function pausePlan(s: Session, projectId?: string): Promise<void> {
  const now = nowIso();
  if (projectId)
    await mutate(s, { label: 'h.planPause' }, (m) =>
      m.update('projects', projectId, { status: 'paused', pausedAt: now }),
    );
  else
    await mutate(s, { label: 'h.planPause' }, (m) =>
      m.update('workspace', 'workspace', { planPausedAt: now }),
    );
}

/** Days a resume would move things by (0 when resumed the same day). */
export function pausedDays(pausedAt: string | null | undefined, now = Date.now()): number {
  return pausedAt ? Math.max(0, dayOf(now) - dayOf(pausedAt)) : 0;
}

/** Resumes the plan (or one project) and moves its pending dates forward by the days paused. */
export async function resumePlan(s: Session, projectId?: string, now = Date.now()): Promise<number> {
  const { workspace, projects, items } = await loadPlan(s);
  const today = dayOf(now);
  if (projectId) {
    const p = projects.find((x) => x.id === projectId);
    const group = rootOf(new Map(projects.map((x) => [x.id, x])), projectId) ?? projectId;
    const moves = p?.pausedAt ? computeResume(items, dayOf(p.pausedAt), today, { group }) : [];
    await mutate(s, { label: 'h.planResume', labelParams: { count: moves.length } }, async (m) => {
      await applyMoves(m, moves);
      await m.update('projects', projectId, { status: 'active', pausedAt: null } as never);
    });
    return moves.length;
  }
  const since = workspace?.planPausedAt;
  // Projects paused on their own keep their own pause and move when they are resumed.
  const moves = since
    ? computeResume(items, dayOf(since), today, { skipGroups: pausedGroups(projects) })
    : [];
  await mutate(s, { label: 'h.planResume', labelParams: { count: moves.length } }, async (m) => {
    await applyMoves(m, moves);
    await m.update('workspace', 'workspace', { planPausedAt: null } as never);
  });
  return moves.length;
}

export interface AutoSlideNote {
  entryId: string;
  at: string;
  count: number;
  days: number;
  dismissed?: boolean;
}
export const AUTO_NOTE = 'plan.autoSlide';
const SKIP_DAY = 'plan.skipDay';

export const autoRescheduleOn = (ws: Workspace | undefined) => ws?.autoReschedule !== false;

/**
 * Slides overdue work forward. Runs when the app opens and every so often; does nothing while the plan
 * is paused, when turned off, or on a day the user undid it. Idempotent: once moved, nothing is late.
 */
export async function slidePlan(s: Session, now = Date.now(), force = false): Promise<Slide> {
  const { workspace, projects, items } = await loadPlan(s);
  const empty: Slide = { moves: [], groups: [] };
  if (!workspace || workspace.planPausedAt) return empty;
  if (!force && !autoRescheduleOn(workspace)) return empty;
  const today = dayOf(now);
  if (!force && (await getMeta<number>(s.db, SKIP_DAY)) === today) return empty;
  const slide = computeSlide(items, today, pausedGroups(projects));
  if (!slide.moves.length) return slide;
  const days = Math.max(...slide.groups.map((g) => g.days));
  await mutate(s, { label: 'h.planSlide', labelParams: { count: slide.moves.length, days } }, (m) =>
    applyMoves(m, slide.moves),
  );
  const entry = await s.db.history.orderBy('at').last();
  if (entry)
    await setMeta(s.db, AUTO_NOTE, {
      entryId: entry.id,
      at: new Date(now).toISOString(),
      count: slide.moves.length,
      days,
    } satisfies AutoSlideNote);
  return slide;
}

/** Puts the dates back and leaves them alone for the rest of the day. */
export async function undoSlide(s: Session, now = Date.now()): Promise<void> {
  const note = await getMeta<AutoSlideNote>(s.db, AUTO_NOTE);
  const entry = note ? await s.db.history.get(note.entryId) : undefined;
  if (entry && !entry.undone) await undoEntry(s, entry);
  await setMeta(s.db, SKIP_DAY, dayOf(now));
  if (note) await setMeta(s.db, AUTO_NOTE, { ...note, dismissed: true });
}

// ---------- Big events and reminders ----------

export const REMIND_DAYS = [14, 7] as const;

export interface BigEvent {
  key: string;
  title: string;
  day: number;
  kind: 'event' | 'radar' | 'deadline';
  /** Hash route to open it. */
  to: string;
}

/** Milestones, deadlines and external events, radar dates (not discarded) and fixed-date tasks. */
export function bigEvents(d: { events: HQEvent[]; radar: RadarItem[]; tasks: Task[] }): BigEvent[] {
  const out: BigEvent[] = [];
  for (const e of d.events)
    if (!e.deletedAt && e.kind !== 'production_block')
      out.push({ key: `ev-${e.id}`, title: e.title, day: dayOf(e.startAt), kind: 'event', to: '/calendar' });
  for (const r of d.radar)
    if (
      !r.deletedAt &&
      !r.archivedAt &&
      r.verification !== 'discarded' &&
      r.startDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.startDate)
    )
      out.push({
        key: `rd-${r.id}`,
        title: r.title,
        day: dayOfDate(r.startDate),
        kind: 'radar',
        to: '/radar',
      });
  for (const x of d.tasks)
    if (!x.deletedAt && x.hardDeadline && x.dueAt && x.status !== 'done')
      out.push({ key: `tk-${x.id}`, title: x.title, day: dayOf(x.dueAt), kind: 'deadline', to: '/tasks' });
  return out.sort((a, b) => a.day - b.day);
}

export async function loadBigEvents(s: Session): Promise<BigEvent[]> {
  const [events, radar, tasks] = await Promise.all([
    s.db.events.toArray(),
    s.db.radar.toArray(),
    s.db.tasks.toArray(),
  ]);
  return bigEvents({ events, radar, tasks });
}

/**
 * Which reminders are due now: the 14-day one once inside two weeks, the 7-day one inside a week.
 * A reminder already given (same event, same date) is not repeated; a moved event reminds again.
 */
export function dueReminders(
  events: BigEvent[],
  today: number,
  given: Set<string>,
): { ev: BigEvent; days: number; mark: string[] }[] {
  const out: { ev: BigEvent; days: number; mark: string[] }[] = [];
  for (const ev of events) {
    const left = ev.day - today;
    if (left < 0 || left > REMIND_DAYS[0]) continue;
    const th = left <= REMIND_DAYS[1] ? REMIND_DAYS[1] : REMIND_DAYS[0];
    const key = (n: number) => `${ev.key}@${ev.day}@${n}`;
    if (given.has(key(th))) continue;
    // Inside a week, the two-week reminder is implied: one notification, not two.
    out.push({ ev, days: left, mark: th === REMIND_DAYS[1] ? [key(7), key(14)] : [key(14)] });
  }
  return out;
}

export const GIVEN = 'plan.reminded';

/** Local Date for a day number (midnight). */
export function dateOfDay(day: number): Date {
  const u = new Date(day * 86400000);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
}
