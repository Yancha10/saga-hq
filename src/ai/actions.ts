import { z } from 'zod';
import type { Session } from '../app/session';
import { ulid } from '../core/ulid';
import { nowIso } from '../core/util';
import { CONTENT_STATUSES } from '../data/schema';
import { mutate } from '../data/store';
import { fmt, t as tr } from '../i18n';
import type { ContextPack } from './context';

/**
 * Secretary action model (ADR-08). The model can only PROPOSE structured actions; applying them
 * goes through the same command layer as the UI (validated, undoable, provenance-stamped).
 * READ/SUGGEST need no confirmation; low-risk writes need one tap (+ undo); high-risk writes show a
 * diff and need explicit confirmation; destructive actions are not available to AI at all.
 */
const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'invalid date');
export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('createTask'),
    title: z.string().min(1).max(300),
    content: z.string().optional(),
    project: z.string().optional(),
    dueAt: iso.optional(),
    isBlocker: z.boolean().optional(),
    rationale: z.string().optional(),
  }),
  z.object({
    type: z.literal('createIdea'),
    title: z.string().min(1).max(300),
    hook: z.string().max(1000).optional(),
    project: z.string().optional(),
    rationale: z.string().optional(),
  }),
  z.object({
    type: z.literal('createContent'),
    title: z.string().min(1).max(300),
    idea: z.string().optional(),
    project: z.string().optional(),
    format: z.string().optional(),
    rationale: z.string().optional(),
  }),
  z.object({
    type: z.literal('changeStatus'),
    target: z.string(),
    status: z.string(),
    rationale: z.string().optional(),
  }),
  z.object({
    type: z.literal('scheduleEvent'),
    title: z.string().min(1).max(300),
    startAt: iso,
    content: z.string().optional(),
    kind: z.enum(['production_block', 'milestone', 'deadline']).optional(),
    rationale: z.string().optional(),
  }),
  z.object({
    type: z.literal('linkReference'),
    from: z.string(),
    to: z.string(),
    rationale: z.string().optional(),
  }),
  z.object({
    type: z.literal('saveLearning'),
    statement: z.string().min(1).max(1000),
    kind: z.enum(['observation', 'hypothesis']),
    evidence: z.array(z.string()).optional(),
    rationale: z.string().optional(),
  }),
]);
export type ProposedAction = z.infer<typeof actionSchema>;
export type Risk = 'low' | 'high';

export interface ResolvedAction {
  id: string;
  action: ProposedAction;
  risk: Risk;
  summary: string;
  diff?: string;
  invalid?: string;
}

function resolver(pack: ContextPack) {
  const map = new Map(pack.entities.map((e) => [e.handle, e]));
  return (h: string | undefined, type?: string) => {
    if (!h) return undefined;
    const e = map.get(h.replace(/[[\]]/g, ''));
    if (!e || (type && e.type !== type)) return null;
    return e;
  };
}

export function parseActions(json: string | null, pack: ContextPack): ResolvedAction[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const r = resolver(pack);
  const out: ResolvedAction[] = [];
  for (const item of raw.slice(0, 10)) {
    const p = actionSchema.safeParse(item);
    if (!p.success) continue;
    const a = p.data;
    const ra: ResolvedAction = { id: ulid(), action: a, risk: 'low', summary: '' };
    switch (a.type) {
      case 'createTask':
        ra.summary = [
          tr('ai.sum.createTask', { title: a.title }),
          a.content,
          a.dueAt ? tr('ai.sum.due', { when: fmt.dateTime(a.dueAt) }) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        if (a.content && !r(a.content, 'content')) ra.invalid = tr('ai.invalid.content', { h: a.content });
        if (a.project && !r(a.project, 'project')) ra.invalid = tr('ai.invalid.project', { h: a.project });
        break;
      case 'createIdea':
        ra.summary = tr('ai.sum.createIdea', { title: a.title });
        if (a.project && !r(a.project, 'project')) ra.invalid = tr('ai.invalid.project', { h: a.project });
        break;
      case 'createContent':
        ra.summary = tr('ai.sum.createContent', { title: a.title });
        if (a.idea && !r(a.idea, 'idea')) ra.invalid = tr('ai.invalid.idea', { h: a.idea });
        break;
      case 'changeStatus': {
        ra.risk = 'high';
        const t = r(a.target);
        if (!t || !['content', 'task', 'idea'].includes(t.type))
          ra.invalid = tr('ai.invalid.target', { h: a.target });
        else {
          const allowed =
            t.type === 'content'
              ? (CONTENT_STATUSES as readonly string[])
              : t.type === 'task'
                ? ['todo', 'doing', 'done']
                : ['new', 'shortlisted', 'parked'];
          if (!allowed.includes(a.status)) ra.invalid = tr('ai.invalid.status', { s: a.status });
          ra.summary = tr('ai.sum.changeStatus', { h: a.target });
          ra.diff = `${String(t.fields.title ?? t.handle)}: ${String(t.fields.status ?? '?')} → ${a.status}`; // status codes are language-neutral
        }
        break;
      }
      case 'scheduleEvent':
        ra.risk = 'high';
        ra.summary = tr('ai.sum.scheduleEvent', { title: a.title });
        ra.diff = tr('ai.diff.event', {
          kind: tr(`event.kind.${a.kind ?? 'production_block'}`),
          when: fmt.dateTime(a.startAt),
        });
        if (a.content && !r(a.content, 'content')) ra.invalid = tr('ai.invalid.content', { h: a.content });
        break;
      case 'linkReference': {
        const f = r(a.from);
        const t = r(a.to, 'library');
        if (!f || !t) ra.invalid = tr('ai.invalid.link');
        ra.summary = tr('ai.sum.linkReference', { to: a.to, from: a.from });
        break;
      }
      case 'saveLearning':
        ra.risk = 'high';
        ra.summary = tr('ai.sum.saveLearning', {
          kind: tr(`learning.kind.${a.kind}`),
          statement: a.statement,
        });
        ra.diff = tr('ai.diff.learning', {
          kind: tr(`learning.kind.${a.kind}`),
          evidence: a.evidence?.join(', ') ?? '—',
        });
        break;
    }
    out.push(ra);
  }
  return out;
}

export async function applyAction(s: Session, ra: ResolvedAction, pack: ContextPack): Promise<void> {
  if (ra.invalid) throw new Error(ra.invalid);
  const r = resolver(pack);
  const a = ra.action;
  const origin = { source: 'ai' as const, aiActionId: ra.id, confirmedAt: nowIso() };
  const id = (h?: string) => (h ? (r(h)?.id ?? null) : null);
  await mutate(
    s,
    { label: 'h.ai', labelParams: { type: ra.action.type }, actor: 'ai' },
    async (m) => {
      switch (a.type) {
        case 'createTask':
          await m.create('tasks', {
            title: a.title,
            status: 'todo',
            kind: 'task',
            isBlocker: !!a.isBlocker,
            contentId: id(a.content),
            projectId: id(a.project),
            dueAt: a.dueAt ?? null,
          });
          break;
        case 'createIdea':
          await m.create('ideas', {
            title: a.title,
            hook: a.hook ?? null,
            projectId: id(a.project),
            status: 'new',
          });
          break;
        case 'createContent':
          await m.create('content', {
            title: a.title,
            ideaId: id(a.idea),
            projectId: id(a.project),
            status: 'planned',
            formatTemplateId: a.format ?? 'reel',
            platforms: [],
          });
          break;
        case 'changeStatus': {
          const t = r(a.target)!;
          const table = t.type === 'content' ? 'content' : t.type === 'task' ? 'tasks' : 'ideas';
          await m.update(table, t.id, {
            status: a.status,
            ...(table === 'tasks' && a.status === 'done' ? { doneAt: nowIso() } : {}),
          } as never);
          break;
        }
        case 'scheduleEvent':
          await m.create('events', {
            title: a.title,
            kind: a.kind ?? 'production_block',
            startAt: a.startAt,
            allDay: false,
            contentId: id(a.content),
          });
          break;
        case 'linkReference': {
          const f = r(a.from)!;
          await m.create('links', {
            fromType: f.type,
            fromId: f.id,
            toType: 'library',
            toId: r(a.to)!.id,
            type: 'references',
          });
          break;
        }
        case 'saveLearning': {
          const l = await m.create('learnings', {
            statement: a.statement,
            kind: a.kind,
            confidence: 'low',
            status: 'active',
          });
          for (const h of a.evidence ?? []) {
            const e = r(h);
            if (e && (e.type === 'content' || e.type === 'publication'))
              await m.create('links', {
                fromType: 'learning',
                fromId: l.id,
                toType: e.type,
                toId: e.id,
                type: 'evidence',
              });
          }
          break;
        }
      }
    },
    origin,
  );
}
