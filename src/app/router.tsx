import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { CalendarPage } from '../features/calendar/CalendarPage';
import { ContentDetail } from '../features/content/ContentDetail';
import { ContentPage } from '../features/content/ContentPage';
import { IdeaDetail } from '../features/ideas/IdeaDetail';
import { IdeasPage } from '../features/ideas/IdeasPage';
import { InboxPage } from '../features/inbox/InboxPage';
import { InsightsPage } from '../features/insights/InsightsPage';
import { LearningDetail } from '../features/insights/LearningDetail';
import { LibraryDetail } from '../features/library/LibraryDetail';
import { LibraryPage } from '../features/library/LibraryPage';
import { MorePage } from '../features/more/MorePage';
import { ProjectHome } from '../features/projects/ProjectHome';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { SearchPage } from '../features/search/SearchPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { StudioImportPage } from '../features/studio/StudioImportPage';
import { TasksPage } from '../features/tasks/TasksPage';
import { TodayPage } from '../features/today/TodayPage';
import { Shell } from './Shell';

const anySearch = (s: Record<string, unknown>) => s as Record<string, string | undefined>;

const root = createRootRoute({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});
const r = (path: string, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => root, path, component, validateSearch: anySearch });

const routeTree = root.addChildren([
  r('/', TodayPage),
  r('/inbox', InboxPage),
  r('/ideas', IdeasPage),
  r('/ideas/$id', IdeaDetail),
  r('/projects', ProjectsPage),
  r('/projects/$id', ProjectHome),
  r('/content', ContentPage),
  r('/content/$id', ContentDetail),
  r('/tasks', TasksPage),
  r('/calendar', CalendarPage),
  r('/library', LibraryPage),
  r('/library/$id', LibraryDetail),
  r('/insights', InsightsPage),
  r('/learnings/$id', LearningDetail),
  r('/search', SearchPage),
  r('/more', MorePage),
  r('/settings', SettingsPage),
  r('/studio/import', StudioImportPage),
]);

export function makeRouter() {
  return createRouter({
    routeTree,
    history: createHashHistory(),
    defaultPreload: false,
    scrollRestoration: true,
  });
}
