import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  CalendarArrowDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gauge,
  Target,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { schedulePublication, toggleTask } from '../../data/domain';
import { capacityOf, nextActionFor } from '../../data/saga';
import type { Content, HQEvent, Publication, Task, Workspace } from '../../data/schema';
import { update } from '../../data/store';
import { fmt, t, useT } from '../../i18n';
import { platformName } from '../../i18n/render';
import { addDays, DAY, sameDay, startOfWeek } from '../../rules/time';
import { Button, IconButton, Pill } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { contentTitle } from '../common';
import { downloadPlanIcs } from '../plan/Plan';

interface Data {
  ws: Workspace | undefined;
  pubs: Publication[];
  tasks: Task[];
  overdue: Task[];
  events: HQEvent[];
  contents: Content[];
}

/** My week: publications, tasks and blocks side by side, measured against the hours you really have. */
export function WeekPage() {
  useT();
  const s = useSession();
  const [anchor, setAnchor] = useState(() => Date.now());
  const start = useMemo(() => startOfWeek(anchor).getTime(), [anchor]);
  const end = start + 7 * DAY;
  const d = useLive<Data>(
    async (ss) => {
      const a = new Date(start).toISOString();
      const z = new Date(end).toISOString();
      const [ws, pubs, tasks, events, overdue] = await Promise.all([
        ss.db.workspace.get('workspace'),
        ss.db.publications.where('scheduledAt').between(a, z).toArray(),
        ss.db.tasks.where('dueAt').between(a, z).toArray(),
        ss.db.events.where('startAt').between(a, z).toArray(),
        ss.db.tasks
          .where('dueAt')
          .below(new Date(Math.min(start, Date.now())).toISOString())
          .toArray(),
      ]);
      const live = pubs.filter((p) => !p.deletedAt && p.status !== 'cancelled');
      const contents = (await ss.db.content.bulkGet([...new Set(live.map((p) => p.contentId))])).filter(
        (c): c is Content => !!c && !c.deletedAt,
      );
      return {
        ws,
        pubs: live,
        tasks: tasks.filter((x) => !x.deletedAt),
        overdue: overdue.filter((x) => !x.deletedAt && x.status !== 'done'),
        events: events.filter((e) => !e.deletedAt),
        contents,
      };
    },
    [start, end],
    { ws: undefined, pubs: [], tasks: [], overdue: [], events: [], contents: [] },
  );
  const cmap = new Map(d.contents.map((c) => [c.id, c]));
  const pubs = d.pubs.filter((p) => cmap.has(p.contentId));
  const cap = capacityOf(d.ws, d.tasks, pubs.length);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const isThisWeek = Date.now() >= start && Date.now() < end;
  const hours = (min: number) => fmt.num(min / 60, { maximumFractionDigits: 1 });
  const load = cap.availableMin ? Math.min(1.5, cap.estimatedMin / cap.availableMin) : 0;
  const moveOptions = Array.from({ length: 14 }, (_, i) => addDays(start, i));

  const movePub = async (p: Publication, day: Date) => {
    const c = cmap.get(p.contentId);
    if (!c || !p.scheduledAt) return;
    const old = new Date(p.scheduledAt);
    const next = new Date(day);
    next.setHours(old.getHours(), old.getMinutes(), 0, 0);
    await schedulePublication(s, c, p.platform, next.toISOString(), p);
    toast(t('week.moved', { day: fmt.dayShort(next) }));
  };
  const moveTask = async (x: Task, day: Date) => {
    const next = new Date(day);
    next.setHours(18, 0, 0, 0);
    await update(s, 'tasks', x.id, { dueAt: next.toISOString() }, { label: 'h.reschedule' });
    toast(t('week.moved', { day: fmt.dayShort(next) }));
  };

  return (
    <div className="page">
      <PageHeader
        title={t('nav.week')}
        sub={`${fmt.date(start, { day: 'numeric', month: 'short' })} – ${fmt.date(end - DAY, { day: 'numeric', month: 'short', year: 'numeric' })}`}
        actions={
          <div className="hstack">
            <IconButton label={t('calendar.prev')} onClick={() => setAnchor(start - 7 * DAY)}>
              <ChevronLeft size={18} />
            </IconButton>
            {!isThisWeek && (
              <Button size="sm" onClick={() => setAnchor(Date.now())}>
                {t('calendar.today')}
              </Button>
            )}
            <IconButton label={t('calendar.next')} onClick={() => setAnchor(start + 7 * DAY)}>
              <ChevronRight size={18} />
            </IconButton>
            <IcsButton />
          </div>
        }
      />
      <div className="capacity-card">
        <div className="cap-stat">
          <Clock size={18} aria-hidden />
          <div>
            <div className="num big">
              {hours(cap.estimatedMin)} / {hours(cap.availableMin)} h
            </div>
            <div className="meta">{t('week.estimated_vs_available')}</div>
          </div>
        </div>
        <div
          className="cap-meter"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(load * 100)}
          aria-label={t('week.load')}
        >
          <span style={{ width: `${Math.min(100, load * 100)}%` }} className={cap.overloaded ? 'over' : ''} />
        </div>
        <div className="cap-stat">
          <Target size={18} aria-hidden />
          <div>
            <div className="num big">
              {fmt.num(cap.pubs)} / {fmt.num(cap.goal)}
            </div>
            <div className="meta">{t('week.pubs_vs_goal')}</div>
          </div>
        </div>
        {cap.unestimated > 0 && (
          <div className="meta cap-note">
            <Gauge size={14} aria-hidden /> {t('week.unestimated', { count: cap.unestimated })}
          </div>
        )}
        <Link to="/settings" search={{ section: 'workspace' }} className="meta cap-note link-quiet">
          {t('week.edit_capacity')}
        </Link>
      </div>
      {(cap.overloaded || cap.overGoal) && (
        <div className="banner warning week-warn" role="status">
          <AlertTriangle size={16} aria-hidden />
          <div>
            <strong>{t('week.overload_title')}</strong>{' '}
            {cap.overloaded
              ? t('week.overload_hours', { over: hours(cap.estimatedMin - cap.availableMin) })
              : t('week.overload_pubs', { count: cap.pubs - cap.goal })}{' '}
            {t('week.overload_hint')}
          </div>
        </div>
      )}
      {d.overdue.length > 0 && isThisWeek && (
        <section className="week-overdue">
          <h4>{t('week.overdue', { count: d.overdue.length })}</h4>
          <div className="list">
            {d.overdue.slice(0, 8).map((x) => (
              <div key={x.id} className="row static">
                <div className="grow">
                  <div className="title">{x.title}</div>
                  <div className="sub">{x.dueAt ? fmt.relDay(x.dueAt) : ''}</div>
                </div>
                <Button size="sm" onClick={() => void moveTask(x, new Date())}>
                  {t('week.bring_today')}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="week-grid">
        {days.map((day) => {
          const dp = pubs
            .filter((p) => sameDay(p.scheduledAt!, day))
            .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
          const dt = d.tasks.filter((x) => sameDay(x.dueAt!, day));
          const de = d.events.filter((e) => sameDay(e.startAt, day));
          const today = sameDay(day, Date.now());
          const empty = !dp.length && !dt.length && !de.length;
          return (
            <section
              key={day.toISOString()}
              className={`week-day ${today ? 'today' : ''} ${empty ? 'empty' : ''}`}
            >
              <h3 className="week-day-head">
                <span className="wd">{fmt.date(day, { weekday: 'short' })}</span>
                <span className="dn">{fmt.date(day, { day: 'numeric' })}</span>
              </h3>
              {dp.map((p) => {
                const c = cmap.get(p.contentId)!;
                const na = nextActionFor(c);
                return (
                  <div key={p.id} className={`week-item pub ${p.status === 'published' ? 'done' : ''}`}>
                    <Link to="/content/$id" params={{ id: c.id }} className="wi-main">
                      <span className="wi-time">{fmt.time(p.scheduledAt!)}</span>
                      <span className="wi-title">{contentTitle(c)}</span>
                      <span className="wi-sub">
                        {platformName(p.platform)} · {t(`content.status.${c.status}`)} · {t(`next.${na.key}`)}
                      </span>
                    </Link>
                    <MoveSelect
                      options={moveOptions}
                      current={day}
                      onMove={(dd) => void movePub(p, dd)}
                      label={contentTitle(c)}
                    />
                  </div>
                );
              })}
              {de.map((e) => (
                <div key={e.id} className="week-item event">
                  <span className="wi-time">{e.allDay ? '' : fmt.time(e.startAt)}</span>
                  <span className="wi-title">{e.title}</span>
                </div>
              ))}
              {dt.map((x) => (
                <div key={x.id} className={`week-item task ${x.status === 'done' ? 'done' : ''}`}>
                  <label className="wi-check">
                    <input
                      type="checkbox"
                      checked={x.status === 'done'}
                      onChange={(e) => void toggleTask(s, x.id, e.target.checked)}
                      aria-label={x.title}
                    />
                    <span className="wi-title">{x.title}</span>
                    {x.estimateMin ? <Pill>{t('week.minutes', { count: x.estimateMin })}</Pill> : null}
                  </label>
                  {x.status !== 'done' && (
                    <MoveSelect
                      options={moveOptions}
                      current={day}
                      onMove={(dd) => void moveTask(x, dd)}
                      label={x.title}
                    />
                  )}
                </div>
              ))}
              {empty && <div className="meta week-free">{t('week.free')}</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Keyboard/touch alternative to drag and drop: move an item to another day. */
function MoveSelect({
  options,
  current,
  onMove,
  label,
}: {
  options: Date[];
  current: Date;
  onMove: (d: Date) => void;
  label: string;
}) {
  return (
    <select
      className="move-select"
      aria-label={t('week.move', { title: label })}
      value=""
      onChange={(e) => {
        const d = options[Number(e.target.value)];
        if (d) onMove(d);
      }}
    >
      <option value="">{t('week.move_short')}</option>
      {options.map((o, i) =>
        sameDay(o, current) ? null : (
          <option key={o.toISOString()} value={i}>
            {fmt.dayShort(o)}
          </option>
        ),
      )}
    </select>
  );
}

/** Export pieces, open tasks and big events (with alerts) as an .ics file in the workspace time zone. */
export function IcsButton() {
  useT();
  const s = useSession();
  return (
    <Button
      size="sm"
      aria-label={t('week.ics')}
      title={t('week.ics')}
      onClick={() => void downloadPlanIcs(s)}
    >
      <CalendarArrowDown size={15} aria-hidden /> <span className="hide-mobile">{t('week.ics')}</span>
    </Button>
  );
}
