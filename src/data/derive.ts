import { isBlank } from '../core/util';
import type { Content, FormatTemplate, Link, Publication, ReadinessKey, SheetSection, Task } from './schema';

export interface DeriveInput {
  content: Content;
  template: FormatTemplate | undefined;
  tasks: Task[];
  publications: Publication[];
  links: Link[];
}

export interface Derived {
  _readyPct: number;
  _missing: ReadinessKey[];
  _blocked: number;
  _stage: SheetSection | null;
  _nextPublishAt: string | null;
}

const live = <T extends { deletedAt?: string | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt);

export function readinessMet(key: ReadinessKey, i: DeriveInput): boolean {
  const c = i.content;
  switch (key) {
    case 'hook':
      return !isBlank(c.hook);
    case 'script':
      return !isBlank(c.script) || !isBlank(c.concept);
    case 'references':
      return live(i.links).some((l) => l.type === 'references' && l.fromId === c.id);
    case 'finalExport':
      return !isBlank(c.finalExportUrl) || !isBlank(c.finalExportMediaId);
    case 'cover':
      return !isBlank(c.coverMediaId) || !isBlank(c.coverUrl);
    case 'coverText':
      return !isBlank(c.coverText);
    case 'caption':
      return !isBlank(c.caption);
    case 'hashtags':
      return (c.hashtags?.length ?? 0) > 0;
    case 'publishDate':
      return live(i.publications).some(
        (p) => p.status === 'published' || (!!p.scheduledAt && p.status !== 'cancelled'),
      );
  }
}

export function sectionComplete(section: SheetSection, i: DeriveInput): boolean {
  const c = i.content;
  if (c.sectionDone?.[section]) return true;
  switch (section) {
    case 'concept':
      return !isBlank(c.hook) && (!isBlank(c.script) || !isBlank(c.concept));
    case 'references':
      return readinessMet('references', i);
    case 'generate': {
      const shots = (c.shots ?? []).filter((s) => !s.deleted);
      if (shots.length > 0) return shots.every((s) => s.status === 'selected' || s.status === 'final');
      return readinessMet('finalExport', i);
    }
    case 'edit':
      return readinessMet('finalExport', i);
    case 'package': {
      const keys: ReadinessKey[] = (i.template?.required ?? ['cover', 'caption']).filter((k) =>
        ['cover', 'coverText', 'caption', 'hashtags'].includes(k),
      );
      return keys.length === 0 ? !isBlank(c.caption) : keys.every((k) => readinessMet(k, i));
    }
    case 'publish':
      return readinessMet('publishDate', i);
  }
}

export function deriveContent(i: DeriveInput): Derived {
  const required = i.template?.required ?? ['hook', 'finalExport', 'caption', 'publishDate'];
  const missing = required.filter((k) => !readinessMet(k, i));
  const sections = i.template?.sections ?? [
    'concept',
    'references',
    'generate',
    'edit',
    'package',
    'publish',
  ];
  const stage = sections.find((s) => !sectionComplete(s, i)) ?? null;
  const blocked = live(i.tasks).some((t) => t.isBlocker && t.status !== 'done') ? 1 : 0;
  const upcoming = live(i.publications)
    .filter((p) => p.scheduledAt && (p.status === 'scheduled' || p.status === 'planned'))
    .map((p) => p.scheduledAt as string)
    .sort();
  return {
    _readyPct: required.length === 0 ? 1 : (required.length - missing.length) / required.length,
    _missing: missing,
    _blocked: blocked,
    _stage: stage,
    _nextPublishAt: upcoming[0] ?? null,
  };
}

// Labels for readiness keys and sections live in src/i18n (domain stays language-neutral).
