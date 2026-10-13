import { Link, useNavigate } from '@tanstack/react-router';
import { CheckCircle2, Pin, PinOff, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { logSnapshot, togglePin } from '../../data/domain';
import { PLATFORM_LABEL } from '../../data/schema';
import type { Candidate } from '../../rules/priority';
import { DAY, fmtTime } from '../../rules/time';
import { buildToday, type ResultsDue, type TodayModel } from '../../rules/today';
import { Button, Empty, IconButton, Section, Sheet } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { useNow } from '../common';
import { MetricsForm } from '../insights/MetricsForm';
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
            .anyOf('planned', 'producing', 'ready', 'scheduled', 'published')
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
          {c.title}
        </Link>
        <div className="reasons">
          {!pinned && <span className="reason">suggested</span>}
          {c.reasons.slice(0, 4).map((r) => (
            <span
              key={r}
              className={`reason ${/late|overdue|missed|today|publishes|blocked/.test(r) ? 'hot' : ''}`}
            >
              {r}
            </span>
          ))}
        </div>
      </div>
      <IconButton
        label={pinned ? 'Unpin from Focus' : 'Pin to Focus'}
        onClick={() =>
          void togglePin(s, c.ref).then((r) => {
            if (r === 'full') toast('Focus holds 3 items. Unpin one first.');
          })
        }
      >
        {pinned ? <PinOff size={16} /> : <Pin size={16} />}
      </IconButton>
    </div>
  );
}

function ResultsRow({ r, onLog }: { r: ResultsDue; onLog: () => void }) {
  return (
    <div className="row static">
      <div className="grow">
        <Link to="/content/$id" params={{ id: r.contentId }} className="title">
          {r.title}
        </Link>
        <div className="sub">
          {PLATFORM_LABEL[r.platform]} · {r.checkpoint} results due
        </div>
      </div>
      <Button size="sm" onClick={onLog}>
        Log {r.checkpoint}
      </Button>
    </div>
  );
}

export function TodayPage() {
  const s = useSession();
  const { openCapture, toggleSecretary } = useApp();
  const navigate = useNavigate();
  const now = useNow();
  const t = useToday(now);
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  const [logFor, setLogFor] = useState<ResultsDue | null>(null);
  const [showAll, setShowAll] = useState(false);
  const pub = useLive(
    async (ss) => (logFor ? ss.db.publications.get(logFor.publicationId) : undefined),
    [logFor?.publicationId],
    undefined,
  );

  const date = new Date(now).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  if (!t) return <div className="page" aria-busy="true" />;
  const focus = [
    ...t.focus.pinned.map((c) => ({ c, pinned: true })),
    ...t.focus.suggested.map((c) => ({ c, pinned: false })),
  ].slice(0, 3);
  const nothing =
    !focus.length && !t.schedule.length && !t.attention.length && !t.resultsDue.length && !t.inboxCount;
  const attention = showAll ? t.attention : t.attention.slice(0, CAP);

  return (
    <div className="page">
      <PageHeader
        title="Today"
        sub={date}
        actions={
          <>
            <Button onClick={() => openCapture()}>Capture</Button>
            <Button variant="ghost" onClick={() => toggleSecretary({ intent: 'brief' })}>
              <Sparkles size={15} /> Brief
            </Button>
          </>
        }
      />
      {!ws?.onboardedAt && <Onboarding />}
      {nothing && ws?.onboardedAt && (
        <Empty
          title="A clear day"
          action={
            <div className="hstack">
              <Button variant="primary" onClick={() => openCapture()}>
                Capture an idea
              </Button>
              <Button onClick={() => void navigate({ to: '/projects' })}>Create a project</Button>
              <Button onClick={() => void navigate({ to: '/content' })}>Plan content</Button>
            </div>
          }
        >
          Nothing scheduled, blocked or late. Capture ideas as they come.
        </Empty>
      )}
      <div className="today-grid">
        <div>
          <Section title="Focus" id="focus" action={<span className="meta">pin up to 3</span>}>
            {focus.length ? (
              <div className="list">
                {focus.map(({ c, pinned }, i) => (
                  <CandidateRow key={`${c.ref.entity}:${c.ref.id}`} c={c} index={i} pinned={pinned} />
                ))}
              </div>
            ) : (
              <Empty compact>
                No priorities yet — content with dates, tasks with due dates and pinned items appear here.
              </Empty>
            )}
          </Section>

          <Section title="Needs attention" count={t.attention.length} id="attention">
            {t.attention.length ? (
              <div className="list">
                {attention.map((a) => (
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
                      <div className="title">{a.title}</div>
                      <div className="sub">
                        <strong style={{ fontWeight: 560 }}>
                          {a.kind === 'missing' ? 'Missing' : a.kind[0]!.toUpperCase() + a.kind.slice(1)}
                        </strong>{' '}
                        · {a.detail}
                      </div>
                    </div>
                  </Link>
                ))}
                {t.attention.length > CAP && (
                  <button
                    type="button"
                    className="more-link"
                    style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => setShowAll((v) => !v)}
                  >
                    {showAll ? 'Show less' : `+${t.attention.length - CAP} more`}
                  </button>
                )}
              </div>
            ) : (
              <div className="list">
                <div className="calm">
                  <CheckCircle2 size={16} aria-hidden /> Everything’s on track
                </div>
              </div>
            )}
          </Section>

          {t.quickWins.length > 0 && (
            <Section title="Quick wins" id="wins">
              <div className="list">
                {t.quickWins.map((c) => (
                  <Link
                    key={c.ref.id}
                    to={c.ref.entity === 'content' ? `/content/${c.ref.id}` : '/tasks'}
                    className="row"
                  >
                    <div className="grow">
                      <div className="title">{c.title}</div>
                      <div className="sub">
                        {c.reasons.filter((r) => r.startsWith('only') || r === 'quick').join(' · ')}
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
            title="Schedule today"
            count={t.schedule.length}
            id="schedule"
            action={
              <Link to="/calendar" className="meta">
                Calendar →
              </Link>
            }
          >
            {t.schedule.length ? (
              <div className="list">
                {t.schedule.map((it) => (
                  <Link
                    key={`${it.kind}:${it.id}`}
                    to={
                      it.contentId ? `/content/${it.contentId}` : it.kind === 'task' ? '/tasks' : '/calendar'
                    }
                    className="row"
                  >
                    <span className="sched-time">{it.at ? fmtTime(it.at) : 'all day'}</span>
                    <div className="grow">
                      <div className="title" style={{ textDecoration: it.done ? 'line-through' : undefined }}>
                        {it.title}
                      </div>
                      <div className="sub">
                        {it.kind === 'publication'
                          ? `Publish · ${PLATFORM_LABEL[it.sub as keyof typeof PLATFORM_LABEL] ?? it.sub}${it.done ? ' · done' : ''}`
                          : it.sub?.replace('_', ' ')}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty compact>
                Nothing on the calendar today.
                {t.nextPublication && (
                  <>
                    {' '}
                    Next publication:{' '}
                    <Link to="/content/$id" params={{ id: t.nextPublication.contentId! }}>
                      {t.nextPublication.title}
                    </Link>{' '}
                    {new Date(t.nextPublication.at!).toLocaleString(undefined, {
                      weekday: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </>
                )}
              </Empty>
            )}
          </Section>

          {t.resultsDue.length > 0 && (
            <Section title="Results to log" count={t.resultsDue.length} id="results">
              <div className="list">
                {t.resultsDue.slice(0, CAP).map((r) => (
                  <ResultsRow key={r.publicationId + r.checkpoint} r={r} onLog={() => setLogFor(r)} />
                ))}
              </div>
            </Section>
          )}

          {(t.gaps.length > 0 || t.suggestions.length > 0) && (
            <Section title="Planning signals" id="signals">
              <div className="list">
                {t.gaps.slice(0, 4).map((g) => (
                  <Link key={g.message} to="/calendar" className="row">
                    <span className="gap-slot">gap</span>
                    <div className="grow sub" style={{ color: 'var(--text-2)' }}>
                      {g.message}
                    </div>
                  </Link>
                ))}
                {t.suggestions.map((sg) => (
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
                    <span className="reason">rule</span>
                    <div className="grow sub" style={{ color: 'var(--text-2)', whiteSpace: 'normal' }}>
                      {sg.message}
                    </div>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {t.inboxCount > 0 && (
            <Link to="/inbox" className="row list" style={{ marginBottom: 24 }}>
              <div className="grow">
                <div className="title">
                  {t.inboxCount} capture{t.inboxCount > 1 ? 's' : ''} to triage
                </div>
                <div className="sub">
                  {t.inboxOldDays > 0
                    ? `oldest ${t.inboxOldDays} day${t.inboxOldDays > 1 ? 's' : ''}`
                    : 'from today'}
                </div>
              </div>
              <span className="meta">Triage →</span>
            </Link>
          )}

          <Section title="Daily brief" id="brief">
            <div className="box">
              <div className="ai-label">Workspace facts</div>
              {t.facts.length ? (
                <ul className="facts">
                  {t.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : (
                <div className="meta">No open items. </div>
              )}
              <div className="hstack">
                <Button size="sm" onClick={() => toggleSecretary({ intent: 'brief' })}>
                  <Sparkles size={14} /> Recommendations
                </Button>
                <span className="meta">Optional AI, from these facts only</span>
              </div>
            </div>
          </Section>
        </div>
      </div>

      <Sheet
        open={!!logFor}
        onClose={() => setLogFor(null)}
        title={logFor ? `${logFor.checkpoint} results · ${logFor.title}` : ''}
      >
        {pub && logFor && (
          <MetricsForm
            platform={pub.platform}
            onSubmit={async (m) => {
              await logSnapshot(s, pub, m, new Date().toISOString(), logFor.checkpoint);
              toast('Results saved');
              setLogFor(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
