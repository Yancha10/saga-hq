import { Link } from '@tanstack/react-router';
import { ArrowRight, CalendarRange } from 'lucide-react';
import { useLive } from '../../app/context';
import { safeHttpUrl } from '../../core/url';
import { capacityOf, checklistOf, checklistProgress, nextActionFor, weekStart } from '../../data/saga';
import type { Content } from '../../data/schema';
import { fmt, t, useT } from '../../i18n';
import { contentTitle, MediaThumb } from '../common';

/** Today's hero: the next piece to publish, its opening, date, state and the one concrete next action. */
export function NextPiece({ now }: { now: number }) {
  useT();
  const d = useLive(
    async (s) => {
      const from = new Date(now - 3600_000).toISOString();
      const next = (await s.db.content.where('_nextPublishAt').above(from).limit(40).toArray())
        .filter((c) => !c.deletedAt && !c.archivedAt && c.status !== 'published' && c.status !== 'reviewed')
        .sort((a, b) => (a._nextPublishAt ?? '').localeCompare(b._nextPublishAt ?? ''))[0];
      const ws = await s.db.workspace.get('workspace');
      const ws0 = weekStart(new Date(now));
      const we = new Date(ws0.getTime() + 7 * 86400000);
      const [weekTasks, weekPubs] = await Promise.all([
        s.db.tasks
          .where('dueAt')
          .between(ws0.toISOString(), we.toISOString())
          .filter((x) => !x.deletedAt)
          .toArray(),
        s.db.publications
          .where('scheduledAt')
          .between(ws0.toISOString(), we.toISOString())
          .filter((p) => !p.deletedAt && p.status !== 'cancelled')
          .count(),
      ]);
      return { next, ws, cap: capacityOf(ws, weekTasks, weekPubs) };
    },
    [Math.floor(now / 60_000)],
    null,
  );
  if (!d) return null;
  const c: Content | undefined = d.next;
  const hours = (min: number) => fmt.num(min / 60, { maximumFractionDigits: 1 });
  const capLine = (
    <Link to="/week" className={`week-strip ${d.cap.overloaded || d.cap.overGoal ? 'warn' : ''}`}>
      <CalendarRange size={15} aria-hidden />
      <span>
        {t('today.week_line', {
          pubs: d.cap.pubs,
          goal: d.cap.goal,
          est: hours(d.cap.estimatedMin),
          avail: hours(d.cap.availableMin),
        })}
      </span>
      <ArrowRight size={14} aria-hidden />
    </Link>
  );
  if (!c) return capLine;
  const na = nextActionFor(c);
  const cl = checklistProgress(c, checklistOf(d.ws));
  const shots = (c.shots ?? []).filter((x) => !x.deleted);
  const ready = shots.filter((x) => x.status === 'selected' || x.status === 'final').length;
  const coverSrc = safeHttpUrl(c.coverUrl);
  const hasCover = !!c.coverMediaId || !!coverSrc;
  const noFinal = !c.finalExportUrl && !c.finalExportMediaId;
  return (
    <>
      <article className="next-piece" aria-label={t('today.next_piece')}>
        <div className={`np-cover ${hasCover ? '' : 'typo'}`}>
          {hasCover ? (
            <MediaThumb mediaId={c.coverMediaId} url={coverSrc} alt="" className="np-img" />
          ) : (
            <>
              <span className="np-cover-title">{c.coverText || contentTitle(c)}</span>
              <span className="np-cover-tag">{t('today.cover_proposal')}</span>
            </>
          )}
        </div>
        <div className="np-body">
          <div className="np-eyebrow">
            {t('today.next_piece')} · {fmt.relDay(c._nextPublishAt!)} {fmt.time(c._nextPublishAt!)}
          </div>
          <h2 className="np-title">
            <Link to="/content/$id" params={{ id: c.id }}>
              {contentTitle(c)}
            </Link>
          </h2>
          {c.hook && <p className="np-hook">{c.hook}</p>}
          <div className="np-meta">
            <span className="pill">{t(`content.status.${c.status}`)}</span>
            {c.pillar && <span className="tag">{c.pillar}</span>}
            {shots.length > 0 && (
              <span className="meta">{t('today.shots_ready', { ready, count: shots.length })}</span>
            )}
            <span className="meta">{t('saga.check_progress', { done: cl.done, total: cl.total })}</span>
            {noFinal && <span className="meta warn-text">{t('today.no_final')}</span>}
          </div>
          <Link
            to="/content/$id"
            params={{ id: c.id }}
            search={na.section ? { tab: na.section } : {}}
            className="btn primary np-action"
          >
            {t(`next.${na.key}`)} <ArrowRight size={15} aria-hidden />
          </Link>
          <p className="meta np-note">{t('today.pct_note')}</p>
        </div>
      </article>
      {capLine}
    </>
  );
}
