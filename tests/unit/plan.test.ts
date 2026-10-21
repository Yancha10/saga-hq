import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../../src/app/session';
import { getMeta } from '../../src/data/db';
import {
  AUTO_NOTE,
  type BigEvent,
  bigEvents,
  computeSlide,
  dayOf,
  dueReminders,
  type PlanItem,
  pausePlan,
  resumePlan,
  shiftIso,
  slidePlan,
  undoSlide,
} from '../../src/data/plan';
import { buildIcs } from '../../src/data/saga';
import { create, update } from '../../src/data/store';
import { openDevice } from '../helpers';

// Wednesday 21 Oct 2026, 10:00 local
const NOW = new Date(2026, 9, 21, 10, 0).getTime();
const at = (d: number, h = 18) => new Date(2026, 9, d, h, 0).toISOString();
const TODAY = dayOf(NOW);

const item = (id: string, d: number, group: string | null, pending = true): PlanItem => ({
  table: 'tasks',
  id,
  at: at(d),
  group,
  pending,
  title: id,
});

describe('sliding the plan', () => {
  it('moves the late item to today and everything after it by the same days, per project', () => {
    const r = computeSlide(
      [
        item('late', 18, 'p1'), // 3 days late
        item('next', 22, 'p1'),
        item('later', 30, 'p1'),
        item('before', 10, 'p1', false), // an earlier production block stays where it was
        item('other', 25, 'p2'), // another project, on time
      ],
      TODAY,
    );
    const moved = Object.fromEntries(r.moves.map((m) => [m.id, m.patch.dueAt]));
    expect(moved).toEqual({ late: at(21), next: at(25), later: shiftIso(at(30), 3) });
    expect(r.groups).toEqual([{ group: 'p1', days: 3, count: 3 }]);
  });

  it('loose tasks only move themselves; paused projects do not move', () => {
    const r = computeSlide(
      [item('loose', 19, null), item('loose-future', 28, null), item('p', 15, 'paused')],
      TODAY,
      new Set(['paused']),
    );
    expect(r.moves.map((m) => [m.id, m.patch.dueAt])).toEqual([['loose', at(21)]]);
  });

  it('keeps the time of day across a daylight-saving change', () => {
    const before = new Date(2026, 9, 20, 18, 0).toISOString(); // DST ends 25 Oct in Europe
    const after = new Date(shiftIso(before, 10));
    expect(after.getHours()).toBe(18);
    expect(after.getDate()).toBe(30);
  });
});

describe('reminders before big events', () => {
  const ev = (key: string, inDays: number): BigEvent => ({
    key,
    title: key,
    day: TODAY + inDays,
    kind: 'event',
    to: '/calendar',
  });

  it('gives the two-week reminder, then the one-week one, never twice', () => {
    const given = new Set<string>();
    const first = dueReminders([ev('fest', 12)], TODAY, given);
    expect(first.map((r) => r.days)).toEqual([12]);
    for (const k of first[0]!.mark) given.add(k);
    expect(dueReminders([ev('fest', 12)], TODAY, given)).toEqual([]);
    // a week later
    const second = dueReminders([ev('fest', 12)], TODAY + 6, given);
    expect(second.map((r) => r.days)).toEqual([6]);
    for (const k of second[0]!.mark) given.add(k);
    expect(dueReminders([ev('fest', 12)], TODAY + 7, given)).toEqual([]);
  });

  it('inside a week only one reminder; far away or past none; a moved event reminds again', () => {
    const one = dueReminders([ev('a', 3), ev('far', 30), ev('past', -1)], TODAY, new Set());
    expect(one.map((r) => [r.ev.key, r.mark.length])).toEqual([['a', 2]]);
    const given = new Set(one[0]!.mark);
    expect(dueReminders([ev('a', 5)], TODAY, given)).toHaveLength(1);
  });

  it('big events: milestones/deadlines/external, radar (not discarded), fixed-date tasks', () => {
    const base = { id: 'x', workspaceId: 'w', createdAt: at(1), updatedAt: at(1) } as never;
    const list = bigEvents({
      events: [
        { ...(base as object), id: 'm', title: 'Estreno', kind: 'milestone', startAt: at(30), allDay: true },
        {
          ...(base as object),
          id: 'b',
          title: 'Rodaje',
          kind: 'production_block',
          startAt: at(25),
          allDay: false,
        },
      ] as never,
      radar: [
        {
          ...(base as object),
          id: 'r',
          title: 'Festival',
          startDate: '2026-11-17',
          verification: 'unverified',
        },
        { ...(base as object), id: 'd', title: 'No', startDate: '2026-11-18', verification: 'discarded' },
      ] as never,
      tasks: [
        { ...(base as object), id: 't', title: 'Entrega', status: 'todo', hardDeadline: true, dueAt: at(28) },
        { ...(base as object), id: 'u', title: 'Normal', status: 'todo', dueAt: at(27) },
      ] as never,
    });
    expect(list.map((e) => e.key)).toEqual(['tk-t', 'ev-m', 'rd-r']);
  });

  it('calendar file carries alerts 14 and 7 days before', () => {
    const ics = buildIcs(
      [{ uid: 'a@x', start: at(30), allDay: true, title: 'Estreno', alarms: [14, 7] }],
      'UTC',
      'Saga',
    );
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT327H');
    expect(ics).toContain('TRIGGER:-PT159H');
  });
});

describe('pause, resume and auto-slide on a real workspace', () => {
  const sessions: Session[] = [];
  afterEach(() => {
    for (const s of sessions.splice(0)) s.close();
  });

  async function setup() {
    const s = await openDevice();
    sessions.push(s);
    const p = await create(s, 'projects', { name: 'Temporada', status: 'active', isFocus: false, color: 1 });
    const mk = (title: string, d: number, extra: object = {}) =>
      create(s, 'tasks', {
        title,
        status: 'todo',
        kind: 'task',
        isBlocker: false,
        dueAt: at(d),
        projectId: p.id,
        ...extra,
      });
    return { s, p, mk };
  }

  it('auto-slide moves late work, shows a note, and undo puts it back for the day', async () => {
    const { s, mk } = await setup();
    const late = await mk('Guion', 18);
    const next = await mk('Rodaje', 24);
    const fixed = await mk('Entrega festival', 19, { hardDeadline: true });
    const r = await slidePlan(s, NOW);
    expect(r.moves).toHaveLength(2);
    expect((await s.db.tasks.get(late.id))?.dueAt).toBe(at(21));
    expect((await s.db.tasks.get(next.id))?.dueAt).toBe(at(27));
    expect((await s.db.tasks.get(fixed.id))?.dueAt).toBe(at(19)); // fixed dates never move
    expect(await getMeta(s.db, AUTO_NOTE)).toMatchObject({ count: 2, days: 3 });
    expect((await slidePlan(s, NOW)).moves).toHaveLength(0); // idempotent

    await undoSlide(s, NOW);
    expect((await s.db.tasks.get(late.id))?.dueAt).toBe(at(18));
    expect((await slidePlan(s, NOW)).moves).toHaveLength(0); // not again today
    expect((await slidePlan(s, NOW + 86400000)).moves.length).toBeGreaterThan(0); // tomorrow it does
  });

  it('can be turned off', async () => {
    const { s, mk } = await setup();
    await mk('Guion', 18);
    await update(s, 'workspace', 'workspace', { autoReschedule: false });
    expect((await slidePlan(s, NOW)).moves).toHaveLength(0);
  });

  it('pausing everything stops sliding; resuming moves pending dates by the days paused', async () => {
    const { s, mk } = await setup();
    const t1 = await mk('Guion', 23);
    const t2 = await mk('Rodaje', 30);
    await pausePlan(s);
    // pretend the pause started on the 21st and we come back on the 26th
    await update(s, 'workspace', 'workspace', { planPausedAt: at(21, 9) });
    const back = new Date(2026, 9, 26, 10).getTime();
    expect((await slidePlan(s, back)).moves).toHaveLength(0); // paused: nothing is late
    const moved = await resumePlan(s, undefined, back);
    expect(moved).toBe(2);
    expect((await s.db.tasks.get(t1.id))?.dueAt).toBe(at(28));
    expect((await s.db.tasks.get(t2.id))?.dueAt).toBe(shiftIso(at(30), 5));
    expect((await s.db.workspace.get('workspace'))?.planPausedAt).toBeFalsy();
  });

  it('pausing one project moves only that project on resume', async () => {
    const { s, p, mk } = await setup();
    const mine = await mk('Guion', 23);
    const loose = await create(s, 'tasks', {
      title: 'Suelta',
      status: 'todo',
      kind: 'task',
      isBlocker: false,
      dueAt: at(24),
    });
    await pausePlan(s, p.id);
    await update(s, 'projects', p.id, { pausedAt: at(21, 9) });
    await resumePlan(s, p.id, new Date(2026, 9, 23, 10).getTime());
    expect((await s.db.tasks.get(mine.id))?.dueAt).toBe(at(25));
    expect((await s.db.tasks.get(loose.id))?.dueAt).toBe(at(24));
    expect((await s.db.projects.get(p.id))?.status).toBe('active');
  });
});
