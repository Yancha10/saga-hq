import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Sparkles, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp, useLive, useSession } from '../../app/context';
import {
  CONTENT_STATUSES,
  type Content,
  type HQEvent,
  type Idea,
  type Learning,
  type LibraryItem,
  type Project,
  type Publication,
  type Snapshot,
  type Task,
} from '../../data/schema';
import { create, update } from '../../data/store';
import { fmt, t, useT } from '../../i18n';
import { platformName, reasonText } from '../../i18n/render';
import { scoreCandidates } from '../../rules/priority';
import { DAY, fmtDay } from '../../rules/time';
import { AutoText, Button, Empty, Pill, Section, Tabs } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import {
  ArchivedNotice,
  archiveTrashItems,
  ContentStatus,
  contentTitle,
  libraryTitle,
  missingText,
  QuickTask,
  RecordMenu,
  TaskRow,
} from '../common';

type Tab = 'overview' | 'content' | 'ideas' | 'tasks' | 'library' | 'results';

export function ProjectHome() {
  useT();
  const { id } = useParams({ strict: false }) as { id: string };
  const s = useSession();
  const navigate = useNavigate();
  const { toggleSecretary } = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  const d = useLive(
    async (ss) => {
      const project = await ss.db.projects.get(id);
      const [content, ideas, tasks, library, events, learnings] = await Promise.all([
        ss.db.content.where('projectId').equals(id).toArray(),
        ss.db.ideas.where('projectId').equals(id).toArray(),
        ss.db.tasks.where('projectId').equals(id).toArray(),
        ss.db.library.where('projectId').equals(id).toArray(),
        ss.db.events.where('projectId').equals(id).toArray(),
        ss.db.learnings.where('status').equals('active').toArray(),
      ]);
      const cids = content.map((c) => c.id);
      const pubs = cids.length ? await ss.db.publications.where('contentId').anyOf(cids).toArray() : [];
      const snaps = cids.length ? await ss.db.snapshots.where('contentId').anyOf(cids).toArray() : [];
      const contentTasks = cids.length ? await ss.db.tasks.where('contentId').anyOf(cids).toArray() : [];
      const live = <T extends { deletedAt?: string | null }>(x: T[]) => x.filter((r) => !r.deletedAt);
      return {
        project,
        content: live(content),
        ideas: live(ideas),
        tasks: live([...tasks, ...contentTasks.filter((ct) => !tasks.some((x) => x.id === ct.id))]),
        library: live(library),
        events: live(events),
        learnings: live(learnings).filter((l) => l.scope?.projectId === id),
        pubs: live(pubs),
        snaps: live(snaps),
      };
    },
    [id],
    null as null | {
      project?: Project;
      content: Content[];
      ideas: Idea[];
      tasks: Task[];
      library: LibraryItem[];
      events: HQEvent[];
      learnings: Learning[];
      pubs: Publication[];
      snaps: Snapshot[];
    },
  );
  const now = Date.now();
  const next = useMemo(
    () =>
      d?.project
        ? scoreCandidates({ now, tasks: d.tasks, content: d.content, projects: [d.project] })[0]
        : undefined,
    [d, now],
  );
  if (!d) return <div className="page" aria-busy="true" />;
  const p = d.project;
  if (!p)
    return (
      <div className="page">
        <Empty title={t('projects.not_found')} />
      </div>
    );
  const up = (patch: Partial<Project>, key?: string) =>
    update(s, 'projects', p.id, patch, key ? { coalesceKey: `p:${p.id}:${key}` } : undefined);
  const activeContent = d.content.filter(
    (c) => !c.archivedAt && !['published', 'reviewed'].includes(c.status),
  );
  const blocked = d.content.filter((c) => c._blocked);
  const openTasks = d.tasks.filter((x) => x.status !== 'done');
  const upcoming = [
    ...d.pubs
      .filter((x) => x.scheduledAt && x.status !== 'published' && Date.parse(x.scheduledAt) > now - DAY)
      .map((x) => ({
        at: x.scheduledAt!,
        label: t('projects.up_publish', {
          title: contentTitle(d.content.find((c) => c.id === x.contentId) ?? {}),
          platform: platformName(x.platform),
        }),
        to: `/content/${x.contentId}`,
      })),
    ...d.events
      .filter((e) => Date.parse(e.startAt) > now - DAY)
      .map((e) => ({
        at: e.startAt,
        label: `${e.kind === 'milestone' ? '◆ ' : ''}${e.title}`,
        to: '/calendar',
      })),
    ...openTasks
      .filter((x) => x.dueAt && Date.parse(x.dueAt) > now - DAY)
      .map((x) => ({ at: x.dueAt!, label: t('projects.up_due', { title: x.title }), to: '/tasks' })),
  ]
    .filter((x) => Date.parse(x.at) < now + 14 * DAY)
    .sort((a, b) => a.at.localeCompare(b.at));
  const results = d.pubs
    .filter((x) => x.status === 'published')
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, 5)
    .map((x) => {
      const sn = d.snaps
        .filter((y) => y.publicationId === x.id)
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
      return {
        pub: x,
        title: contentTitle(d.content.find((c) => c.id === x.contentId) ?? {}),
        views: sn?.metrics.views,
        cp: sn?.checkpoint,
      };
    });
  const pipeline = CONTENT_STATUSES.map((st) => ({
    st,
    n: d.content.filter((c) => c.status === st && !c.archivedAt).length,
  }));

  return (
    <div className="page">
      <PageHeader
        back
        title={p.name}
        sub={[
          t(`project.status.${p.status}`),
          p.startDate && t('projects.from', { date: fmtDay(p.startDate) }),
          p.endDate && t('projects.to', { date: fmtDay(p.endDate) }),
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <Button onClick={() => void up({ isFocus: !p.isFocus })} aria-pressed={p.isFocus}>
              <Star size={15} fill={p.isFocus ? 'currentColor' : 'none'} />{' '}
              {p.isFocus ? t('projects.focus_project') : t('projects.mark_focus')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => toggleSecretary({ intent: 'producer', focus: { entity: 'project', id: p.id } })}
            >
              <Sparkles size={15} /> {t('projects.whats_blocking')}
            </Button>
            <RecordMenu
              label={t('projects.actions')}
              items={archiveTrashItems(s, 'projects', p, () => void navigate({ to: '/projects' }))}
            />
          </>
        }
      />
      <ArchivedNotice rec={p} table="projects" />
      <div style={{ marginBottom: 16 }}>
        <Tabs
          label={t('projects.sections')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: t('projects.tab.overview') },
            { value: 'content', label: `${t('nav.content')} ${d.content.length || ''}` },
            { value: 'ideas', label: `${t('nav.ideas')} ${d.ideas.length || ''}` },
            { value: 'tasks', label: `${t('nav.tasks')} ${openTasks.length || ''}` },
            { value: 'library', label: `${t('nav.library')} ${d.library.length || ''}` },
            { value: 'results', label: t('projects.tab.results') },
          ]}
        />
      </div>
      {tab === 'overview' && (
        <div className="grid2">
          <div>
            <Section title={t('projects.goal')}>
              <AutoText
                value={p.goal}
                onSave={(v) => up({ goal: v || null }, 'goal')}
                ariaLabel={t('projects.goal')}
                placeholder={t('projects.goal_q')}
              />
            </Section>
            <Section title={t('projects.next_action')}>
              {next ? (
                <Link
                  to={next.ref.entity === 'content' ? `/content/${next.ref.id}` : '/tasks'}
                  className="row list"
                >
                  <div className="grow">
                    <div className="title">{next.title || t('common.untitled')}</div>
                    <div className="sub">{next.reasons.map(reasonText).join(' · ')}</div>
                  </div>
                </Link>
              ) : (
                <Empty compact>{t('projects.no_dated')}</Empty>
              )}
            </Section>
            <Section title={t('projects.blockers')} count={blocked.length}>
              {blocked.length ? (
                <div className="list">
                  {blocked.map((c) => (
                    <Link key={c.id} to="/content/$id" params={{ id: c.id }} className="row">
                      <span className="status-dot warn" aria-hidden />
                      <div className="grow">
                        <div className="title">{contentTitle(c)}</div>
                        <div className="sub">
                          {d.tasks
                            .filter((x) => x.contentId === c.id && x.isBlocker && x.status !== 'done')
                            .map((x) => x.title)
                            .join(' · ')}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="meta">{t('projects.nothing_blocked')}</div>
              )}
            </Section>
            <Section title={t('projects.pipeline')}>
              <div className="chips">
                {pipeline.map((x) => (
                  <span key={x.st} className="tag num">
                    {t(`content.status.${x.st}`)} {x.n}
                  </span>
                ))}
              </div>
            </Section>
            <Section
              title={t('projects.active_content')}
              count={activeContent.length}
              action={
                <Button
                  size="sm"
                  onClick={async () => {
                    const c = await create(s, 'content', {
                      title: '',
                      status: 'planned',
                      formatTemplateId: 'reel',
                      platforms: p.platforms ?? [],
                      projectId: p.id,
                    });
                    void navigate({ to: '/content/$id', params: { id: c.id } });
                  }}
                >
                  + {t('nav.content')}
                </Button>
              }
            >
              <ContentList items={activeContent.slice(0, 8)} />
            </Section>
          </div>
          <div>
            <Section title={t('projects.upcoming')} count={upcoming.length}>
              {upcoming.length ? (
                <div className="list">
                  {upcoming.slice(0, 8).map((u) => (
                    <Link key={u.label + u.at} to={u.to} className="row">
                      <span className="sched-time">{fmtDay(u.at, { day: 'numeric', month: 'short' })}</span>
                      <div className="grow title">{u.label}</div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="meta">{t('projects.upcoming_none')}</div>
              )}
            </Section>
            <Section title={t('projects.top_ideas')}>
              {d.ideas.filter((i) => i.status === 'shortlisted').length ? (
                <div className="list">
                  {d.ideas
                    .filter((i) => i.status === 'shortlisted')
                    .slice(0, 5)
                    .map((i) => (
                      <Link key={i.id} to="/ideas/$id" params={{ id: i.id }} className="row">
                        <div className="grow title">★ {i.title || t('ideas.untitled')}</div>
                      </Link>
                    ))}
                </div>
              ) : (
                <div className="meta">
                  {d.ideas.length
                    ? t('projects.ideas_none_short', { count: d.ideas.length })
                    : t('projects.no_ideas_linked')}
                </div>
              )}
            </Section>
            <Section title={t('projects.latest_results')}>
              {results.length ? (
                <div className="list">
                  {results.map((r) => (
                    <Link key={r.pub.id} to="/content/$id" params={{ id: r.pub.contentId }} className="row">
                      <div className="grow">
                        <div className="title">{r.title}</div>
                        <div className="sub">
                          {platformName(r.pub.platform)} ·{' '}
                          {r.views !== undefined
                            ? t('projects.views_cp', { views: r.views, cp: r.cp ?? t('projects.latest') })
                            : t('projects.no_results_logged')}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="meta">{t('projects.no_published')}</div>
              )}
            </Section>
            <Section title={t('projects.learnings')}>
              {d.learnings.length ? (
                d.learnings.map((l) => (
                  <div key={l.id} className="meta">
                    <span className="tag">{t(`learning.kind.${l.kind}`)}</span> {l.statement}
                  </div>
                ))
              ) : (
                <div className="meta">{t('common.none_yet')}</div>
              )}
            </Section>
            <Section title={t('projects.research')}>
              {d.library.slice(0, 5).map((r) => (
                <div key={r.id}>
                  <Link to="/library/$id" params={{ id: r.id }} className="meta">
                    {libraryTitle(r)}
                  </Link>
                </div>
              ))}
              {!d.library.length && <div className="meta">{t('common.none_yet')}</div>}
            </Section>
            <Section title={t('nav.settings')}>
              <div className="form-grid">
                <div className="field">
                  <label className="lbl" htmlFor="pst">
                    {t('common.status')}
                  </label>
                  <select
                    id="pst"
                    className="select"
                    value={p.status}
                    onChange={(e) => void up({ status: e.target.value as Project['status'] })}
                  >
                    <option value="active">{t('project.status.active')}</option>
                    <option value="paused">{t('project.status.paused')}</option>
                    <option value="done">{t('project.status.done')}</option>
                  </select>
                </div>
                <div className="field">
                  <label className="lbl" htmlFor="psd">
                    {t('projects.start')}
                  </label>
                  <input
                    id="psd"
                    type="date"
                    className="input"
                    value={p.startDate?.slice(0, 10) ?? ''}
                    onChange={(e) =>
                      void up({ startDate: e.target.value ? new Date(e.target.value).toISOString() : null })
                    }
                  />
                </div>
                <div className="field">
                  <label className="lbl" htmlFor="ped">
                    {t('projects.end')}
                  </label>
                  <input
                    id="ped"
                    type="date"
                    className="input"
                    value={p.endDate?.slice(0, 10) ?? ''}
                    onChange={(e) =>
                      void up({ endDate: e.target.value ? new Date(e.target.value).toISOString() : null })
                    }
                  />
                </div>
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <span className="lbl">{t('common.name')}</span>
                <AutoText
                  value={p.name}
                  onSave={(v) => v.trim() && up({ name: v.trim() }, 'name')}
                  ariaLabel={t('projects.name')}
                />
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <span className="lbl">{t('field.brief')}</span>
                <AutoText
                  multiline
                  value={p.brief}
                  onSave={(v) => up({ brief: v || null }, 'brief')}
                  ariaLabel={t('projects.brief')}
                  rows={4}
                />
              </div>
            </Section>
          </div>
        </div>
      )}
      {tab === 'content' && <ContentList items={d.content} />}
      {tab === 'ideas' && (
        <div className="list">
          {d.ideas.map((i) => (
            <Link key={i.id} to="/ideas/$id" params={{ id: i.id }} className="row">
              <div className="grow title">{i.title || t('ideas.untitled')}</div>
              <Pill>{t(`idea.status.${i.status}`)}</Pill>
            </Link>
          ))}
          {!d.ideas.length && <div className="row static meta">{t('projects.no_ideas')}</div>}
        </div>
      )}
      {tab === 'tasks' && (
        <div className="list">
          {d.tasks
            .filter((x) => x.status !== 'done')
            .map((x) => (
              <TaskRow key={x.id} t={x} />
            ))}
          <QuickTask parent={{ projectId: p.id }} />
        </div>
      )}
      {tab === 'library' && (
        <div className="list">
          {d.library.map((r) => (
            <Link key={r.id} to="/library/$id" params={{ id: r.id }} className="row">
              <div className="grow">
                <div className="title">{libraryTitle(r)}</div>
                <div className="sub">
                  {t(`library.role.${r.role}`)} · {t(`library.kind.${r.kind}`)}
                </div>
              </div>
            </Link>
          ))}
          {!d.library.length && <div className="row static meta">{t('projects.nothing_saved')}</div>}
        </div>
      )}
      {tab === 'results' && (
        <div className="list">
          {results.map((r) => (
            <Link key={r.pub.id} to="/content/$id" params={{ id: r.pub.contentId }} className="row">
              <div className="grow title">{r.title}</div>
              <span className="meta">
                {platformName(r.pub.platform)} · {r.views !== undefined ? fmt.num(r.views) : '—'}
              </span>
            </Link>
          ))}
          {!results.length && <div className="row static meta">{t('projects.no_results')}</div>}
        </div>
      )}
    </div>
  );
}

function ContentList({ items }: { items: Content[] }) {
  useT();
  if (!items.length) return <div className="meta">{t('projects.no_content')}</div>;
  return (
    <div className="list">
      {items.map((c) => (
        <Link key={c.id} to="/content/$id" params={{ id: c.id }} className="row">
          <div className="grow">
            <div className="title">{contentTitle(c)}</div>
            <div className="sub">
              {missingText(c) ||
                (c._nextPublishAt ? t('projects.publishes', { date: fmtDay(c._nextPublishAt) }) : '')}
            </div>
          </div>
          <ContentStatus c={c} />
        </Link>
      ))}
    </div>
  );
}
