import { RouterProvider } from '@tanstack/react-router';
import Dexie from 'dexie';
import { Cloud, HardDrive, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { currentToken, mockSignIn, reconnect, signIn } from '../account/google';
import {
  type AccountEntry,
  createLocal,
  getAccount,
  type LocalEntry,
  listAccounts,
  listLocals,
  resolveStartupRef,
  setLastRef,
  touch,
  upsertAccount,
} from '../account/registry';
import { accountRef, localRef, type WorkspaceRef } from '../account/workspaceRef';
import { env, googleConfigured } from '../config/env';
import { getMeta } from '../data/db';
import { purgeExpired } from '../data/store';
import { logger } from '../diagnostics/logger';
import { downloadText } from '../features/common';
import { LanguageSelect } from '../features/settings/LanguageSelect';
import { t, useT } from '../i18n';
import { errorText } from '../i18n/render';
import { SearchClient } from '../search/client';
import { DriveRest } from '../sync/driveRest';
import { SyncRunner, syncStatus } from '../sync/runner';
import { Button, Spinner } from '../ui/kit';
import { type AppCtx, AppProvider } from './context';
import { makeRouter } from './router';
import { FutureSchemaError, Session, setCurrentSession } from './session';
import { toast } from './status';
import { captureState, paletteState, secretaryState } from './ui';

type Boot =
  | { kind: 'loading' }
  | { kind: 'welcome' }
  | { kind: 'ready'; session: Session; search: SearchClient; account: AccountEntry | null }
  | { kind: 'future'; ref: WorkspaceRef }
  | { kind: 'error'; message: string; ref?: WorkspaceRef };

/** Switching workspace = full reload: no state, timer, worker or token can leak across accounts. */
export async function switchWorkspace(
  ref: WorkspaceRef,
  current?: Session | null,
  runner?: SyncRunner | null,
): Promise<void> {
  try {
    await runner?.flush();
  } catch {
    /* best effort */
  }
  current?.close();
  setLastRef(ref);
  location.hash = '#/';
  location.reload();
}

export async function signInAndOpen(): Promise<void> {
  const id = env.e2eMocks && !env.googleClientId ? await e2eMockIdentity() : await signIn();
  if (!id) return;
  await upsertAccount({
    accountId: id.accountId,
    email: id.email,
    displayName: id.displayName,
    accountHint: id.accountHint,
    ...(id.avatarHint ? { avatarHint: id.avatarHint } : {}),
  });
  await switchWorkspace(accountRef(id.accountId));
}

async function e2eMockIdentity() {
  const sub = window.prompt('E2E mock Google subject (test only)', '109876543210987654321');
  const email = window.prompt('E2E mock email', 'tester@example.com');
  if (!sub || !email) return null;
  return mockSignIn(sub, email);
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [runner, setRunner] = useState<SyncRunner | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let ref: WorkspaceRef | null = null;
      try {
        ref = await resolveStartupRef();
        if (!ref) {
          if (!cancelled) setBoot({ kind: 'welcome' });
          return;
        }
        const session = await Session.open(ref);
        setCurrentSession(session);
        await touch(ref);
        const search = new SearchClient(session);
        await search.start();
        const account = ref.kind === 'account' ? ((await getAccount(ref.accountId)) ?? null) : null;
        void purgeExpired(session).catch((e) => logger.warn('trash', 'purge failed', e));
        if (account)
          syncStatus.set({
            phase: 'needs_auth',
            code: 'SYNC_NEEDS_AUTH',
            ...(await lastSync(session)),
          });
        if (!cancelled) setBoot({ kind: 'ready', session, search, account });
      } catch (e) {
        logger.error('boot', 'startup failed', e);
        if (e instanceof FutureSchemaError && ref) setBoot({ kind: 'future', ref });
        else
          setBoot({
            kind: 'error',
            message: (e as Error)?.message ?? 'unknown',
            ...(ref ? { ref } : {}),
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startSync = useCallback(async () => {
    if (boot.kind !== 'ready' || !boot.account) return;
    const { session, account } = boot;
    try {
      if (!currentToken(account.accountId)) {
        if (env.e2eMocks && !env.googleClientId) {
          toast(t('sync.mock_unavailable'));
          return;
        }
        await reconnect(account.accountId, account.email);
      }
      session.assertLive();
      let r = runner;
      if (!r) {
        const drive = new DriveRest(() => currentToken(account.accountId), session.signal);
        const limit = (await getMeta<number>(session.db, 'mediaCacheLimit')) ?? 1024 ** 3;
        r = new SyncRunner(session, drive, account.accountId, () => limit);
        setRunner(r);
        r.start();
      } else r.kick();
    } catch (e) {
      toast(errorText(e), { kind: 'error' });
    }
  }, [boot, runner]);

  const ctx: AppCtx | null = useMemo(() => {
    if (boot.kind !== 'ready') return null;
    return {
      session: boot.session,
      search: boot.search,
      runner,
      account: boot.account,
      startSync,
      openCapture: (preset) => captureState.set(preset ?? {}),
      openPalette: () => paletteState.set(true),
      toggleSecretary: (opts) =>
        secretaryState.set((p) => (opts ? { open: true, ...opts } : { open: !p.open })),
      secretaryOpen: false,
    };
  }, [boot, runner, startSync]);

  const router = useMemo(() => (boot.kind === 'ready' ? makeRouter() : null), [boot.kind]);

  if (boot.kind === 'loading')
    return (
      <div className="welcome">
        <Spinner label={t('boot.opening')} />
      </div>
    );
  if (boot.kind === 'welcome') return <Welcome />;
  if (boot.kind === 'future') return <FutureScreen refName={boot.ref.dbName} />;
  if (boot.kind === 'error') return <ErrorScreen message={boot.message} refName={boot.ref?.dbName} />;
  return (
    <AppProvider value={ctx!}>
      <RouterProvider router={router!} />
    </AppProvider>
  );
}

async function lastSync(s: Session): Promise<{ lastSyncAt?: string }> {
  const st = await getMeta<{ lastSyncAt?: string }>(s.db, 'sync');
  return st?.lastSyncAt ? { lastSyncAt: st.lastSyncAt } : {};
}

export function Welcome() {
  const { t, locale } = useT();
  const [accounts, setAccounts] = useState<AccountEntry[]>([]);
  const [locals, setLocals] = useState<LocalEntry[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void listAccounts().then(setAccounts);
    void listLocals().then(setLocals);
  }, []);
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <span className="brand-mark" aria-hidden>
            S
          </span>
          <LanguageSelect compact />
        </div>
        <h1>Saga HQ</h1>
        <p className="muted">{t('welcome.intro')}</p>
        {googleConfigured() && (
          <button
            type="button"
            className="choice"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void signInAndOpen().catch((e) => {
                toast(errorText(e), { kind: 'error' });
                setBusy(false);
              });
            }}
          >
            <Cloud size={22} aria-hidden />
            <span>
              <strong>{t('welcome.google')}</strong>
              <br />
              <span className="meta">{t('welcome.google_sub')}</span>
            </span>
          </button>
        )}
        <button
          type="button"
          className="choice"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const l = await createLocal();
            await switchWorkspace(localRef(l.localId));
          }}
        >
          <HardDrive size={22} aria-hidden />
          <span>
            <strong>{t('welcome.local')}</strong>
            <br />
            <span className="meta">{t('welcome.local_sub')}</span>
          </span>
        </button>
        {(accounts.length > 0 || locals.length > 0) && (
          <div className="stack">
            <h4>{t('welcome.on_device')}</h4>
            <div className="list">
              {accounts.map((a) => (
                <button
                  key={a.accountId}
                  type="button"
                  className="row"
                  onClick={() => void switchWorkspace(accountRef(a.accountId))}
                >
                  <div className="grow">
                    <div className="title">{a.displayName || a.email}</div>
                    <div className="sub">{a.email}</div>
                  </div>
                </button>
              ))}
              {locals.map((l) => (
                <button
                  key={l.localId}
                  type="button"
                  className="row"
                  onClick={() => void switchWorkspace(localRef(l.localId))}
                >
                  <div className="grow">
                    <div className="title">{l.name || t('workspace.local_default')}</div>
                    <div className="sub">
                      {t('workspace.local_only')}
                      {l.attachedTo ? ` · ${t('workspace.copied')}` : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {!googleConfigured() && <p className="meta">{t('welcome.no_google', { env: env.name })}</p>}
        <span hidden>{locale}</span>
      </div>
    </div>
  );
}

function FutureScreen({ refName }: { refName: string }) {
  const { t } = useT();
  return (
    <div className="recovery" role="alert">
      <ShieldAlert size={28} aria-hidden />
      <h2>{t('boot.future_title')}</h2>
      <p className="muted">{t('boot.future_body')}</p>
      <div className="hstack">
        <Button variant="primary" onClick={() => location.reload()}>
          {t('common.reload')}
        </Button>
        <Button onClick={() => void exportRaw(refName)}>{t('boot.export_raw')}</Button>
      </div>
    </div>
  );
}

function ErrorScreen({ message, refName }: { message: string; refName?: string }) {
  const { t } = useT();
  return (
    <div className="recovery" role="alert">
      <ShieldAlert size={28} aria-hidden />
      <h2>{t('boot.error_title')}</h2>
      <p className="muted">{t('boot.error_body')}</p>
      <pre className="json">{message}</pre>
      <div className="hstack">
        <Button variant="primary" onClick={() => location.reload()}>
          {t('common.try_again')}
        </Button>
        {refName && <Button onClick={() => void exportRaw(refName)}>{t('boot.export_raw')}</Button>}
        <Button
          onClick={() => {
            try {
              localStorage.removeItem('hq:last-workspace');
            } catch {
              /* ignore */
            }
            location.reload();
          }}
        >
          {t('boot.choose_another')}
        </Button>
      </div>
    </div>
  );
}

/** Dynamic open (no schema assumptions) to rescue data even from an unknown/newer version. */
async function exportRaw(dbName: string): Promise<void> {
  const db = new Dexie(dbName);
  await db.open();
  const out: Record<string, unknown[]> = {};
  for (const t of db.tables) {
    if (['secrets', 'cryptoKeys', 'mediaBlobs', 'meta', 'history', 'secretary', 'recovery'].includes(t.name))
      continue;
    out[t.name] = await t.toArray();
  }
  db.close();
  downloadText(
    `saga-hq-raw-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ format: 'saga-hq-raw', exportedAt: new Date().toISOString(), tables: out }),
  );
}
