import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIsPhone, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { ideaToContent, schedulePublication } from '../../data/domain';
import type { Content, HQEvent, Idea, Publication, Task, Workspace } from '../../data/schema';
import { create, mutate } from '../../data/store';
import { fmt, t, useT } from '../../i18n';
import { gapText, platformName } from '../../i18n/render';
import { cadenceGaps } from '../../rules/cadence';
import {
  addDays,
  DAY,
  fmtTime,
  fromLocalInput,
  sameDay,
  startOfDay,
  startOfWeek,
  toLocalInput,
} from '../../rules/time';
import { Button, IconButton, Sheet, Tabs } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { contentTitle, ProjectSelect } from '../common';

type View = 'agenda' | 'week' | 'month';
interface Item {
  key: string;
  kind: 'pub' | 'event' | 'task';
  at: number;
  allDay: boolean;
  title: string;
  sub?: string;
  cls: string;
  to: string;
  pub?: Publication;
  event?: HQEvent;
  done?: boolean;
}

export function CalendarPage() {
  useT();
  const s = useSession();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const [view, setView] = useState<View>(phone ? 'agenda' : 'week');
  const [anchor, setAnchor] = useState(() => Date.now());
  const [newEvent, setNewEvent] = useState<{ startAt: string } | null>(null);
  const [overDay, setOverDay] = useState<number | null>(null);

  const range = useMemo(() => {
    if (view === 'week') {
      const st = startOfWeek(anchor).getTime();
      return { start: st, end: st + 7 * DAY };
    }
    if (view === 'month') {
      const d = new Date(anchor);
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const st = startOfWeek(first).getTime();
      return { start: st, end: st + 42 * DAY };
    }
    const st = startOfDay(anchor).getTime();
    return { start: st, end: st + 21 * DAY };
  }, [view, anchor]);

  const data = useLive(
    async (ss) => {
      const a = new Date(range.start).toISOString();
      const z = new Date(range.end).toISOString();
      const [pubsS, pubsP, events, tasks, ws, ready, shortlisted] = await Promise.all([
        ss.db.publications.where('scheduledAt').between(a, z).toArray(),
        ss.db.publications.where('publishedAt').between(a, z).toArray(),
        ss.db.events.where('startAt').between(a, z).toArray(),
        ss.db.tasks.where('dueAt').between(a, z).toArray(),
        ss.db.workspace.get('workspace'),
        ss.db.content.where('status').anyOf('ready', 'producing').toArray(),
        ss.db.ideas.where('status').equals('shortlisted').toArray(),
      ]);
      const pubs = [...new Map([...pubsS, ...pubsP].map((p) => [p.id, p])).values()].filter(
        (p) => !p.deletedAt && p.status !== 'cancelled',
      );
      const cids = [...new Set(pubs.map((p) => p.contentId))];
      const contents = (await ss.db.content.bulkGet(cids)).filter(Boolean) as Content[];
      return {
        pubs,
        events: events.filter((e) => !e.deletedAt),
        tasks: tasks.filter((x) => !x.deletedAt),
        ws,
        contents,
        ready: ready.filter((c) => !c.deletedAt && !c.archivedAt && !c._nextPublishAt),
        shortlisted: shortlisted.filter((i) => !i.deletedAt && !i.archivedAt),
      };
    },
    [range.start, range.end],
    {
      pubs: [] as Publication[],
      events: [] as HQEvent[],
      tasks: [] as Task[],
      ws: undefined as Workspace | undefined,
      contents: [] as Content[],
      ready: [] as Content[],
      shortlisted: [] as Idea[],
    },
  );
  const cmap = new Map(data.contents.map((c) => [c.id, c]));
  const items: Item[] = [
    ...data.pubs
      .filter((p) => cmap.get(p.contentId) && !cmap.get(p.contentId)!.deletedAt)
      .map((p) => ({
        key: `p${p.id}`,
        kind: 'pub' as const,
        at: Date.parse((p.publishedAt ?? p.scheduledAt)!),
        allDay: false,
        title: contentTitle(cmap.get(p.contentId)!),
        sub: `${t('today.publish')} · ${platformName(p.platform)}`,
        cls: `pub ${p.status === 'published' ? 'done' : ''}`,
        to: `/content/${p.contentId}`,
        pub: p,
        done: p.status === 'published',
      })),
    ...data.events.map((e) => ({
      key: `e${e.id}`,
      kind: 'event' as const,
      at: Date.parse(e.startAt),
      allDay: e.allDay,
      title: e.title,
      sub: t(`event.kind.${e.kind}`),
      cls: e.kind === 'milestone' ? 'milestone' : e.kind === 'deadline' ? 'deadline' : 'block',
      to: e.contentId ? `/content/${e.contentId}` : e.projectId ? `/projects/${e.projectId}` : '/calendar',
      event: e,
    })),
    ...data.tasks
      .filter((x) => x.status !== 'done')
      .map((x) => ({
        key: `t${x.id}`,
        kind: 'task' as const,
        at: Date.parse(x.dueAt!),
        allDay: true,
        title: x.title,
        sub: x.hardDeadline ? t('today.deadline') : t('calendar.task_due'),
        cls: x.hardDeadline ? 'deadline task' : 'task',
        to: '/tasks',
      })),
  ].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.at - b.at);
  const gaps = cadenceGaps(
    data.ws,
    data.pubs,
    Math.max(Date.now(), range.start),
    Math.round((range.end - Math.max(Date.now(), range.start)) / DAY),
  );

  const moveTo = async (item: Item, day: number) => {
    const old = new Date(item.at);
    const d = new Date(day);
    d.setHours(old.getHours(), old.getMinutes(), 0, 0);
    if (item.pub && item.pub.status !== 'published') {
      await mutate(s, { label: 'h.reschedule' }, (m) =>
        m.update('publications', item.pub!.id, { scheduledAt: d.toISOString() }),
      );
      toast(t('calendar.moved_to', { date: fmt.date(d, { weekday: 'short', day: 'numeric' }) }));
    } else if (item.event) {
      const dur = item.event.endAt ? Date.parse(item.event.endAt) - Date.parse(item.event.startAt) : 0;
      await mutate(s, { label: 'h.moveEvent' }, (m) =>
        m.update('events', item.event!.id, {
          startAt: d.toISOString(),
          endAt: dur ? new Date(d.getTime() + dur).toISOString() : null,
        }),
      );
    }
  };
  const onDropDay = async (day: number, raw: string) => {
    setOverDay(null);
    const [kind, id] = raw.split(':');
    if (kind === 'item') {
      const it = items.find((x) => x.key === id);
      if (it) await moveTo(it, day);
    } else if (kind === 'content') {
      const c = data.ready.find((x) => x.id === id);
      if (!c) return;
      const at = new Date(day);
      at.setHours(18, 0, 0, 0);
      await schedulePublication(s, c, c.platforms[0] ?? 'instagram', at.toISOString());
      toast(t('calendar.scheduled', { title: contentTitle(c), when: fmt.dayTime(at) }));
    } else if (kind === 'idea') {
      const i = data.shortlisted.find((x) => x.id === id);
      if (!i || !confirm(t('calendar.confirm_idea', { title: i.title }))) return;
      const c = await ideaToContent(s, i, {
        formatTemplateId: 'reel',
        platforms: i.platforms?.length ? i.platforms : (data.ws?.platforms.slice(0, 1) ?? []),
      });
      if (c.platforms[0]) {
        const at = new Date(day);
        at.setHours(18, 0, 0, 0);
        await schedulePublication(s, { ...c }, c.platforms[0], at.toISOString());
      }
      toast(t('calendar.planned_from_idea'));
    }
  };

  const ev = (it: Item) => (
    <Link
      key={it.key}
      to={it.to}
      className={`ev ${it.cls}`}
      draggable={!phone && (it.kind === 'event' || (it.kind === 'pub' && !it.done))}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', `item:${it.key}`)}
    >
      {!it.allDay && <span className="num">{fmtTime(new Date(it.at).toISOString())} </span>}
      {it.title || t('common.untitled')}
      {it.sub && (
        <div className="meta" style={{ fontSize: 10.5 }}>
          {it.sub}
        </div>
      )}
    </Link>
  );
  const dayCells = (n: number) => Array.from({ length: n }, (_, i) => addDays(range.start, i).getTime());
  const title =
    view === 'month'
      ? fmt.date(anchor, { month: 'long', year: 'numeric' })
      : `${fmt.date(range.start, { day: 'numeric', month: 'short' })} – ${fmt.date(range.end - 1, { day: 'numeric', month: 'short' })}`;
  const step = view === 'month' ? 30 * DAY : view === 'week' ? 7 * DAY : 21 * DAY;

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <PageHeader
        title={t('nav.calendar')}
        sub={t('calendar.sub')}
        actions={
          <Button
            variant="primary"
            onClick={() =>
              setNewEvent({ startAt: new Date(Math.max(Date.now(), range.start)).toISOString() })
            }
          >
            <Plus size={15} /> {t('calendar.add_block')}
          </Button>
        }
      />
      <div className="hstack" style={{ marginBottom: 12 }}>
        <Tabs
          label={t('calendar.view_label')}
          value={view}
          onChange={setView}
          options={[
            { value: 'agenda', label: t('calendar.agenda') },
            { value: 'week', label: t('calendar.week') },
            { value: 'month', label: t('calendar.month') },
          ]}
        />
        <IconButton label={t('common.previous')} onClick={() => setAnchor((a) => a - step)}>
          <ChevronLeft size={18} />
        </IconButton>
        <Button size="sm" onClick={() => setAnchor(Date.now())}>
          {t('nav.today')}
        </Button>
        <IconButton label={t('common.next')} onClick={() => setAnchor((a) => a + step)}>
          <ChevronRight size={18} />
        </IconButton>
        <strong>{title}</strong>
        <span className="spacer" />
        <span className="hstack meta" aria-hidden>
          <span className="ev pub" style={{ width: 'auto' }}>
            {t('calendar.legend.publish')}
          </span>
          <span className="ev block" style={{ width: 'auto' }}>
            {t('calendar.legend.production')}
          </span>
          <span className="ev deadline" style={{ width: 'auto' }}>
            {t('calendar.legend.deadline')}
          </span>
          <span className="ev milestone" style={{ width: 'auto' }}>
            {t('calendar.legend.milestone')}
          </span>
        </span>
      </div>

      {view === 'agenda' && (
        <div className="stack">
          {dayCells(21).map((d) => {
            const its = items.filter((x) => sameDay(x.at, d));
            const g = gaps.filter((x) => x.day && sameDay(x.day, d));
            if (!its.length && !g.length && !sameDay(d, Date.now())) return null;
            return (
              <section key={d} aria-label={fmt.weekdayLong(d)}>
                <h4 style={{ margin: '6px 0' }}>
                  {sameDay(d, Date.now()) ? `${t('nav.today')} · ` : ''}
                  {fmt.date(d, { weekday: 'long', day: 'numeric', month: 'short' })}
                </h4>
                <div className="list">
                  {its.map((it) => (
                    <Link key={it.key} to={it.to} className="row">
                      <span className="sched-time">
                        {it.allDay ? t('common.all_day') : fmtTime(new Date(it.at).toISOString())}
                      </span>
                      <span
                        className={`ev ${it.cls}`}
                        style={{ width: 6, padding: 0, minHeight: 28, flex: 'none' }}
                        aria-hidden
                      />
                      <div className="grow">
                        <div className="title">{it.title || t('common.untitled')}</div>
                        <div className="sub">{it.sub}</div>
                      </div>
                    </Link>
                  ))}
                  {g.map((x) => (
                    <div key={`${x.platform}:${x.day ?? x.weekStart}`} className="row static">
                      <span className="gap-slot">{t('today.gap')}</span>
                      <span className="meta">{gapText(x)}</span>
                    </div>
                  ))}
                  {!its.length && !g.length && (
                    <div className="row static meta">{t('calendar.nothing_planned')}</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {view === 'week' && (
        <div
          className={phone ? '' : 'grid2'}
          style={phone ? undefined : { gridTemplateColumns: 'minmax(0, 1fr) 230px' }}
        >
          <div className="week">
            {dayCells(7).map((d) => (
              <section key={d} className="day" aria-label={fmt.weekdayLong(d)}>
                <div className={`day-head ${sameDay(d, Date.now()) ? 'today' : ''}`}>
                  <span>{fmt.date(d, { weekday: 'short' })}</span>
                  <span className="d num">{new Date(d).getDate()}</span>
                </div>
                <div
                  className={`day-body ${overDay === d ? 'drop' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverDay(d);
                  }}
                  onDragLeave={() => setOverDay(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    void onDropDay(d, e.dataTransfer.getData('text/plain'));
                  }}
                  onDoubleClick={() => setNewEvent({ startAt: new Date(d + 10 * 3600_000).toISOString() })}
                >
                  {items.filter((x) => sameDay(x.at, d)).map(ev)}
                  {gaps
                    .filter((x) => x.day && sameDay(x.day, d))
                    .map((x) => (
                      <div key={`${x.platform}:${x.day ?? x.weekStart}`} className="gap-slot">
                        {gapText(x)}
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </div>
          {!phone && (
            <aside className="stack" aria-label={t('calendar.tray')}>
              <div className="box">
                <h4>
                  {t('calendar.ready_to_schedule', {
                    n: data.ready.filter((c) => c.status === 'ready').length,
                  })}
                </h4>
                <span className="meta">{t('calendar.drag_hint')}</span>
                {data.ready
                  .filter((c) => c.status === 'ready')
                  .map((c) => (
                    <div
                      key={c.id}
                      className="card"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', `content:${c.id}`)}
                    >
                      <span className="title">{contentTitle(c)}</span>
                    </div>
                  ))}
              </div>
              <div className="box">
                <h4>{t('calendar.shortlisted', { n: data.shortlisted.length })}</h4>
                {data.shortlisted.slice(0, 12).map((i) => (
                  <div
                    key={i.id}
                    className="card"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', `idea:${i.id}`)}
                  >
                    <span className="title">★ {i.title || t('ideas.untitled')}</span>
                  </div>
                ))}
              </div>
              {gaps
                .filter((g) => !g.day)
                .map((g) => (
                  <div key={`${g.platform}:${g.weekStart}`} className="gap-slot">
                    {gapText(g)}
                  </div>
                ))}
            </aside>
          )}
        </div>
      )}

      {view === 'month' && (
        <div className="month">
          {dayCells(42).map((d) => {
            const its = items.filter((x) => sameDay(x.at, d));
            return (
              <div
                key={d}
                className={`cell ${new Date(d).getMonth() !== new Date(anchor).getMonth() ? 'out' : ''}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => void onDropDay(d, e.dataTransfer.getData('text/plain'))}
              >
                <span className={sameDay(d, Date.now()) ? 'pill accent' : 'meta'}>
                  {new Date(d).getDate()}
                </span>
                {its.slice(0, phone ? 1 : 3).map(ev)}
                {its.length > (phone ? 1 : 3) && (
                  <span className="meta">+{its.length - (phone ? 1 : 3)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <EventSheet
        open={!!newEvent}
        startAt={newEvent?.startAt}
        onClose={() => setNewEvent(null)}
        onCreated={() => toast(t('calendar.added'))}
        navigateToContent={(id) => void navigate({ to: '/content/$id', params: { id } })}
      />
    </div>
  );
}

function EventSheet({
  open,
  startAt,
  onClose,
  onCreated,
}: {
  open: boolean;
  startAt?: string;
  onClose: () => void;
  onCreated: () => void;
  navigateToContent: (id: string) => void;
}) {
  useT();
  const s = useSession();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<HQEvent['kind']>('production_block');
  const [at, setAt] = useState('');
  const [hours, setHours] = useState(2);
  const [allDay, setAllDay] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const start = at || toLocalInput(startAt);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('calendar.add_title')}
      footer={
        <Button
          variant="primary"
          disabled={!title.trim()}
          onClick={async () => {
            const iso = fromLocalInput(start) ?? new Date().toISOString();
            await create(s, 'events', {
              title: title.trim(),
              kind,
              startAt: iso,
              endAt:
                allDay || kind === 'milestone'
                  ? null
                  : new Date(Date.parse(iso) + hours * 3600_000).toISOString(),
              allDay,
              projectId,
            });
            setTitle('');
            setAt('');
            onClose();
            onCreated();
          }}
        >
          {t('common.add')}
        </Button>
      }
    >
      <div className="field">
        <label className="lbl" htmlFor="etitle">
          {t('common.title')}
        </label>
        <input
          id="etitle"
          className="input"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('calendar.title_placeholder')}
        />
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="lbl" htmlFor="ekind">
            {t('task.kind_label')}
          </label>
          <select
            id="ekind"
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value as HQEvent['kind'])}
          >
            <option value="production_block">{t('event.kind.production_block')}</option>
            <option value="deadline">{t('task.hard_deadline')}</option>
            <option value="milestone">{t('event.kind.milestone')}</option>
            <option value="external">{t('calendar.external')}</option>
          </select>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="estart">
            {t('projects.start')}
          </label>
          <input
            id="estart"
            type="datetime-local"
            className="input"
            value={start}
            onChange={(e) => setAt(e.target.value)}
          />
        </div>
        {!allDay && kind !== 'milestone' && (
          <div className="field">
            <label className="lbl" htmlFor="ehours">
              {t('calendar.duration_h')}
            </label>
            <input
              id="ehours"
              type="number"
              min={0.25}
              step={0.25}
              className="input"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </div>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />{' '}
        {t('calendar.all_day')}
      </label>
      <div className="field">
        <span className="lbl">{t('common.project')}</span>
        <ProjectSelect value={projectId} onChange={setProjectId} />
      </div>
    </Sheet>
  );
}
