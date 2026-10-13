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
import { MISSING_LABEL, SECTION_LABEL } from '../data/derive';
import { linkRecords, toggleTask, unlink } from '../data/domain';
import {
  CONTENT_STATUS_LABEL,
  type Content,
  type EntityTable,
  type LibraryItem,
  PLATFORM_LABEL,
  PLATFORMS,
  type Platform,
  type Project,
  type Task,
} from '../data/schema';
import { archive, create, restore, trash, update } from '../data/store';
import { mediaUrl } from '../media/store';
import { fmtDay, relDays } from '../rules/time';
import { AutoText, Button, Chip, IconButton, Pill, Sheet } from '../ui/kit';

export function ContentStatus({ c }: { c: Content }) {
  if (c._blocked)
    return (
      <Pill tone="warn" dot>
        Blocked
      </Pill>
    );
  const late =
    c._nextPublishAt && Date.parse(c._nextPublishAt) < Date.now() - 3600_000 && c.status !== 'published';
  if (late)
    return (
      <Pill tone="danger" dot>
        Late
      </Pill>
    );
  const tone = c.status === 'ready' ? 'ok' : c.status === 'scheduled' ? 'accent' : undefined;
  return (
    <Pill tone={tone} dot={!!tone}>
      {CONTENT_STATUS_LABEL[c.status]}
      {c.status === 'producing' && c._stage
        ? ` · ${SECTION_LABEL[c._stage as keyof typeof SECTION_LABEL]}`
        : ''}
    </Pill>
  );
}

export function missingText(c: Content): string {
  const m = (c._missing ?? []).filter((k) => k !== 'publishDate');
  return m.length ? `missing ${m.map((k) => MISSING_LABEL[k as keyof typeof MISSING_LABEL]).join(', ')}` : '';
}

export function PlatformTags({ platforms }: { platforms: Platform[] | undefined }) {
  if (!platforms?.length) return null;
  return (
    <>
      {platforms.map((p) => (
        <span key={p} className="tag">
          {PLATFORM_LABEL[p]}
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
  return (
    <div className="chips" role="group" aria-label="Platforms">
      {PLATFORMS.map((p) => (
        <Chip
          key={p}
          on={value.includes(p)}
          onClick={() => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p])}
        >
          {PLATFORM_LABEL[p]}
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
  const projects = useProjects();
  return (
    <select
      id={id}
      className="select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={id ? undefined : 'Project'}
    >
      {includeNone && <option value="">No project</option>}
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

export function ProjectName({ id }: { id: string | null | undefined }) {
  const p = useLive((s) => (id ? s.db.projects.get(id) : undefined), [id], undefined);
  if (!id || !p || p.deletedAt) return null;
  return <span className="tag">{p.name}</span>;
}

export function TaskRow({ t, showParent = true }: { t: Task; showParent?: boolean }) {
  const s = useSession();
  const done = t.status === 'done';
  const overdue = !done && t.dueAt && Date.parse(t.dueAt) < new Date().setHours(0, 0, 0, 0);
  const parent = useLive(
    async (ss) => (showParent && t.contentId ? ss.db.content.get(t.contentId) : undefined),
    [t.contentId, showParent],
    undefined,
  );
  return (
    <div className="row static">
      <label className="check" style={{ minHeight: 0 }}>
        <input
          type="checkbox"
          checked={done}
          onChange={(e) => void toggleTask(s, t.id, e.target.checked)}
          aria-label={`Mark “${t.title}” ${done ? 'not done' : 'done'}`}
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
          {t.title}
        </div>
        <div className="sub hstack" style={{ gap: 6 }}>
          {t.isBlocker && !done && <Pill tone="warn">blocker</Pill>}
          {t.kind === 'decision' && <Pill tone="accent">decision</Pill>}
          {t.status === 'doing' && <Pill>doing</Pill>}
          {t.dueAt && (
            <span style={{ color: overdue ? 'var(--danger)' : undefined }}>due {relDays(t.dueAt)}</span>
          )}
          {parent && (
            <Link to="/content/$id" params={{ id: parent.id }} className="tag">
              {truncate(parent.title, 40)}
            </Link>
          )}
        </div>
      </div>
      {!done && t.status !== 'doing' && (
        <Button size="sm" variant="ghost" onClick={() => void update(s, 'tasks', t.id, { status: 'doing' })}>
          Start
        </Button>
      )}
      <TaskMenu t={t} />
    </div>
  );
}

function TaskMenu({ t }: { t: Task }) {
  const s = useSession();
  const [edit, setEdit] = useState(false);
  return (
    <>
      <RecordMenu
        label={`Actions for ${t.title}`}
        items={[
          { id: 'edit', label: 'Edit…', run: () => setEdit(true) },
          {
            id: 'blocker',
            label: t.isBlocker ? 'Not a blocker' : 'Mark as blocker',
            run: () => void update(s, 'tasks', t.id, { isBlocker: !t.isBlocker }),
          },
          {
            id: 'trash',
            label: 'Move to Trash',
            run: () =>
              void trash(s, 'tasks', t.id).then(() =>
                toast('Task moved to Trash', {
                  action: { label: 'Undo', run: () => void restore(s, 'tasks', t.id) },
                }),
              ),
          },
        ]}
      />
      <TaskEditor open={edit} onClose={() => setEdit(false)} task={t} />
    </>
  );
}

export function TaskEditor({ open, onClose, task }: { open: boolean; onClose: () => void; task: Task }) {
  const s = useSession();
  return (
    <Sheet open={open} onClose={onClose} title="Edit task" footer={<Button onClick={onClose}>Done</Button>}>
      <AutoText
        value={task.title}
        onSave={(v) =>
          v.trim() && update(s, 'tasks', task.id, { title: v.trim() }, { coalesceKey: `t:${task.id}:title` })
        }
        ariaLabel="Title"
        className="title"
      />
      <div className="form-grid">
        <div className="field">
          <label className="lbl" htmlFor="tdue">
            Due
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
            Priority
          </label>
          <select
            id="tprio"
            className="select"
            value={task.priority ?? ''}
            onChange={(e) =>
              void update(s, 'tasks', task.id, { priority: (e.target.value || null) as Task['priority'] })
            }
          >
            <option value="">None</option>
            <option value="low">Low</option>
            <option value="med">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="test">
            Estimate (min)
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
            Kind
          </label>
          <select
            id="tkind"
            className="select"
            value={task.kind}
            onChange={(e) => void update(s, 'tasks', task.id, { kind: e.target.value as Task['kind'] })}
          >
            <option value="task">Task</option>
            <option value="decision">Decision</option>
          </select>
        </div>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={!!task.hardDeadline}
          onChange={(e) => void update(s, 'tasks', task.id, { hardDeadline: e.target.checked })}
        />{' '}
        Hard deadline
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={task.isBlocker}
          onChange={(e) => void update(s, 'tasks', task.id, { isBlocker: e.target.checked })}
        />{' '}
        Blocks its content/project
      </label>
      <div className="field">
        <span className="lbl">Project</span>
        <ProjectSelect
          value={task.projectId}
          onChange={(v) => void update(s, 'tasks', task.id, { projectId: v })}
        />
      </div>
      {task.kind === 'decision' && (
        <div className="field">
          <span className="lbl">Decision / resolution</span>
          <AutoText
            multiline
            value={task.resolution}
            onSave={(v) =>
              update(s, 'tasks', task.id, { resolution: v || null }, { coalesceKey: `t:${task.id}:res` })
            }
            ariaLabel="Resolution"
          />
        </div>
      )}
      <div className="field">
        <span className="lbl">Notes</span>
        <AutoText
          multiline
          value={task.notes}
          onSave={(v) =>
            update(s, 'tasks', task.id, { notes: v || null }, { coalesceKey: `t:${task.id}:notes` })
          }
          ariaLabel="Notes"
        />
      </div>
    </Sheet>
  );
}

export function QuickTask({
  parent,
  placeholder = 'Add a task…',
}: {
  parent?: { contentId?: string; projectId?: string | null; ideaId?: string };
  placeholder?: string;
}) {
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
        placeholder={placeholder}
        aria-label="New task title"
      />
      {parent?.contentId && (
        <label className="check meta" style={{ minHeight: 0 }}>
          <input type="checkbox" checked={blocker} onChange={(e) => setBlocker(e.target.checked)} /> blocker
        </label>
      )}
      {v && (
        <Button size="sm" type="submit">
          Add
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
      ? { id: 'unarchive', label: 'Unarchive', run: () => void archive(s, table, rec.id, false) }
      : {
          id: 'archive',
          label: 'Archive',
          run: () =>
            void archive(s, table, rec.id).then(() =>
              toast('Archived', {
                action: { label: 'Undo', run: () => void archive(s, table, rec.id, false) },
              }),
            ),
        },
    rec.deletedAt
      ? { id: 'restore', label: 'Restore from Trash', run: () => void restore(s, table, rec.id) }
      : {
          id: 'trash',
          label: 'Move to Trash',
          danger: true,
          run: () =>
            void trash(s, table, rec.id).then(() => {
              toast('Moved to Trash (kept 30 days)', {
                action: { label: 'Undo', run: () => void restore(s, table, rec.id) },
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
  const s = useSession();
  if (rec.deletedAt)
    return (
      <div
        className="banner warning"
        style={{ borderRadius: 8, border: '1px solid var(--line)', marginBottom: 12 }}
      >
        <Trash2 size={16} aria-hidden /> In Trash since {fmtDay(rec.deletedAt)}. It will be deleted
        permanently after 30 days.
        <span className="spacer" />
        <Button size="sm" onClick={() => void restore(s, table, rec.id)}>
          <Undo2 size={14} /> Restore
        </Button>
      </div>
    );
  if (rec.archivedAt)
    return (
      <div
        className="banner info"
        style={{ borderRadius: 8, border: '1px solid var(--line)', marginBottom: 12 }}
      >
        <Archive size={16} aria-hidden /> Archived {fmtDay(rec.archivedAt)} — kept for history, hidden from
        active views.
        <span className="spacer" />
        <Button size="sm" onClick={() => void archive(s, table, rec.id, false)}>
          <ArchiveRestore size={14} /> Unarchive
        </Button>
      </div>
    );
  return null;
}

/** Shows conflict copies kept when two devices edited the same long text concurrently. */
export function ConflictNotice({ recordId, table }: { recordId: string; table: EntityTable }) {
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
        Edited on two devices at the same time — the other version of{' '}
        {conflicts.map((c) => c.field).join(', ')} was kept so nothing is lost.
        <span className="spacer" />
        <Button size="sm" onClick={() => setOpen(true)}>
          Compare
        </Button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Other versions" wide>
        {conflicts.map((c) => (
          <div key={c.id} className="box">
            <div className="hstack">
              <strong>{c.field}</strong>
              <span className="meta">kept {fmtDay(c.at)}</span>
            </div>
            <pre className="json">{String(c.value ?? '')}</pre>
            <div className="hstack">
              <Button
                size="sm"
                onClick={() =>
                  void update(s, table, recordId, { [c.field]: c.value } as never, {
                    label: 'Use other version',
                  }).then(() => s.db.conflicts.update(c.id, { resolved: true }))
                }
              >
                Use this version
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void navigator.clipboard?.writeText(String(c.value ?? ''))}
              >
                Copy
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void s.db.conflicts.update(c.id, { resolved: true })}
              >
                Dismiss
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
      {links.length === 0 && <div className="meta">No references yet.</div>}
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
                    {r.title || r.originalUrl || 'Untitled'}
                  </Link>
                  <div className="sub">
                    {r.role} · {r.kind}
                    {l.note ? ` · ${l.note}` : ''}
                  </div>
                </div>
                {r.originalUrl && <ExtLink href={r.originalUrl}>{''}</ExtLink>}
                <IconButton label="Remove reference" size="sm" onClick={() => void unlink(s, l.id)}>
                  <X size={14} />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
      <div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Link2 size={14} /> Add reference
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
    toast('Reference linked');
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
      title: p ? displayTitleForUrl(p) : url,
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
            title: r.title || r.originalUrl || 'Untitled',
            sub: `${r.role} · ${r.kind}`,
          }));
  return (
    <Sheet open={open} onClose={onClose} title="Add reference">
      <input
        className="input"
        autoFocus
        placeholder="Search the Library or paste a URL"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search references or paste URL"
      />
      {url && (
        <Button variant="primary" onClick={() => void createFromUrl()}>
          <Plus size={14} /> Save link as reference
        </Button>
      )}
      <div className="list">
        {list.length === 0 && <div className="row static meta">Nothing found.</div>}
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
  label = 'Tags',
}: {
  value: string[] | undefined;
  onChange: (v: string[]) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState('');
  const tags = value ?? [];
  const add = () => {
    const t = draft.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };
  return (
    <div className="hstack" style={{ gap: 6 }}>
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
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
        style={{ width: 140, minHeight: 28 }}
        placeholder={`+ ${label.toLowerCase()}`}
        aria-label={`Add ${label.toLowerCase()}`}
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
  if (!entries.length) return <div className="meta">No local history yet.</div>;
  return (
    <ul style={{ margin: 0, paddingLeft: 16 }} className="meta">
      {entries.map((e) => (
        <li key={e.id}>
          {e.actor === 'ai' ? '✧ ' : ''}
          {e.label} ·{' '}
          {new Date(e.at).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {e.undone ? ' (undone)' : ''}
        </li>
      ))}
    </ul>
  );
}

export function useNow(intervalMs = 60_000): number {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), intervalMs);
    return () => clearInterval(t);
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
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function sortByUpdated<T extends { updatedAt: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const isLive = <T extends { deletedAt?: string | null; archivedAt?: string | null }>(x: T) =>
  !x.deletedAt && !x.archivedAt;
export { nowIso, useMemo };
