import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type ErrorComponentProps,
  lazyRouteComponent,
  Outlet,
  type RouteComponent,
} from '@tanstack/react-router';
import { ContentPage } from '../features/content/ContentPage';
import { IdeaDetail } from '../features/ideas/IdeaDetail';
import { IdeasPage } from '../features/ideas/IdeasPage';
import { InboxPage } from '../features/inbox/InboxPage';
import { TodayPage } from '../features/today/TodayPage';
import { logger } from '../diagnostics/logger';
import { Shell } from './Shell';

const anySearch = (s: Record<string, unknown>) => s as Record<string, string | undefined>;

const root = createRootRoute({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});
const r = (path: string, component: RouteComponent) =>
  createRoute({ getParentRoute: () => root, path, component, validateSearch: anySearch });

const routeTree = root.addChildren([
  r('/', TodayPage),
  r('/inbox', InboxPage),
  r('/ideas', IdeasPage),
  r('/ideas/$id', IdeaDetail),
  r('/projects', lazyRouteComponent(() => import('../features/projects/ProjectsPage'), 'ProjectsPage')),
  r('/projects/$id', lazyRouteComponent(() => import('../features/projects/ProjectHome'), 'ProjectHome')),
  r('/content', ContentPage),
  r('/content/$id', lazyRouteComponent(() => import('../features/content/ContentDetail'), 'ContentDetail')),
  r('/tasks', lazyRouteComponent(() => import('../features/tasks/TasksPage'), 'TasksPage')),
  r('/calendar', lazyRouteComponent(() => import('../features/calendar/CalendarPage'), 'CalendarPage')),
  r('/library', lazyRouteComponent(() => import('../features/library/LibraryPage'), 'LibraryPage')),
  r('/library/$id', lazyRouteComponent(() => import('../features/library/LibraryDetail'), 'LibraryDetail')),
  r('/insights', lazyRouteComponent(() => import('../features/insights/InsightsPage'), 'InsightsPage')),
  r('/learnings/$id', lazyRouteComponent(() => import('../features/insights/LearningDetail'), 'LearningDetail')),
  r('/search', lazyRouteComponent(() => import('../features/search/SearchPage'), 'SearchPage')),
  r('/more', lazyRouteComponent(() => import('../features/more/MorePage'), 'MorePage')),
  r('/settings', lazyRouteComponent(() => import('../features/settings/SettingsPage'), 'SettingsPage')),
  r('/studio/import', lazyRouteComponent(() => import('../features/studio/StudioImportPage'), 'StudioImportPage')),
]);

/** A screen failed to render: data is untouched; offer a way back instead of a dead end. */
function RouteError({ error, reset }: ErrorComponentProps) {
  logger.error('ui', 'screen crashed', error);
  return (
    <div className="recovery" role="alert">
      <h2>This screen hit an error</h2>
      <p className="muted">Your data is safe — nothing was changed. Go back to Today or try again.</p>
      <pre className="json">{String((error as Error)?.message ?? error)}</pre>
      <div className="hstack">
        <a className="btn primary" href="#/" onClick={() => reset()}>
          Go to Today
        </a>
        <button type="button" className="btn" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </div>
  );
}

export function makeRouter() {
  return createRouter({
    routeTree,
    history: createHashHistory(),
    defaultPreload: false,
    scrollRestoration: true,
    defaultErrorComponent: RouteError,
  });
}
