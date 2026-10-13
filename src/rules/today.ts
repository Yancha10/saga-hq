import type {
  Capture,
  Content,
  HQEvent,
  Idea,
  Project,
  Publication,
  Snapshot,
  Task,
  Workspace,
} from '../data/schema';
import { findOutliers, type Outlier } from './analytics';
import { cadenceGaps, type Gap } from './cadence';
import { type Candidate, scoreCandidates } from './priority';
import { DAY, endOfDay, HOUR, startOfDay } from './time';

export interface TodayData {
  now: number;
  workspace: Workspace | undefined;
  tasks: Task[];
  content: Content[];
  projects: Project[];
  publications: Publication[];
  snapshots: Snapshot[];
  events: HQEvent[];
  captures: Capture[];
  ideas: Idea[];
}

export interface ScheduleItem {
  kind: 'publication' | 'event' | 'task';
  id: string;
  at: string | null; // null = all day
  title: string; // user content
  platform?: Publication['platform'];
  eventKind?: HQEvent['kind'];
  deadline?: boolean;
  contentId?: string;
  done?: boolean;
}

/** Language-neutral attention item; the UI renders `attention.<kind>` with these fields. */
export interface AttentionItem {
  kind: 'blocked' | 'overdue' | 'late' | 'missing' | 'decision';
  id: string;
  entity: 'content' | 'task';
  title: string; // user content
  blockers?: string[]; // user content (task titles)
  at?: string;
  platform?: Publication['platform'];
  missing?: string[]; // readiness keys
}

export interface ResultsDue {
  publicationId: string;
  contentId: string;
  title: string;
  platform: Publication['platform'];
  checkpoint: '24h' | '7d';
  publishedAt: string;
}

export interface Suggestion {
  id: string;
  kind: 'ready_unscheduled' | 'project_no_content' | 'outlier' | 'inbox_waiting';
  target?: { entity: 'content' | 'project' | 'idea' | 'publication'; id: string };
  params: Record<string, string | number>;
}

export type FactKey =
  | 'pub_today'
  | 'blocked'
  | 'overdue'
  | 'late'
  | 'ready'
  | 'results'
  | 'gaps'
  | 'inbox'
  | 'decisions';
export interface Fact {
  key: FactKey;
  count: number;
}

export interface TodayModel {
  focus: { pinned: Candidate[]; suggested: Candidate[] };
  schedule: ScheduleItem[];
  attention: AttentionItem[];
  quickWins: Candidate[];
  resultsDue: ResultsDue[];
  gaps: Gap[];
  inboxCount: number;
  inboxOldDays: number;
  suggestions: Suggestion[];
  outliers: Outlier[];
  facts: Fact[];
  readyCount: number;
  nextPublication: ScheduleItem | null;
}

const live = <T extends { deletedAt?: string | null; archivedAt?: string | null }>(xs: T[]) =>
  xs.filter((x) => !x.deletedAt && !x.archivedAt);

export function buildToday(d: TodayData): TodayModel {
  const now = d.now;
  const sod = startOfDay(now).getTime();
  const eod = endOfDay(now).getTime();
  const tasks = live(d.tasks);
  const content = live(d.content);
  const contentById = new Map(content.map((c) => [c.id, c]));
  const pubs = d.publications.filter((p) => !p.deletedAt && contentById.has(p.contentId));
  const candidates = scoreCandidates({ now, tasks, content, projects: d.projects });

  // Focus: user-pinned first, never auto-pinned; up to 3 suggestions shown separately.
  const pinnedRefs = d.workspace?.focus ?? [];
  const byKey = new Map(candidates.map((c) => [`${c.ref.entity}:${c.ref.id}`, c]));
  const pinned: Candidate[] = [];
  for (const r of pinnedRefs) {
    const cand = byKey.get(`${r.entity}:${r.id}`);
    if (cand) pinned.push(cand);
    else {
      const t = r.entity === 'task' ? tasks.find((x) => x.id === r.id) : undefined;
      const c = r.entity === 'content' ? contentById.get(r.id) : undefined;
      if (t && t.status !== 'done')
        pinned.push({ ref: r, title: t.title, score: 0, reasons: [], blocked: false });
      if (c && c.status !== 'published' && c.status !== 'reviewed')
        pinned.push({ ref: r, title: c.title, score: 0, reasons: [], blocked: !!c._blocked });
    }
  }
  const pinnedKeys = new Set(pinned.map((p) => `${p.ref.entity}:${p.ref.id}`));
  const suggested = candidates
    .filter((c) => !c.blocked && !pinnedKeys.has(`${c.ref.entity}:${c.ref.id}`))
    .slice(0, Math.max(0, 3 - pinned.length));

  // Schedule today
  const schedule: ScheduleItem[] = [];
  for (const p of pubs) {
    const at = p.publishedAt ?? p.scheduledAt;
    if (!at) continue;
    const t = Date.parse(at);
    if (t >= sod && t <= eod)
      schedule.push({
        kind: 'publication',
        id: p.id,
        at,
        title: contentById.get(p.contentId)?.title ?? '',
        platform: p.platform,
        contentId: p.contentId,
        done: p.status === 'published',
      });
  }
  for (const e of live(d.events)) {
    const t = Date.parse(e.startAt);
    const endT = e.endAt ? Date.parse(e.endAt) : t;
    if (endT >= sod && t <= eod)
      schedule.push({
        kind: 'event',
        id: e.id,
        at: e.allDay ? null : e.startAt,
        title: e.title,
        eventKind: e.kind,
      });
  }
  for (const t of tasks) {
    if (!t.dueAt || t.status === 'done') continue;
    const due = Date.parse(t.dueAt);
    if (due >= sod && due <= eod)
      schedule.push({
        kind: 'task',
        id: t.id,
        at: null,
        title: t.title,
        deadline: !!t.hardDeadline,
      });
  }
  schedule.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  const upcomingPubs = pubs
    .filter(
      (p) =>
        p.status !== 'published' &&
        p.status !== 'cancelled' &&
        p.scheduledAt &&
        Date.parse(p.scheduledAt) >= now - HOUR,
    )
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  const np = upcomingPubs[0];
  const nextPublication: ScheduleItem | null = np
    ? {
        kind: 'publication',
        id: np.id,
        at: np.scheduledAt!,
        title: contentById.get(np.contentId)?.title ?? '',
        platform: np.platform,
        contentId: np.contentId,
      }
    : null;

  // Needs attention
  const attention: AttentionItem[] = [];
  for (const c of content) {
    if (c._blocked) {
      const reasons = tasks
        .filter((t) => t.contentId === c.id && t.isBlocker && t.status !== 'done')
        .map((t) => t.title);
      attention.push({ kind: 'blocked', id: c.id, entity: 'content', title: c.title, blockers: reasons });
    }
  }
  for (const p of pubs) {
    if (p.status === 'published' || p.status === 'cancelled' || !p.scheduledAt) continue;
    const t = Date.parse(p.scheduledAt);
    const c = contentById.get(p.contentId);
    if (!c) continue;
    if (t < now - HOUR)
      attention.push({
        kind: 'late',
        id: c.id,
        entity: 'content',
        title: c.title,
        at: p.scheduledAt,
        platform: p.platform,
      });
    else if (t - now < 2 * DAY) {
      const missing = (c._missing ?? []).filter((m) => m !== 'publishDate');
      if (missing.length)
        attention.push({
          kind: 'missing',
          id: c.id,
          entity: 'content',
          title: c.title,
          missing,
          at: p.scheduledAt,
        });
    }
  }
  for (const t of tasks) {
    if (t.status === 'done') continue;
    if (t.dueAt && Date.parse(t.dueAt) < sod)
      attention.push({ kind: 'overdue', id: t.id, entity: 'task', title: t.title, at: t.dueAt });
    else if (t.kind === 'decision' && !t.isBlocker)
      attention.push({ kind: 'decision', id: t.id, entity: 'task', title: t.title });
  }
  const uniqAttention = attention.filter(
    (a, i) => attention.findIndex((b) => b.id === a.id && b.kind === a.kind) === i,
  );

  // Quick wins: one step from ready, or short tasks
  const quickWins = candidates
    .filter((c) => !c.blocked && c.reasons.some((r) => r.code === 'only_missing' || r.code === 'quick'))
    .slice(0, 3);

  // Results to log
  const resultsDue: ResultsDue[] = [];
  const snapsByPub = new Map<string, Set<string>>();
  for (const s of d.snapshots) {
    if (s.deletedAt || !s.checkpoint) continue;
    if (!snapsByPub.has(s.publicationId)) snapsByPub.set(s.publicationId, new Set());
    snapsByPub.get(s.publicationId)!.add(s.checkpoint);
  }
  for (const p of pubs) {
    if (p.status !== 'published' || !p.publishedAt) continue;
    const age = (now - Date.parse(p.publishedAt)) / HOUR;
    const have = snapsByPub.get(p.id) ?? new Set();
    const title = contentById.get(p.contentId)?.title ?? '';
    if (age >= 168 && age < 168 * 3 && !have.has('7d'))
      resultsDue.push({
        publicationId: p.id,
        contentId: p.contentId,
        title,
        platform: p.platform,
        checkpoint: '7d',
        publishedAt: p.publishedAt,
      });
    else if (age >= 24 && age < 168 && !have.has('24h'))
      resultsDue.push({
        publicationId: p.id,
        contentId: p.contentId,
        title,
        platform: p.platform,
        checkpoint: '24h',
        publishedAt: p.publishedAt,
      });
  }

  const gaps = cadenceGaps(d.workspace, pubs, now);
  const inbox = d.captures.filter((c) => !c.deletedAt && c.status === 'inbox');
  const oldest = inbox.reduce((m, c) => Math.min(m, Date.parse(c.createdAt)), now);

  // Deterministic suggestions (codes + params; rendered by i18n)
  const suggestions: Suggestion[] = [];
  const readyUnscheduled = content.filter((c) => c.status === 'ready' && !c._nextPublishAt);
  if (readyUnscheduled.length)
    suggestions.push({
      id: 'ready',
      kind: 'ready_unscheduled',
      target: { entity: 'content', id: readyUnscheduled[0]!.id },
      params: { count: readyUnscheduled.length },
    });
  for (const p of live(d.projects)) {
    if (p.status !== 'active') continue;
    const ideas = d.ideas.filter(
      (i) => !i.deletedAt && i.projectId === p.id && i.status !== 'committed',
    ).length;
    const active = content.filter(
      (c) => c.projectId === p.id && c.status !== 'published' && c.status !== 'reviewed',
    ).length;
    if (ideas >= 3 && active === 0)
      suggestions.push({
        id: `proj-${p.id}`,
        kind: 'project_no_content',
        target: { entity: 'project', id: p.id },
        params: { name: p.name, count: ideas },
      });
  }
  const outliers = findOutliers(pubs, d.snapshots, contentById);
  for (const o of outliers.slice(0, 2)) {
    const c = contentById.get(o.contentId);
    suggestions.push({
      id: `out-${o.publicationId}`,
      kind: 'outlier',
      target: { entity: 'content', id: o.contentId },
      params: {
        title: c?.title ?? '',
        ratio: o.ratio,
        checkpoint: o.checkpoint,
        n: o.n,
        up: o.ratio >= 1 ? 1 : 0,
      },
    });
  }
  const inboxOldDays = inbox.length ? Math.floor((now - oldest) / DAY) : 0;
  if (inboxOldDays >= 3)
    suggestions.push({ id: 'inbox', kind: 'inbox_waiting', params: { count: inboxOldDays } });

  const readyCount = content.filter((c) => c.status === 'ready').length;
  const facts: Fact[] = [];
  const add = (key: FactKey, count: number) => count > 0 && facts.push({ key, count });
  add('pub_today', schedule.filter((s) => s.kind === 'publication' && !s.done).length);
  add('blocked', uniqAttention.filter((a) => a.kind === 'blocked').length);
  add('overdue', uniqAttention.filter((a) => a.kind === 'overdue').length);
  add('late', uniqAttention.filter((a) => a.kind === 'late').length);
  add('ready', readyCount);
  add('results', resultsDue.length);
  add('gaps', gaps.length);
  add('inbox', inbox.length);
  add('decisions', uniqAttention.filter((a) => a.kind === 'decision').length);

  return {
    focus: { pinned, suggested },
    schedule,
    attention: uniqAttention.slice(0, 50),
    quickWins,
    resultsDue,
    gaps,
    inboxCount: inbox.length,
    inboxOldDays,
    suggestions,
    outliers,
    facts,
    readyCount,
    nextPublication,
  };
}
