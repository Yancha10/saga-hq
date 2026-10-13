import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  BookMarked,
  BookOpen,
  CalendarDays,
  CalendarRange,
  Clapperboard,
  FolderKanban,
  Inbox,
  Lightbulb,
  LineChart,
  ListChecks,
  type LucideIcon,
  Menu as MenuIcon,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Wand2,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { undoLast } from '../data/store';
import { CaptureSheet } from '../features/capture/CaptureSheet';
import { CommandPalette } from '../features/search/CommandPalette';
import { SecretaryPanel } from '../features/secretary/SecretaryPanel';
import { t, useT } from '../i18n';
import { historyLabel, syncCodeText } from '../i18n/render';
import { syncStatus } from '../sync/runner';
import { Button, IconButton } from '../ui/kit';
import { useApp, useIsPhone, useLive, useOnline, useStore } from './context';
import { useShortcuts } from './keys';
import { applyUpdate, updateReady } from './pwa';
import { banners, dismissToast, toast, toasts } from './status';
import { captureState, paletteState, secretaryState } from './ui';

/** Route identifiers stay language-neutral; only labels are translated. */
interface NavItem {
  to: string;
  key: string;
  icon: LucideIcon;
  sc: string;
}
const NAV_GROUPS: { key: string; items: NavItem[] }[] = [
  {
    key: 'plan',
    items: [
      { to: '/', key: 'today', icon: Sun, sc: 't' },
      { to: '/week', key: 'week', icon: CalendarRange, sc: 'w' },
      { to: '/inbox', key: 'inbox', icon: Inbox, sc: 'i' },
      { to: '/calendar', key: 'calendar', icon: CalendarDays, sc: 'a' },
      { to: '/projects', key: 'projects', icon: FolderKanban, sc: 'p' },
    ],
  },
  {
    key: 'create',
    items: [
      { to: '/ideas', key: 'ideas', icon: Lightbulb, sc: 'd' },
      { to: '/content', key: 'content', icon: Clapperboard, sc: 'c' },
      { to: '/workshop', key: 'workshop', icon: Wand2, sc: 'o' },
    ],
  },
  {
    key: 'know',
    items: [
      { to: '/bible', key: 'bible', icon: BookMarked, sc: 'b' },
      { to: '/radar', key: 'radar', icon: Radar, sc: 'r' },
      { to: '/library', key: 'library', icon: BookOpen, sc: 'l' },
      { to: '/insights', key: 'insights', icon: LineChart, sc: 'n' },
    ],
  },
];
const NAV = NAV_GROUPS.flatMap((g) => g.items);

function SyncDot() {
  const { t, fmt } = useT();
  const st = useStore(syncStatus);
  const online = useOnline();
  const { account, startSync } = useApp();
  if (!account)
    return (
      <span className="meta" style={{ padding: '6px 12px' }}>
        {t('sync.local_only')}
      </span>
    );
  const phase = !online ? 'offline' : st.phase;
  const cls: Record<string, string> = {
    off: '',
    idle: 'ok',
    syncing: 'busy',
    offline: 'warn',
    needs_auth: 'warn',
    blocked: 'err',
    error: 'warn',
  };
  const label =
    phase === 'idle' && st.lastSyncAt
      ? t('sync.phase.idle_at', { time: fmt.time(st.lastSyncAt) })
      : t(`sync.phase.${phase}`);
  const detail = st.code && phase !== 'idle' ? syncCodeText(st.code) : label;
  return (
    <div className="hstack" style={{ padding: '6px 12px', gap: 8 }} aria-live="polite">
      <span className={`status-dot ${cls[phase] ?? ''}`} aria-hidden />
      <span className="meta" style={{ flex: 1 }}>
        {detail}
      </span>
      {phase === 'needs_auth' && (
        <Button size="sm" onClick={() => void startSync()}>
          {t('sync.reconnect')}
        </Button>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { session, openCapture, openPalette, toggleSecretary } = useApp();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const inboxCount = useLive(
    (s) =>
      s.db.captures
        .where('status')
        .equals('inbox')
        .filter((c) => !c.deletedAt)
        .count(),
    [],
    0,
  );
  const pinned = useLive(
    (s) =>
      s.db.projects
        .toArray()
        .then((ps) =>
          ps.filter((p) => p.isFocus && !p.deletedAt && !p.archivedAt && p.status === 'active').slice(0, 5),
        ),
    [],
    [],
  );
  const capture = useStore(captureState);
  const palette = useStore(paletteState);
  const secretary = useStore(secretaryState);
  const bannerList = useStore(banners);
  const toastList = useStore(toasts);
  const update = useStore(updateReady);
  const phone = useIsPhone();

  const shortcuts = useMemo(
    () => [
      { combo: 'mod+k', run: () => openPalette(), allowInInput: true },
      { combo: 'mod+j', run: () => toggleSecretary(), allowInInput: true },
      { combo: 'c', run: () => openCapture() },
      { combo: 't', run: () => openCapture({ mode: 'task' }) },
      { combo: '/', run: () => openPalette() },
      {
        combo: 'mod+z',
        run: () =>
          void undoLast(session).then(
            (e) => e && toast(t('toast.undone', { label: historyLabel(e.label, e.labelParams) })),
          ),
      },
      ...NAV.map((n) => ({ combo: `g ${n.sc}`, run: () => void navigate({ to: n.to }) })),
      { combo: 'g s', run: () => void navigate({ to: '/settings' }) },
      { combo: 'g k', run: () => void navigate({ to: '/tasks' }) },
    ],
    [openPalette, toggleSecretary, openCapture, navigate, session],
  );
  useShortcuts(shortcuts);

  // ?capture=1 (PWA shortcut) opens capture
  useEffect(() => {
    if (location.hash.includes('capture=1')) openCapture();
  }, [openCapture]);

  const isActive = (to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));

  return (
    <div className={`app ${secretary.open ? 'with-panel' : ''}`}>
      <a href="#main" className="skip-link">
        {t('a11y.skip')}
      </a>
      <nav className="sidebar" aria-label={t('a11y.primary_nav')}>
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            S
          </span>
          <span>Saga HQ</span>
        </div>
        <Button
          variant="primary"
          onClick={() => openCapture()}
          style={{ margin: '0 4px 8px' }}
          aria-label={t('capture.button_aria')}
        >
          <Plus size={16} aria-hidden />
          <span className="label">{t('capture.button')}</span>
        </Button>
        {NAV_GROUPS.map((g) => (
          <div key={g.key} className="nav-group" role="group" aria-label={t(`nav.group.${g.key}`)}>
            <div className="nav-group-label" aria-hidden>
              {t(`nav.group.${g.key}`)}
            </div>
            {g.items.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`nav-item ${isActive(n.to) ? 'active' : ''}`}
                aria-current={isActive(n.to) ? 'page' : undefined}
                title={t(`nav.${n.key}`)}
              >
                <n.icon size={17} aria-hidden />
                <span className="label">{t(`nav.${n.key}`)}</span>
                <span className="rail-label">{t(`nav.${n.key}`)}</span>
                {n.to === '/inbox' && inboxCount > 0 && <span className="count">{inboxCount}</span>}
              </Link>
            ))}
          </div>
        ))}
        {pinned.map((p) => (
          <Link key={p.id} to="/projects/$id" params={{ id: p.id }} className="nav-item nav-sub">
            <span className="label">{p.name}</span>
          </Link>
        ))}
        <Link
          to="/tasks"
          className={`nav-item ${isActive('/tasks') ? 'active' : ''}`}
          title={t('nav.tasks_all')}
        >
          <ListChecks size={17} aria-hidden />
          <span className="label">{t('nav.tasks_all')}</span>
          <span className="rail-label">{t('nav.tasks')}</span>
        </Link>
        <div className="nav-sep" />
        <button
          type="button"
          className="nav-item"
          onClick={openPalette}
          style={{ border: 0, background: 'none', cursor: 'pointer' }}
          title={`${t('nav.search_commands')} (⌘K)`}
        >
          <Search size={17} aria-hidden />
          <span className="label">{t('nav.search_commands')}</span>
          <span className="rail-label">{t('nav.search')}</span>
          <span className="count">⌘K</span>
        </button>
        <button
          type="button"
          className={`nav-item ${secretary.open ? 'active' : ''}`}
          onClick={() => toggleSecretary()}
          style={{ border: 0, background: 'none', cursor: 'pointer' }}
          title={`${t('nav.secretary')} (⌘J)`}
        >
          <Sparkles size={17} aria-hidden />
          <span className="label">{t('nav.secretary')}</span>
          <span className="rail-label">{t('nav.secretary')}</span>
          <span className="count">⌘J</span>
        </button>
        <div className="sidebar-foot">
          <Link
            to="/settings"
            className={`nav-item ${isActive('/settings') ? 'active' : ''}`}
            title={t('nav.settings')}
          >
            <Settings size={17} aria-hidden />
            <span className="label">{t('nav.settings')}</span>
            <span className="rail-label">{t('nav.settings')}</span>
          </Link>
          <div className="hide-rail">
            <SyncDot />
          </div>
        </div>
      </nav>

      <main className="main" id="main" tabIndex={-1}>
        <div className="banners" role="region" aria-label={t('a11y.status_region')}>
          {update && (
            <div className="banner info">
              <RefreshCw size={15} aria-hidden /> {t('pwa.update_ready')}
              <span className="spacer" />
              <Button
                size="sm"
                onClick={() => void applyUpdate().then((ok) => !ok && toast(t('pwa.update_wait')))}
              >
                {t('pwa.reload_update')}
              </Button>
            </div>
          )}
          {bannerList.map((b) => (
            <div key={b.id} className={`banner ${b.kind}`} role={b.kind === 'error' ? 'alert' : 'status'}>
              <span style={{ flex: 1 }}>{t(b.msgKey, b.params)}</span>
              {b.action && (
                <Button size="sm" onClick={b.action.run}>
                  {t(b.action.labelKey)}
                </Button>
              )}
            </div>
          ))}
          {phone && (
            <div className="only-mobile">
              <SyncDotMobile />
            </div>
          )}
        </div>
        {children}
      </main>

      {secretary.open && (
        <aside className="panel" aria-label={t('nav.secretary')}>
          <SecretaryPanel
            focus={secretary.focus}
            initialIntent={secretary.intent}
            initialQuestion={secretary.question}
            onClose={() => secretaryState.set({ open: false })}
          />
        </aside>
      )}

      <nav className="bottom-nav" aria-label={t('a11y.primary_nav')}>
        <Link to="/" aria-current={isActive('/') ? 'page' : undefined}>
          <Sun size={21} aria-hidden />
          {t('nav.today')}
        </Link>
        <Link to="/ideas" aria-current={isActive('/ideas') ? 'page' : undefined}>
          <Lightbulb size={21} aria-hidden />
          {t('nav.ideas')}
        </Link>
        <button
          type="button"
          className="capture-btn"
          onClick={() => openCapture()}
          aria-label={t('capture.button')}
        >
          <span className="plus">
            <Plus size={24} aria-hidden />
          </span>
        </button>
        <Link to="/content" aria-current={isActive('/content') ? 'page' : undefined}>
          <Clapperboard size={21} aria-hidden />
          {t('nav.content')}
        </Link>
        <Link
          to="/more"
          aria-current={
            [
              '/more',
              '/inbox',
              '/calendar',
              '/library',
              '/week',
              '/bible',
              '/radar',
              '/workshop',
              '/insights',
              '/projects',
              '/settings',
              '/tasks',
            ].some(isActive)
              ? 'page'
              : undefined
          }
        >
          <MenuIcon size={21} aria-hidden />
          {t('nav.more')}
          {inboxCount > 0 ? ` · ${inboxCount}` : ''}
        </Link>
      </nav>

      <CaptureSheet
        open={capture !== null}
        preset={capture ?? undefined}
        onClose={() => captureState.set(null)}
      />
      <CommandPalette open={palette} onClose={() => paletteState.set(false)} />

      <div className="toasts" aria-live="polite">
        {toastList.map((x) => (
          <div key={x.id} className={`toast ${x.kind}`} role={x.kind === 'error' ? 'alert' : 'status'}>
            <span className="grow">{x.message}</span>
            {x.action && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  x.action!.run();
                  dismissToast(x.id);
                }}
              >
                {x.action.label}
              </Button>
            )}
            <IconButton label={t('common.dismiss')} size="sm" onClick={() => dismissToast(x.id)}>
              <X size={14} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

function SyncDotMobile() {
  useT();
  const st = useStore(syncStatus);
  const online = useOnline();
  const { account, startSync } = useApp();
  if (!account) return null;
  if (online && st.phase !== 'needs_auth' && st.phase !== 'blocked') return null;
  return (
    <div className="banner warning">
      <span style={{ flex: 1 }}>
        {!online ? t('sync.offline_banner') : syncCodeText(st.code) || t('sync.phase.needs_auth')}
      </span>
      {online && st.phase === 'needs_auth' && (
        <Button size="sm" onClick={() => void startSync()}>
          {t('sync.reconnect')}
        </Button>
      )}
    </div>
  );
}
