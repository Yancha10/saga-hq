import { Link } from '@tanstack/react-router';
import {
  BookMarked,
  BookOpen,
  CalendarDays,
  CalendarRange,
  CheckSquare,
  FolderKanban,
  Inbox,
  LineChart,
  Radar,
  Search,
  Settings,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useApp, useLive } from '../../app/context';
import { fmt, t, useT } from '../../i18n';
import { PageHeader } from '../../ui/PageHeader';

export function MorePage() {
  useT();
  const { toggleSecretary } = useApp();
  const inbox = useLive(
    (s) =>
      s.db.captures
        .where('status')
        .equals('inbox')
        .filter((c) => !c.deletedAt)
        .count(),
    [],
    0,
  );
  const groups = [
    {
      key: 'plan',
      items: [
        { to: '/week', label: t('nav.week'), icon: CalendarRange },
        { to: '/inbox', label: t('nav.inbox'), icon: Inbox, count: inbox },
        { to: '/calendar', label: t('nav.calendar'), icon: CalendarDays },
        { to: '/projects', label: t('nav.projects'), icon: FolderKanban },
        { to: '/tasks', label: t('nav.tasks_all'), icon: CheckSquare },
      ],
    },
    {
      key: 'create',
      items: [{ to: '/workshop', label: t('nav.workshop'), icon: Wand2 }],
    },
    {
      key: 'know',
      items: [
        { to: '/bible', label: t('nav.bible'), icon: BookMarked },
        { to: '/radar', label: t('nav.radar'), icon: Radar },
        { to: '/library', label: t('nav.library'), icon: BookOpen },
        { to: '/insights', label: t('nav.insights'), icon: LineChart },
      ],
    },
    {
      key: 'tools',
      items: [
        { to: '/search', label: t('search.everything'), icon: Search },
        { to: '/settings', label: t('nav.settings'), icon: Settings },
      ],
    },
  ];
  return (
    <div className="page narrow">
      <PageHeader title={t('nav.more')} />
      {groups.map((g) => (
        <section key={g.key} className="tile-section" aria-label={t(`nav.group.${g.key}`)}>
          <h2 className="tile-group">{t(`nav.group.${g.key}`)}</h2>
          <div className="tile-grid">
            {g.items.map((i) => (
              <Link key={i.to} to={i.to} className="tile">
                <span className={`tile-icon ti-${i.to.slice(1)}`}>
                  <i.icon size={21} aria-hidden />
                </span>
                <span className="tile-label">{i.label}</span>
                {'count' in i && i.count ? (
                  <span className="pill accent tile-count">{fmt.num(i.count)}</span>
                ) : null}
              </Link>
            ))}
            {g.key === 'create' && (
              <button type="button" className="tile" onClick={() => toggleSecretary()}>
                <span className="tile-icon ti-secretary">
                  <Sparkles size={21} aria-hidden />
                </span>
                <span className="tile-label">{t('nav.secretary')}</span>
              </button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
