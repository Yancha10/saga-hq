import type { Platform } from '../data/schema';
import type { Gap } from '../rules/cadence';
import type { Reason } from '../rules/priority';
import type { AttentionItem, Fact, Suggestion } from '../rules/today';
import type { SyncCode } from '../sync/runner';
import { fmt, getLocale, t } from './index';
import { MISSING_LABEL_KEYS } from './keys';

/** Render language-neutral codes produced by rules / sync / errors into the current UI language. */
export const platformName = (p: Platform | string): string => t(`platform.${p}`);
export const missingName = (k: string): string =>
  t(MISSING_LABEL_KEYS[k as keyof typeof MISSING_LABEL_KEYS] ?? `missing.${k}`);
export const missingList = (keys: string[]): string =>
  new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(keys.map(missingName));

export function reasonText(r: Reason): string {
  switch (r.code) {
    case 'publishes_at':
      return t('reason.publishes_at', { time: r.at ? fmt.time(r.at) : '' });
    case 'only_missing':
      return t('reason.only_missing', { item: missingName(r.items?.[0] ?? '') });
    case 'missing_list':
      return t('reason.missing_list', { items: missingList(r.items ?? []) });
    default:
      return t(`reason.${r.code}`);
  }
}

export function attentionText(a: AttentionItem): { label: string; detail: string } {
  switch (a.kind) {
    case 'blocked':
      return {
        label: t('attention.blocked'),
        detail: a.blockers?.length ? a.blockers.join(' · ') : t('attention.blocked_flagged'),
      };
    case 'late':
      return {
        label: t('attention.late'),
        detail: t('attention.late_detail', {
          when: a.at ? fmt.dayTime(a.at) : '',
          platform: a.platform ? platformName(a.platform) : '',
        }),
      };
    case 'missing':
      return {
        label: t('attention.missing'),
        detail: t('attention.missing_detail', { items: missingList(a.missing ?? []) }),
      };
    case 'overdue':
      return {
        label: t('attention.overdue'),
        detail: t('attention.overdue_detail', {
          date: a.at ? fmt.date(a.at, { day: 'numeric', month: 'short' }) : '',
        }),
      };
    case 'decision':
      return { label: t('attention.decision'), detail: t('attention.decision_detail') };
  }
}

export function gapText(g: Gap): string {
  if (g.day)
    return t('gap.day', { day: fmt.date(g.day, { weekday: 'short' }), platform: platformName(g.platform) });
  return t('gap.week', {
    platform: platformName(g.platform),
    planned: g.planned,
    target: g.target,
    count: g.remainingDays,
  });
}

export function suggestionText(sg: Suggestion): string {
  const p = sg.params;
  switch (sg.kind) {
    case 'ready_unscheduled':
      return t('suggest.ready_unscheduled', { count: Number(p.count) });
    case 'project_no_content':
      return t('suggest.project_no_content', { name: String(p.name), count: Number(p.count) });
    case 'outlier':
      return t(Number(p.up) ? 'suggest.outlier_up' : 'suggest.outlier_down', {
        title: String(p.title) || t('common.untitled'),
        ratio: fmt.ratio(Number(p.ratio)),
        checkpoint: String(p.checkpoint),
        n: Number(p.n),
      });
    case 'inbox_waiting':
      return t('suggest.inbox_waiting', { count: Number(p.count) });
  }
}

export const factText = (f: Fact): string => t(`fact.${f.key}`, { count: f.count });

export function historyLabel(label: string, params?: Record<string, string | number>): string {
  const p: Record<string, string | number> = { ...(params ?? {}) };
  if (typeof p.entity === 'string') p.entity = t(`entity.${p.entity}`);
  if (typeof p.status === 'string') p.status = t(`content.status.${p.status}`);
  if (typeof p.target === 'string') p.target = t(`triage.${p.target}`);
  if (typeof p.type === 'string') p.type = t(`ai.action.${p.type}`);
  return label.startsWith('h.') ? t(label, p) : label;
}

export const syncCodeText = (c: SyncCode | undefined): string => (c ? t(`sync.code.${c}`) : '');

/** Localized message for an error that carries a stable code. */
export function errorText(e: unknown): string {
  const err = e as { name?: string; code?: string; kind?: string; message?: string };
  if (err?.name === 'AuthError' && err.code) return t(`auth.error.${err.code}`);
  if (err?.name === 'ProviderError' && err.kind) return t(`ai.error.${err.kind}`);
  if (err?.name === 'MediaTooLargeError') return t('error.media_too_large');
  if (err?.name === 'DriveError' && err.kind) return t(`drive.error.${err.kind}`);
  return t('error.generic');
}
