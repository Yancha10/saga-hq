import { Link } from '@tanstack/react-router';
import { CheckSquare, Clapperboard, GitBranch, Inbox, Lightbulb, Mic, Radar, Undo2 } from 'lucide-react';
import { useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { sendBackToInbox } from '../../capture/voiceInbox';
import type { Capture } from '../../data/schema';
import { fmt, t, useT } from '../../i18n';
import { IconButton } from '../../ui/kit';

const ICON = {
  idea: Lightbulb,
  task: CheckSquare,
  variant: GitBranch,
  radar: Radar,
  piece: Clapperboard,
  inbox: Inbox,
} as const;

const linkFor = (c: Capture): string => {
  const r = c.resultRef;
  if (!r) return '/inbox';
  if (r.entity === 'ideas') return `/ideas/${r.id}`;
  if (r.entity === 'content') return `/content/${r.id}`;
  if (r.entity === 'radar') return '/radar';
  if (r.entity === 'tasks') return '/tasks';
  return '/inbox';
};

/** Today: what arrived by voice/share in the last 48 h and where each one was filed. */
export function Arrivals({ now }: { now: number }) {
  useT();
  const s = useSession();
  const list = useLive(
    (ss) =>
      ss.db.captures
        .where('createdAt')
        .above(new Date(now - 48 * 3600_000).toISOString())
        .toArray()
        .then((cs) =>
          cs
            .filter((c) => c.channel === 'voice' && !c.deletedAt)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 6),
        ),
    [Math.floor(now / 60_000)],
    [] as Capture[],
  );
  if (!list.length) return null;
  return (
    <section className="arrivals" aria-label={t('voice.arrivals')}>
      <div className="arrivals-head">
        <span className="arrivals-orb" aria-hidden>
          <Mic size={14} />
        </span>
        <h4>{t('voice.arrivals')}</h4>
        <span className="meta">{t('voice.arrivals_sub')}</span>
      </div>
      <ul>
        {list.map((c) => {
          const kind = c.routedAs ?? 'inbox';
          const Icon = ICON[kind];
          return (
            <li key={c.id} className={`arrival a-${kind}`}>
              <span className="arrival-ico" aria-hidden>
                <Icon size={15} />
              </span>
              <Link to={linkFor(c)} className="arrival-main">
                <span className="arrival-text">{c.text}</span>
                <span className="arrival-dest">
                  {t(`voice.dest.${kind}`)} · {fmt.relDay(c.createdAt)} {fmt.time(c.createdAt)}
                </span>
              </Link>
              {kind !== 'inbox' && (
                <IconButton
                  size="sm"
                  label={t('voice.not_here')}
                  onClick={() => void sendBackToInbox(s, c).then(() => toast(t('voice.sent_back')))}
                >
                  <Undo2 size={14} />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
