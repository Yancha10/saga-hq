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
import { PageHeader } from '../../ui/PageHeader';

export function MorePage() {
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
    { to: '/search', label: 'Search everything', icon: Search },
    { to: '/inbox', label: 'Inbox', icon: Inbox, count: inbox },
    { to: '/calendar', label: 'Agenda', icon: CalendarDays },
    { to: '/projects', label: 'Projects', icon: FolderKanban },
    { to: '/tasks', label: 'All tasks', icon: CheckSquare },
    { to: '/library', label: 'Library', icon: BookOpen },
    { to: '/insights', label: 'Insights', icon: LineChart },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];
  return (
    <div className="page narrow">
      <PageHeader title="More" />
      <div className="list">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="row">
            <i.icon size={19} aria-hidden />
            <div className="grow title">{i.label}</div>
            {i.count ? <span className="pill accent">{i.count}</span> : null}
          </Link>
        ))}
        <button type="button" className="row" onClick={() => toggleSecretary()}>
          <Sparkles size={19} aria-hidden />
          <div className="grow title">Secretary</div>
        </button>
      </div>
    </div>
  );
}
