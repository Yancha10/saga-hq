import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  BookOpen,
  CalendarDays,
  Clapperboard,
  FolderKanban,
  Inbox,
  Lightbulb,
  LineChart,
  ListChecks,
  Menu as MenuIcon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { undoLast } from '../data/store';
import { CaptureSheet } from '../features/capture/CaptureSheet';
import { CommandPalette } from '../features/search/CommandPalette';
import { SecretaryPanel } from '../features/secretary/SecretaryPanel';
import { syncStatus } from '../sync/runner';
import { Button, IconButton } from '../ui/kit';
import { useApp, useIsPhone, useLive, useOnline, useStore } from './context';
import { useShortcuts } from './keys';
import { applyUpdate, updateReady } from './pwa';
import { banners, dismissToast, toast, toasts } from './status';
import { captureState, paletteState, secretaryState } from './ui';

const NAV = [
  { to: '/', label: 'Today', icon: Sun, key: 't' },
  { to: '/inbox', label: 'Inbox', icon: Inbox, key: 'i' },
  { to: '/ideas', label: 'Ideas', icon: Lightbulb, key: 'd' },
  { to: '/projects', label: 'Projects', icon: FolderKanban, key: 'p' },
  { to: '/content', label: 'Content', icon: Clapperboard, key: 'c' },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, key: 'a' },
  { to: '/library', label: 'Library', icon: BookOpen, key: 'l' },
  { to: '/insights', label: 'Insights', icon: LineChart, key: 'n' },
] as const;

function SyncDot() {
  const st = useStore(syncStatus);
  const online = useOnline();
  const { account, startSync } = useApp();
  if (!account)
    return (
      <span className="meta" style={{ padding: '6px 12px' }}>
        Local only · not synced
      </span>
    );
  const phase = !online ? 'offline' : st.phase;
  const map: Record<string, [string, string]> = {
    off: ['', 'Sync off'],
    idle: [
      'ok',
      st.lastSyncAt
        ? `Synced ${new Date(st.lastSyncAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
        : 'Synced',
    ],
    syncing: ['busy', 'Syncing…'],
    offline: ['warn', 'Offline · changes saved locally'],
    needs_auth: ['warn', 'Sync paused'],
    blocked: ['err', 'Sync blocked'],
    error: ['warn', 'Sync retrying'],
  };
  const [cls, label] = map[phase] ?? ['', phase];
  return (
    <div className="hstack" style={{ padding: '6px 12px', gap: 8 }} aria-live="polite">
      <span className={`status-dot ${cls}`} aria-hidden />
      <span className="meta" style={{ flex: 1 }}>
        {st.message && phase !== 'idle' ? st.message : label}
      </span>
      {phase === 'needs_auth' && (
        <Button size="sm" onClick={() => void startSync()}>
          Reconnect
        </Button>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
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
      { combo: 'mod+z', run: () => void undoLast(session).then((e) => e && toast(`Undone: ${e.label}`)) },
      ...NAV.map((n) => ({ combo: `g ${n.key}`, run: () => void navigate({ to: n.to }) })),
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
        Skip to content
      </a>
      <nav className="sidebar" aria-label="Primary">
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
          aria-label="Capture (C)"
        >
          <Plus size={16} aria-hidden />
          <span className="label">Capture</span>
        </Button>
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className={`nav-item ${isActive(n.to) ? 'active' : ''}`}
            aria-current={isActive(n.to) ? 'page' : undefined}
            title={n.label}
          >
            <n.icon size={17} aria-hidden />
            <span className="label">{n.label}</span>
            <span className="rail-label">{n.label}</span>
            {n.to === '/inbox' && inboxCount > 0 && <span className="count">{inboxCount}</span>}
          </Link>
        ))}
        {pinned.map((p) => (
          <Link key={p.id} to="/projects/$id" params={{ id: p.id }} className="nav-item nav-sub">
            <span className="label">{p.name}</span>
          </Link>
        ))}
        <Link to="/tasks" className={`nav-item ${isActive('/tasks') ? 'active' : ''}`} title="All tasks">
          <ListChecks size={17} aria-hidden />
          <span className="label">All tasks</span>
          <span className="rail-label">Tasks</span>
        </Link>
        <div className="nav-sep" />
        <button
          type="button"
          className="nav-item"
          onClick={openPalette}
          style={{ border: 0, background: 'none', cursor: 'pointer' }}
          title="Search (⌘K)"
        >
          <Search size={17} aria-hidden />
          <span className="label">Search & commands</span>
          <span className="rail-label">Search</span>
          <span className="count">⌘K</span>
        </button>
        <button
          type="button"
          className={`nav-item ${secretary.open ? 'active' : ''}`}
          onClick={() => toggleSecretary()}
          style={{ border: 0, background: 'none', cursor: 'pointer' }}
          title="Secretary (⌘J)"
        >
          <Sparkles size={17} aria-hidden />
          <span className="label">Secretary</span>
          <span className="rail-label">Secretary</span>
          <span className="count">⌘J</span>
        </button>
        <div className="sidebar-foot">
          <Link
            to="/settings"
            className={`nav-item ${isActive('/settings') ? 'active' : ''}`}
            title="Settings"
          >
            <Settings size={17} aria-hidden />
            <span className="label">Settings</span>
            <span className="rail-label">Settings</span>
          </Link>
          <div className="hide-rail">
            <SyncDot />
          </div>
        </div>
      </nav>

      <main className="main" id="main" tabIndex={-1}>
        <div className="banners" role="region" aria-label="Status">
          {update && (
            <div className="banner info">
              <RefreshCw size={15} aria-hidden /> A new version of Saga HQ is ready.
              <span className="spacer" />
              <Button
                size="sm"
                onClick={() =>
                  void applyUpdate().then(
                    (ok) => !ok && toast('Finish your current edit first — the update will wait.'),
                  )
                }
              >
                Reload to update
              </Button>
            </div>
          )}
          {bannerList.map((b) => (
            <div key={b.id} className={`banner ${b.kind}`} role={b.kind === 'error' ? 'alert' : 'status'}>
              <span style={{ flex: 1 }}>{b.message}</span>
              {b.action && (
                <Button size="sm" onClick={b.action.run}>
                  {b.action.label}
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
        <aside className="panel" aria-label="Secretary">
          <SecretaryPanel
            focus={secretary.focus}
            initialIntent={secretary.intent}
            onClose={() => secretaryState.set({ open: false })}
          />
        </aside>
      )}

      <nav className="bottom-nav" aria-label="Primary">
        <Link to="/" aria-current={isActive('/') ? 'page' : undefined}>
          <Sun size={21} aria-hidden />
          Today
        </Link>
        <Link to="/ideas" aria-current={isActive('/ideas') ? 'page' : undefined}>
          <Lightbulb size={21} aria-hidden />
          Ideas
        </Link>
        <button type="button" className="capture-btn" onClick={() => openCapture()} aria-label="Capture">
          <span className="plus">
            <Plus size={24} aria-hidden />
          </span>
        </button>
        <Link to="/content" aria-current={isActive('/content') ? 'page' : undefined}>
          <Clapperboard size={21} aria-hidden />
          Content
        </Link>
        <Link
          to="/more"
          aria-current={
            isActive('/more') || isActive('/inbox') || isActive('/calendar') || isActive('/library')
              ? 'page'
              : undefined
          }
        >
          <MenuIcon size={21} aria-hidden />
          More{inboxCount > 0 ? ` · ${inboxCount}` : ''}
        </Link>
      </nav>

      <CaptureSheet
        open={capture !== null}
        preset={capture ?? undefined}
        onClose={() => captureState.set(null)}
      />
      <CommandPalette open={palette} onClose={() => paletteState.set(false)} />

      <div className="toasts" aria-live="polite">
        {toastList.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="grow">{t.message}</span>
            {t.action && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </Button>
            )}
            <IconButton label="Dismiss" size="sm" onClick={() => dismissToast(t.id)}>
              <X size={14} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

function SyncDotMobile() {
  const st = useStore(syncStatus);
  const online = useOnline();
  const { account, startSync } = useApp();
  if (!account) return null;
  if (online && st.phase !== 'needs_auth' && st.phase !== 'blocked') return null;
  return (
    <div className="banner warning">
      <span style={{ flex: 1 }}>
        {!online ? 'Offline — everything is saved on this device.' : (st.message ?? 'Sync paused')}
      </span>
      {online && st.phase === 'needs_auth' && (
        <Button size="sm" onClick={() => void startSync()}>
          Reconnect
        </Button>
      )}
    </div>
  );
}
