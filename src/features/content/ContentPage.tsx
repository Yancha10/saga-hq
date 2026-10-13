import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIsPhone, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { setContentStatus } from '../../data/domain';
import {
  CONTENT_STATUSES,
  type Content,
  type ContentStatus as CS,
  PLATFORMS,
  type Platform,
} from '../../data/schema';
import { create } from '../../data/store';
import { t, useT } from '../../i18n';
import { platformName } from '../../i18n/render';
import { fmtDay } from '../../rules/time';
import { Button, Chip, Empty, Progress, Tabs } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import {
  ContentStatus,
  contentTitle,
  missingText,
  PlatformTags,
  ProjectSelect,
  RecordMenu,
  useProjects,
} from '../common';

type View = 'board' | 'list' | 'platform';
const COL_LIMIT = 50;

export function ContentPage() {
  useT();
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
      title: '',
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
      toast(t('content.marked_ready_with', { missing: missingText(c) }));
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
          {contentTitle(c)}
        </Link>
        <RecordMenu
          label={t('content.move_item', { title: contentTitle(c) })}
          items={CONTENT_STATUSES.filter((x) => x !== c.status).map((x) => ({
            id: x,
            label: t('content.move_to', { status: t(`content.status.${x}`) }),
            run: () => void move(c, x),
          }))}
        />
      </div>
      {c.status !== 'published' && c.status !== 'reviewed' && (
        <Progress value={c._readyPct ?? 0} label={t('content.readiness_of', { title: contentTitle(c) })} />
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
        title={t('nav.content')}
        sub={t('common.n_items', { count: items.length })}
        actions={
          <Button variant="primary" onClick={() => void newContent()}>
            <Plus size={15} /> {t('content.new')}
          </Button>
        }
      />
      <div className="hstack" style={{ marginBottom: 12 }}>
        {!phone && (
          <Tabs
            label={t('common.view')}
            value={view}
            onChange={setView}
            options={[
              { value: 'board', label: t('content.view.board') },
              { value: 'list', label: t('content.view.list') },
              { value: 'platform', label: t('content.view.platform') },
            ]}
          />
        )}
        <input
          className="input"
          style={{ maxWidth: 200 }}
          placeholder={t('common.filter_ellipsis')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('content.filter_aria')}
        />
        <div style={{ width: 180 }}>
          <ProjectSelect value={project} onChange={setProject} />
        </div>
        <select
          className="select"
          style={{ width: 'auto', maxWidth: '100%' }}
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          aria-label={t('common.platform')}
        >
          <option value="">{t('common.all_platforms')}</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {platformName(p)}
            </option>
          ))}
        </select>
        <Chip on={onlyBlocked} onClick={() => setOnlyBlocked((v) => !v)}>
          {t('status.blocked')}
        </Chip>
        <Chip on={onlyMissing} onClick={() => setOnlyMissing((v) => !v)}>
          {t('content.missing_packaging')}
        </Chip>
        <Chip on={archived} onClick={() => setArchived((v) => !v)}>
          {t('common.archived')}
        </Chip>
      </div>
      {items.length === 0 && (
        <Empty
          title={all.length ? t('common.nothing_matches') : t('content.none')}
          action={
            <Button variant="primary" onClick={() => void newContent()}>
              {t('today.plan_content')}
            </Button>
          }
        >
          {all.length ? t('common.clear_filters') : t('content.empty_body')}
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
                aria-label={t(`content.status.${st}`)}
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
                  {t(`content.status.${st}`)} <span className="meta num">{col.length}</span>
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
                      {t('common.n_more', { count: col.length - lim })}
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
              <section key={st} aria-label={t(`content.status.${st}`)}>
                <h4 style={{ margin: '8px 0' }}>
                  {t(`content.status.${st}`)} · {col.length}
                </h4>
                <div className="list">
                  {col.slice(0, lim).map((c) => (
                    <Link key={c.id} to="/content/$id" params={{ id: c.id }} className="row">
                      <div className="grow">
                        <div className="title">{contentTitle(c)}</div>
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
                      {t('common.n_more', { count: col.length - lim })}
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
            <section key={p} className="col" aria-label={platformName(p)}>
              <div className="col-head">{platformName(p)}</div>
              <div className="col-body">
                {items
                  .filter((c) => c.platforms.includes(p))
                  .slice(0, COL_LIMIT)
                  .map(card)}
              </div>
            </section>
          ))}
          {items.some((c) => !c.platforms.length) && (
            <section className="col" aria-label={t('content.no_platform')}>
              <div className="col-head">{t('content.no_platform')}</div>
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
