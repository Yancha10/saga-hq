import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useLive, useSession } from '../../app/context';
import { LIBRARY_KINDS, type LibraryItem } from '../../data/schema';
import { update } from '../../data/store';
import { mediaUrl } from '../../media/store';
import { AutoText, Empty, Section } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import {
  ArchivedNotice,
  archiveTrashItems,
  ExtLink,
  HistoryList,
  MediaThumb,
  ProjectSelect,
  RecordMenu,
  TagEditor,
} from '../common';

export function LibraryDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const s = useSession();
  const navigate = useNavigate();
  const r = useLive((ss) => ss.db.library.get(id), [id], undefined);
  const media = useLive(
    async (ss) => (r?.mediaId ? ss.db.media.get(r.mediaId) : undefined),
    [r?.mediaId],
    undefined,
  );
  const usedBy = useLive(
    async (ss) => {
      const links = (await ss.db.links.where('toId').equals(id).toArray()).filter((l) => !l.deletedAt);
      const out: { id: string; type: string; title: string }[] = [];
      for (const l of links) {
        const t =
          l.fromType === 'content'
            ? 'content'
            : l.fromType === 'idea'
              ? 'ideas'
              : l.fromType === 'project'
                ? 'projects'
                : null;
        if (!t) continue;
        const rec = (await ss.db.table(t).get(l.fromId)) as
          | { title?: string; name?: string; deletedAt?: string }
          | undefined;
        if (rec && !rec.deletedAt)
          out.push({ id: l.fromId, type: l.fromType, title: rec.title ?? rec.name ?? '' });
      }
      return out;
    },
    [id],
    [],
  );
  const [full, setFull] = useState<string | null>(null);
  useEffect(() => {
    if (r?.mediaId && media?.mime.startsWith('audio/')) void mediaUrl(s, r.mediaId, 'full').then(setFull);
    else if (r?.mediaId) void mediaUrl(s, r.mediaId, 'full').then(setFull);
  }, [r?.mediaId, media?.mime, s]);
  if (r === undefined) return <div className="page" aria-busy="true" />;
  if (!r)
    return (
      <div className="page">
        <Empty title="Not found" />
      </div>
    );
  const up = (patch: Partial<LibraryItem>, key?: string) =>
    update(s, 'library', r.id, patch, key ? { coalesceKey: `lib:${r.id}:${key}` } : undefined);
  return (
    <div className="page narrow" style={{ maxWidth: 1100 }}>
      <PageHeader
        back
        title={r.title || 'Library item'}
        actions={
          <RecordMenu
            label="Actions"
            items={[
              {
                id: 'promote',
                label: r.role === 'asset' ? 'Mark as reference' : 'Promote to asset',
                run: () => void up({ role: r.role === 'asset' ? 'reference' : 'asset' }),
              },
              ...archiveTrashItems(s, 'library', r, () => void navigate({ to: '/library' })),
            ]}
          />
        }
      />
      <ArchivedNotice rec={r} table="library" />
      <div className="grid2">
        <div className="stack">
          <AutoText
            value={r.title}
            onSave={(v) => up({ title: v || null }, 'title')}
            className="title plain"
            ariaLabel="Title"
          />
          {r.originalUrl && (
            <div className="box">
              <span className="lbl">Original URL (kept as captured)</span>
              <ExtLink href={r.originalUrl}>{r.originalUrl}</ExtLink>
              {r.platformRef && (
                <span className="meta">
                  {r.platformRef.platform}
                  {r.platformRef.handle ? ` · ${r.platformRef.handle}` : ''}
                  {r.platformRef.externalId ? ` · id ${r.platformRef.externalId}` : ''}
                </span>
              )}
            </div>
          )}
          {(r.mediaId || r.thumbUrl) && (
            <div>
              {media?.mime.startsWith('audio/') && full ? (
                // biome-ignore lint/a11y/useMediaCaption: user voice notes have no captions
                <audio controls src={full} style={{ width: '100%' }} />
              ) : media?.mime.startsWith('video/') && full ? (
                // biome-ignore lint/a11y/useMediaCaption: user clips have no captions
                <video controls src={full} style={{ width: '100%', borderRadius: 8 }} />
              ) : full ? (
                <img
                  src={full}
                  alt={r.title ?? 'Saved media'}
                  style={{ borderRadius: 8, maxHeight: 480, objectFit: 'contain' }}
                />
              ) : (
                <MediaThumb mediaId={r.mediaId} url={r.thumbUrl} alt={r.title ?? ''} className="" />
              )}
            </div>
          )}
          <div className="field">
            <span className="lbl">Why it’s relevant</span>
            <AutoText
              multiline
              value={r.whyRelevant}
              onSave={(v) => up({ whyRelevant: v || null }, 'why')}
              ariaLabel="Why relevant"
              rows={2}
            />
          </div>
          <div className="field">
            <span className="lbl">Notes</span>
            <AutoText
              multiline
              value={r.notes}
              onSave={(v) => up({ notes: v || null }, 'notes')}
              ariaLabel="Notes"
              rows={5}
            />
          </div>
        </div>
        <div className="stack">
          <div className="box">
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label className="lbl" htmlFor="lrole2">
                  Role
                </label>
                <select
                  id="lrole2"
                  className="select"
                  value={r.role}
                  onChange={(e) => void up({ role: e.target.value as LibraryItem['role'] })}
                >
                  <option value="inspiration">Research</option>
                  <option value="reference">Reference</option>
                  <option value="asset">Asset</option>
                </select>
              </div>
              <div className="field">
                <label className="lbl" htmlFor="lkind2">
                  Kind
                </label>
                <select
                  id="lkind2"
                  className="select"
                  value={r.kind}
                  onChange={(e) => void up({ kind: e.target.value as LibraryItem['kind'] })}
                >
                  {LIBRARY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <span className="lbl">Project</span>
              <ProjectSelect value={r.projectId} onChange={(v) => void up({ projectId: v })} />
            </div>
            <div className="field">
              <span className="lbl">Source / author</span>
              <AutoText value={r.author} onSave={(v) => up({ author: v || null })} ariaLabel="Author" />
            </div>
            <div className="field">
              <span className="lbl">Tags</span>
              <TagEditor value={r.tags} onChange={(v) => void up({ tags: v })} />
            </div>
            <span className="meta">
              Captured {new Date(r.createdAt).toLocaleString()}
              {r.origin?.source === 'capture' ? ' from Inbox' : ''}
            </span>
          </div>
          <Section title="Used by" count={usedBy.length}>
            {usedBy.length ? (
              <div className="list">
                {usedBy.map((u) => (
                  <Link
                    key={u.id}
                    to={
                      u.type === 'content'
                        ? `/content/${u.id}`
                        : u.type === 'idea'
                          ? `/ideas/${u.id}`
                          : `/projects/${u.id}`
                    }
                    className="row"
                  >
                    <div className="grow title">{u.title}</div>
                    <span className="tag">{u.type}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="meta">Not linked yet. Add it as a reference from an idea or content item.</div>
            )}
          </Section>
          <details>
            <summary className="meta">History</summary>
            <HistoryList recordId={r.id} />
          </details>
        </div>
      </div>
    </div>
  );
}
