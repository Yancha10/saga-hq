import { Link, useNavigate } from '@tanstack/react-router';
import { CheckCircle2, Pin, PinOff, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useApp, useIsPhone, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { logSnapshot, togglePin } from '../../data/domain';
import { fmt, t, useT } from '../../i18n';
import {
  attentionText,
  factText,
  gapText,
  platformName,
  reasonText,
  suggestionText,
} from '../../i18n/render';
import { type Candidate, HOT_REASONS } from '../../rules/priority';
import { DAY, fmtTime } from '../../rules/time';
import { buildToday, type ResultsDue, type TodayModel } from '../../rules/today';
import { Button, Empty, IconButton, Section, Sheet } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { useNow } from '../common';
import { MetricsForm } from '../insights/MetricsForm';
import { PlanToday } from '../plan/Plan';
import { Arrivals } from './Arrivals';
import { NextPiece } from './NextPiece';
import { Onboarding } from './Onboarding';

const CAP = 5;

function useToday(now: number): TodayModel | null {
  return useLive(
    async (s) => {
      const [workspace, tasks, content, projects, publications, snapshots, events, captures, ideas] =
        await Promise.all([
          s.db.workspace.get('workspace'),
          s.db.tasks.where('status').anyOf('todo', 'doing').toArray(),
          s.db.content
            .where('status')
            .anyOf('planned', 'script', 'producing', 'ready', 'scheduled', 'published')
            .toArray(),
          s.db.projects.toArray(),
          s.db.publications
            .where('scheduledAt')
            .above(new Date(now - 30 * DAY).toISOString())
            .toArray()
            .then(async (a) => {
              const b = await s.db.publications
                .where('publishedAt')
                .above(new Date(now - 30 * DAY).toISOString())
                .toArray();
              const m = new Map([...a, ...b].map((p) => [p.id, p]));
              return [...m.values()];
            }),
          s.db.snapshots
            .where('observedAt')
            .above(new Date(now - 40 * DAY).toISOString())
            .toArray(),
          s.db.events
            .where('startAt')
            .between(new Date(now - 2 * DAY).toISOString(), new Date(now + 2 * DAY).toISOString())
            .toArray(),
          s.db.captures.where('status').equals('inbox').toArray(),
          s.db.ideas.where('status').anyOf('new', 'shortlisted').toArray(),
        ]);
      return buildToday({
        now,
        workspace,
        tasks,
        content,
        projects,
        publications,
        snapshots,
        events,
        captures,
        ideas,
      });
    },
    [Math.floor(now / 60_000)],
    null,
  );
}

function CandidateRow({ c, index, pinned }: { c: Candidate; index: number; pinned: boolean }) {
  useT();
  const s = useSession();
  const to =
    c.ref.entity === 'content'
      ? `/content/${c.ref.id}`
      : c.ref.entity === 'task'
        ? '/tasks'
        : `/ideas/${c.ref.id}`;
  return (
    <div className={`focus-row ${pinned ? '' : 'suggested'}`}>
      <span className={`focus-num ${pinned ? 'pinned' : ''}`} aria-hidden>
        {index + 1}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link to={to} className="title" style={{ fontWeight: 560 }}>
          {c.title || t('common.untitled')}
        </Link>
        <div className="reasons">
          {!pinned && <span className="reason">{t('today.suggested')}</span>}
          {c.reasons.slice(0, 4).map((r) => (
            <span key={r.code} className={`reason ${HOT_REASONS.has(r.code) ? 'hot' : ''}`}>
              {reasonText(r)}
            </span>
          ))}
        </div>
      </div>
      <IconButton
        label={pinned ? t('h.unpin') : t('h.pin')}
        onClick={() =>
          void togglePin(s, c.ref).then((r) => {
            if (r === 'full') toast(t('today.focus_full'));
          })
        }
      >
        {pinned ? <PinOff size={16} /> : <Pin size={16} />}
      </IconButton>
    </div>
  );
}

function ResultsRow({ r, onLog }: { r: ResultsDue; onLog: () => void }) {
  useT();
  return (
    <div className="row static">
      <div className="grow">
        <Link to="/content/$id" params={{ id: r.contentId }} className="title">
          {r.title || t('common.untitled')}
        </Link>
        <div className="sub">
          {t('today.results_due', { platform: platformName(r.platform), checkpoint: r.checkpoint })}
        </div>
      </div>
      <Button size="sm" onClick={onLog}>
        {t('today.log_checkpoint', { checkpoint: r.checkpoint })}
      </Button>
    </div>
  );
}

export function TodayPage() {
  useT();
  const s = useSession();
  const { openCapture, toggleSecretary } = useApp();
  const navigate = useNavigate();
  const now = useNow();
  const phone = useIsPhone();
  const m = useToday(now);
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  const [logFor, setLogFor] = useState<ResultsDue | null>(null);
  const [showAll, setShowAll] = useState(false);
  const pub = useLive(
    async (ss) => (logFor ? ss.db.publications.get(logFor.publicationId) : undefined),
    [logFor?.publicationId],
    undefined,
  );

  const date = fmt.weekdayLong(now);
  if (!m) return <div className="page" aria-busy="true" />;
  const focus = [
    ...m.focus.pinned.map((c) => ({ c, pinned: true })),
    ...m.focus.suggested.map((c) => ({ c, pinned: false })),
  ].slice(0, 3);
  const nothing =
    !focus.length && !m.schedule.length && !m.attention.length && !m.resultsDue.length && !m.inboxCount;
  const attention = showAll ? m.attention : m.attention.slice(0, CAP);

  return (
    <div className="page">
      <PageHeader
        title={t('nav.today')}
        sub={date}
        actions={
          <>
            <Button className="hide-mobile" onClick={() => openCapture()}>
              {t('capture.button')}
            </Button>
            <Button variant="ghost" onClick={() => toggleSecretary({ intent: 'brief' })}>
              <Sparkles size={15} /> {t('today.brief_btn')}
            </Button>
          </>
        }
      />
      {!ws?.onboardedAt && <Onboarding />}
      {nothing && ws?.onboardedAt && (
        <Empty
          title={t('today.clear_day')}
          action={
            <div className="hstack">
              <Button variant="primary" onClick={() => openCapture()}>
                {t('today.capture_idea')}
              </Button>
              <Button onClick={() => void navigate({ to: '/projects' })}>{t('today.create_project')}</Button>
              <Button onClick={() => void navigate({ to: '/content' })}>{t('today.plan_content')}</Button>
            </div>
          }
        >
          {t('today.clear_body')}
        </Empty>
      )}
      {phone && (
        <nav className="stat-tiles" aria-label={t('today.overview')}>
          <button
            type="button"
            className={`stat-tile ${m.attention.length ? 'hot' : ''}`}
            onClick={() =>
              document.getElementById('attention')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            <span className="stat-n num">{m.attention.length}</span>
            <span className="stat-l">{t('today.attention')}</span>
          </button>
          <Link to="/calendar" className="stat-tile">
            <span className="stat-n num">{m.schedule.length}</span>
            <span className="stat-l">{t('today.schedule')}</span>
          </Link>
          <Link to="/inbox" className={`stat-tile ${m.inboxCount ? 'accent' : ''}`}>
            <span className="stat-n num">{m.inboxCount}</span>
            <span className="stat-l">{t('nav.inbox')}</span>
          </Link>
          <Link to="/insights" className="stat-tile">
            <span className="stat-n num">{m.resultsDue.length}</span>
            <span className="stat-l">{t('today.results_to_log')}</span>
          </Link>
        </nav>
      )}
      <PlanToday now={now} />
      <Arrivals now={now} />
      {ws?.onboardedAt && <NextPiece now={now} />}
      <div className="today-grid">
        <div>
          <Section
            title={t('today.focus')}
            id="focus"
            action={<span className="meta">{t('today.pin_up_to')}</span>}
          >
            {focus.length ? (
              <div className="list">
                {focus.map(({ c, pinned }, i) => (
                  <CandidateRow key={`${c.ref.entity}:${c.ref.id}`} c={c} index={i} pinned={pinned} />
                ))}
              </div>
            ) : (
              <Empty compact>{t('today.focus_empty')}</Empty>
            )}
          </Section>

          <Section title={t('today.attention')} count={m.attention.length} id="attention" fold="open">
            {m.attention.length ? (
              <div className="list">
                {attention.map((a) => {
                  const at = attentionText(a);
                  return (
                    <Link
                      key={`${a.kind}:${a.id}`}
                      to={a.entity === 'content' ? `/content/${a.id}` : '/tasks'}
                      className="row"
                    >
                      <span
                        className={`status-dot ${a.kind === 'overdue' || a.kind === 'late' ? 'err' : 'warn'}`}
                        aria-hidden
                      />
                      <div className="grow">
                        <div className="title">{a.title || t('common.untitled')}</div>
                        <div className="sub">
                          <strong style={{ fontWeight: 560 }}>{at.label}</strong> · {at.detail}
                        </div>
                      </div>
                    </Link>
                  );
                })}
                {m.attention.length > CAP && (
                  <button
                    type="button"
                    className="more-link"
                    style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => setShowAll((v) => !v)}
                  >
                    {showAll
                      ? t('common.show_less')
                      : t('common.n_more', { count: m.attention.length - CAP })}
                  </button>
                )}
              </div>
            ) : (
              <div className="list">
                <div className="calm">
                  <CheckCircle2 size={16} aria-hidden /> {t('today.on_track')}
                </div>
              </div>
            )}
          </Section>

          {m.quickWins.length > 0 && (
            <Section title={t('today.quick_wins')} id="wins" fold="closed">
              <div className="list">
                {m.quickWins.map((c) => (
                  <Link
                    key={c.ref.id}
                    to={c.ref.entity === 'content' ? `/content/${c.ref.id}` : '/tasks'}
                    className="row"
                  >
                    <div className="grow">
                      <div className="title">{c.title || t('common.untitled')}</div>
                      <div className="sub">
                        {c.reasons
                          .filter((r) => r.code === 'only_missing' || r.code === 'quick')
                          .map(reasonText)
                          .join(' · ')}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </Section>
          )}
        </div>

        <div>
          <Section
            title={t('today.schedule')}
            count={m.schedule.length}
            id="schedule"
            fold="closed"
            action={
              <Link to="/calendar" className="meta">
                {t('today.calendar_link')}
              </Link>
            }
          >
            {m.schedule.length ? (
              <div className="list">
                {m.schedule.map((it) => (
                  <Link
                    key={`${it.kind}:${it.id}`}
                    to={
                      it.contentId ? `/content/${it.contentId}` : it.kind === 'task' ? '/tasks' : '/calendar'
                    }
                    className="row"
                  >
                    <span className="sched-time">{it.at ? fmtTime(it.at) : t('common.all_day')}</span>
                    <div className="grow">
                      <div className="title" style={{ textDecoration: it.done ? 'line-through' : undefined }}>
                        {it.title || t('common.untitled')}
                      </div>
                      <div className="sub">
                        {it.kind === 'publication'
                          ? `${t('today.publish')} · ${it.platform ? platformName(it.platform) : ''}${it.done ? ` · ${t('common.done_lower')}` : ''}`
                          : it.kind === 'event'
                            ? t(`event.kind.${it.eventKind ?? 'production_block'}`)
                            : it.deadline
                              ? t('today.deadline')
                              : t('today.due')}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty compact>
                {t('today.schedule_empty')}
                {m.nextPublication && (
                  <>
                    {' '}
                    {t('today.next_publication')}{' '}
                    <Link to="/content/$id" params={{ id: m.nextPublication.contentId! }}>
                      {m.nextPublication.title}
                    </Link>{' '}
                    {fmt.dayTime(m.nextPublication.at!)}
                  </>
                )}
              </Empty>
            )}
          </Section>

          {m.resultsDue.length > 0 && (
            <Section title={t('today.results_to_log')} count={m.resultsDue.length} id="results" fold="closed">
              <div className="list">
                {m.resultsDue.slice(0, CAP).map((r) => (
                  <ResultsRow key={r.publicationId + r.checkpoint} r={r} onLog={() => setLogFor(r)} />
                ))}
              </div>
            </Section>
          )}

          {(m.gaps.length > 0 || m.suggestions.length > 0) && (
            <Section title={t('today.signals')} id="signals" fold="closed">
              <div className="list">
                {m.gaps.slice(0, 4).map((g) => (
                  <Link key={`${g.platform}:${g.day ?? g.weekStart}`} to="/calendar" className="row">
                    <span className="gap-slot">{t('today.gap')}</span>
                    <div className="grow sub" style={{ color: 'var(--text-2)' }}>
                      {gapText(g)}
                    </div>
                  </Link>
                ))}
                {m.suggestions.map((sg) => (
                  <Link
                    key={sg.id}
                    to={
                      sg.target?.entity === 'project'
                        ? `/projects/${sg.target.id}`
                        : sg.target?.entity === 'content'
                          ? `/content/${sg.target.id}`
                          : sg.kind === 'inbox_waiting'
                            ? '/inbox'
                            : '/content'
                    }
                    className="row"
                  >
                    <span className="reason">{t('today.rule')}</span>
                    <div className="grow sub" style={{ color: 'var(--text-2)', whiteSpace: 'normal' }}>
                      {suggestionText(sg)}
                    </div>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {m.inboxCount > 0 && (
            <div className="list hide-mobile" style={{ marginBottom: 24 }}>
              <Link to="/inbox" className="row">
                <div className="grow">
                  <div className="title">{t('today.inbox_count', { count: m.inboxCount })}</div>
                  <div className="sub">
                    {m.inboxOldDays > 0
                      ? t('today.inbox_oldest', { count: m.inboxOldDays })
                      : t('today.inbox_today')}
                  </div>
                </div>
                <span className="meta">{t('today.triage_link')}</span>
              </Link>
            </div>
          )}

          <Section title={t('today.daily_brief')} id="brief" fold="closed">
            <div className="box">
              <div className="ai-label">{t('today.facts')}</div>
              {m.facts.length ? (
                <ul className="facts">
                  {m.facts.map((f) => (
                    <li key={f.key}>{factText(f)}</li>
                  ))}
                </ul>
              ) : (
                <div className="meta">{t('today.no_open')}</div>
              )}
              <div className="hstack">
                <Button size="sm" onClick={() => toggleSecretary({ intent: 'brief' })}>
                  <Sparkles size={14} /> {t('today.recommendations')}
                </Button>
                <span className="meta">{t('today.ai_note')}</span>
              </div>
            </div>
          </Section>
        </div>
      </div>

      <Sheet
        open={!!logFor}
        onClose={() => setLogFor(null)}
        title={
          logFor
            ? t('today.results_title', {
                checkpoint: logFor.checkpoint,
                title: logFor.title || t('common.untitled'),
              })
            : ''
        }
      >
        {pub && logFor && (
          <MetricsForm
            platform={pub.platform}
            onSubmit={async (m) => {
              await logSnapshot(s, pub, m, new Date().toISOString(), logFor.checkpoint);
              toast(t('today.results_saved'));
              setLogFor(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
