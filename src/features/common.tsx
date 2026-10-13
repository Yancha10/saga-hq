import { Link } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  Check,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  MoreHorizontal,
  Plus,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Menu, MenuItem, MenuTrigger, Popover, Button as RACButton } from 'react-aria-components';
import { useApp, useLive, useSession } from '../app/context';
import { toast } from '../app/status';
import { displayTitleForUrl, parseUrl, safeHttpUrl } from '../core/url';
import { nowIso, truncate } from '../core/util';
import { DEFAULT_TEMPLATES } from '../data/defaults';
import { linkRecords, toggleTask, unlink } from '../data/domain';
import {
  type Content,
  type EntityTable,
  type LibraryItem,
  PLATFORMS,
  type Platform,
  type Project,
  type Task,
} from '../data/schema';
import { archive, create, restore, trash, update } from '../data/store';
import { t, useT } from '../i18n';
import { historyLabel, missingList, platformName } from '../i18n/render';
import { mediaUrl } from '../media/store';
import { AutoText, Button, Chip, IconButton, Pill, Sheet } from '../ui/kit';

export function ContentStatus({ c }: { c: Content }) {
  const { t } = useT();
  if (c._blocked)
    return (
      <Pill tone="warn" dot>
        {t('status.blocked')}
      </Pill>
    );
  const late =
    c._nextPublishAt && Date.parse(c._nextPublishAt) < Date.now() - 3600_000 && c.status !== 'published';
  if (late)
    return (
      <Pill tone="danger" dot>
        {t('status.late')}
      </Pill>
    );
  const tone = c.status === 'ready' ? 'ok' : c.status === 'scheduled' ? 'accent' : undefined;
  return (
    <Pill tone={tone} dot={!!tone}>
      {t(`content.status.${c.status}`)}
      {c.status === 'producing' && c._stage ? ` · ${t(`section.${c._stage}`)}` : ''}
    </Pill>
  );
}

export function missingText(c: Content): string {
  const m = (c._missing ?? []).filter((k) => k !== 'publishDate');
  return m.length ? t('content.missing', { items: missingList(m) }) : '';
}

/** Display title for records whose title may be empty (never stores a UI-language default). */
export const contentTitle = (c: { title?: string | null }) => c.title?.trim() || t('common.untitled');
export function libraryTitle(r: Pick<LibraryItem, 'title' | 'originalUrl' | 'kind'>): string {
  if (r.title?.trim()) return r.title;
  const p = r.originalUrl ? parseUrl(r.originalUrl) : null;
  return p ? displayTitleForUrl(p) : t(`library.kind.${r.kind}`);
}

export function PlatformTags({ platforms }: { platforms: Platform[] | undefined }) {
  useT();
  if (!platforms?.length) return null;
  return (
    <>
      {platforms.map((p) => (
        <span key={p} className="tag">
          {platformName(p)}
        </span>
      ))}
    </>
  );
}

export function PlatformPicker({
  value,
  onChange,
}: {
  value: Platform[];
  onChange: (v: Platform[]) => void;
}) {
  const { t } = useT();
  return (
    <div className="chips" role="group" aria-label={t('common.platforms')}>
      {PLATFORMS.map((p) => (
        <Chip
          key={p}
          on={value.includes(p)}
          onClick={() => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p])}
        >
          {platformName(p)}
        </Chip>
      ))}
    </div>
  );
}

export function useProjects(): Project[] {
  return useLive(
    (s) =>
      s.db.projects
        .toArray()
        .then((ps) => ps.filter((p) => !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name))),
    [],
    [],
  );
}

export function ProjectSelect({
  value,
  onChange,
  id,
  includeNone = true,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  id?: string;
  includeNone?: boolean;
}) {
  const { t } = useT();
  const projects = useProjects();
  return (
    <select
      id={id}
      className="select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={id ? undefined : t('common.project')}
    >
      {includeNone && <option value="">{t('common.no_project')}</option>}
      {projects
        .filter((p) => !p.archivedAt || p.id === value)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
    </select>
  );
}

export function PrioritySelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (v: 'low' | 'med' | 'high' | null) => void;
}) {
  const { t } = useT();
  return (
    <select
      id={id}
      className="select"
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || null) as 'low' | 'med' | 'high' | null)}
    >
      <option value="">{t('priority.none')}</option>
      <option value="low">{t('priority.low')}</option>
      <option value="med">{t('priority.med')}</option>
      <option value="high">{t('priority.high')}</option>
    </select>
  );
}

export function TaskRow({ t: task, showParent = true }: { t: Task; showParent?: boolean }) {
  const { t, fmt } = useT();
  const s = useSession();
  const done = task.status === 'done';
  const overdue = !done && task.dueAt && Date.parse(task.dueAt) < new Date().setHours(0, 0, 0, 0);
  const parent = useLive(
    async (ss) => (showParent && task.contentId ? ss.db.content.get(task.contentId) : undefined),
    [task.contentId, showParent],
    undefined,
  );
  return (
    <div className="row static">
      <label className="check" style={{ minHeight: 0 }}>
        <input
          type="checkbox"
          checked={done}
          onChange={(e) => void toggleTask(s, task.id, e.target.checked)}
          aria-label={t(done ? 'task.mark_undone' : 'task.mark_done', { title: task.title })}
        />
      </label>
      <div className="grow">
        <div
          className="title"
          style={{
            textDecoration: done ? 'line-through' : undefined,
            color: done ? 'var(--text-3)' : undefined,
          }}
        >
          {task.title}
        </div>
        <div className="sub hstack" style={{ gap: 6 }}>
          {task.isBlocker && !done && <Pill tone="warn">{t('task.blocker')}</Pill>}
          {task.kind === 'decision' && <Pill tone="accent">{t('task.kind.decision')}</Pill>}
          {task.status === 'doing' && <Pill>{t('task.status.doing')}</Pill>}
          {task.dueAt && (
            <span style={{ color: overdue ? 'var(--danger)' : undefined }}>
              {t('task.due', { when: fmt.relDay(task.dueAt) })}
            </span>
          )}
          {parent && (
            <Link to="/content/$id" params={{ id: parent.id }} className="tag">
              {truncate(contentTitle(parent), 40)}
            </Link>
          )}
        </div>
      </div>
      {!done && task.status !== 'doing' && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void update(s, 'tasks', task.id, { status: 'doing' })}
        >
          {t('task.start')}
        </Button>
      )}
      <TaskMenu task={task} />
    </div>
  );
}

function TaskMenu({ task }: { task: Task }) {
  const { t } = useT();
  const s = useSession();
  const [edit, setEdit] = useState(false);
  return (
    <>
      <RecordMenu
        label={t('task.actions', { title: task.title })}
        items={[
          { id: 'edit', label: t('common.edit_ellipsis'), run: () => setEdit(true) },
          {
            id: 'blocker',
            label: task.isBlocker ? t('task.not_blocker') : t('task.make_blocker'),
            run: () => void update(s, 'tasks', task.id, { isBlocker: !task.isBlocker }),
          },
          {
            id: 'trash',
            label: t('common.move_to_trash'),
            danger: true,
            run: () =>
              void trash(s, 'tasks', task.id).then(() =>
                toast(t('task.trashed'), {
                  action: { label: t('common.undo'), run: () => void restore(s, 'tasks', task.id) },
                }),
              ),
          },
        ]}
      />
      <TaskEditor open={edit} onClose={() => setEdit(false)} task={task} />
    </>
  );
}

export function TaskEditor({ open, onClose, task }: { open: boolean; onClose: () => void; task: Task }) {
  const { t } = useT();
  const s = useSession();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('task.edit_title')}
      footer={<Button onClick={onClose}>{t('common.done')}</Button>}
    >
      <AutoText
        value={task.title}
        onSave={(v) =>
          v.trim() && update(s, 'tasks', task.id, { title: v.trim() }, { coalesceKey: `t:${task.id}:title` })
        }
        ariaLabel={t('common.title')}
        className="title"
      />
      <div className="form-grid">
        <div className="field">
          <label className="lbl" htmlFor="tdue">
            {t('task.due_label')}
          </label>
          <input
            id="tdue"
            type="date"
            className="input"
            value={task.dueAt ? task.dueAt.slice(0, 10) : ''}
            onChange={(e) =>
              void update(s, 'tasks', task.id, {
                dueAt: e.target.value ? new Date(`${e.target.value}T18:00:00`).toISOString() : null,
              })
            }
          />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="tprio">
            {t('common.priority')}
          </label>
          <PrioritySelect
            id="tprio"
            value={task.priority}
            onChange={(v) => void update(s, 'tasks', task.id, { priority: v })}
          />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="test">
            {t('task.estimate')}
          </label>
          <input
            id="test"
            type="number"
            min={0}
            className="input"
            value={task.estimateMin ?? ''}
            onChange={(e) =>
              void update(s, 'tasks', task.id, {
                estimateMin: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="tkind">
            {t('task.kind_label')}
          </label>
          <select
            id="tkind"
            className="select"
            value={task.kind}
            onChange={(e) => void update(s, 'tasks', task.id, { kind: e.target.value as Task['kind'] })}
          >
            <option value="task">{t('task.kind.task')}</option>
            <option value="decision">{t('task.kind.decision')}</option>
          </select>
        </div>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={!!task.hardDeadline}
          onChange={(e) => void update(s, 'tasks', task.id, { hardDeadline: e.target.checked })}
        />{' '}
        {t('task.hard_deadline')}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={task.isBlocker}
          onChange={(e) => void update(s, 'tasks', task.id, { isBlocker: e.target.checked })}
        />{' '}
        {t('task.blocks_parent')}
      </label>
      <div className="field">
        <span className="lbl">{t('common.project')}</span>
        <ProjectSelect
          value={task.projectId}
          onChange={(v) => void update(s, 'tasks', task.id, { projectId: v })}
        />
      </div>
      {task.kind === 'decision' && (
        <div className="field">
          <span className="lbl">{t('task.resolution')}</span>
          <AutoText
            multiline
            value={task.resolution}
            onSave={(v) =>
              update(s, 'tasks', task.id, { resolution: v || null }, { coalesceKey: `t:${task.id}:res` })
            }
            ariaLabel={t('task.resolution')}
          />
        </div>
      )}
      <div className="field">
        <span className="lbl">{t('common.notes')}</span>
        <AutoText
          multiline
          value={task.notes}
          onSave={(v) =>
            update(s, 'tasks', task.id, { notes: v || null }, { coalesceKey: `t:${task.id}:notes` })
          }
          ariaLabel={t('common.notes')}
        />
      </div>
    </Sheet>
  );
}

export function QuickTask({
  parent,
  placeholder,
}: {
  parent?: { contentId?: string; projectId?: string | null; ideaId?: string };
  placeholder?: string;
}) {
  const { t } = useT();
  const s = useSession();
  const [v, setV] = useState('');
  const [blocker, setBlocker] = useState(false);
  const add = async () => {
    const title = v.trim();
    if (!title) return;
    await create(s, 'tasks', {
      title,
      status: 'todo',
      kind: 'task',
      isBlocker: blocker,
      contentId: parent?.contentId ?? null,
      projectId: parent?.projectId ?? null,
      ideaId: parent?.ideaId ?? null,
    });
    setV('');
    setBlocker(false);
  };
  return (
    <form
      className="hstack"
      style={{ padding: '6px 10px', borderTop: '1px solid var(--line)' }}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Plus size={16} aria-hidden style={{ color: 'var(--text-3)' }} />
      <input
        className="input plain"
        style={{ flex: 1, minWidth: 120 }}
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder ?? t('task.add_placeholder')}
        aria-label={t('task.new_title')}
      />
      {parent?.contentId && (
        <label className="check meta" style={{ minHeight: 0 }}>
          <input type="checkbox" checked={blocker} onChange={(e) => setBlocker(e.target.checked)} />{' '}
          {t('task.blocker')}
        </label>
      )}
      {v && (
        <Button size="sm" type="submit">
          {t('common.add')}
        </Button>
      )}
    </form>
  );
}

export interface MenuItemDef {
  id: string;
  label: string;
  run: () => void;
  danger?: boolean;
}
export function RecordMenu({ items, label }: { items: MenuItemDef[]; label: string }) {
  return (
    <MenuTrigger>
      <RACButton className="icon-btn sm" aria-label={label}>
        <MoreHorizontal size={16} />
      </RACButton>
      <Popover className="menu-pop" placement="bottom end">
        <Menu className="menu" onAction={(k) => items.find((i) => i.id === k)?.run()}>
          {items.map((i) => (
            <MenuItem key={i.id} id={i.id} className={`menu-item ${i.danger ? 'danger' : ''}`}>
              {i.label}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

export function archiveTrashItems(
  s: ReturnType<typeof useSession>,
  table: EntityTable,
  rec: { id: string; archivedAt?: string | null; deletedAt?: string | null },
  after?: () => void,
): MenuItemDef[] {
  return [
    rec.archivedAt
      ? { id: 'unarchive', label: t('common.unarchive'), run: () => void archive(s, table, rec.id, false) }
      : {
          id: 'archive',
          label: t('common.archive'),
          run: () =>
            void archive(s, table, rec.id).then(() =>
              toast(t('toast.archived'), {
                action: { label: t('common.undo'), run: () => void archive(s, table, rec.id, false) },
              }),
            ),
        },
    rec.deletedAt
      ? { id: 'restore', label: t('common.restore_trash'), run: () => void restore(s, table, rec.id) }
      : {
          id: 'trash',
          label: t('common.move_to_trash'),
          danger: true,
          run: () =>
            void trash(s, table, rec.id).then(() => {
              toast(t('toast.trashed'), {
                action: { label: t('common.undo'), run: () => void restore(s, table, rec.id) },
              });
              after?.();
            }),
        },
  ];
}

export function ArchivedNotice({
  rec,
  table,
}: {
  rec: { id: string; archivedAt?: string | null; deletedAt?: string | null };
  table: EntityTable;
}) {
  const { t, fmt } = useT();
  const s = useSession();
  if (rec.deletedAt)
    return (
      <div
        className="banner warning"
        style={{ borderRadius: 8, border: '1px solid var(--line)', marginBottom: 12 }}
      >
        <Trash2 size={16} aria-hidden /> {t('notice.in_trash', { date: fmt.date(rec.deletedAt) })}
        <span className="spacer" />
        <Button size="sm" onClick={() => void restore(s, table, rec.id)}>
          <Undo2 size={14} /> {t('common.restore')}
        </Button>
      </div>
    );
  if (rec.archivedAt)
    return (
      <div
        className="banner info"
        style={{ borderRadius: 8, border: '1px solid var(--line)', marginBottom: 12 }}
      >
        <Archive size={16} aria-hidden /> {t('notice.archived', { date: fmt.date(rec.archivedAt) })}
        <span className="spacer" />
        <Button size="sm" onClick={() => void archive(s, table, rec.id, false)}>
          <ArchiveRestore size={14} /> {t('common.unarchive')}
        </Button>
      </div>
    );
  return null;
}

/** Shows conflict copies kept when two devices edited the same long text concurrently. */
export function ConflictNotice({ recordId, table }: { recordId: string; table: EntityTable }) {
  const { t, fmt } = useT();
  const s = useSession();
  const conflicts = useLive(
    (ss) =>
      ss.db.conflicts
        .where('recordId')
        .equals(recordId)
        .toArray()
        .then((xs) => xs.filter((x) => !x.resolved)),
    [recordId],
    [],
  );
  const [open, setOpen] = useState(false);
  if (!conflicts.length) return null;
  return (
    <>
      <div
        className="banner warning"
        style={{ borderRadius: 8, border: '1px solid var(--line)', marginBottom: 12 }}
      >
        {t('conflict.notice', { fields: conflicts.map((c) => t(`field.${c.field}`)).join(', ') })}
        <span className="spacer" />
        <Button size="sm" onClick={() => setOpen(true)}>
          {t('conflict.compare')}
        </Button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('conflict.title')} wide>
        {conflicts.map((c) => (
          <div key={c.id} className="box">
            <div className="hstack">
              <strong>{t(`field.${c.field}`)}</strong>
              <span className="meta">{t('conflict.kept', { date: fmt.date(c.at) })}</span>
            </div>
            <pre className="json">{String(c.value ?? '')}</pre>
            <div className="hstack">
              <Button
                size="sm"
                onClick={() =>
                  void update(s, table, recordId, { [c.field]: c.value } as never, {
                    label: 'h.useOtherVersion',
                  }).then(() => s.db.conflicts.update(c.id, { resolved: true }))
                }
              >
                {t('conflict.use')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void navigator.clipboard?.writeText(String(c.value ?? ''))}
              >
                {t('common.copy')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void s.db.conflicts.update(c.id, { resolved: true })}
              >
                {t('common.dismiss')}
              </Button>
            </div>
          </div>
        ))}
      </Sheet>
    </>
  );
}

export function MediaThumb({
  mediaId,
  url,
  alt,
  className = 'thumb-sm',
}: {
  mediaId?: string | null;
  url?: string | null;
  alt: string;
  className?: string;
}) {
  const s = useSession();
  const { runner } = useApp();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (mediaId) void mediaUrl(s, mediaId, 'thumb', runner?.drive).then((u) => alive && setSrc(u));
    else setSrc(safeHttpUrl(url ?? null));
    return () => {
      alive = false;
    };
  }, [mediaId, url, s, runner]);
  if (!src)
    return (
      <span
        className={className}
        style={{ display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}
        aria-hidden
      >
        <ImageIcon size={16} />
      </span>
    );
  return <img className={className} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />;
}

export function ExtLink({ href, children }: { href: string | null | undefined; children?: ReactNode }) {
  const { t } = useT();
  const safe = safeHttpUrl(href ?? null);
  if (!safe) return <span className="meta">{href}</span>;
  let host = '';
  try {
    host = new URL(safe).hostname;
  } catch {
    /* ignore */
  }
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="hstack"
      style={{ gap: 4, color: 'var(--accent-strong)' }}
      aria-label={children ? undefined : t('a11y.open_link', { host })}
    >
      {children ?? host} <ExternalLink size={12} aria-hidden />
    </a>
  );
}

/** Linked references for any record, with an add flow (search the Library or paste a URL). */
export function References({
  fromType,
  fromId,
  projectId,
}: {
  fromType: string;
  fromId: string;
  projectId?: string | null;
}) {
  const { t } = useT();
  const s = useSession();
  const links = useLive(
    (ss) =>
      ss.db.links
        .where('fromId')
        .equals(fromId)
        .toArray()
        .then((ls) => ls.filter((l) => !l.deletedAt && l.type === 'references' && l.toType === 'library')),
    [fromId],
    [],
  );
  const items = useLive(
    async (ss) => (await ss.db.library.bulkGet(links.map((l) => l.toId))) as (LibraryItem | undefined)[],
    [links.map((l) => l.id).join()],
    [],
  );
  const [open, setOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {links.length === 0 && <div className="meta">{t('refs.none')}</div>}
      {links.length > 0 && (
        <div className="list">
          {links.map((l, i) => {
            const r = items[i];
            if (!r) return null;
            return (
              <div key={l.id} className="row static">
                <MediaThumb mediaId={r.mediaId} url={r.thumbUrl} alt="" />
                <div className="grow">
                  <Link to="/library/$id" params={{ id: r.id }} className="title">
                    {libraryTitle(r)}
                  </Link>
                  <div className="sub">
                    {t(`library.role.${r.role}`)} · {t(`library.kind.${r.kind}`)}
                    {l.note ? ` · ${l.note}` : ''}
                  </div>
                </div>
                {r.originalUrl && <ExtLink href={r.originalUrl} />}
                <IconButton label={t('refs.remove')} size="sm" onClick={() => void unlink(s, l.id)}>
                  <X size={14} />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
      <div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Link2 size={14} /> {t('refs.add')}
        </Button>
      </div>
      <RefPicker
        open={open}
        onClose={() => setOpen(false)}
        fromType={fromType}
        fromId={fromId}
        projectId={projectId}
      />
    </div>
  );
}

function RefPicker({
  open,
  onClose,
  fromType,
  fromId,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  fromType: string;
  fromId: string;
  projectId?: string | null;
}) {
  const { t } = useT();
  const s = useSession();
  const { search } = useApp();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; title: string; snippet: string }[]>([]);
  const recent = useLive((ss) => ss.db.library.orderBy('updatedAt').reverse().limit(12).toArray(), [], []);
  const url = safeHttpUrl(q.trim());
  useEffect(() => {
    let alive = true;
    if (q.trim().length > 1 && !url)
      void search.search(`${q} type:library`, 15).then((h) => alive && setHits(h));
    else setHits([]);
    return () => {
      alive = false;
    };
  }, [q, url, search]);
  const pick = async (id: string) => {
    await linkRecords(s, fromType, fromId, 'library', id, 'references');
    toast(t('refs.linked'));
    onClose();
  };
  const createFromUrl = async () => {
    if (!url) return;
    const p = parseUrl(url);
    const dup = (
      await s.db.library
        .where('canonicalUrl')
        .equals(p?.canonical ?? url)
        .toArray()
    ).find((x) => !x.deletedAt);
    if (dup) return pick(dup.id);
    const r = await create(s, 'library', {
      title: p ? displayTitleForUrl(p) : null,
      role: 'reference',
      kind: p?.kind === 'video' ? 'video' : 'link',
      originalUrl: url,
      canonicalUrl: p?.canonical ?? url,
      site: p?.host ?? null,
      thumbUrl: p?.thumbUrl ?? null,
      projectId: projectId ?? null,
    });
    await pick(r.id);
  };
  const list =
    q.trim() && !url
      ? hits.map((h) => ({ id: h.id, title: h.title, sub: h.snippet }))
      : recent
          .filter((r) => !r.deletedAt)
          .map((r) => ({
            id: r.id,
            title: libraryTitle(r),
            sub: `${t(`library.role.${r.role}`)} · ${t(`library.kind.${r.kind}`)}`,
          }));
  return (
    <Sheet open={open} onClose={onClose} title={t('refs.add')}>
      <input
        className="input"
        autoFocus
        placeholder={t('refs.search_placeholder')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={t('refs.search_placeholder')}
      />
      {url && (
        <Button variant="primary" onClick={() => void createFromUrl()}>
          <Plus size={14} /> {t('refs.save_link')}
        </Button>
      )}
      <div className="list">
        {list.length === 0 && <div className="row static meta">{t('common.nothing_found')}</div>}
        {list.map((r) => (
          <button key={r.id} type="button" className="row" onClick={() => void pick(r.id)}>
            <div className="grow">
              <div className="title">{r.title}</div>
              <div className="sub">{r.sub}</div>
            </div>
            <Check size={14} aria-hidden style={{ opacity: 0.4 }} />
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function TagEditor({
  value,
  onChange,
  labelKey = 'common.tag',
}: {
  value: string[] | undefined;
  onChange: (v: string[]) => void;
  labelKey?: string;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  const tags = value ?? [];
  const add = () => {
    const x = draft.trim().replace(/^#/, '');
    if (x && !tags.includes(x)) onChange([...tags, x]);
    setDraft('');
  };
  return (
    <div className="hstack" style={{ gap: 6 }}>
      {tags.map((x) => (
        <span key={x} className="tag">
          {x}
          <button
            type="button"
            aria-label={t('common.remove_item', { item: x })}
            onClick={() => onChange(tags.filter((y) => y !== x))}
            style={{
              border: 0,
              background: 'none',
              color: 'inherit',
              cursor: 'pointer',
              padding: '0 0 0 4px',
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="input plain"
        style={{ width: 150, minHeight: 28 }}
        placeholder={`+ ${t(labelKey)}`}
        aria-label={t('common.add_item', { item: t(labelKey) })}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

export function HistoryList({ recordId }: { recordId: string }) {
  const { t, fmt } = useT();
  const entries = useLive(
    (ss) =>
      ss.db.history
        .orderBy('at')
        .reverse()
        .limit(300)
        .toArray()
        .then((h) => h.filter((e) => e.ops.some((o) => o.id === recordId)).slice(0, 15)),
    [recordId],
    [],
  );
  if (!entries.length) return <div className="meta">{t('history.none')}</div>;
  return (
    <ul style={{ margin: 0, paddingLeft: 16 }} className="meta">
      {entries.map((e) => (
        <li key={e.id}>
          {e.actor === 'ai' ? '✧ ' : ''}
          {historyLabel(e.label, e.labelParams)} · {fmt.dateTime(e.at)}
          {e.undone ? ` (${t('history.undone')})` : ''}
        </li>
      ))}
    </ul>
  );
}

export function useNow(intervalMs = 60_000): number {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setN(Date.now()), intervalMs);
    return () => clearInterval(i);
  }, [intervalMs]);
  return n;
}

export function downloadText(name: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function useDebounced<T>(v: T, ms = 150): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const x = setTimeout(() => setD(v), ms);
    return () => clearTimeout(x);
  }, [v, ms]);
  return d;
}

export function sortByUpdated<T extends { updatedAt: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const isLive = <T extends { deletedAt?: string | null; archivedAt?: string | null }>(x: T) =>
  !x.deletedAt && !x.archivedAt;
export { nowIso, useMemo };

/** Built-in template names are shown localized while the user has not renamed them (stored value stays canonical). */
export function templateName(tpl: { id: string; name: string }): string {
  const builtin = DEFAULT_TEMPLATES.find((d) => d.id === tpl.id);
  return builtin && builtin.name === tpl.name ? t(`template.${tpl.id}`) : tpl.name;
}
