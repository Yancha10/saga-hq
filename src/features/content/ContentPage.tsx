import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIsPhone, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { setContentStatus } from '../../data/domain';
import {
  CONTENT_STATUS_LABEL,
  CONTENT_STATUSES,
  type Content,
  type ContentStatus as CS,
  PLATFORM_LABEL,
  PLATFORMS,
  type Platform,
} from '../../data/schema';
import { create } from '../../data/store';
import { fmtDay } from '../../rules/time';
import { Button, Chip, Empty, Progress, Tabs } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { ContentStatus, missingText, PlatformTags, ProjectSelect, RecordMenu, useProjects } from '../common';

type View = 'board' | 'list' | 'platform';
const COL_LIMIT = 50;

export function ContentPage() {
  const s = useSession();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const [view, setView] = useState<View>('board');
  const [project, setProject] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const projects = useProjects();
  const pName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const all = useLive((ss) => ss.db.content.orderBy('updatedAt').reverse().toArray(), [], [] as Content[]);
  const items = all.filter(
    (c) =>
      !c.deletedAt &&
      (archived ? !!c.archivedAt : !c.archivedAt) &&
      (!project || c.projectId === project) &&
      (!platform || c.platforms.includes(platform)) &&
      (!onlyBlocked || !!c._blocked) &&
      (!onlyMissing ||
        (c._missing ?? []).some((m) => ['cover', 'caption', 'coverText', 'hashtags'].includes(m))) &&
      (!q || c.title.toLowerCase().includes(q.toLowerCase())),
  );
  const newContent = async () => {
    const c = await create(s, 'content', {
      title: 'Untitled content',
      status: 'planned',
      formatTemplateId: 'reel',
      platforms: platform ? [platform] : [],
      projectId: project,
    });
    void navigate({ to: '/content/$id', params: { id: c.id } });
  };
  const move = async (c: Content, st: CS) => {
    if (c.status === st) return;
    if (st === 'ready' && (c._missing ?? []).filter((m) => m !== 'publishDate').length)
      toast(`Marked Ready with ${missingText(c)}`);
    await setContentStatus(s, c, st);
  };

  const card = (c: Content) => (
    <div
      key={c.id}
      className="card"
      draggable={!phone}
      onDragStart={(e) => {
        setDragId(c.id);
        e.dataTransfer.setData('text/plain', c.id);
      }}
      onDragEnd={() => setDragId(null)}
    >
      <div className="hstack" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <Link to="/content/$id" params={{ id: c.id }} className="title" style={{ flex: 1 }}>
          {c.title || 'Untitled'}
        </Link>
        <RecordMenu
          label={`Move ${c.title}`}
          items={CONTENT_STATUSES.filter((x) => x !== c.status).map((x) => ({
            id: x,
            label: `Move to ${CONTENT_STATUS_LABEL[x]}`,
            run: () => void move(c, x),
          }))}
        />
      </div>
      {c.status !== 'published' && c.status !== 'reviewed' && (
        <Progress value={c._readyPct ?? 0} label={`${c.title} readiness`} />
      )}
      <div className="metaRow">
        <ContentStatus c={c} />
        {c._nextPublishAt && (
          <span>
            {fmtDay(c._nextPublishAt, {
              weekday: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
        {c.projectId && pName.get(c.projectId) && <span className="tag">{pName.get(c.projectId)}</span>}
        <PlatformTags platforms={c.platforms} />
      </div>
      {missingText(c) && c.status !== 'planned' && (
        <div className="meta" style={{ fontSize: 11.5 }}>
          {missingText(c)}
        </div>
      )}
    </div>
  );

  const showBoard = view === 'board' && !phone;
  return (
    <div className="page" style={{ maxWidth: showBoard ? 'none' : undefined }}>
      <PageHeader
        title="Content"
        sub={`${items.length} items`}
        actions={
          <Button variant="primary" onClick={() => void newContent()}>
            <Plus size={15} /> New content
          </Button>
        }
      />
      <div className="hstack" style={{ marginBottom: 12 }}>
        {!phone && (
          <Tabs
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'board', label: 'Board' },
              { value: 'list', label: 'List' },
              { value: 'platform', label: 'By platform' },
            ]}
          />
        )}
        <input
          className="input"
          style={{ maxWidth: 200 }}
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter content"
        />
        <div style={{ width: 180 }}>
          <ProjectSelect value={project} onChange={setProject} />
        </div>
        <select
          className="select"
          style={{ width: 150 }}
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          aria-label="Platform"
        >
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
        <Chip on={onlyBlocked} onClick={() => setOnlyBlocked((v) => !v)}>
          Blocked
        </Chip>
        <Chip on={onlyMissing} onClick={() => setOnlyMissing((v) => !v)}>
          Missing packaging
        </Chip>
        <Chip on={archived} onClick={() => setArchived((v) => !v)}>
          Archived
        </Chip>
      </div>
      {items.length === 0 && (
        <Empty
          title={all.length ? 'Nothing matches' : 'No content yet'}
          action={
            <Button variant="primary" onClick={() => void newContent()}>
              Plan content
            </Button>
          }
        >
          {all.length
            ? 'Clear the filters to see everything.'
            : 'Each content item is one intended publication. Turn an idea into content, or start one here.'}
        </Empty>
      )}
      {items.length > 0 && showBoard && (
        <div className="board">
          {CONTENT_STATUSES.map((st) => {
            const col = items.filter((c) => c.status === st);
            const lim = expanded[st] ? col.length : COL_LIMIT;
            return (
              <section
                key={st}
                className={`col ${overCol === st ? 'drop' : ''}`}
                aria-label={CONTENT_STATUS_LABEL[st]}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(st);
                }}
                onDragLeave={() => setOverCol(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverCol(null);
                  const c = items.find((x) => x.id === (dragId ?? e.dataTransfer.getData('text/plain')));
                  if (c) void move(c, st);
                }}
              >
                <div className="col-head">
                  {CONTENT_STATUS_LABEL[st]} <span className="meta num">{col.length}</span>
                </div>
                <div className="col-body">
                  {col.slice(0, lim).map(card)}
                  {col.length > lim && (
                    <button
                      type="button"
                      className="more-link"
                      style={{ border: 0, background: 'none', cursor: 'pointer' }}
                      onClick={() => setExpanded((x) => ({ ...x, [st]: true }))}
                    >
                      +{col.length - lim} more
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {items.length > 0 && !showBoard && view !== 'platform' && (
        <div className="stack">
          {CONTENT_STATUSES.map((st) => {
            const col = items.filter((c) => c.status === st);
            if (!col.length) return null;
            const lim = expanded[st] ? col.length : COL_LIMIT;
            return (
              <section key={st} aria-label={CONTENT_STATUS_LABEL[st]}>
                <h4 style={{ margin: '8px 0' }}>
                  {CONTENT_STATUS_LABEL[st]} · {col.length}
                </h4>
                <div className="list">
                  {col.slice(0, lim).map((c) => (
                    <Link key={c.id} to="/content/$id" params={{ id: c.id }} className="row">
                      <div className="grow">
                        <div className="title">{c.title || 'Untitled'}</div>
                        <div className="sub">
                          {[
                            c.projectId && pName.get(c.projectId),
                            c._nextPublishAt &&
                              fmtDay(c._nextPublishAt, {
                                weekday: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              }),
                            missingText(c),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <ContentStatus c={c} />
                    </Link>
                  ))}
                  {col.length > lim && (
                    <button
                      type="button"
                      className="more-link"
                      style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }}
                      onClick={() => setExpanded((x) => ({ ...x, [st]: true }))}
                    >
                      +{col.length - lim} more
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {items.length > 0 && view === 'platform' && !phone && (
        <div className="board">
          {PLATFORMS.filter((p) => items.some((c) => c.platforms.includes(p))).map((p) => (
            <section key={p} className="col" aria-label={PLATFORM_LABEL[p]}>
              <div className="col-head">{PLATFORM_LABEL[p]}</div>
              <div className="col-body">
                {items
                  .filter((c) => c.platforms.includes(p))
                  .slice(0, COL_LIMIT)
                  .map(card)}
              </div>
            </section>
          ))}
          {items.some((c) => !c.platforms.length) && (
            <section className="col" aria-label="No platform">
              <div className="col-head">No platform</div>
              <div className="col-body">
                {items
                  .filter((c) => !c.platforms.length)
                  .slice(0, COL_LIMIT)
                  .map(card)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
