import type { Session } from '../app/session';
import { displayTitleForUrl, extractUrl, parseUrl } from '../core/url';
import { nowIso } from '../core/util';
import { snapCheckpoint } from '../rules/analytics';
import type { Capture, Content, ContentStatus, FocusRef, Idea, Platform, Publication } from './schema';
import { create, mutate, update } from './store';

// ---------- Capture & triage ----------

const TASK_RE =
  /^(todo|to do|task|buy|call|email|send|book|fix|pay|reply|remind|check|finish|record|export|upload)\b|^\s*[-*]\s*\[\s?\]/i;

export function suggestFor(
  text: string,
  url: string | null,
  hasMedia: boolean,
): NonNullable<Capture['suggestion']> {
  if (url && text.trim().replace(url, '').trim().length < 12)
    return { type: 'library', role: 'inspiration', by: 'rule', reason: 'link' };
  if (hasMedia && text.trim().length < 20)
    return { type: 'library', role: 'reference', by: 'rule', reason: 'image' };
  if (TASK_RE.test(text.trim())) return { type: 'task', by: 'rule', reason: 'starts like a task' };
  return { type: 'idea', by: 'rule', reason: 'free text' };
}

export async function capture(
  s: Session,
  input: { text?: string; mode: Capture['mode']; mediaIds?: string[]; projectId?: string | null },
): Promise<Capture> {
  const text = (input.text ?? '').trim();
  const url = extractUrl(text);
  const parsed = url ? parseUrl(url) : null;
  return create(
    s,
    'captures',
    {
      text: text || null,
      url: url ?? null,
      canonicalUrl: parsed?.canonical ?? null,
      mediaIds: input.mediaIds ?? [],
      mode: input.mode === 'text' && url ? 'link' : input.mode,
      status: 'inbox',
      suggestion:
        input.mode === 'task'
          ? { type: 'task', by: 'rule', reason: 'captured as task' }
          : suggestFor(text, url, (input.mediaIds?.length ?? 0) > 0),
      projectId: input.projectId ?? null,
    },
    'Capture',
    { source: 'user' },
  );
}

function firstLine(t: string | null | undefined, n = 120): string {
  const line = (t ?? '').split('\n').find((l) => l.trim()) ?? '';
  return line.trim().slice(0, n);
}

export type TriageTarget = 'idea' | 'task' | 'research' | 'reference' | 'asset' | 'content' | 'note';

export async function triage(
  s: Session,
  c: Capture,
  target: TriageTarget,
  opts: { projectId?: string | null; title?: string } = {},
): Promise<{ entity: string; id: string }> {
  const projectId = opts.projectId ?? c.projectId ?? null;
  const origin = { source: 'capture' as const, captureId: c.id };
  const parsed = c.url ? parseUrl(c.url) : null;
  const title =
    opts.title ||
    firstLine(c.text?.replace(c.url ?? '', '')) ||
    (parsed ? displayTitleForUrl(parsed) : 'Untitled');
  return mutate(s, { label: `Triage capture → ${target}` }, async (m) => {
    let ref: { entity: string; id: string };
    if (target === 'idea') {
      const r = await m.create('ideas', { title, raw: c.text ?? null, status: 'new', projectId, origin });
      if (c.url || c.mediaIds.length) {
        const lib = await m.create('library', {
          title: parsed ? displayTitleForUrl(parsed) : 'Captured media',
          role: 'inspiration',
          kind: parsed ? 'link' : 'image',
          originalUrl: c.url ?? null,
          canonicalUrl: parsed?.canonical ?? null,
          site: parsed?.host ?? null,
          thumbUrl: parsed?.thumbUrl ?? null,
          mediaId: c.mediaIds[0] ?? null,
          projectId,
          origin,
        });
        await m.create('links', {
          fromType: 'idea',
          fromId: r.id,
          toType: 'library',
          toId: lib.id,
          type: 'references',
        });
      }
      ref = { entity: 'ideas', id: r.id };
    } else if (target === 'task') {
      const r = await m.create('tasks', {
        title: title.replace(/^(todo|to do|task)[:\s-]*/i, '') || title,
        status: 'todo',
        kind: 'task',
        isBlocker: false,
        notes: c.text && c.text.length > title.length ? c.text : null,
        projectId,
        origin,
      });
      ref = { entity: 'tasks', id: r.id };
    } else if (target === 'content') {
      const r = await m.create('content', {
        title,
        concept: c.text ?? null,
        status: 'planned',
        formatTemplateId: 'reel',
        platforms: [],
        projectId,
        origin,
      });
      ref = { entity: 'content', id: r.id };
    } else {
      const role = target === 'reference' ? 'reference' : target === 'asset' ? 'asset' : 'inspiration';
      const kind =
        target === 'note'
          ? 'note'
          : parsed
            ? parsed.kind === 'video'
              ? 'video'
              : parsed.kind === 'account'
                ? 'account'
                : parsed.kind === 'post'
                  ? 'post'
                  : 'link'
            : c.mediaIds.length
              ? c.mode === 'voice'
                ? 'voice'
                : 'image'
              : 'note';
      const r = await m.create('library', {
        title,
        role,
        kind,
        originalUrl: c.url ?? null,
        canonicalUrl: parsed?.canonical ?? null,
        site: parsed?.host ?? null,
        platformRef:
          parsed?.platform && parsed.platform !== 'web'
            ? {
                platform: parsed.platform,
                ...(parsed.externalId ? { externalId: parsed.externalId } : {}),
                ...(parsed.handle ? { handle: parsed.handle } : {}),
              }
            : null,
        thumbUrl: parsed?.thumbUrl ?? null,
        mediaId: c.mediaIds[0] ?? null,
        notes: c.text && c.text !== c.url ? c.text : null,
        projectId,
        origin,
      });
      ref = { entity: 'library', id: r.id };
    }
    await m.update('captures', c.id, { status: 'triaged', resultRef: ref });
    return ref;
  });
}

// ---------- Ideas ----------

export async function createVariant(
  s: Session,
  idea: Idea,
  label: string,
  fields: Partial<Idea> = {},
): Promise<Idea> {
  return create(
    s,
    'ideas',
    {
      title: fields.title ?? `${idea.title} — ${label}`,
      hook: fields.hook ?? idea.hook ?? null,
      concept: fields.concept ?? idea.concept ?? null,
      raw: fields.raw ?? null,
      format: idea.format ?? null,
      platforms: idea.platforms ?? [],
      projectId: idea.projectId ?? null,
      parentIdeaId: idea.id,
      variantLabel: label,
      status: 'new',
      ...(fields.origin ? { origin: fields.origin } : {}),
    },
    'Create variant',
  );
}

export async function ideaToContent(
  s: Session,
  idea: Idea,
  opts: { formatTemplateId: string; platforms: Platform[]; projectId?: string | null; title?: string },
): Promise<Content> {
  return mutate(s, { label: 'Turn idea into content' }, async (m) => {
    const c = await m.create('content', {
      title: opts.title || idea.title,
      ideaId: idea.id,
      projectId: opts.projectId ?? idea.projectId ?? null,
      status: 'planned',
      formatTemplateId: opts.formatTemplateId,
      platforms: opts.platforms,
      hook: idea.hook ?? null,
      concept: idea.concept ?? idea.raw ?? null,
      attributes: {
        ...(idea.cast?.length ? { cast: idea.cast } : {}),
        ...(idea.tone ? { tone: idea.tone } : {}),
        ...(idea.topic ? { topic: idea.topic } : {}),
      },
    });
    await m.update('ideas', idea.id, { status: 'committed' });
    // Carry the idea's references over to the content.
    const links = (await s.db.links.where('fromId').equals(idea.id).toArray()).filter(
      (l) => !l.deletedAt && l.type === 'references',
    );
    for (const l of links)
      await m.create('links', {
        fromType: 'content',
        fromId: c.id,
        toType: l.toType,
        toId: l.toId,
        type: 'references',
      });
    return c;
  });
}

// ---------- Content production ----------

const PRODUCTION_FIELDS = new Set([
  'hook',
  'concept',
  'script',
  'shots',
  'finalExportUrl',
  'finalExportMediaId',
  'coverMediaId',
  'coverUrl',
  'coverText',
  'caption',
  'hashtags',
  'editNotes',
  'productionNotes',
]);

/** Edit content; the first production edit on a planned item moves it to Producing (undoable). */
export async function editContent(
  s: Session,
  c: Content,
  patch: Partial<Content>,
  coalesceKey?: string,
): Promise<{ autoProducing: boolean }> {
  const auto =
    c.status === 'planned' && !patch.status && Object.keys(patch).some((k) => PRODUCTION_FIELDS.has(k));
  await update(s, 'content', c.id, auto ? { ...patch, status: 'producing' } : patch, {
    label: auto ? 'Edit content · moved to Producing' : 'Edit content',
    ...(coalesceKey && !auto ? { coalesceKey } : {}),
  });
  return { autoProducing: auto };
}

export async function setContentStatus(s: Session, c: Content, status: ContentStatus): Promise<void> {
  await update(
    s,
    'content',
    c.id,
    { status, ...(status === 'reviewed' ? { reviewedAt: nowIso() } : {}) },
    { label: `Status → ${status}` },
  );
}

export async function schedulePublication(
  s: Session,
  c: Content,
  platform: Platform,
  at: string | null,
  existing?: Publication,
): Promise<void> {
  await mutate(s, { label: at ? 'Schedule publication' : 'Unschedule publication' }, async (m) => {
    if (existing)
      await m.update('publications', existing.id, {
        scheduledAt: at,
        status: at ? 'scheduled' : 'planned',
        platform,
      });
    else
      await m.create('publications', {
        contentId: c.id,
        platform,
        status: at ? 'scheduled' : 'planned',
        scheduledAt: at,
      });
    if (at && ['planned', 'producing', 'ready'].includes(c.status))
      await m.update('content', c.id, { status: 'scheduled' });
  });
}

export async function markPublished(
  s: Session,
  c: Content,
  pub: Publication,
  url: string | null,
  at = nowIso(),
): Promise<void> {
  await mutate(s, { label: 'Mark published' }, async (m) => {
    await m.update('publications', pub.id, {
      status: 'published',
      publishedAt: at,
      url,
      externalId: url ? (parseUrl(url)?.externalId ?? null) : null,
    });
    if (c.status !== 'published' && c.status !== 'reviewed')
      await m.update('content', c.id, { status: 'published' });
  });
}

export async function logSnapshot(
  s: Session,
  pub: Publication,
  metrics: Record<string, number>,
  observedAt = nowIso(),
  checkpoint?: string | null,
): Promise<void> {
  const ageHours = pub.publishedAt
    ? Math.max(0, (Date.parse(observedAt) - Date.parse(pub.publishedAt)) / 3600_000)
    : 0;
  const cp = (checkpoint ?? snapCheckpoint(ageHours)) as never;
  await mutate(s, { label: 'Log results' }, async (m) => {
    await m.create('snapshots', {
      publicationId: pub.id,
      contentId: pub.contentId,
      platform: pub.platform,
      observedAt,
      ageHours,
      checkpoint: cp,
      source: 'manual',
      metrics,
    });
    if (cp === '7d') {
      const c = await s.db.content.get(pub.contentId);
      if (c && c.status === 'published')
        await m.update('content', c.id, { status: 'reviewed', reviewedAt: nowIso() });
    }
  });
}

export async function flagBlocked(
  s: Session,
  c: Content,
  reason: string,
  blockerType?: 'reference' | 'asset' | 'decision' | 'generation' | 'external' | 'other',
): Promise<void> {
  await create(
    s,
    'tasks',
    {
      title: reason,
      status: 'todo',
      kind: blockerType === 'decision' ? 'decision' : 'task',
      isBlocker: true,
      blockerType: blockerType ?? 'other',
      contentId: c.id,
      projectId: c.projectId ?? null,
    },
    'Flag blocked',
  );
}

export async function toggleTask(s: Session, id: string, done: boolean): Promise<void> {
  await update(
    s,
    'tasks',
    id,
    { status: done ? 'done' : 'todo', doneAt: done ? nowIso() : null },
    { label: done ? 'Complete task' : 'Reopen task' },
  );
}

export async function moveToTomorrow(s: Session, c: Content): Promise<void> {
  const pubs = (await s.db.publications.where('contentId').equals(c.id).toArray()).filter(
    (p) => !p.deletedAt && p.scheduledAt && p.status !== 'published',
  );
  await mutate(s, { label: 'Move to tomorrow' }, async (m) => {
    for (const p of pubs)
      await m.update('publications', p.id, {
        scheduledAt: new Date(Date.parse(p.scheduledAt!) + 86400_000).toISOString(),
      });
  });
}

// ---------- Focus ----------

export async function togglePin(s: Session, ref: FocusRef): Promise<'pinned' | 'unpinned' | 'full'> {
  const ws = await s.db.workspace.get('workspace');
  if (!ws) return 'full';
  const has = ws.focus.some((f) => f.entity === ref.entity && f.id === ref.id);
  if (!has && ws.focus.length >= 3) return 'full';
  const focus = has
    ? ws.focus.filter((f) => !(f.entity === ref.entity && f.id === ref.id))
    : [...ws.focus, ref];
  await update(s, 'workspace', 'workspace', { focus }, { label: has ? 'Unpin from Focus' : 'Pin to Focus' });
  return has ? 'unpinned' : 'pinned';
}

export async function linkRecords(
  s: Session,
  fromType: string,
  fromId: string,
  toType: string,
  toId: string,
  type: 'references' | 'inspired' | 'evidence' | 'influenced' | 'related' = 'references',
): Promise<void> {
  const existing = (await s.db.links.where('fromId').equals(fromId).toArray()).find(
    (l) => l.toId === toId && l.type === type,
  );
  if (existing && !existing.deletedAt) return;
  if (existing) await update(s, 'links', existing.id, { deletedAt: null });
  else await create(s, 'links', { fromType, fromId, toType, toId, type }, 'Link');
}

export async function unlink(s: Session, linkId: string): Promise<void> {
  await update(s, 'links', linkId, { deletedAt: nowIso() }, { label: 'Remove link' });
}
