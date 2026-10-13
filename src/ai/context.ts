import type { Session } from '../app/session';
import { MISSING_LABEL } from '../data/derive';
import type {
  Content,
  Idea,
  Learning,
  LibraryItem,
  Project,
  Publication,
  Snapshot,
  Task,
} from '../data/schema';
import { cadenceGaps } from '../rules/cadence';
import { DAY } from '../rules/time';
import { buildToday, type TodayModel } from '../rules/today';
import type { SearchClient } from '../search/client';

export type Intent = 'brief' | 'ask' | 'producer' | 'creative' | 'planner' | 'analyst' | 'librarian';

export const INTENT_LABEL: Record<Intent, string> = {
  brief: 'Daily Brief',
  ask: 'Ask workspace',
  producer: 'Producer',
  creative: 'Creative Director',
  planner: 'Planner',
  analyst: 'Analyst',
  librarian: 'Librarian',
};

export interface PackEntity {
  handle: string;
  type: string;
  id: string;
  fields: Record<string, unknown>;
}

/** Compact, inspectable context: only what this request needs, never the whole workspace. */
export interface ContextPack {
  intent: Intent;
  generatedAt: string;
  today: string;
  facts: string[];
  entities: PackEntity[];
  notes: string[];
}

export interface Focus {
  entity?: 'content' | 'idea' | 'project';
  id?: string;
}

const MAX_TEXT = 600;
const MAX_SCRIPT = 1500;
const MAX_ENTITIES = 40;

const cut = (v: unknown, n = MAX_TEXT) => (typeof v === 'string' && v.length > n ? `${v.slice(0, n)}…` : v);
const live = <T extends { deletedAt?: string | null; archivedAt?: string | null }>(xs: T[]) =>
  xs.filter((x) => !x.deletedAt && !x.archivedAt);

class PackBuilder {
  entities: PackEntity[] = [];
  private byId = new Map<string, string>();
  private counters: Record<string, number> = {};
  add(type: string, id: string, fields: Record<string, unknown>): string {
    const existing = this.byId.get(id);
    if (existing) return existing;
    if (this.entities.length >= MAX_ENTITIES) return '';
    const prefix =
      { content: 'C', task: 'T', idea: 'I', project: 'P', learning: 'L', library: 'R', publication: 'U' }[
        type
      ] ?? 'X';
    this.counters[prefix] = (this.counters[prefix] ?? 0) + 1;
    const handle = `${prefix}${this.counters[prefix]}`;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields))
      if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) clean[k] = v;
    this.entities.push({ handle, type, id, fields: clean });
    this.byId.set(id, handle);
    return handle;
  }
  handleOf(id: string | null | undefined): string | undefined {
    return id ? this.byId.get(id) : undefined;
  }
}

function contentFields(c: Content, pb: PackBuilder, full = false) {
  return {
    title: c.title,
    status: c.status,
    stage: c._stage ?? undefined,
    format: c.formatTemplateId,
    platforms: c.platforms,
    project: pb.handleOf(c.projectId),
    missing: (c._missing ?? []).map((m) => MISSING_LABEL[m as keyof typeof MISSING_LABEL]),
    blocked: c._blocked ? true : undefined,
    nextPublishAt: c._nextPublishAt ?? undefined,
    priority: c.priority ?? undefined,
    hook: cut(c.hook),
    ...(full
      ? {
          concept: cut(c.concept),
          script: cut(c.script, MAX_SCRIPT),
          caption: cut(c.caption),
          shots: (c.shots ?? [])
            .filter((s) => !s.deleted)
            .map((s) => ({ order: s.order, description: cut(s.description, 200), status: s.status })),
        }
      : {}),
  };
}
const taskFields = (t: Task, pb: PackBuilder) => ({
  title: t.title,
  status: t.status,
  kind: t.kind,
  blocker: t.isBlocker || undefined,
  dueAt: t.dueAt ?? undefined,
  priority: t.priority ?? undefined,
  estimateMin: t.estimateMin ?? undefined,
  content: pb.handleOf(t.contentId),
  project: pb.handleOf(t.projectId),
});
const learningFields = (l: Learning) => ({
  statement: l.statement,
  kind: l.kind,
  confidence: l.confidence,
  scope: l.scope,
});
const ideaFields = (i: Idea, pb: PackBuilder, full = false) => ({
  title: i.title,
  status: i.status,
  hook: cut(i.hook),
  project: pb.handleOf(i.projectId),
  format: i.format ?? undefined,
  variantOf: pb.handleOf(i.parentIdeaId),
  ...(full
    ? { raw: cut(i.raw), concept: cut(i.concept), whyItWorks: cut(i.whyItWorks), tone: i.tone, cast: i.cast }
    : {}),
});
const libFields = (r: LibraryItem) => ({
  title: r.title ?? undefined,
  role: r.role,
  kind: r.kind,
  notes: cut(r.notes, 300),
  whyRelevant: cut(r.whyRelevant, 300),
  url: r.originalUrl ?? undefined,
});

async function load(s: Session) {
  const [workspace, tasks, content, projects, publications, snapshots, events, captures, ideas, learnings] =
    await Promise.all([
      s.db.workspace.get('workspace'),
      s.db.tasks.where('status').anyOf('todo', 'doing').toArray(),
      s.db.content.where('status').anyOf('planned', 'producing', 'ready', 'scheduled', 'published').toArray(),
      s.db.projects.toArray(),
      s.db.publications.toArray(),
      s.db.snapshots.toArray(),
      s.db.events
        .where('startAt')
        .above(new Date(Date.now() - 2 * DAY).toISOString())
        .toArray(),
      s.db.captures.where('status').equals('inbox').toArray(),
      s.db.ideas.toArray(),
      s.db.learnings.where('status').equals('active').toArray(),
    ]);
  return { workspace, tasks, content, projects, publications, snapshots, events, captures, ideas, learnings };
}

export async function resolveContext(
  s: Session,
  intent: Intent,
  question: string,
  focus: Focus = {},
  search?: SearchClient,
): Promise<ContextPack> {
  const d = await load(s);
  const now = Date.now();
  const pb = new PackBuilder();
  const notes: string[] = [];
  const projects = live(d.projects) as Project[];
  for (const p of projects.filter((x) => x.status === 'active').slice(0, 8))
    pb.add('project', p.id, { name: p.name, goal: cut(p.goal, 200), focus: p.isFocus || undefined });
  const today: TodayModel = buildToday({ now, ...d, workspace: d.workspace });
  const content = live(d.content) as Content[];
  const contentById = new Map(content.map((c) => [c.id, c]));
  const tasks = live(d.tasks) as Task[];

  const addContent = (c: Content, full = false) => pb.add('content', c.id, contentFields(c, pb, full));
  const addTasksFor = (cid: string) => {
    for (const t of tasks) if (t.contentId === cid) pb.add('task', t.id, taskFields(t, pb));
  };

  if (intent === 'brief' || intent === 'producer' || intent === 'ask') {
    for (const p of today.focus.pinned) {
      if (p.ref.entity === 'content' && contentById.get(p.ref.id)) addContent(contentById.get(p.ref.id)!);
      if (p.ref.entity === 'task') {
        const t = tasks.find((x) => x.id === p.ref.id);
        if (t) pb.add('task', t.id, { ...taskFields(t, pb), pinnedFocus: true });
      }
    }
    for (const a of today.attention.slice(0, 12)) {
      if (a.entity === 'content' && contentById.get(a.id)) {
        addContent(contentById.get(a.id)!);
        addTasksFor(a.id);
      } else if (a.entity === 'task') {
        const t = tasks.find((x) => x.id === a.id);
        if (t) pb.add('task', t.id, taskFields(t, pb));
      }
    }
  }

  if (intent === 'producer') {
    if (focus.entity === 'content' && focus.id && contentById.get(focus.id)) {
      addContent(contentById.get(focus.id)!, true);
      addTasksFor(focus.id);
      notes.push(`Focused on ${pb.handleOf(focus.id)}.`);
    }
    const active = content
      .filter((c) => ['planned', 'producing', 'ready', 'scheduled'].includes(c.status))
      .sort((a, b) => (b._readyPct ?? 0) - (a._readyPct ?? 0));
    for (const c of active.slice(0, 20)) {
      addContent(c);
      addTasksFor(c.id);
    }
  }

  if (intent === 'brief') {
    for (const c of content.filter((x) => x.status === 'ready').slice(0, 8)) addContent(c);
    for (const r of today.resultsDue.slice(0, 5))
      if (contentById.get(r.contentId)) addContent(contentById.get(r.contentId)!);
  }

  if (intent === 'creative') {
    const ideas = live(d.ideas) as Idea[];
    if (focus.entity === 'idea' && focus.id) {
      const idea = ideas.find((i) => i.id === focus.id);
      if (idea) {
        pb.add('idea', idea.id, ideaFields(idea, pb, true));
        for (const v of ideas.filter((i) => i.parentIdeaId === idea.id))
          pb.add('idea', v.id, ideaFields(v, pb));
        const links = await s.db.links.where('fromId').equals(idea.id).toArray();
        const refs = (
          await s.db.library.bulkGet(links.filter((l) => !l.deletedAt).map((l) => l.toId))
        ).filter(Boolean) as LibraryItem[];
        for (const r of refs.slice(0, 6)) pb.add('library', r.id, libFields(r));
      }
    } else {
      for (const i of ideas.filter((x) => x.status === 'new' || x.status === 'shortlisted').slice(0, 15))
        pb.add('idea', i.id, ideaFields(i, pb));
    }
    const recentRes = (await s.db.library.orderBy('updatedAt').reverse().limit(30).toArray()).filter(
      (r) => !r.deletedAt && r.role === 'inspiration',
    );
    for (const r of recentRes.slice(0, 6)) pb.add('library', r.id, libFields(r));
  }

  if (intent === 'planner') {
    const horizon = now + 14 * DAY;
    for (const p of d.publications.filter(
      (x) =>
        !x.deletedAt &&
        x.scheduledAt &&
        Date.parse(x.scheduledAt) >= now - DAY &&
        Date.parse(x.scheduledAt) <= horizon,
    )) {
      const c = contentById.get(p.contentId);
      if (!c) continue;
      const ch = addContent(c);
      pb.add('publication', p.id, {
        content: ch,
        platform: p.platform,
        status: p.status,
        scheduledAt: p.scheduledAt,
      });
    }
    for (const c of content.filter((x) => x.status === 'ready' && !x._nextPublishAt)) addContent(c);
    for (const c of content.filter((x) => x.status === 'producing').slice(0, 8)) addContent(c);
    for (const i of (live(d.ideas) as Idea[]).filter((x) => x.status === 'shortlisted').slice(0, 8))
      pb.add('idea', i.id, ideaFields(i, pb));
    const ws = d.workspace;
    if (ws?.cadence?.length)
      notes.push(`Cadence targets: ${ws.cadence.map((c) => `${c.platform} ${c.perWeek}/week`).join(', ')}.`);
    for (const g of cadenceGaps(ws, d.publications, now, 14)) notes.push(`Gap: ${g.message}`);
  }

  if (intent === 'analyst') {
    const pubs = (d.publications as Publication[])
      .filter((p) => p.status === 'published' && !p.deletedAt)
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    const snaps = (d.snapshots as Snapshot[]).filter((x) => !x.deletedAt);
    for (const p of pubs.slice(0, 25)) {
      const c = contentById.get(p.contentId) ?? (await s.db.content.get(p.contentId));
      if (!c) continue;
      const ch = pb.add('content', c.id, {
        title: c.title,
        format: c.formatTemplateId,
        attributes: c.attributes,
      });
      const metrics: Record<string, unknown> = {};
      for (const sn of snaps.filter((x) => x.publicationId === p.id))
        metrics[sn.checkpoint ?? `${Math.round(sn.ageHours)}h`] = sn.metrics;
      pb.add('publication', p.id, { content: ch, platform: p.platform, publishedAt: p.publishedAt, metrics });
    }
    for (const o of today.outliers.slice(0, 5))
      notes.push(
        `Rule-detected outlier: ${pb.handleOf(o.contentId) ?? 'a post'} at ${o.ratio.toFixed(2)}× its ${o.checkpoint} median (n=${o.n}).`,
      );
    notes.push('Metrics are platform-specific; do not sum or compare across platforms as if equivalent.');
  }

  if ((intent === 'librarian' || intent === 'ask') && search && question.trim()) {
    const hits = await search.search(question, 15);
    for (const h of hits) {
      const rec = (await s.db.table(h.type).get(h.id)) as Record<string, unknown> | undefined;
      if (!rec) continue;
      if (h.type === 'content') addContent(rec as Content);
      else if (h.type === 'ideas') pb.add('idea', h.id, ideaFields(rec as Idea, pb));
      else if (h.type === 'tasks') pb.add('task', h.id, taskFields(rec as Task, pb));
      else if (h.type === 'library') pb.add('library', h.id, libFields(rec as LibraryItem));
      else if (h.type === 'learnings') pb.add('learning', h.id, learningFields(rec as Learning));
      else if (h.type === 'projects')
        pb.add('project', h.id, { name: (rec as Project).name, goal: cut((rec as Project).goal, 200) });
    }
    if (!hits.length) notes.push('Keyword search found no matching records.');
  }

  if (intent !== 'librarian') {
    for (const l of (live(d.learnings) as Learning[]).slice(0, 8))
      pb.add('learning', l.id, learningFields(l));
  }

  return {
    intent,
    generatedAt: new Date(now).toISOString(),
    today: new Date(now).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    facts: today.facts,
    entities: pb.entities,
    notes,
  };
}

export function summarizePack(p: ContextPack): string {
  const counts: Record<string, number> = {};
  for (const e of p.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const parts = Object.entries(counts).map(
    ([t, n]) => `${n} ${t}${n > 1 ? (t.endsWith('y') ? '' : 's') : ''}`,
  );
  return parts.length ? parts.join(', ') : 'workspace facts only';
}
