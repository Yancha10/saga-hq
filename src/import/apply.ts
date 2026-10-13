/**
 * Applies a parsed Saga Lai package to the open workspace. One atomic, undoable mutation, after a
 * recovery point. Records are matched by their package identifier (`externalId`), so importing the
 * same package twice never duplicates anything; the user picks what happens to matches:
 *  - merge:   fill only what is still empty (the user's edits always win);
 *  - keep:    leave matched records untouched, add only new ones;
 *  - replace: overwrite matched records with the package values.
 * The imported original card (`original`, `originalBody`) is never replaced once stored.
 */
import type { Session } from '../app/session';
import { ulid } from '../core/ulid';
import { nowIso } from '../core/util';
import { createRecoveryPoint } from '../data/recovery';
import type {
  Chapter,
  Content,
  EntityTable,
  Idea,
  Project,
  RadarItem,
  Shot,
  Task,
  Variant,
} from '../data/schema';
import { type Mutator, mutate } from '../data/store';
import { getLocale } from '../i18n';
import type { PkgPiece, SagaPackage } from './sagaLai';

export type ImportMode = 'merge' | 'keep' | 'replace';
export const IMPORT_KINDS = ['chapters', 'pieces', 'radar', 'tasks', 'ideas', 'sessions'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export interface KindPlan {
  total: number;
  existing: number;
}
export interface ImportPlan {
  kinds: Record<ImportKind, KindPlan>;
  checklist: number;
  prefs: string[];
  pillars: string[];
  dated: number;
  span?: { from: string; to: string };
}
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  batchId: string;
}

const TABLE: Record<ImportKind, EntityTable> = {
  chapters: 'chapters',
  pieces: 'content',
  radar: 'radar',
  tasks: 'tasks',
  ideas: 'ideas',
  sessions: 'sessions',
};
const ids = (pkg: SagaPackage, k: ImportKind): string[] =>
  k === 'chapters'
    ? pkg.chapters.map((x) => x.externalId)
    : k === 'pieces'
      ? pkg.pieces.map((x) => x.externalId)
      : k === 'radar'
        ? pkg.radar.map((x) => x.externalId)
        : k === 'tasks'
          ? pkg.tasks.map((x) => x.externalId)
          : k === 'ideas'
            ? pkg.ideas.map((x) => x.externalId)
            : pkg.sessions.map((x) => x.externalId);

/** externalId → live record, per table. Deleted (trashed) records do not count as matches. */
async function existingBy<T extends { id: string; externalId?: string | null; deletedAt?: string | null }>(
  s: Session,
  table: EntityTable,
): Promise<Map<string, T>> {
  const all = (await s.db.table(table).toArray()) as T[];
  return new Map(all.filter((r) => r.externalId && !r.deletedAt).map((r) => [r.externalId!, r]));
}

export async function planImport(s: Session, pkg: SagaPackage): Promise<ImportPlan> {
  const kinds = {} as Record<ImportKind, KindPlan>;
  for (const k of IMPORT_KINDS) {
    const ex = await existingBy(s, TABLE[k]);
    const list = ids(pkg, k);
    kinds[k] = { total: list.length, existing: list.filter((x) => ex.has(x)).length };
  }
  const dates = pkg.pieces
    .map((p) => p.plannedAt)
    .filter((x): x is string => !!x)
    .sort();
  return {
    kinds,
    checklist: pkg.checklist.length,
    prefs: Object.keys(pkg.prefs),
    pillars: [...new Set(pkg.pieces.map((p) => p.pillar).filter((x): x is string => !!x))].sort(),
    dated: dates.length,
    ...(dates.length ? { span: { from: dates[0]!, to: dates[dates.length - 1]! } } : {}),
  };
}

const cut = (v: string | undefined, n: number) => (v === undefined ? undefined : v.slice(0, n));
const blank = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/** Builds the patch for a matched record according to the mode. `undefined` values are dropped. */
function patchFor<T extends Record<string, unknown>>(
  mode: ImportMode,
  cur: T | undefined,
  next: Record<string, unknown>,
  immutable: string[] = [],
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (!cur) out[k] = v;
    else if (immutable.includes(k)) {
      if (blank(cur[k])) out[k] = v;
    } else if (mode === 'replace') out[k] = v;
    else if (mode === 'merge' && blank(cur[k])) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function shotsOf(p: PkgPiece, rev: string): Shot[] {
  return p.shots.map((sh, i) => ({
    id: ulid(),
    order: i,
    title: cut(sh.title, 200),
    description: cut(sh.description, 10000) ?? '',
    ...(sh.durationSec !== undefined ? { durationSec: sh.durationSec } : {}),
    ...(sh.dialogue ? { dialogue: cut(sh.dialogue, 10000) } : {}),
    ...(sh.timeLabel ? { timeLabel: cut(sh.timeLabel, 60) } : {}),
    referenceIds: [],
    status: sh.status,
    rev,
  }));
}

function variantsOf(p: PkgPiece, at: string): Variant[] {
  const label = cut(p.provenance, 120);
  const fields: [Variant['field'], string | undefined][] = [
    ['hook', p.hook],
    ['script', p.script],
    ['caption', p.caption],
    ['prompt', p.prompt],
  ];
  return fields
    .filter(([, v]) => !!v)
    .map(([field, text]) => ({
      id: ulid(),
      field,
      text: text!,
      by: 'import',
      ...(label ? { label } : {}),
      at,
    }));
}

export async function applyImport(
  s: Session,
  pkg: SagaPackage,
  opts: { mode: ImportMode; seriesPillars?: string[]; sourceLabel?: string },
): Promise<ImportResult> {
  const { mode } = opts;
  const batchId = ulid();
  const total = IMPORT_KINDS.reduce((n, k) => n + ids(pkg, k).length, 0);
  await createRecoveryPoint(s, 'import_package', { count: total });
  const res: ImportResult = { created: 0, updated: 0, skipped: 0, batchId };
  const at = nowIso();
  const ws = await s.db.workspace.get('workspace');
  const templates = new Set(ws?.formatTemplates.map((t) => t.id) ?? []);

  const ex = {
    content: await existingBy<Content>(s, 'content'),
    chapters: await existingBy<Chapter>(s, 'chapters'),
    radar: await existingBy<RadarItem>(s, 'radar'),
    tasks: await existingBy<Task>(s, 'tasks'),
    ideas: await existingBy<Idea>(s, 'ideas'),
    sessions: await existingBy<Record<string, unknown> & { id: string }>(s, 'sessions'),
    projects: await existingBy<Project>(s, 'projects'),
  };

  await mutate(
    s,
    { label: 'h.importPackage', labelParams: { count: total }, actor: 'user' },
    async (m) => {
      const upsert = async (
        table: EntityTable,
        cur: { id: string } | undefined,
        data: Record<string, unknown>,
        immutable?: string[],
      ): Promise<string | undefined> => {
        if (cur && mode === 'keep') {
          res.skipped++;
          return cur.id;
        }
        const patch = patchFor(mode, cur as Record<string, unknown> | undefined, data, immutable);
        if (!cur) {
          const rec = await (m as Mutator).create(table, (patch ?? {}) as never);
          res.created++;
          return rec.id;
        }
        if (patch) {
          await m.update(table, cur.id, patch as never);
          res.updated++;
        } else res.skipped++;
        return cur.id;
      };

      // Projects: one season holding the calendar, plus a series per pillar the user chose.
      const dates = pkg.pieces
        .map((p) => p.plannedAt)
        .filter((x): x is string => !!x)
        .sort();
      let seasonId: string | undefined;
      if (pkg.pieces.length) {
        const brand = pkg.brand?.trim() || 'Saga';
        const span = dates.length ? `${monthLabel(dates[0]!)} – ${monthLabel(dates[dates.length - 1]!)}` : '';
        const cur = ex.projects.get('pkg:season');
        seasonId = await upsert('projects', cur, {
          name: cut(span ? `${brand} · ${span}` : brand, 200),
          status: 'active',
          kind: 'season',
          isFocus: false,
          color: 3,
          platforms: ['instagram'],
          externalId: 'pkg:season',
          ...(dates.length ? { startDate: dates[0], endDate: dates[dates.length - 1] } : {}),
        });
      }
      const seriesIds = new Map<string, string>();
      for (const [i, pillar] of (opts.seriesPillars ?? []).entries()) {
        const xid = `pkg:series:${pillar}`.slice(0, 120);
        const id = await upsert('projects', ex.projects.get(xid), {
          name: cut(pillar, 200),
          status: 'active',
          kind: 'series',
          isFocus: false,
          color: ((i + 4) % 8) + 1,
          platforms: ['instagram'],
          externalId: xid,
          ...(seasonId ? { parentId: seasonId } : {}),
        });
        if (id) seriesIds.set(pillar, id);
      }

      // Bible
      for (const c of pkg.chapters) {
        await upsert(
          'chapters',
          ex.chapters.get(c.externalId),
          {
            title: cut(c.title, 300),
            number: cut(c.number, 30),
            order: c.order,
            body: cut(c.body, 500000),
            originalBody: cut(c.originalBody ?? c.body, 500000),
            status: 'current',
            externalId: c.externalId,
          },
          ['originalBody'],
        );
      }

      // Pieces (+ planned publication, + first measurement when the package has one)
      const pieceIds = new Map<string, string>();
      for (const p of pkg.pieces) {
        const cur = ex.content.get(p.externalId);
        const rev = s.hlc.now();
        const data: Record<string, unknown> = {
          title: cut(p.title, 300),
          status: p.status,
          formatTemplateId: templates.has(p.format) ? p.format : 'reel',
          platforms: ['instagram'],
          projectId: (p.pillar && seriesIds.get(p.pillar)) || seasonId,
          externalId: p.externalId,
          pillar: cut(p.pillar, 120),
          dmKeyword: cut(p.dmKeyword, 120),
          durationTargetSec: p.durationTargetSec,
          original: p.original
            ? {
                text: cut(p.original, 200000)!,
                sourceLabel: cut(opts.sourceLabel ?? p.provenance, 300),
                importedAt: at,
              }
            : undefined,
          hook: cut(p.hook, 2000),
          objective: cut(p.objective, 2000),
          coverText: cut(p.coverText, 500),
          coverUrl: cut(p.coverUrl, 4000),
          artDirection: cut(p.artDirection, 20000),
          soundDirection: cut(p.soundDirection, 20000),
          continuityNotes: cut(p.continuityNotes, 20000),
          cta: cut(p.cta, 2000),
          script: cut(p.script, 100000),
          prompt: cut(p.prompt, 100000),
          caption: cut(p.caption, 10000),
          stories: cut(p.stories, 20000),
          pinnedComment: cut(p.pinnedComment, 5000),
          productionNotes: cut(p.productionNotes, 50000),
          notes: cut(p.notes, 50000),
          checks: p.checks,
          shots: p.shots.length ? shotsOf(p, rev) : undefined,
          variants: cur ? undefined : variantsOf(p, at),
          ...(p.archived ? { archivedAt: at } : {}),
        };
        const id = await upsert('content', cur, data, ['original']);
        if (!id) continue;
        pieceIds.set(p.externalId, id);
        if (cur && mode === 'keep') continue;
        if (p.plannedAt || p.publishedAt) {
          const pubs = (await s.db.publications.where('contentId').equals(id).toArray()).filter(
            (x) => !x.deletedAt && x.platform === 'instagram',
          );
          const pub = pubs[0];
          const pd: Record<string, unknown> = {
            scheduledAt: p.plannedAt,
            ...(p.publishedAt ? { publishedAt: p.publishedAt, status: 'published' } : {}),
            ...(p.publishedUrl ? { url: cut(p.publishedUrl, 4000) } : {}),
          };
          let pubId = pub?.id;
          if (!pub)
            pubId = (
              await m.create('publications', {
                contentId: id,
                platform: 'instagram',
                status: p.publishedAt ? 'published' : 'planned',
                ...(pd as object),
              } as never)
            ).id;
          else {
            const patch = patchFor(mode, pub as unknown as Record<string, unknown>, pd);
            if (patch) await m.update('publications', pub.id, patch as never);
          }
          if (p.metrics && pubId) {
            const snaps = await s.db.snapshots.where('publicationId').equals(pubId).count();
            if (!snaps)
              await m.create('snapshots', {
                publicationId: pubId,
                contentId: id,
                platform: 'instagram',
                observedAt: p.publishedAt ?? at,
                ageHours: 0,
                checkpoint: null, // no window was recorded: never invent one
                source: 'manual',
                metrics: p.metrics,
              } as never);
          }
        }
      }

      // Radar
      for (const r of pkg.radar) {
        await upsert('radar', ex.radar.get(r.externalId), {
          title: cut(r.title, 500),
          category: cut(r.category, 120),
          periodText: cut(r.periodText, 300),
          startDate: r.startDate,
          endDate: r.endDate,
          precision: r.precision,
          sources: r.sources
            .slice(0, 20)
            .map((x) => ({ label: x.label.slice(0, 300), url: x.url.slice(0, 4000) })),
          verification: r.verification,
          angle: cut(r.angle, 5000),
          notes: cut(r.notes, 20000),
          externalId: r.externalId,
        });
      }

      // Tasks and decisions
      for (const t of pkg.tasks) {
        await upsert('tasks', ex.tasks.get(t.externalId), {
          title: cut(t.title, 500),
          status: t.status,
          kind: t.kind,
          isBlocker: false,
          ...(t.kind === 'decision' ? { blockerType: 'decision' } : {}),
          dueAt: t.due ? new Date(`${t.due}T18:00:00`).toISOString() : undefined,
          category: cut(t.category, 120),
          notes: cut(t.notes, 20000),
          projectId: seasonId,
          externalId: t.externalId,
          ...(t.status === 'done' ? { doneAt: at } : {}),
        });
      }

      // Ideas (emergency bank)
      for (const i of pkg.ideas) {
        await upsert('ideas', ex.ideas.get(i.externalId), {
          title: cut(i.title, 300),
          status: 'new',
          pillar: cut(i.pillar, 120),
          notes: cut(i.notes, 50000),
          emergency: i.emergency,
          externalId: i.externalId,
        });
      }

      // Manual AI answers: kept as drafts; their origin is declared, never certified.
      for (const x of pkg.sessions) {
        await upsert('sessions', ex.sessions.get(x.externalId), {
          task: cut(x.task, 60),
          provider: cut(x.provider, 60),
          mode: 'manual',
          declaredSource: cut(x.provider, 200),
          contentId: x.pieceId ? pieceIds.get(x.pieceId) : undefined,
          prompt: cut(x.prompt, 200000),
          response: cut(x.response, 200000),
          status: 'draft',
          at: x.at && !Number.isNaN(Date.parse(x.at)) ? new Date(x.at).toISOString() : at,
          externalId: x.externalId,
        });
      }

      // Workspace preferences and editorial checklist
      if (ws) {
        const wp: Record<string, unknown> = {};
        const want: Record<string, unknown> = {
          timezone: pkg.prefs.timezone,
          weeklyHours: pkg.prefs.weeklyHours,
          weeklyGoal: pkg.prefs.weeklyGoal,
          ownerName: pkg.prefs.ownerName,
        };
        for (const [k, v] of Object.entries(want)) {
          if (v === undefined) continue;
          const cur = (ws as Record<string, unknown>)[k];
          if (blank(cur) || mode === 'replace') wp[k] = v;
        }
        if (pkg.checklist.length && (blank(ws.checklist) || mode === 'replace')) {
          wp.checklist = pkg.checklist
            .slice(0, 60)
            .map((c) => ({ id: c.id.slice(0, 40), text: c.text.slice(0, 500) }));
          wp.checklistVersion = (ws.checklistVersion ?? 0) + 1;
        }
        if (Object.keys(wp).length) await m.update('workspace', 'workspace', wp as never);
      }
    },
    { source: 'import', importBatchId: batchId },
  );
  return res;
}

const monthLabel = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { month: 'short', year: 'numeric' })
    .format(new Date(iso))
    .replace('.', '');
