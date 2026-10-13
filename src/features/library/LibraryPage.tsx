import { Link, useNavigate } from '@tanstack/react-router';
import { FileText, Link2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { displayTitleForUrl, parseUrl, safeHttpUrl } from '../../core/url';
import type { LibraryItem } from '../../data/schema';
import { create } from '../../data/store';
import { fmt, t, useT } from '../../i18n';
import { Button, Chip, Empty, Sheet, Tabs } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { libraryTitle, MediaThumb, ProjectSelect } from '../common';

type Role = 'all' | 'inspiration' | 'reference' | 'asset';
const PAGE = 120;

export function LibraryPage() {
  useT();
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
        title={t('nav.library')}
        sub={t('library.sub')}
        actions={
          <Button variant="primary" onClick={() => setAdd(true)}>
            <Plus size={15} /> {t('common.add')}
          </Button>
        }
      />
      <div className="hstack filters" style={{ marginBottom: 12 }}>
        <Tabs
          label={t('library.role_label')}
          value={role}
          onChange={(v) => {
            setRole(v);
            setLimit(PAGE);
          }}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'inspiration', label: t('library.tab.inspiration') },
            { value: 'reference', label: t('library.tab.reference') },
            { value: 'asset', label: t('library.tab.asset') },
          ]}
        />
        <input
          className="input"
          style={{ maxWidth: 220 }}
          placeholder={t('common.filter_ellipsis')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('library.filter_aria')}
        />
        <div style={{ width: 180 }}>
          <ProjectSelect value={project} onChange={setProject} />
        </div>
        <Chip on={unused} onClick={() => setUnused((v) => !v)}>
          {t('library.unused')}
        </Chip>
        <Chip on={archived} onClick={() => setArchived((v) => !v)}>
          {t('common.archived')}
        </Chip>
        <span className="spacer" />
        <Tabs
          label={t('library.layout')}
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: t('library.grid') },
            { value: 'list', label: t('content.view.list') },
          ]}
        />
      </div>
      {list.length === 0 ? (
        <Empty
          title={items.length ? t('common.nothing_matches') : t('library.empty')}
          action={
            <Button variant="primary" onClick={() => setAdd(true)}>
              {t('library.save_link_note')}
            </Button>
          }
        >
          {t('library.empty_body')}
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
                  {libraryTitle(r)}
                </div>
                <div className="meta">
                  {t(`library.role.${r.role}`)} · {t(`library.kind.${r.kind}`)}
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
                <div className="title">{libraryTitle(r)}</div>
                <div className="sub">
                  {t(`library.role.${r.role}`)} · {t(`library.kind.${r.kind}`)}
                  {r.whyRelevant ? ` · ${r.whyRelevant}` : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {list.length > limit && (
        <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)} style={{ marginTop: 12 }}>
          {t('library.show_more', { n: list.length - limit })}
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
  useT();
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
    if (url.trim() && !safe) return toast(t('library.bad_url'), { kind: 'error' });
    const p = safe ? parseUrl(safe) : null;
    if (p) {
      const dup = (await s.db.library.where('canonicalUrl').equals(p.canonical).toArray()).find(
        (x) => !x.deletedAt,
      );
      if (dup && !confirm(t('library.dup_confirm', { date: fmt.date(dup.createdAt) }))) {
        onClose();
        onCreated(dup.id);
        return;
      }
    }
    const r = await create(s, 'library', {
      title: title.trim() || (p ? displayTitleForUrl(p) : notes.trim().slice(0, 80)),
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
      title={t('library.add_title')}
      footer={
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={!url.trim() && !notes.trim() && !title.trim()}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="field">
        <label className="lbl" htmlFor="lurl">
          {t('library.url_optional')}
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
          {t('common.title')}
        </label>
        <input
          id="ltitle"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('library.title_placeholder')}
        />
      </div>
      <div className="field">
        <label className="lbl" htmlFor="lnotes">
          {t('library.notes_why')}
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
            {t('library.role_label')}
          </label>
          <select
            id="lrole"
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as LibraryItem['role'])}
          >
            <option value="inspiration">{t('library.role_opt.inspiration')}</option>
            <option value="reference">{t('library.role_opt.reference')}</option>
            <option value="asset">{t('library.role_opt.asset')}</option>
          </select>
        </div>
        <div className="field">
          <span className="lbl">{t('common.project')}</span>
          <ProjectSelect value={projectId} onChange={setProjectId} />
        </div>
      </div>
      <p className="meta">{t('library.no_fetch')}</p>
    </Sheet>
  );
}
