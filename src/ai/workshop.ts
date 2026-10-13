/**
 * AI Workshop (Taller): builds a self-contained brief from the piece and the chosen context, for
 * pasting into ChatGPT/Claude in their own web apps, or for the optional BYOK API. The brief never
 * contains keys or secrets, and nothing is put in a URL.
 */
import type { Session } from '../app/session';
import type { Chapter, Content, Task, Workspace } from '../data/schema';
import { getLocale, t } from '../i18n';

export const WORKSHOP_TASKS = [
  'develop_idea',
  'write_script',
  'video_prompt',
  'cover',
  'caption_stories',
  'critique',
  'plan_week',
  'continuity',
  'making_of',
  'decisions',
  'adapt_platform',
  'analyze_results',
  'resources_cost',
] as const;
export type WorkshopTask = (typeof WORKSHOP_TASKS)[number];
/** Tasks that make sense without a selected piece. */
export const PIECELESS: WorkshopTask[] = ['plan_week', 'decisions', 'analyze_results'];
/** Where an answer to each task most naturally lands. */
export const DEFAULT_TARGET: Partial<
  Record<WorkshopTask, 'hook' | 'script' | 'caption' | 'prompt' | 'cover' | 'ending'>
> = {
  develop_idea: 'hook',
  write_script: 'script',
  video_prompt: 'prompt',
  cover: 'cover',
  caption_stories: 'caption',
  making_of: 'script',
  adapt_platform: 'caption',
};

export interface BriefInput {
  task: WorkshopTask;
  piece?: Content | null;
  chapters: Chapter[];
  decisions?: Task[];
  tasks?: Task[];
  ws?: Workspace;
  weekPubs?: number;
  extra?: string;
}

const CHAPTER_BUDGET = 14000;
const field = (label: string, v: unknown) =>
  v === undefined || v === null || v === '' ? '' : `- ${label}: ${String(v).trim()}\n`;

export function buildBrief(i: BriefInput): string {
  const c = i.piece;
  const lines: string[] = [];
  lines.push(`# ${t('workshop.brief.title', { task: t(`workshop.task.${i.task}`) })}`);
  lines.push(t('workshop.brief.role'));
  lines.push(t('workshop.brief.guard'));
  lines.push('');
  if (c) {
    let p = `## ${t('workshop.brief.piece')}\n`;
    p += field(t('field.title'), c.title);
    p += field(t('workshop.brief.status'), t(`content.status.${c.status}`));
    p += field(t('saga.pillar'), c.pillar);
    p += field(t('workshop.brief.format'), c.formatTemplateId);
    p += field(t('saga.duration_target'), c.durationTargetSec ? `${c.durationTargetSec} s` : '');
    p += field(
      t('workshop.brief.planned'),
      c._nextPublishAt ? new Date(c._nextPublishAt).toLocaleString(getLocale()) : '',
    );
    p += field(t('field.hook'), c.hook);
    p += field(t('saga.objective'), c.objective);
    p += field(t('saga.cta'), c.cta);
    p += field(t('saga.dm_keyword'), c.dmKeyword);
    p += field(t('field.cover_text'), c.coverText);
    p += field(t('saga.art'), c.artDirection);
    p += field(t('saga.sound'), c.soundDirection);
    p += field(t('saga.continuity'), c.continuityNotes);
    if (c.script) p += `\n### ${t('field.script')}\n${c.script.trim()}\n`;
    const shots = (c.shots ?? []).filter((x) => !x.deleted);
    if (shots.length) {
      p += `\n### ${t('workshop.brief.shots')}\n`;
      for (const sh of shots)
        p += `${sh.order + 1}. ${sh.timeLabel ? `[${sh.timeLabel}] ` : ''}${sh.description}${sh.dialogue ? ` — «${sh.dialogue}»` : ''}\n`;
    }
    if (c.prompt) p += `\n### ${t('saga.prompt')}\n${c.prompt.trim()}\n`;
    if (c.caption) p += `\n### ${t('field.caption')}\n${c.caption.trim()}\n`;
    if (c.original?.text && i.task !== 'plan_week')
      p += `\n### ${t('saga.original')}\n${c.original.text.trim().slice(0, 4000)}\n`;
    lines.push(p);
  }
  if (i.chapters.length) {
    let budget = CHAPTER_BUDGET;
    let p = `## ${t('workshop.brief.bible')}\n`;
    for (const ch of i.chapters) {
      const body = (ch.body ?? '').trim();
      const take = body.slice(0, Math.max(800, Math.floor(budget / Math.max(1, i.chapters.length))));
      budget -= take.length;
      p += `\n### ${ch.number ? `${ch.number} · ` : ''}${ch.title}${ch.status !== 'current' ? ` (${t(`chapter.status.${ch.status}`)})` : ''}\n${take}${take.length < body.length ? '\n[…]' : ''}\n`;
    }
    lines.push(p);
  }
  if (i.decisions?.length) {
    lines.push(
      `## ${t('workshop.brief.decisions')}\n${i.decisions.map((d) => `- ${d.title}${d.notes ? `: ${d.notes}` : ''}`).join('\n')}\n`,
    );
  }
  if (i.tasks?.length) {
    lines.push(
      `## ${t('workshop.brief.tasks')}\n${i.tasks
        .slice(0, 20)
        .map((x) => `- ${x.title}${x.dueAt ? ` (${new Date(x.dueAt).toLocaleDateString(getLocale())})` : ''}`)
        .join('\n')}\n`,
    );
  }
  if (i.ws) {
    lines.push(
      `## ${t('workshop.brief.capacity')}\n${t('workshop.brief.capacity_line', {
        hours: i.ws.weeklyHours ?? 6,
        goal: i.ws.weeklyGoal ?? 3,
        pubs: i.weekPubs ?? 0,
      })}\n`,
    );
  }
  lines.push(`## ${t('workshop.brief.ask')}\n${t(`workshop.ask.${i.task}`)}`);
  if (i.extra?.trim()) lines.push(`\n${t('workshop.brief.extra')}: ${i.extra.trim()}`);
  lines.push(`\n${t('workshop.brief.format_rules')}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Chapters most related to a piece (shared words with its title, pillar and script). */
export function suggestChapters(chapters: Chapter[], piece: Content | null | undefined, n = 2): string[] {
  if (!piece) return [];
  const words = `${piece.title} ${piece.pillar ?? ''} ${piece.hook ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 5);
  const scored = chapters
    .filter((c) => !c.deletedAt && c.status !== 'historical')
    .map((c) => {
      const body = (c.body ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const score = words.filter((w) => body.includes(w)).length;
      return { id: c.id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((x) => x.id);
}

export const PROVIDER_URLS = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
} as const;

export async function weekPubCount(s: Session): Promise<number> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start.getTime() + 7 * 86400000);
  return s.db.publications
    .where('scheduledAt')
    .between(start.toISOString(), end.toISOString())
    .filter((p) => !p.deletedAt && p.status !== 'cancelled')
    .count();
}
