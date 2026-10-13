import { Link } from '@tanstack/react-router';
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  FolderKanban,
  Inbox,
  LineChart,
  Search,
  Settings,
  Sparkles,
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
  const items = [
    { to: '/search', label: t('search.everything'), icon: Search },
    { to: '/inbox', label: t('nav.inbox'), icon: Inbox, count: inbox },
    { to: '/calendar', label: t('nav.calendar'), icon: CalendarDays },
    { to: '/projects', label: t('nav.projects'), icon: FolderKanban },
    { to: '/tasks', label: t('nav.tasks_all'), icon: CheckSquare },
    { to: '/library', label: t('nav.library'), icon: BookOpen },
    { to: '/insights', label: t('nav.insights'), icon: LineChart },
    { to: '/settings', label: t('nav.settings'), icon: Settings },
  ];
  return (
    <div className="page narrow">
      <PageHeader title={t('nav.more')} />
      <div className="tile-grid">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="tile">
            <span className="tile-icon">
              <i.icon size={21} aria-hidden />
            </span>
            <span className="tile-label">{i.label}</span>
            {i.count ? <span className="pill accent tile-count">{fmt.num(i.count)}</span> : null}
          </Link>
        ))}
        <button type="button" className="tile" onClick={() => toggleSecretary()}>
          <span className="tile-icon">
            <Sparkles size={21} aria-hidden />
          </span>
          <span className="tile-label">{t('nav.secretary')}</span>
        </button>
      </div>
    </div>
  );
}
