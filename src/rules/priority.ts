import type { Content, FocusRef, Project, Task } from '../data/schema';
import { DAY, HOUR, endOfDay } from './time';
import { MISSING_LABEL } from '../data/derive';

/**
 * Transparent, deterministic priority engine (no AI, no black-box numbers shown).
 * Each candidate carries human-readable reasons; the score only orders candidates.
 */
export interface Candidate {
  ref: FocusRef;
  title: string;
  score: number;
  reasons: string[];
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
  const focusProjects = new Set(i.projects.filter((p) => p.isFocus && !p.deletedAt && !p.archivedAt).map((p) => p.id));
  const eod = endOfDay(i.now).getTime();
  const out: Candidate[] = [];

  for (const c of i.content) {
    if (c.deletedAt || c.archivedAt || c.status === 'published' || c.status === 'reviewed') continue;
    const reasons: string[] = [];
    let score = 0;
    const missing = (c._missing ?? []).filter((m) => m !== 'publishDate');
    const next = c._nextPublishAt ? Date.parse(c._nextPublishAt) : null;
    if (next !== null) {
      const until = next - i.now;
      if (until < 0) {
        score += 55;
        reasons.push('publication late');
      } else if (next <= eod) {
        score += missing.length ? 50 : 35;
        reasons.push(`publishes ${new Date(next).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`);
      } else if (until < 2 * DAY) {
        score += missing.length ? 30 : 12;
        reasons.push(until < DAY ? 'publishes within 24h' : 'publishes within 48h');
      }
    }
    if (missing.length === 1) {
      score += 15;
      reasons.push(`only ${MISSING_LABEL[missing[0] as keyof typeof MISSING_LABEL]} missing`);
    } else if (missing.length > 0 && next !== null && next - i.now < 2 * DAY) {
      reasons.push(`missing ${missing.map((m) => MISSING_LABEL[m as keyof typeof MISSING_LABEL]).join(', ')}`);
    }
    if (c.status === 'ready' && next === null) {
      score += 10;
      reasons.push('ready, not scheduled');
    }
    if (c.priority) {
      score += PRIO[c.priority];
      if (c.priority === 'high') reasons.push('high priority');
    }
    if (c.projectId && focusProjects.has(c.projectId)) {
      score += 10;
      reasons.push('focus project');
    }
    const blocked = !!c._blocked;
    if (blocked) {
      score -= 30;
      reasons.push('blocked');
    }
    if (reasons.length) out.push({ ref: { entity: 'content', id: c.id }, title: c.title || 'Untitled content', score, reasons, blocked });
  }

  for (const t of i.tasks) {
    if (t.deletedAt || t.archivedAt || t.status === 'done') continue;
    const reasons: string[] = [];
    let score = 0;
    if (t.dueAt) {
      const due = Date.parse(t.dueAt);
      if (due < i.now - HOUR && due < Date.parse(new Date(i.now).toDateString())) {
        score += 45;
        reasons.push(t.hardDeadline ? 'deadline missed' : 'overdue');
      } else if (due <= eod) {
        score += t.hardDeadline ? 40 : 30;
        reasons.push(t.hardDeadline ? 'deadline today' : 'due today');
      } else if (due - i.now < 2 * DAY) {
        score += 10;
        reasons.push('due soon');
      }
    }
    if (t.kind === 'decision') {
      score += 12;
      reasons.push('needs a decision');
    }
    if (t.isBlocker) {
      score += 8;
      reasons.push('unblocks content');
    }
    if (t.priority) {
      score += PRIO[t.priority];
      if (t.priority === 'high') reasons.push('high priority');
    }
    if (t.status === 'doing') {
      score += 6;
      reasons.push('in progress');
    }
    if (t.estimateMin && t.estimateMin <= 15) reasons.push('quick');
    if (t.projectId && focusProjects.has(t.projectId)) {
      score += 10;
      reasons.push('focus project');
    }
    const ageDays = (i.now - Date.parse(t.createdAt)) / DAY;
    if (ageDays > 14) {
      score += 5;
      reasons.push('waiting 2+ weeks');
    }
    if (reasons.length) out.push({ ref: { entity: 'task', id: t.id }, title: t.title, score, reasons, blocked: false });
  }

  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
