import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIsPhone, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { ideaToContent, schedulePublication } from '../../data/domain';
import {
  type Content,
  type HQEvent,
  type Idea,
  PLATFORM_LABEL,
  type Publication,
  type Task,
  type Workspace,
} from '../../data/schema';
import { create, mutate } from '../../data/store';
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
import { ProjectSelect } from '../common';

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
        tasks: tasks.filter((t) => !t.deletedAt),
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
        title: cmap.get(p.contentId)!.title,
        sub: `Publish · ${PLATFORM_LABEL[p.platform]}`,
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
      sub: e.kind.replace('_', ' '),
      cls: e.kind === 'milestone' ? 'milestone' : e.kind === 'deadline' ? 'deadline' : 'block',
      to: e.contentId ? `/content/${e.contentId}` : e.projectId ? `/projects/${e.projectId}` : '/calendar',
      event: e,
    })),
    ...data.tasks
      .filter((t) => t.status !== 'done')
      .map((t) => ({
        key: `t${t.id}`,
        kind: 'task' as const,
        at: Date.parse(t.dueAt!),
        allDay: true,
        title: t.title,
        sub: t.hardDeadline ? 'deadline' : 'task due',
        cls: t.hardDeadline ? 'deadline task' : 'task',
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
      await mutate(s, { label: 'Reschedule publication' }, (m) =>
        m.update('publications', item.pub!.id, { scheduledAt: d.toISOString() }),
      );
      toast(`Moved to ${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}`);
    } else if (item.event) {
      const dur = item.event.endAt ? Date.parse(item.event.endAt) - Date.parse(item.event.startAt) : 0;
      await mutate(s, { label: 'Move event' }, (m) =>
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
      toast(
        `Scheduled “${c.title}” ${at.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`,
      );
    } else if (kind === 'idea') {
      const i = data.shortlisted.find((x) => x.id === id);
      if (!i || !confirm(`Create planned content from “${i.title}” for this day?`)) return;
      const c = await ideaToContent(s, i, {
        formatTemplateId: 'reel',
        platforms: i.platforms?.length ? i.platforms : (data.ws?.platforms.slice(0, 1) ?? []),
      });
      if (c.platforms[0]) {
        const at = new Date(day);
        at.setHours(18, 0, 0, 0);
        await schedulePublication(s, { ...c }, c.platforms[0], at.toISOString());
      }
      toast('Content planned from idea');
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
      {it.title}
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
      ? new Date(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : `${new Date(range.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(range.end - 1).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  const step = view === 'month' ? 30 * DAY : view === 'week' ? 7 * DAY : 21 * DAY;

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <PageHeader
        title="Calendar"
        sub="Publications, production blocks, deadlines and milestones"
        actions={
          <Button
            variant="primary"
            onClick={() =>
              setNewEvent({ startAt: new Date(Math.max(Date.now(), range.start)).toISOString() })
            }
          >
            <Plus size={15} /> Add block
          </Button>
        }
      />
      <div className="hstack" style={{ marginBottom: 12 }}>
        <Tabs
          label="Calendar view"
          value={view}
          onChange={setView}
          options={[
            { value: 'agenda', label: 'Agenda' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
        />
        <IconButton label="Previous" onClick={() => setAnchor((a) => a - step)}>
          <ChevronLeft size={18} />
        </IconButton>
        <Button size="sm" onClick={() => setAnchor(Date.now())}>
          Today
        </Button>
        <IconButton label="Next" onClick={() => setAnchor((a) => a + step)}>
          <ChevronRight size={18} />
        </IconButton>
        <strong>{title}</strong>
        <span className="spacer" />
        <span className="hstack meta" aria-hidden>
          <span className="ev pub" style={{ width: 'auto' }}>
            publish
          </span>
          <span className="ev block" style={{ width: 'auto' }}>
            production
          </span>
          <span className="ev deadline" style={{ width: 'auto' }}>
            deadline
          </span>
          <span className="ev milestone" style={{ width: 'auto' }}>
            milestone
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
              <section key={d} aria-label={new Date(d).toDateString()}>
                <h4 style={{ margin: '6px 0' }}>
                  {sameDay(d, Date.now()) ? 'Today · ' : ''}
                  {new Date(d).toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'short',
                  })}
                </h4>
                <div className="list">
                  {its.map((it) => (
                    <Link key={it.key} to={it.to} className="row">
                      <span className="sched-time">
                        {it.allDay ? 'all day' : fmtTime(new Date(it.at).toISOString())}
                      </span>
                      <span
                        className={`ev ${it.cls}`}
                        style={{ width: 6, padding: 0, minHeight: 28, flex: 'none' }}
                        aria-hidden
                      />
                      <div className="grow">
                        <div className="title">{it.title}</div>
                        <div className="sub">{it.sub}</div>
                      </div>
                    </Link>
                  ))}
                  {g.map((x) => (
                    <div key={x.message} className="row static">
                      <span className="gap-slot">gap</span>
                      <span className="meta">{x.message}</span>
                    </div>
                  ))}
                  {!its.length && !g.length && <div className="row static meta">Nothing planned.</div>}
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
          <div className="week" role="grid" aria-label="Week">
            {dayCells(7).map((d) => (
              <div key={d} className="day" role="gridcell">
                <div className={`day-head ${sameDay(d, Date.now()) ? 'today' : ''}`}>
                  <span>{new Date(d).toLocaleDateString(undefined, { weekday: 'short' })}</span>
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
                      <div key={x.message} className="gap-slot">
                        {x.message}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
          {!phone && (
            <aside className="stack" aria-label="Planning tray">
              <div className="box">
                <h4>Ready to schedule · {data.ready.filter((c) => c.status === 'ready').length}</h4>
                <span className="meta">Drag onto a day (18:00, editable)</span>
                {data.ready
                  .filter((c) => c.status === 'ready')
                  .map((c) => (
                    <div
                      key={c.id}
                      className="card"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', `content:${c.id}`)}
                    >
                      <span className="title">{c.title}</span>
                    </div>
                  ))}
              </div>
              <div className="box">
                <h4>Shortlisted ideas · {data.shortlisted.length}</h4>
                {data.shortlisted.slice(0, 12).map((i) => (
                  <div
                    key={i.id}
                    className="card"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', `idea:${i.id}`)}
                  >
                    <span className="title">★ {i.title}</span>
                  </div>
                ))}
              </div>
              {gaps
                .filter((g) => !g.day)
                .map((g) => (
                  <div key={g.message} className="gap-slot">
                    {g.message}
                  </div>
                ))}
            </aside>
          )}
        </div>
      )}

      {view === 'month' && (
        <div className="month" role="grid" aria-label="Month">
          {dayCells(42).map((d) => {
            const its = items.filter((x) => sameDay(x.at, d));
            return (
              <div
                key={d}
                role="gridcell"
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
        onCreated={() => toast('Added to calendar')}
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
      title="Add to calendar"
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
          Add
        </Button>
      }
    >
      <div className="field">
        <label className="lbl" htmlFor="etitle">
          Title
        </label>
        <input
          id="etitle"
          className="input"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Generate scene 2"
        />
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="lbl" htmlFor="ekind">
            Type
          </label>
          <select
            id="ekind"
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value as HQEvent['kind'])}
          >
            <option value="production_block">Production block</option>
            <option value="deadline">Hard deadline</option>
            <option value="milestone">Milestone</option>
            <option value="external">Other / external</option>
          </select>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="estart">
            Start
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
              Duration (h)
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
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
      </label>
      <div className="field">
        <span className="lbl">Project</span>
        <ProjectSelect value={projectId} onChange={setProjectId} />
      </div>
    </Sheet>
  );
}
