import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { copyWorkspaceInto, removeLocalData } from '../../account/attach';
import { signIn, signOutGoogle } from '../../account/google';
import {
  type AccountEntry,
  createLocal,
  type LocalEntry,
  listAccounts,
  listLocals,
  upsertAccount,
} from '../../account/registry';
import { accountRef, localRef } from '../../account/workspaceRef';
import { PROVIDER_INFO, testProvider } from '../../ai/providers';
import { type AISettings, getAISettings, setAISettings } from '../../ai/secretary';
import {
  getSecret,
  type ProviderId,
  removeAllSecrets,
  removeSecret,
  saveSecret,
  secretHints,
} from '../../ai/secrets';
import { signInAndOpen, switchWorkspace } from '../../app/App';
import { useApp, useLive, useSession, useStore } from '../../app/context';
import { requestPersistence } from '../../app/pwa';
import { toast } from '../../app/status';
import { env, googleConfigured } from '../../config/env';
import { buildBackup, exportCsv, previewBackup, type RestorePreview, restoreBackup } from '../../data/backup';
import { getMeta, setMeta } from '../../data/db';
import { listRecoveryPoints, restoreRecoveryPoint } from '../../data/recovery';
import { type EntityTable, PLATFORM_LABEL, type Platform, SYNC_TABLES } from '../../data/schema';
import { purgeNow, restore, update } from '../../data/store';
import { buildDiagnostics } from '../../diagnostics/report';
import { localMediaBytes } from '../../media/store';
import { syncStatus } from '../../sync/runner';
import { Button, Confirm, Section, Sheet } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { downloadText, PlatformPicker } from '../common';

const SECTIONS = [
  ['workspace', 'Workspace'],
  ['account', 'Account & sync'],
  ['storage', 'Storage'],
  ['backup', 'Backup & restore'],
  ['recovery', 'Recovery points'],
  ['ai', 'AI (optional)'],
  ['integrations', 'Saga Studio'],
  ['trash', 'Trash'],
  ['diagnostics', 'Diagnostics'],
  ['shortcuts', 'Keyboard'],
  ['about', 'About & privacy'],
] as const;
type Sec = (typeof SECTIONS)[number][0];

const mb = (n: number | undefined) =>
  n === undefined
    ? '—'
    : n > 1024 ** 3
      ? `${(n / 1024 ** 3).toFixed(2)} GB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`;

export function SettingsPage() {
  const search = useSearch({ strict: false }) as { section?: Sec };
  const navigate = useNavigate();
  const sec: Sec = search.section ?? 'workspace';
  return (
    <div className="page">
      <PageHeader title="Settings" />
      <div className="grid2" style={{ gridTemplateColumns: 'minmax(160px, 220px) minmax(0, 1fr)' }}>
        <nav className="list" aria-label="Settings sections" style={{ alignSelf: 'start' }}>
          {SECTIONS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className="row"
              aria-current={sec === k ? 'page' : undefined}
              style={{ background: sec === k ? 'var(--surface-3)' : undefined }}
              onClick={() => void navigate({ to: '/settings', search: { section: k } })}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="stack" style={{ minWidth: 0 }}>
          {sec === 'workspace' && <WorkspaceSec />}
          {sec === 'account' && <AccountSec />}
          {sec === 'storage' && <StorageSec />}
          {sec === 'backup' && <BackupSec />}
          {sec === 'recovery' && <RecoverySec />}
          {sec === 'ai' && <AISec />}
          {sec === 'integrations' && <IntegrationsSec />}
          {sec === 'trash' && <TrashSec />}
          {sec === 'diagnostics' && <DiagnosticsSec />}
          {sec === 'shortcuts' && <ShortcutsSec />}
          {sec === 'about' && <AboutSec />}
        </div>
      </div>
    </div>
  );
}

function WorkspaceSec() {
  const s = useSession();
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  if (!ws) return null;
  const cad = Object.fromEntries(ws.cadence.map((c) => [c.platform, c.perWeek]));
  return (
    <>
      <Section title="Workspace">
        <div className="field">
          <label className="lbl" htmlFor="wsname">
            Name
          </label>
          <input
            id="wsname"
            className="input"
            defaultValue={ws.name}
            onBlur={(e) =>
              void update(s, 'workspace', 'workspace', { name: e.target.value || 'My workspace' })
            }
          />
        </div>
      </Section>
      <Section title="Platforms & cadence">
        <PlatformPicker
          value={ws.platforms}
          onChange={(v) => void update(s, 'workspace', 'workspace', { platforms: v })}
        />
        <div className="hstack" style={{ marginTop: 10 }}>
          {ws.platforms.map((p: Platform) => (
            <label key={p} className="hstack meta">
              {PLATFORM_LABEL[p]} per week
              <input
                type="number"
                min={0}
                max={50}
                className="input"
                style={{ width: 70 }}
                defaultValue={cad[p] ?? ''}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  const others = ws.cadence.filter((c) => c.platform !== p);
                  void update(s, 'workspace', 'workspace', {
                    cadence: n > 0 ? [...others, { platform: p, perWeek: n }] : others,
                  });
                }}
              />
            </label>
          ))}
        </div>
        <p className="meta">
          Cadence is only used to show planning gaps. Saga HQ never schedules content automatically.
        </p>
      </Section>
      <Section title="Format templates">
        <div className="list">
          {ws.formatTemplates.map((t) => (
            <div key={t.id} className="row static">
              <div className="grow">
                <div className="title">{t.name}</div>
                <div className="sub">Required to be Ready: {t.required.join(', ')}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Idea scoring">
        <label className="check">
          <input
            type="checkbox"
            checked={!!ws.scoringEnabled}
            onChange={(e) => void update(s, 'workspace', 'workspace', { scoringEnabled: e.target.checked })}
          />{' '}
          Show optional low/med/high scores on ideas (your judgement, never a combined number)
        </label>
      </Section>
    </>
  );
}

function AccountSec() {
  const s = useSession();
  const { account, startSync, runner } = useApp();
  const st = useStore(syncStatus);
  const [accounts, setAccounts] = useState<AccountEntry[]>([]);
  const [locals, setLocals] = useState<LocalEntry[]>([]);
  const [signOut, setSignOut] = useState(false);
  const [attach, setAttach] = useState<AccountEntry | null>(null);
  const [foot, setFoot] = useState<{ data: number; media: number; backups: number } | null>(null);
  useEffect(() => {
    void listAccounts().then(setAccounts);
    void listLocals().then(setLocals);
  }, []);
  const connectLocal = async () => {
    try {
      const id = await signIn();
      await upsertAccount({
        accountId: id.accountId,
        email: id.email,
        displayName: id.displayName,
        accountHint: id.accountHint,
        ...(id.avatarHint ? { avatarHint: id.avatarHint } : {}),
      });
      setAttach({ accountId: id.accountId, email: id.email, displayName: id.displayName, lastUsedAt: '' });
    } catch (e) {
      toast((e as Error).message, { kind: 'error' });
    }
  };
  return (
    <>
      <Section title="This workspace">
        {account ? (
          <div className="box">
            <div>
              <strong>{account.displayName}</strong> <span className="meta">{account.email}</span>
            </div>
            <div className="meta">
              Private workspace on this device, synced through this account’s own Google Drive (folder “Saga
              HQ”, files created by Saga HQ only).
            </div>
            <div className="hstack">
              <span className="meta">
                Sync: {st.phase}
                {st.message ? ` — ${st.message}` : ''}
                {st.lastSyncAt ? ` · last ${new Date(st.lastSyncAt).toLocaleString()}` : ''}
              </span>
            </div>
            <div className="hstack">
              <Button variant="primary" onClick={() => void startSync()}>
                {st.phase === 'needs_auth' ? 'Reconnect Google & sync' : 'Sync now'}
              </Button>
              {runner && (
                <Button
                  onClick={() =>
                    void runner.engine
                      .footprint()
                      .then(setFoot)
                      .catch((e) => toast((e as Error).message, { kind: 'error' }))
                  }
                >
                  Drive footprint
                </Button>
              )}
              <Button variant="danger" onClick={() => setSignOut(true)}>
                Sign out…
              </Button>
            </div>
            {foot && (
              <div className="meta">
                In your Drive: data {mb(foot.data)} · media {mb(foot.media)} · backups {mb(foot.backups)}
              </div>
            )}
            {st.quota && (
              <div className="meta">
                Drive storage: {mb(st.quota.usage)} used{st.quota.limit ? ` of ${mb(st.quota.limit)}` : ''}
              </div>
            )}
            <p className="meta">
              Browsers can’t keep Google sign-in alive in the background without a server, so you may need to
              tap Reconnect after reopening the app. Your local data is never blocked by this.
            </p>
          </div>
        ) : (
          <div className="box">
            <div>
              <strong>Local workspace</strong> — stored only on this device, not synced.
            </div>
            {googleConfigured() ? (
              <Button variant="primary" onClick={() => void connectLocal()}>
                Connect Google…
              </Button>
            ) : (
              <span className="meta">Google sign-in is not configured for this build.</span>
            )}
            <p className="meta">
              Connecting never moves data silently — you’ll be asked whether to copy this workspace into the
              account.
            </p>
          </div>
        )}
      </Section>
      <Section title="Workspaces on this device">
        <div className="list">
          {accounts.map((a) => (
            <div key={a.accountId} className="row static">
              <div className="grow">
                <div className="title">{a.displayName}</div>
                <div className="sub">{a.email}</div>
              </div>
              {s.ref.kind === 'account' && s.ref.accountId === a.accountId ? (
                <span className="pill accent">current</span>
              ) : (
                <Button size="sm" onClick={() => void switchWorkspace(accountRef(a.accountId), s, runner)}>
                  Switch
                </Button>
              )}
            </div>
          ))}
          {locals.map((l) => (
            <div key={l.localId} className="row static">
              <div className="grow">
                <div className="title">{l.name}</div>
                <div className="sub">Local only{l.attachedTo ? ' · copied into an account' : ''}</div>
              </div>
              {s.ref.kind === 'local' && s.ref.localId === l.localId ? (
                <span className="pill accent">current</span>
              ) : (
                <Button size="sm" onClick={() => void switchWorkspace(localRef(l.localId), s, runner)}>
                  Switch
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="hstack" style={{ marginTop: 8 }}>
          {googleConfigured() && (
            <Button
              onClick={() =>
                void signInAndOpen().catch((e) => toast((e as Error).message, { kind: 'error' }))
              }
            >
              Add Google account
            </Button>
          )}
          <Button
            onClick={async () => {
              const l = await createLocal();
              await switchWorkspace(localRef(l.localId), s, runner);
            }}
          >
            New local workspace
          </Button>
        </div>
        <p className="meta">Switching reloads the app so nothing from one workspace can leak into another.</p>
      </Section>
      <Sheet
        open={signOut}
        onClose={() => setSignOut(false)}
        title="Sign out"
        footer={
          <>
            <Button
              onClick={async () => {
                signOutGoogle();
                await runner?.flush();
                setSignOut(false);
                toast('Signed out of Google. Local data kept on this device.');
              }}
            >
              Sign out, keep data on this device
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await runner?.flush();
                signOutGoogle();
                const ref = s.ref;
                s.close();
                await removeLocalData(ref);
                location.hash = '#/';
                location.reload();
              }}
            >
              Sign out and remove this workspace from this device
            </Button>
          </>
        }
      >
        <p className="muted">
          Removing deletes this workspace’s local database, media cache and saved API keys from this browser.
          Data already synced to your Google Drive stays in your Drive.
        </p>
      </Sheet>
      <Sheet
        open={!!attach}
        onClose={() => setAttach(null)}
        title={`Connect ${attach?.email ?? ''}`}
        footer={
          <>
            <Button onClick={() => attach && void switchWorkspace(accountRef(attach.accountId), s, runner)}>
              Just switch to the account
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!attach) return;
                const counts = await copyWorkspaceInto(s, accountRef(attach.accountId));
                toast(
                  `Copied ${Object.values(counts).reduce((a, b) => a + b, 0)} records. The local copy is kept.`,
                );
                await switchWorkspace(accountRef(attach.accountId), s, runner);
              }}
            >
              Copy this workspace into the account
            </Button>
          </>
        }
      >
        <p className="muted">
          Copy brings everything from this local workspace into the account’s workspace (merged with anything
          already there). The local workspace is kept until you remove it.
        </p>
      </Sheet>
    </>
  );
}

function StorageSec() {
  const s = useSession();
  const [est, setEst] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null);
  const [media, setMedia] = useState<{ total: number; pinned: number; cache: number } | null>(null);
  const [limit, setLimit] = useState<number>(1024);
  const refresh = async () => {
    try {
      const e = await navigator.storage?.estimate?.();
      const p = await navigator.storage?.persisted?.();
      setEst({ usage: e?.usage, quota: e?.quota, persisted: p });
    } catch {
      setEst(null);
    }
    setMedia(await localMediaBytes(s));
    setLimit(Math.round(((await getMeta<number>(s.db, 'mediaCacheLimit')) ?? 1024 ** 3) / 1024 ** 2));
  };
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <>
      <Section title="This device">
        <div className="box">
          <div>
            Used by this site: {mb(est?.usage)}
            {est?.quota ? ` of ~${mb(est.quota)} available` : ''}
          </div>
          <div>
            Persistent storage:{' '}
            {est?.persisted ? 'granted — the browser won’t evict data under pressure' : 'not granted'}
          </div>
          {!est?.persisted && (
            <Button size="sm" onClick={() => void requestPersistence().then(() => refresh())}>
              Ask the browser to keep data
            </Button>
          )}
          <div className="meta">
            iPhone/iPad: install Saga HQ to the Home Screen and connect Google Drive — Safari may clear data
            of sites you haven’t opened for a while.
          </div>
        </div>
      </Section>
      <Section title="Media">
        <div className="box">
          <div>
            Local media: {mb(media?.total)} · not yet in Drive (never evicted): {mb(media?.pinned)} · cache:{' '}
            {mb(media?.cache)}
          </div>
          <label className="hstack">
            Cache limit (MB)
            <input
              type="number"
              className="input"
              style={{ width: 110 }}
              min={100}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              onBlur={() => void setMeta(s.db, 'mediaCacheLimit', Math.max(100, limit) * 1024 ** 2)}
            />
          </label>
          <div className="meta">
            Only full-size copies already safely stored in your Drive are evicted. Videos over 100 MB should
            be linked, not stored.
          </div>
        </div>
      </Section>
    </>
  );
}

function BackupSec() {
  const s = useSession();
  const [withMedia, setWithMedia] = useState(false);
  const [pv, setPv] = useState<RestorePreview | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Section title="Export">
        <div className="box">
          <p className="muted">
            A complete, portable copy of this workspace as JSON. It never contains Google tokens, account
            identifiers, API keys or diagnostics.
          </p>
          <label className="check">
            <input type="checkbox" checked={withMedia} onChange={(e) => setWithMedia(e.target.checked)} />{' '}
            Include local media (can be large)
          </label>
          <div className="hstack">
            <Button
              variant="primary"
              onClick={async () => {
                const b = await buildBackup(s, { includeMedia: withMedia });
                downloadText(
                  `saga-hq-backup-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify(b),
                );
                toast('Backup downloaded');
              }}
            >
              Download backup
            </Button>
            <Button
              onClick={async () =>
                downloadText('saga-hq-content.csv', await exportCsv(s, 'content'), 'text/csv')
              }
            >
              Content CSV
            </Button>
            <Button
              onClick={async () => downloadText('saga-hq-tasks.csv', await exportCsv(s, 'tasks'), 'text/csv')}
            >
              Tasks CSV
            </Button>
            <Button
              onClick={async () =>
                downloadText('saga-hq-analytics.csv', await exportCsv(s, 'analytics'), 'text/csv')
              }
            >
              Analytics CSV
            </Button>
          </div>
          <p className="meta">With Google connected, a weekly backup is also kept in your Drive (last 8).</p>
        </div>
      </Section>
      <Section title="Restore">
        <div className="box">
          <label className="btn" style={{ alignSelf: 'flex-start' }}>
            Choose backup file…
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setPv(await previewBackup(await f.text()));
                e.target.value = '';
              }}
            />
          </label>
          {pv && !pv.ok && (
            <div className="banner error" style={{ borderRadius: 8 }}>
              {pv.error} Nothing was changed.
            </div>
          )}
          {pv?.ok && (
            <>
              <div>
                Backup “{pv.workspaceName}” from {new Date(pv.createdAt!).toLocaleString()}:{' '}
                {Object.entries(pv.counts)
                  .filter(([, n]) => n)
                  .map(([k, n]) => `${n} ${k}`)
                  .join(', ')}
                {pv.invalid ? ` · ${pv.invalid} invalid records will be skipped` : ''}
              </div>
              <div className="hstack">
                <label className="check">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'replace'}
                    onChange={() => setMode('replace')}
                  />{' '}
                  Replace this workspace
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'merge'}
                    onChange={() => setMode('merge')}
                  />{' '}
                  Add missing records only
                </label>
              </div>
              <Button variant="primary" onClick={() => setConfirm(true)}>
                Restore…
              </Button>
            </>
          )}
        </div>
      </Section>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Restore backup?"
        body="A recovery point of the current state is created first, so you can undo this from Settings › Recovery points."
        confirmLabel="Restore"
        danger={mode === 'replace'}
        onConfirm={async () => {
          if (!pv?.file) return;
          const after = await restoreBackup(s, pv.file, mode);
          toast(
            `Restored: ${Object.entries(after)
              .filter(([k, n]) => n && k !== 'tombstones')
              .map(([k, n]) => `${n} ${k}`)
              .join(', ')}`,
          );
          setPv(null);
        }}
      />
    </>
  );
}

function RecoverySec() {
  const s = useSession();
  const points = useLive((ss) => listRecoveryPoints(ss), [], []);
  const [target, setTarget] = useState<string | null>(null);
  return (
    <Section title="Recovery points (this device, last 7)">
      <p className="meta">Created automatically before restores, imports, upgrades and large sync merges.</p>
      <div className="list">
        {points.map((p) => (
          <div key={p.id} className="row static">
            <div className="grow">
              <div className="title">{p.reason}</div>
              <div className="sub">
                {new Date(p.at).toLocaleString()} ·{' '}
                {Object.entries(p.counts)
                  .filter(([k, n]) => n && k !== 'tombstones' && k !== 'workspace')
                  .map(([k, n]) => `${n} ${k}`)
                  .join(', ') || 'empty'}
              </div>
            </div>
            <Button size="sm" onClick={() => setTarget(p.id)}>
              Restore
            </Button>
          </div>
        ))}
        {!points.length && <div className="row static meta">None yet.</div>}
      </div>
      <Confirm
        open={!!target}
        onClose={() => setTarget(null)}
        title="Restore this recovery point?"
        body="The current state is saved as a new recovery point first."
        confirmLabel="Restore"
        onConfirm={async () => {
          if (target) {
            await restoreRecoveryPoint(s, target);
            toast('Recovery point restored');
            location.reload();
          }
        }}
      />
    </Section>
  );
}

function AISec() {
  const s = useSession();
  const [st, setSt] = useState<AISettings>({ provider: null, models: {} });
  const [hints, setHints] = useState<Partial<Record<ProviderId, { hint: string; updatedAt: string }>>>({});
  const [draft, setDraft] = useState('');
  const [prov, setProv] = useState<ProviderId>('anthropic');
  const [testing, setTesting] = useState(false);
  const reload = async () => {
    const a = await getAISettings(s);
    setSt(a);
    if (a.provider) setProv(a.provider);
    setHints(await secretHints(s));
  };
  useEffect(() => {
    void reload();
  }, []);
  const info = PROVIDER_INFO[prov];
  return (
    <>
      <Section title="AI provider (optional, bring your own key)">
        <div className="box">
          <p className="muted">
            Saga HQ works fully without AI. The Secretary and Idea Lab can use your own API key; you pay your
            provider directly. A ChatGPT or Claude subscription is not API access.
          </p>
          <div className="form-grid">
            <div className="field">
              <label className="lbl" htmlFor="aiprov">
                Provider
              </label>
              <select
                id="aiprov"
                className="select"
                value={prov}
                onChange={(e) => setProv(e.target.value as ProviderId)}
              >
                <option value="anthropic">{PROVIDER_INFO.anthropic.label}</option>
                <option value="openai">{PROVIDER_INFO.openai.label}</option>
              </select>
            </div>
            <div className="field">
              <label className="lbl" htmlFor="aimodel">
                Model id
              </label>
              <input
                id="aimodel"
                className="input"
                placeholder={info.defaultModel || 'required'}
                defaultValue={st.models[prov] ?? ''}
                key={prov + (st.models[prov] ?? '')}
                onBlur={(e) => {
                  const next = { ...st, models: { ...st.models, [prov]: e.target.value.trim() } };
                  setSt(next);
                  void setAISettings(s, next);
                }}
              />
            </div>
          </div>
          <p className="meta">{info.keyHelp}</p>
          {hints[prov] ? (
            <div className="hstack">
              <span>
                Key saved: <code>{hints[prov]!.hint}</code>
              </span>
              <Button
                size="sm"
                onClick={async () => {
                  setTesting(true);
                  try {
                    const key = await getSecret(s, prov);
                    const m = await testProvider({
                      provider: prov,
                      apiKey: key!,
                      model: st.models[prov] || info.defaultModel,
                    });
                    toast(`Key works (${m})`, { kind: 'success' });
                  } catch (e) {
                    toast((e as Error).message, { kind: 'error' });
                  } finally {
                    setTesting(false);
                  }
                }}
                disabled={testing}
              >
                {testing ? 'Testing…' : 'Test key'}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  await removeSecret(s, prov);
                  if (st.provider === prov) await setAISettings(s, { ...st, provider: null });
                  await reload();
                  toast('Key removed');
                }}
              >
                Remove key
              </Button>
            </div>
          ) : (
            <form
              className="hstack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                await saveSecret(s, prov, draft);
                setDraft('');
                await setAISettings(s, { ...st, provider: prov });
                await reload();
                toast('Key saved on this device');
              }}
            >
              <input
                className="input"
                style={{ flex: 1, minWidth: 220 }}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste API key"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="API key"
              />
              <Button type="submit" variant="primary">
                Save key
              </Button>
            </form>
          )}
          <label className="check">
            <input
              type="radio"
              name="activeProv"
              checked={st.provider === prov}
              disabled={!hints[prov]}
              onChange={async () => {
                const next = { ...st, provider: prov };
                setSt(next);
                await setAISettings(s, next);
              }}
            />{' '}
            Use {info.label} for the Secretary
          </label>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await removeAllSecrets(s);
              await setAISettings(s, { provider: null, models: st.models });
              await reload();
              toast('All saved keys removed from this workspace');
            }}
          >
            Remove all secrets
          </Button>
        </div>
      </Section>
      <Section title="How your key is stored — and its limits">
        <ul className="meta" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Encrypted with a non-extractable key in this browser, scoped to this workspace only.</li>
          <li>Never synced to Drive, never in backups, exports, recovery points, logs or diagnostics.</li>
          <li>
            Requests go directly from your browser to your provider, with only the context the Secretary shows
            you.
          </li>
          <li>
            <strong>Browser storage is not server-grade secret storage.</strong> Anything running on this page
            could use the key. Use a dedicated, spend-limited key or project (set a monthly budget at{' '}
            <a href={info.consoleUrl} target="_blank" rel="noopener noreferrer">
              your provider’s console
            </a>
            ) and remove it on shared devices.
          </li>
        </ul>
      </Section>
    </>
  );
}

function IntegrationsSec() {
  const s = useSession();
  const url = useLive((ss) => getMeta<string>(ss.db, 'studioUrl'), [], undefined);
  return (
    <Section title="Saga Studio">
      <div className="box">
        <div className="field">
          <label className="lbl" htmlFor="studio">
            Saga Studio URL (for “Open in Saga Studio” links)
          </label>
          <input
            id="studio"
            className="input"
            placeholder="https://…"
            defaultValue={url ?? ''}
            key={url ?? ''}
            onBlur={(e) => void setMeta(s.db, 'studioUrl', e.target.value.trim())}
          />
        </div>
        <p className="meta">
          Handoffs use a versioned saga.handoff v1 package in the link’s #fragment (never sent to a server) or
          a JSON file. Saga HQ and Studio keep separate data; Drive-based exchange waits on the INTEROP-01
          test.
        </p>
        <a className="btn" href="#/studio/import" style={{ alignSelf: 'flex-start' }}>
          Import Studio results…
        </a>
      </div>
    </Section>
  );
}

function TrashSec() {
  const s = useSession();
  const items = useLive(
    async (ss) => {
      const out: { table: EntityTable; id: string; title: string; deletedAt: string }[] = [];
      for (const t of SYNC_TABLES) {
        if (t === 'workspace' || t === 'links' || t === 'media') continue;
        await ss.db.table(t).each((r: Record<string, unknown>) => {
          if (r.deletedAt && !r.trashGroup)
            out.push({
              table: t,
              id: r.id as string,
              title: String(r.title ?? r.name ?? r.statement ?? r.text ?? r.platform ?? r.id),
              deletedAt: r.deletedAt as string,
            });
        });
      }
      return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    },
    [],
    [],
  );
  const [del, setDel] = useState<{ table: EntityTable; id: string } | null>(null);
  return (
    <Section title="Trash (kept 30 days)">
      <div className="list">
        {items.slice(0, 300).map((i) => (
          <div key={i.id} className="row static">
            <div className="grow">
              <div className="title">{i.title.slice(0, 120)}</div>
              <div className="sub">
                {i.table} · deleted {new Date(i.deletedAt).toLocaleDateString()} · permanent in{' '}
                {Math.max(0, 30 - Math.floor((Date.now() - Date.parse(i.deletedAt)) / 86400000))} days
              </div>
            </div>
            <Button size="sm" onClick={() => void restore(s, i.table, i.id).then(() => toast('Restored'))}>
              Restore
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDel(i)}>
              Delete now
            </Button>
          </div>
        ))}
        {!items.length && <div className="row static meta">Trash is empty.</div>}
      </div>
      <Confirm
        open={!!del}
        onClose={() => setDel(null)}
        title="Delete permanently?"
        body="This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => del && void purgeNow(s, del.table, del.id)}
      />
    </Section>
  );
}

function DiagnosticsSec() {
  const s = useSession();
  const st = useStore(syncStatus);
  return (
    <Section title="Diagnostics (local only)">
      <div className="box">
        <p className="muted">
          Saga HQ sends no telemetry. If you need help, copy a technical report: it contains versions, counts,
          storage and sync state, and redacted error lines — no content, prompts, emails, account ids, tokens
          or keys.
        </p>
        <Button
          onClick={async () => {
            const r = await buildDiagnostics(s, {
              sync: { phase: st.phase, lastSyncAt: st.lastSyncAt, pendingUploads: st.pendingUploads },
            });
            await navigator.clipboard?.writeText(JSON.stringify(r, null, 2));
            toast('Diagnostic report copied');
          }}
        >
          Copy diagnostic report
        </Button>
      </div>
    </Section>
  );
}

function ShortcutsSec() {
  const rows: [string, string][] = [
    ['⌘/Ctrl K', 'Search & commands'],
    ['⌘/Ctrl J', 'Secretary'],
    ['C', 'Capture'],
    ['T', 'Capture a task'],
    ['/', 'Search'],
    ['⌘/Ctrl Z', 'Undo last change (outside text fields)'],
    [
      'G then T / I / D / P / C / A / L / N / K / S',
      'Go to Today, Inbox, Ideas, Projects, Content, Calendar, Library, Insights, Tasks, Settings',
    ],
    ['Inbox: J / K, ↵, I T R F C N, E', 'Move, accept suggestion, convert, discard'],
    ['⌘/Ctrl ↵', 'Save capture'],
  ];
  return (
    <Section title="Keyboard shortcuts">
      <div className="list">
        {rows.map(([k, v]) => (
          <div key={k} className="row static">
            <kbd className="kbd" style={{ minWidth: 120 }}>
              {k}
            </kbd>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <p className="meta">Single-key shortcuts never fire while typing in a field.</p>
    </Section>
  );
}

function AboutSec() {
  return (
    <Section title="About & privacy">
      <div className="box">
        <div>
          Saga HQ {env.version} · build “{env.name}”
        </div>
        <ul className="meta" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            Your data lives in this browser (IndexedDB). With Google connected, a copy syncs to your own
            Google Drive.
          </li>
          <li>No Saga server stores your content. No analytics, ads or trackers. No telemetry.</li>
          <li>AI is optional and uses your own key, sending only the context you see.</li>
          <li>Static app: works offline after the first load.</li>
        </ul>
      </div>
    </Section>
  );
}
