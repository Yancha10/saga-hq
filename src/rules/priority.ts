import type { Content, FocusRef, Project, Task } from '../data/schema';
import { DAY, endOfDay, HOUR } from './time';

/**
 * Transparent, deterministic priority engine (no AI, no black-box numbers shown).
 * Each candidate carries human-readable reasons; the score only orders candidates.
 */
/** Language-neutral reason codes; rendered by i18n (`reason.<code>`). */
export type ReasonCode =
  | 'late'
  | 'publishes_at'
  | 'within24'
  | 'within48'
  | 'only_missing'
  | 'missing_list'
  | 'ready_unscheduled'
  | 'high_priority'
  | 'focus_project'
  | 'blocked'
  | 'overdue'
  | 'deadline_missed'
  | 'due_today'
  | 'deadline_today'
  | 'due_soon'
  | 'needs_decision'
  | 'unblocks'
  | 'in_progress'
  | 'quick'
  | 'waiting_long';
export interface Reason {
  code: ReasonCode;
  at?: string;
  items?: string[];
}
export const HOT_REASONS = new Set<ReasonCode>([
  'late',
  'overdue',
  'deadline_missed',
  'due_today',
  'deadline_today',
  'publishes_at',
  'blocked',
]);

export interface Candidate {
  ref: FocusRef;
  title: string;
  score: number;
  reasons: Reason[];
  blocked: boolean;
}

export interface PriorityInput {
  now: number;
  tasks: Task[];
  content: Content[];
  projects: Project[];
}

const PRIO = { high: 25, med: 10, low: 0 } as const;

export function scoreCandidates(i: PriorityInput): Candidate[] {
  const focusProjects = new Set(
    i.projects.filter((p) => p.isFocus && !p.deletedAt && !p.archivedAt).map((p) => p.id),
  );
  const eod = endOfDay(i.now).getTime();
  const out: Candidate[] = [];

  for (const c of i.content) {
    if (c.deletedAt || c.archivedAt || c.status === 'published' || c.status === 'reviewed') continue;
    const reasons: Reason[] = [];
    let score = 0;
    const missing = (c._missing ?? []).filter((m) => m !== 'publishDate');
    const next = c._nextPublishAt ? Date.parse(c._nextPublishAt) : null;
    if (next !== null) {
      const until = next - i.now;
      if (until < 0) {
        score += 55;
        reasons.push({ code: 'late' });
      } else if (next <= eod) {
        score += missing.length ? 50 : 35;
        reasons.push({ code: 'publishes_at', at: new Date(next).toISOString() });
      } else if (until < 2 * DAY) {
        score += missing.length ? 30 : 12;
        reasons.push({ code: until < DAY ? 'within24' : 'within48' });
      }
    }
    if (missing.length === 1) {
      score += 15;
      reasons.push({ code: 'only_missing', items: [missing[0]!] });
    } else if (missing.length > 0 && next !== null && next - i.now < 2 * DAY) {
      reasons.push({ code: 'missing_list', items: missing });
    }
    if (c.status === 'ready' && next === null) {
      score += 10;
      reasons.push({ code: 'ready_unscheduled' });
    }
    if (c.priority) {
      score += PRIO[c.priority];
      if (c.priority === 'high') reasons.push({ code: 'high_priority' });
    }
    if (c.projectId && focusProjects.has(c.projectId)) {
      score += 10;
      reasons.push({ code: 'focus_project' });
    }
    const blocked = !!c._blocked;
    if (blocked) {
      score -= 30;
      reasons.push({ code: 'blocked' });
    }
    if (reasons.length)
      out.push({
        ref: { entity: 'content', id: c.id },
        title: c.title,
        score,
        reasons,
        blocked,
      });
  }

  for (const t of i.tasks) {
    if (t.deletedAt || t.archivedAt || t.status === 'done') continue;
    const reasons: Reason[] = [];
    let score = 0;
    if (t.dueAt) {
      const due = Date.parse(t.dueAt);
      if (due < i.now - HOUR && due < Date.parse(new Date(i.now).toDateString())) {
        score += 45;
        reasons.push({ code: t.hardDeadline ? 'deadline_missed' : 'overdue' });
      } else if (due <= eod) {
        score += t.hardDeadline ? 40 : 30;
        reasons.push({ code: t.hardDeadline ? 'deadline_today' : 'due_today' });
      } else if (due - i.now < 2 * DAY) {
        score += 10;
        reasons.push({ code: 'due_soon' });
      }
    }
    if (t.kind === 'decision') {
      score += 12;
      reasons.push({ code: 'needs_decision' });
    }
    if (t.isBlocker) {
      score += 8;
      reasons.push({ code: 'unblocks' });
    }
    if (t.priority) {
      score += PRIO[t.priority];
      if (t.priority === 'high') reasons.push({ code: 'high_priority' });
    }
    if (t.status === 'doing') {
      score += 6;
      reasons.push({ code: 'in_progress' });
    }
    if (t.estimateMin && t.estimateMin <= 15) reasons.push({ code: 'quick' });
    if (t.projectId && focusProjects.has(t.projectId)) {
      score += 10;
      reasons.push({ code: 'focus_project' });
    }
    const ageDays = (i.now - Date.parse(t.createdAt)) / DAY;
    if (ageDays > 14) {
      score += 5;
      reasons.push({ code: 'waiting_long' });
    }
    if (reasons.length)
      out.push({ ref: { entity: 'task', id: t.id }, title: t.title, score, reasons, blocked: false });
  }

  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
