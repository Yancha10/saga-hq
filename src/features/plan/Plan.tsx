import { Link } from '@tanstack/react-router';
import { BellRing, CalendarArrowDown, CalendarClock, Pause, Play, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { useLive, useSession } from '../../app/context';
import { notificationsSupported, remindBigEvents } from '../../app/planKeeper';
import type { Session } from '../../app/session';
import { toast } from '../../app/status';
import { getMeta, setMeta } from '../../data/db';
import {
  AUTO_NOTE,
  type AutoSlideNote,
  autoRescheduleOn,
  type BigEvent,
  dateOfDay,
  dayOf,
  loadBigEvents,
  pausedDays,
  pausePlan,
  REMIND_DAYS,
  resumePlan,
  slidePlan,
  undoSlide,
} from '../../data/plan';
import { buildIcs, type IcsItem, publicationIcsItems, workspaceTz } from '../../data/saga';
import type { Content } from '../../data/schema';
import { update } from '../../data/store';
import { fmt, t, useT } from '../../i18n';
import { Button, Confirm, Section } from '../../ui/kit';
import { contentTitle, downloadText } from '../common';

// ---------- Calendar file with alerts ----------

/** Pieces, open tasks and big events as one .ics; big events carry alerts 14 and 7 days before. */
export async function buildPlanIcs(s: Session): Promise<{ text: string; count: number; alerts: number }> {
  const ws = await s.db.workspace.get('workspace');
  const pubs = (await s.db.publications.toArray()).filter((p) => !p.deletedAt);
  const contents = await s.db.content.bulkGet([...new Set(pubs.map((p) => p.contentId))]);
  const cmap = new Map(contents.filter((c): c is Content => !!c).map((c) => [c.id, c]));
  const items: IcsItem[] = publicationIcsItems(pubs, cmap, (c, p) =>
    p.status === 'published' ? `✓ ${contentTitle(c)}` : contentTitle(c),
  );
  const alarms = [...REMIND_DAYS];
  let alerts = 0;
  for (const x of await s.db.tasks.toArray()) {
    if (x.deletedAt || !x.dueAt || x.status === 'done') continue;
    if (x.hardDeadline) alerts++;
    items.push({
      uid: `task-${x.id}@saga-hq`,
      start: x.dueAt,
      allDay: true,
      title: `☐ ${x.title}`,
      updatedAt: x.updatedAt,
      ...(x.hardDeadline ? { alarms } : {}),
    });
  }
  for (const e of await s.db.events.toArray()) {
    if (e.deletedAt) continue;
    const big = e.kind !== 'production_block';
    if (big) alerts++;
    items.push({
      uid: `event-${e.id}@saga-hq`,
      start: e.startAt,
      ...(e.endAt ? { end: e.endAt } : {}),
      allDay: e.allDay,
      title: e.title,
      updatedAt: e.updatedAt,
      ...(big ? { alarms } : {}),
    });
  }
  for (const r of await s.db.radar.toArray()) {
    if (r.deletedAt || r.archivedAt || r.verification === 'discarded' || !r.startDate) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.startDate)) continue;
    alerts++;
    const end = r.endDate && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate) ? r.endDate : r.startDate;
    const endNext = new Date(`${end}T12:00:00`);
    endNext.setDate(endNext.getDate() + 1);
    items.push({
      uid: `radar-${r.id}@saga-hq`,
      start: new Date(`${r.startDate}T12:00:00`).toISOString(),
      end: endNext.toISOString(),
      allDay: true,
      title: `★ ${r.title}`,
      updatedAt: r.updatedAt,
      alarms,
    });
  }
  return { text: buildIcs(items, workspaceTz(ws), ws?.name || 'Saga HQ'), count: items.length, alerts };
}

export async function downloadPlanIcs(s: Session): Promise<void> {
  const { text, count, alerts } = await buildPlanIcs(s);
  downloadText('saga-hq.ics', text, 'text/calendar');
  toast(t('plan.ics_done', { count, alerts }));
}

// ---------- Settings: Plan & reminders ----------

export function PlanSec() {
  useT();
  const s = useSession();
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  const upcoming = useLive((ss) => loadBigEvents(ss), [], [] as BigEvent[]);
  const [perm, setPerm] = useState(notificationsSupported() ? Notification.permission : 'unsupported');
  const [confirmPause, setConfirmPause] = useState(false);
  if (!ws) return null;
  const today = dayOf(Date.now());
  const soon = upcoming.filter((e) => e.day >= today).slice(0, 8);
  const auto = autoRescheduleOn(ws);
  return (
    <>
      <Section title={t('plan.pause_title')}>
        <p className="meta explain">{t('plan.pause_body')}</p>
        {ws.planPausedAt ? (
          <div className="plan-paused">
            <p>
              <Pause size={15} aria-hidden />{' '}
              {t('plan.paused_since', { date: fmt.dayShort(ws.planPausedAt) })}
            </p>
            <Button variant="primary" onClick={() => void resume(s, ws.planPausedAt)}>
              <Play size={15} aria-hidden /> {resumeLabel(ws.planPausedAt)}
            </Button>
          </div>
        ) : (
          <Button onClick={() => setConfirmPause(true)}>
            <Pause size={15} aria-hidden /> {t('plan.pause_all')}
          </Button>
        )}
        <p className="meta">{t('plan.pause_project_hint')}</p>
      </Section>

      <Section title={t('plan.auto_title')}>
        <label className="check">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) =>
              void update(
                s,
                'workspace',
                'workspace',
                { autoReschedule: e.target.checked },
                { label: 'h.prefs' },
              )
            }
          />{' '}
          {t('plan.auto_label')}
        </label>
        <p className="meta explain">{t('plan.auto_body')}</p>
        <Button
          size="sm"
          onClick={async () => {
            const r = await slidePlan(s, Date.now(), true);
            toast(r.moves.length ? t('plan.slid', { count: r.moves.length }) : t('plan.nothing_late'));
          }}
        >
          <CalendarClock size={15} aria-hidden /> {t('plan.slide_now')}
        </Button>
      </Section>

      <Section title={t('plan.remind_title')}>
        <p className="meta explain">{t('plan.remind_body')}</p>
        <div className="plan-remind-ways">
          <div>
            <h5>{t('plan.calendar_title')}</h5>
            <p className="meta">{t('plan.calendar_body')}</p>
            <Button variant="primary" onClick={() => void downloadPlanIcs(s)}>
              <CalendarArrowDown size={15} aria-hidden /> {t('plan.calendar_btn')}
            </Button>
          </div>
          <div>
            <h5>{t('plan.notif_title')}</h5>
            <p className="meta">{t('plan.notif_body')}</p>
            {perm === 'granted' ? (
              <p className="meta ok-text">
                <BellRing size={14} aria-hidden /> {t('plan.notif_on')}
              </p>
            ) : perm === 'unsupported' ? (
              <p className="meta">{t('plan.notif_unsupported')}</p>
            ) : perm === 'denied' ? (
              <p className="meta">{t('plan.notif_denied')}</p>
            ) : (
              <Button
                onClick={async () => {
                  const p = await Notification.requestPermission();
                  setPerm(p);
                  if (p === 'granted') await remindBigEvents(s);
                }}
              >
                <BellRing size={15} aria-hidden /> {t('plan.notif_btn')}
              </Button>
            )}
          </div>
        </div>
        <h5 className="plan-soon-h">{t('plan.soon_title')}</h5>
        {soon.length ? (
          <ul className="plan-soon">
            {soon.map((e) => (
              <BigRow key={e.key} e={e} today={today} />
            ))}
          </ul>
        ) : (
          <p className="meta">{t('plan.soon_none')}</p>
        )}
      </Section>

      <Confirm
        open={confirmPause}
        title={t('plan.pause_all')}
        body={t('plan.pause_confirm')}
        confirmLabel={t('plan.pause_btn')}
        onConfirm={() => {
          setConfirmPause(false);
          void pausePlan(s).then(() => toast(t('plan.paused_toast')));
        }}
        onClose={() => setConfirmPause(false)}
      />
    </>
  );
}

function resumeLabel(pausedAt: string | null | undefined): string {
  const n = pausedDays(pausedAt);
  return n ? t('plan.resume_days', { count: n }) : t('plan.resume');
}

async function resume(s: Session, pausedAt: string | null | undefined): Promise<void> {
  const days = pausedDays(pausedAt);
  const moved = await resumePlan(s);
  toast(moved && days ? t('plan.resumed_moved', { count: moved, days }) : t('plan.resumed'));
}

function BigRow({ e, today }: { e: BigEvent; today: number }) {
  const left = e.day - today;
  return (
    <li className={left <= 7 ? 'near' : left <= 14 ? 'soon' : ''}>
      <Link to={e.to}>{e.title}</Link>
      <span className="meta">
        {fmt.dayShort(dateOfDay(e.day))} · {left === 0 ? t('plan.today') : t('plan.in_days', { count: left })}
      </span>
    </li>
  );
}

// ---------- Today ----------

/** Today: the plan is on hold, what slid forward (with undo), and big events in the next two weeks. */
export function PlanToday({ now }: { now: number }) {
  useT();
  const s = useSession();
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  const note = useLive((ss) => getMeta<AutoSlideNote>(ss.db, AUTO_NOTE), [], undefined);
  const big = useLive((ss) => loadBigEvents(ss), [], [] as BigEvent[]);
  if (!ws) return null;
  const today = dayOf(now);
  const soon = big.filter((e) => e.day >= today && e.day - today <= REMIND_DAYS[0]);
  const showNote = note && !note.dismissed && now - Date.parse(note.at) < 36 * 3600_000;
  if (!ws.planPausedAt && !showNote && !soon.length) return null;
  return (
    <>
      {ws.planPausedAt && (
        <section className="plan-card paused" aria-label={t('plan.paused_title')}>
          <div className="plan-card-head">
            <Pause size={16} aria-hidden />
            <h4>{t('plan.paused_title')}</h4>
            <span className="meta">{t('plan.paused_since', { date: fmt.dayShort(ws.planPausedAt) })}</span>
          </div>
          <p className="meta">{t('plan.paused_today_body')}</p>
          <Button variant="primary" size="sm" onClick={() => void resume(s, ws.planPausedAt)}>
            <Play size={14} aria-hidden /> {resumeLabel(ws.planPausedAt)}
          </Button>
        </section>
      )}
      {showNote && (
        <section className="plan-card" aria-label={t('plan.slid_title')}>
          <div className="plan-card-head">
            <CalendarClock size={16} aria-hidden />
            <h4>{t('plan.slid_title')}</h4>
            <button
              type="button"
              className="icon-btn sm"
              aria-label={t('common.dismiss')}
              onClick={() => void setMeta(s.db, AUTO_NOTE, { ...note, dismissed: true })}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
          <p className="meta">{t('plan.slid_body', { count: note.count, days: note.days })}</p>
          <Button
            size="sm"
            onClick={async () => {
              await undoSlide(s);
              toast(t('plan.slid_undone'));
            }}
          >
            <Undo2 size={14} aria-hidden /> {t('plan.slid_undo')}
          </Button>
        </section>
      )}
      {soon.length > 0 && (
        <section className="plan-card" aria-label={t('plan.soon_title')}>
          <div className="plan-card-head">
            <BellRing size={16} aria-hidden />
            <h4>{t('plan.soon_title')}</h4>
            <Link to="/settings" search={{ section: 'plan' } as never} className="meta">
              {t('plan.soon_settings')}
            </Link>
          </div>
          <ul className="plan-soon">
            {soon.slice(0, 5).map((e) => (
              <BigRow key={e.key} e={e} today={today} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
