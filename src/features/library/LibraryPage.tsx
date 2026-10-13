import { Link, useNavigate } from '@tanstack/react-router';
import { FileText, Link2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { displayTitleForUrl, parseUrl, safeHttpUrl } from '../../core/url';
import type { LibraryItem } from '../../data/schema';
import { create } from '../../data/store';
import { Button, Chip, Empty, Sheet, Tabs } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { MediaThumb, ProjectSelect } from '../common';

type Role = 'all' | 'inspiration' | 'reference' | 'asset';
const PAGE = 120;

export function LibraryPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [q, setQ] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [unused, setUnused] = useState(false);
  const [archived, setArchived] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [add, setAdd] = useState(false);
  const items = useLive(
    (ss) => ss.db.library.orderBy('updatedAt').reverse().toArray(),
    [],
    [] as LibraryItem[],
  );
  const linkedIds = useLive(
    (ss) => ss.db.links.toArray().then((ls) => new Set(ls.filter((l) => !l.deletedAt).map((l) => l.toId))),
    [],
    new Set<string>(),
  );
  const list = useMemo(
    () =>
      items.filter(
        (r) =>
          !r.deletedAt &&
          (archived ? !!r.archivedAt : !r.archivedAt) &&
          (role === 'all' || r.role === role) &&
          (!project || r.projectId === project) &&
          (!unused || !linkedIds.has(r.id)) &&
          (!q ||
            `${r.title ?? ''} ${r.notes ?? ''} ${r.originalUrl ?? ''} ${r.whyRelevant ?? ''}`
              .toLowerCase()
              .includes(q.toLowerCase())),
      ),
    [items, role, project, unused, archived, q, linkedIds],
  );
  return (
    <div className="page">
      <PageHeader
        title="Library"
        sub="Research, references and assets — the original URL is always kept."
        actions={
          <Button variant="primary" onClick={() => setAdd(true)}>
            <Plus size={15} /> Add
          </Button>
        }
      />
      <div className="hstack" style={{ marginBottom: 12 }}>
        <Tabs
          label="Role"
          value={role}
          onChange={(v) => {
            setRole(v);
            setLimit(PAGE);
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'inspiration', label: 'Research' },
            { value: 'reference', label: 'References' },
            { value: 'asset', label: 'Assets' },
          ]}
        />
        <input
          className="input"
          style={{ maxWidth: 220 }}
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter library"
        />
        <div style={{ width: 180 }}>
          <ProjectSelect value={project} onChange={setProject} />
        </div>
        <Chip on={unused} onClick={() => setUnused((v) => !v)}>
          Unused
        </Chip>
        <Chip on={archived} onClick={() => setArchived((v) => !v)}>
          Archived
        </Chip>
        <span className="spacer" />
        <Tabs
          label="Layout"
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'list', label: 'List' },
          ]}
        />
      </div>
      {list.length === 0 ? (
        <Empty
          title={items.length ? 'Nothing matches' : 'Library is empty'}
          action={
            <Button variant="primary" onClick={() => setAdd(true)}>
              Save a link or note
            </Button>
          }
        >
          Save trends, posts, visual styles, references and assets. Links from Inbox land here when you triage
          them.
        </Empty>
      ) : view === 'grid' ? (
        <div className="lib-grid">
          {list.slice(0, limit).map((r) => (
            <Link key={r.id} to="/library/$id" params={{ id: r.id }} className="lib-card">
              <div className="lib-thumb">
                {r.mediaId || r.thumbUrl ? (
                  <MediaThumb mediaId={r.mediaId} url={r.thumbUrl} alt="" className="" />
                ) : r.kind === 'note' ? (
                  <FileText size={22} />
                ) : (
                  <Link2 size={22} />
                )}
              </div>
              <div className="body">
                <div
                  className="title"
                  style={{
                    fontWeight: 540,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.title || r.originalUrl || 'Untitled'}
                </div>
                <div className="meta">
                  {r.role === 'inspiration' ? 'research' : r.role} · {r.kind}
                  {r.site ? ` · ${r.site}` : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="list">
          {list.slice(0, limit).map((r) => (
            <Link key={r.id} to="/library/$id" params={{ id: r.id }} className="row">
              <MediaThumb mediaId={r.mediaId} url={r.thumbUrl} alt="" />
              <div className="grow">
                <div className="title">{r.title || r.originalUrl || 'Untitled'}</div>
                <div className="sub">
                  {r.role === 'inspiration' ? 'research' : r.role} · {r.kind}
                  {r.whyRelevant ? ` · ${r.whyRelevant}` : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {list.length > limit && (
        <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)} style={{ marginTop: 12 }}>
          Show more ({list.length - limit})
        </Button>
      )}
      <AddLibrary
        open={add}
        onClose={() => setAdd(false)}
        onCreated={(id) => void navigate({ to: '/library/$id', params: { id } })}
        defaultProject={project}
      />
    </div>
  );
}

function AddLibrary({
  open,
  onClose,
  onCreated,
  defaultProject,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  defaultProject: string | null;
}) {
  const s = useSession();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [role, setRole] = useState<LibraryItem['role']>('inspiration');
  const [projectId, setProjectId] = useState<string | null>(defaultProject);
  const save = async () => {
    const safe = url.trim()
      ? safeHttpUrl(/^https?:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`)
      : null;
    if (url.trim() && !safe) return toast('That does not look like a web address.', { kind: 'error' });
    const p = safe ? parseUrl(safe) : null;
    if (p) {
      const dup = (await s.db.library.where('canonicalUrl').equals(p.canonical).toArray()).find(
        (x) => !x.deletedAt,
      );
      if (
        dup &&
        !confirm(`You saved this link on ${new Date(dup.createdAt).toLocaleDateString()}. Save again?`)
      ) {
        onClose();
        onCreated(dup.id);
        return;
      }
    }
    const r = await create(s, 'library', {
      title: title.trim() || (p ? displayTitleForUrl(p) : notes.trim().slice(0, 80) || 'Note'),
      role,
      kind: p
        ? p.kind === 'video'
          ? 'video'
          : p.kind === 'account'
            ? 'account'
            : p.kind === 'post'
              ? 'post'
              : 'link'
        : 'note',
      originalUrl: safe,
      canonicalUrl: p?.canonical ?? null,
      site: p?.host ?? null,
      platformRef:
        p?.platform && p.platform !== 'web'
          ? {
              platform: p.platform,
              ...(p.externalId ? { externalId: p.externalId } : {}),
              ...(p.handle ? { handle: p.handle } : {}),
            }
          : null,
      thumbUrl: p?.thumbUrl ?? null,
      notes: notes.trim() || null,
      projectId,
    });
    setUrl('');
    setTitle('');
    setNotes('');
    onClose();
    onCreated(r.id);
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add to Library"
      footer={
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={!url.trim() && !notes.trim() && !title.trim()}
        >
          Save
        </Button>
      }
    >
      <div className="field">
        <label className="lbl" htmlFor="lurl">
          URL (optional)
        </label>
        <input
          id="lurl"
          className="input"
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />
      </div>
      <div className="field">
        <label className="lbl" htmlFor="ltitle">
          Title
        </label>
        <input
          id="ltitle"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Leave empty to use the link"
        />
      </div>
      <div className="field">
        <label className="lbl" htmlFor="lnotes">
          Notes / why it matters
        </label>
        <textarea
          id="lnotes"
          className="textarea"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="lbl" htmlFor="lrole">
            Role
          </label>
          <select
            id="lrole"
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as LibraryItem['role'])}
          >
            <option value="inspiration">Research / inspiration</option>
            <option value="reference">Reference (guides creation)</option>
            <option value="asset">Asset (used in production)</option>
          </select>
        </div>
        <div className="field">
          <span className="lbl">Project</span>
          <ProjectSelect value={projectId} onChange={setProjectId} />
        </div>
      </div>
      <p className="meta">
        Saga HQ does not fetch pages (no server). Titles for YouTube, TikTok, Instagram and X links are
        inferred locally.
      </p>
    </Sheet>
  );
}
