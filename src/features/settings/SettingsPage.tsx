import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  Bot,
  ChevronRight,
  Cloud,
  DatabaseBackup,
  FileUp,
  HardDrive,
  History,
  Info,
  Keyboard,
  Languages,
  type LucideIcon,
  Send,
  SlidersHorizontal,
  Stethoscope,
  Trash2,
} from 'lucide-react';
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
import { useApp, useIsPhone, useLive, useSession, useStore } from '../../app/context';
import { requestPersistence } from '../../app/pwa';
import { toast } from '../../app/status';
import { env, googleConfigured } from '../../config/env';
import { buildBackup, exportCsv, previewBackup, type RestorePreview, restoreBackup } from '../../data/backup';
import { getMeta, setMeta } from '../../data/db';
import { listRecoveryPoints, restoreRecoveryPoint } from '../../data/recovery';
import { type EntityTable, type Platform, SYNC_TABLES } from '../../data/schema';
import { purgeNow, restore, update } from '../../data/store';
import { buildDiagnostics } from '../../diagnostics/report';
import { fmt, t, useT } from '../../i18n';
import { errorText, missingName, platformName, syncCodeText } from '../../i18n/render';
import { localMediaBytes } from '../../media/store';
import { syncStatus } from '../../sync/runner';
import { Button, Confirm, Section, Sheet } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { downloadText, PlatformPicker, templateName } from '../common';
import { ImportPackageSec } from './ImportPackage';
import { LanguageSelect } from './LanguageSelect';
import { PlanningPrefs } from './PlanningPrefs';

const SECTIONS = [
  'workspace',
  'language',
  'account',
  'import',
  'storage',
  'backup',
  'recovery',
  'ai',
  'integrations',
  'trash',
  'diagnostics',
  'shortcuts',
  'about',
] as const;
type Sec = (typeof SECTIONS)[number];
const SEC_ICON: Record<Sec, LucideIcon> = {
  workspace: SlidersHorizontal,
  language: Languages,
  account: Cloud,
  import: FileUp,
  storage: HardDrive,
  backup: DatabaseBackup,
  recovery: History,
  ai: Bot,
  integrations: Send,
  trash: Trash2,
  diagnostics: Stethoscope,
  shortcuts: Keyboard,
  about: Info,
};
/** Phone menu groups, iOS Settings style. Keyboard shortcuts are desktop-only. */
const PHONE_GROUPS: Sec[][] = [
  ['account', 'workspace', 'language'],
  ['ai', 'integrations'],
  ['import', 'backup', 'recovery', 'storage', 'trash'],
  ['diagnostics', 'about'],
];

const mb = (n: number | undefined) => fmt.bytes(n);
/** “12 ideas, 3 tasks” — table names rendered as localized plural nouns. */
const countsText = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .filter(([k, n]) => n && k !== 'tombstones' && k !== 'workspace')
    .map(([k, n]) => t(`count.${k}`, { count: n }))
    .join(', ');

export function SettingsPage() {
  useT();
  const search = useSearch({ strict: false }) as { section?: Sec };
  const navigate = useNavigate();
  const phone = useIsPhone();
  const sec: Sec | null = search.section ?? (phone ? null : 'workspace');
  if (phone && !sec)
    return (
      <div className="page narrow">
        <PageHeader title={t('nav.settings')} />
        {PHONE_GROUPS.map((group) => (
          <nav key={group.join()} className="list settings-menu" aria-label={t('settings.sections')}>
            {group.map((k) => {
              const Icon = SEC_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  className="row"
                  onClick={() => void navigate({ to: '/settings', search: { section: k } })}
                >
                  <span className={`menu-icon mi-${k}`}>
                    <Icon size={17} aria-hidden />
                  </span>
                  <span className="grow title">{t(`settings.sec.${k}`)}</span>
                  <ChevronRight size={17} className="chev-r" aria-hidden />
                </button>
              );
            })}
          </nav>
        ))}
      </div>
    );
  return (
    <div className="page">
      <PageHeader title={phone && sec ? t(`settings.sec.${sec}`) : t('nav.settings')} back={phone} />
      <div className="settings-layout">
        <nav className="list settings-nav hide-mobile" aria-label={t('settings.sections')}>
          {SECTIONS.map((k) => (
            <button
              key={k}
              type="button"
              className="row"
              aria-current={sec === k ? 'page' : undefined}
              style={{ background: sec === k ? 'var(--surface-3)' : undefined }}
              onClick={() => void navigate({ to: '/settings', search: { section: k } })}
            >
              {t(`settings.sec.${k}`)}
            </button>
          ))}
        </nav>
        <div className="stack" style={{ minWidth: 0 }}>
          {sec === 'workspace' && <WorkspaceSec />}
          {sec === 'language' && <LanguageSec />}
          {sec === 'account' && <AccountSec />}
          {sec === 'import' && <ImportPackageSec />}
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

function LanguageSec() {
  useT();
  return (
    <Section title={t('settings.language')}>
      <LanguageSelect />
      <p className="meta">{t('settings.language_note')}</p>
    </Section>
  );
}

function WorkspaceSec() {
  useT();
  const s = useSession();
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  if (!ws) return null;
  const cad = Object.fromEntries(ws.cadence.map((c) => [c.platform, c.perWeek]));
  return (
    <>
      <Section title={t('settings.sec.workspace')}>
        <div className="field">
          <label className="lbl" htmlFor="wsname">
            {t('common.name')}
          </label>
          <input
            id="wsname"
            className="input"
            defaultValue={ws.name}
            placeholder={t('settings.ws_name_placeholder')}
            onBlur={(e) => void update(s, 'workspace', 'workspace', { name: e.target.value })}
          />
        </div>
      </Section>
      <Section title={t('settings.platforms_cadence')}>
        <PlatformPicker
          value={ws.platforms}
          onChange={(v) => void update(s, 'workspace', 'workspace', { platforms: v })}
        />
        <div className="hstack" style={{ marginTop: 10 }}>
          {ws.platforms.map((p: Platform) => (
            <label key={p} className="hstack meta">
              {t('onboarding.per_week', { platform: platformName(p) })}
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
        <p className="meta explain">{t('settings.cadence_note')}</p>
      </Section>
      <Section title={t('settings.templates')}>
        <div className="list">
          {ws.formatTemplates.map((tp) => (
            <div key={tp.id} className="row static">
              <div className="grow">
                <div className="title">{templateName(tp)}</div>
                <div className="sub">
                  {t('settings.required_ready', { list: tp.required.map(missingName).join(', ') })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title={t('settings.scoring')}>
        <label className="check">
          <input
            type="checkbox"
            checked={!!ws.scoringEnabled}
            onChange={(e) => void update(s, 'workspace', 'workspace', { scoringEnabled: e.target.checked })}
          />{' '}
          {t('settings.scoring_label')}
        </label>
      </Section>
      <PlanningPrefs />
    </>
  );
}

function AccountSec() {
  useT();
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
      toast(errorText(e), { kind: 'error' });
    }
  };
  return (
    <>
      <Section title={t('settings.this_workspace')}>
        {account ? (
          <div className="box">
            <div>
              <strong>{account.displayName || account.email}</strong>{' '}
              <span className="meta">{account.email}</span>
            </div>
            <div className="meta">{t('settings.account_desc')}</div>
            <div className="hstack">
              <span className="meta">
                {t('settings.sync_state', { phase: t(`sync.phase.${st.phase}`) })}
                {st.code ? ` — ${syncCodeText(st.code)}` : ''}
                {st.lastSyncAt ? ` · ${t('settings.last_sync', { date: fmt.dateTime(st.lastSyncAt) })}` : ''}
              </span>
            </div>
            <div className="hstack">
              <Button variant="primary" onClick={() => void startSync()}>
                {st.phase === 'needs_auth' ? t('settings.reconnect_sync') : t('settings.sync_now')}
              </Button>
              {runner && (
                <Button
                  onClick={() =>
                    void runner.engine
                      .footprint()
                      .then(setFoot)
                      .catch((e) => toast(errorText(e), { kind: 'error' }))
                  }
                >
                  {t('settings.drive_footprint')}
                </Button>
              )}
              <Button variant="danger" onClick={() => setSignOut(true)}>
                {t('settings.sign_out_ellipsis')}
              </Button>
            </div>
            {foot && (
              <div className="meta">
                {t('settings.footprint', {
                  data: mb(foot.data),
                  media: mb(foot.media),
                  backups: mb(foot.backups),
                })}
              </div>
            )}
            {st.quota && (
              <div className="meta">
                {st.quota.limit
                  ? t('settings.drive_used_of', { used: mb(st.quota.usage), limit: mb(st.quota.limit) })
                  : t('settings.drive_used', { used: mb(st.quota.usage) })}
              </div>
            )}
            <p className="meta explain">{t('settings.reconnect_note')}</p>
          </div>
        ) : (
          <div className="box">
            <div>
              <strong>{t('workspace.local_default')}</strong> — {t('settings.local_desc')}
            </div>
            {googleConfigured() ? (
              <Button variant="primary" onClick={() => void connectLocal()}>
                {t('settings.connect_google')}
              </Button>
            ) : (
              <span className="meta">{t('auth.error.AUTH_NOT_CONFIGURED')}</span>
            )}
            <p className="meta explain">{t('settings.connect_note')}</p>
          </div>
        )}
      </Section>
      <Section title={t('settings.workspaces_device')}>
        <div className="list">
          {accounts.map((a) => (
            <div key={a.accountId} className="row static">
              <div className="grow">
                <div className="title">{a.displayName || a.email}</div>
                <div className="sub">{a.email}</div>
              </div>
              {s.ref.kind === 'account' && s.ref.accountId === a.accountId ? (
                <span className="pill accent">{t('settings.current')}</span>
              ) : (
                <Button size="sm" onClick={() => void switchWorkspace(accountRef(a.accountId), s, runner)}>
                  {t('settings.switch')}
                </Button>
              )}
            </div>
          ))}
          {locals.map((l) => (
            <div key={l.localId} className="row static">
              <div className="grow">
                <div className="title">{l.name || t('workspace.local_default')}</div>
                <div className="sub">
                  {t('workspace.local_only')}
                  {l.attachedTo ? ` · ${t('workspace.copied')}` : ''}
                </div>
              </div>
              {s.ref.kind === 'local' && s.ref.localId === l.localId ? (
                <span className="pill accent">{t('settings.current')}</span>
              ) : (
                <Button size="sm" onClick={() => void switchWorkspace(localRef(l.localId), s, runner)}>
                  {t('settings.switch')}
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="hstack" style={{ marginTop: 8 }}>
          {googleConfigured() && (
            <Button onClick={() => void signInAndOpen().catch((e) => toast(errorText(e), { kind: 'error' }))}>
              {t('settings.add_google')}
            </Button>
          )}
          <Button
            onClick={async () => {
              const l = await createLocal();
              await switchWorkspace(localRef(l.localId), s, runner);
            }}
          >
            {t('settings.new_local')}
          </Button>
        </div>
        <p className="meta explain">{t('settings.switch_note')}</p>
      </Section>
      <Sheet
        open={signOut}
        onClose={() => setSignOut(false)}
        title={t('settings.sign_out')}
        footer={
          <>
            <Button
              onClick={async () => {
                signOutGoogle();
                await runner?.flush();
                setSignOut(false);
                toast(t('settings.signed_out'));
              }}
            >
              {t('settings.sign_out_keep')}
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
              {t('settings.sign_out_remove')}
            </Button>
          </>
        }
      >
        <p className="muted">{t('settings.remove_note')}</p>
      </Sheet>
      <Sheet
        open={!!attach}
        onClose={() => setAttach(null)}
        title={t('settings.connect_email', { email: attach?.email ?? '' })}
        footer={
          <>
            <Button onClick={() => attach && void switchWorkspace(accountRef(attach.accountId), s, runner)}>
              {t('settings.just_switch')}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!attach) return;
                const counts = await copyWorkspaceInto(s, accountRef(attach.accountId));
                toast(
                  t('settings.copied_records', { count: Object.values(counts).reduce((a, b) => a + b, 0) }),
                );
                await switchWorkspace(accountRef(attach.accountId), s, runner);
              }}
            >
              {t('settings.copy_into')}
            </Button>
          </>
        }
      >
        <p className="muted">{t('settings.copy_note')}</p>
      </Sheet>
    </>
  );
}

function StorageSec() {
  useT();
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
      <Section title={t('welcome.on_device')}>
        <div className="box">
          <div>
            {est?.quota
              ? t('settings.site_used_of', { used: mb(est?.usage), quota: mb(est.quota) })
              : t('settings.site_used', { used: mb(est?.usage) })}
          </div>
          <div>{est?.persisted ? t('settings.persist_granted') : t('settings.persist_not')}</div>
          {!est?.persisted && (
            <Button size="sm" onClick={() => void requestPersistence().then(() => refresh())}>
              {t('settings.ask_persist')}
            </Button>
          )}
          <div className="meta explain">{t('settings.ios_note')}</div>
        </div>
      </Section>
      <Section title={t('settings.media')}>
        <div className="box">
          <div>
            {t('settings.media_usage', {
              total: mb(media?.total),
              pinned: mb(media?.pinned),
              cache: mb(media?.cache),
            })}
          </div>
          <label className="hstack">
            {t('settings.cache_limit')}
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
          <div className="meta explain">{t('settings.evict_note')}</div>
        </div>
      </Section>
    </>
  );
}

function BackupSec() {
  useT();
  const s = useSession();
  const [withMedia, setWithMedia] = useState(false);
  const [pv, setPv] = useState<RestorePreview | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Section title={t('settings.export')}>
        <div className="box">
          <p className="muted">{t('settings.export_desc')}</p>
          <label className="check">
            <input type="checkbox" checked={withMedia} onChange={(e) => setWithMedia(e.target.checked)} />{' '}
            {t('settings.include_media')}
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
                toast(t('settings.backup_downloaded'));
              }}
            >
              {t('settings.download_backup')}
            </Button>
            <Button
              onClick={async () =>
                downloadText('saga-hq-content.csv', await exportCsv(s, 'content'), 'text/csv')
              }
            >
              {t('settings.csv_content')}
            </Button>
            <Button
              onClick={async () => downloadText('saga-hq-tasks.csv', await exportCsv(s, 'tasks'), 'text/csv')}
            >
              {t('settings.csv_tasks')}
            </Button>
            <Button
              onClick={async () =>
                downloadText('saga-hq-analytics.csv', await exportCsv(s, 'analytics'), 'text/csv')
              }
            >
              {t('settings.csv_analytics')}
            </Button>
          </div>
          <p className="meta explain">{t('settings.weekly_backup')}</p>
        </div>
      </Section>
      <Section title={t('settings.restore')}>
        <div className="box">
          <label className="btn" style={{ alignSelf: 'flex-start' }}>
            {t('settings.choose_backup')}
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
              {t(`backup.error.${pv.error}`)} {t('settings.nothing_changed')}
            </div>
          )}
          {pv?.ok && (
            <>
              <div>
                {t('settings.backup_from', {
                  name: pv.workspaceName || t('settings.ws_name_placeholder'),
                  date: fmt.dateTime(pv.createdAt!),
                })}{' '}
                {countsText(pv.counts)}
                {pv.invalid ? ` · ${t('settings.invalid_skipped', { count: pv.invalid })}` : ''}
              </div>
              <div className="hstack">
                <label className="check">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'replace'}
                    onChange={() => setMode('replace')}
                  />{' '}
                  {t('settings.replace_ws')}
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'merge'}
                    onChange={() => setMode('merge')}
                  />{' '}
                  {t('settings.add_missing')}
                </label>
              </div>
              <Button variant="primary" onClick={() => setConfirm(true)}>
                {t('settings.restore_ellipsis')}
              </Button>
            </>
          )}
        </div>
      </Section>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('settings.restore_q')}
        body={t('settings.restore_body')}
        confirmLabel={t('common.restore')}
        danger={mode === 'replace'}
        onConfirm={async () => {
          if (!pv?.file) return;
          const after = await restoreBackup(s, pv.file, mode);
          toast(t('settings.restored', { list: countsText(after) }));
          setPv(null);
        }}
      />
    </>
  );
}

function RecoverySec() {
  useT();
  const s = useSession();
  const points = useLive((ss) => listRecoveryPoints(ss), [], []);
  const [target, setTarget] = useState<string | null>(null);
  return (
    <Section title={t('settings.recovery_title')}>
      <p className="meta explain">{t('settings.recovery_desc')}</p>
      <div className="list">
        {points.map((p) => (
          <div key={p.id} className="row static">
            <div className="grow">
              <div className="title">{t(`recovery.reason.${p.reason}`, p.reasonParams)}</div>
              <div className="sub">
                {fmt.dateTime(p.at)} · {countsText(p.counts) || t('settings.empty')}
              </div>
            </div>
            <Button size="sm" onClick={() => setTarget(p.id)}>
              {t('common.restore')}
            </Button>
          </div>
        ))}
        {!points.length && <div className="row static meta">{t('common.none_yet')}</div>}
      </div>
      <Confirm
        open={!!target}
        onClose={() => setTarget(null)}
        title={t('settings.restore_point_q')}
        body={t('settings.restore_point_body')}
        confirmLabel={t('common.restore')}
        onConfirm={async () => {
          if (target) {
            await restoreRecoveryPoint(s, target);
            toast(t('settings.point_restored'));
            location.reload();
          }
        }}
      />
    </Section>
  );
}

function AISec() {
  useT();
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
      <Section title={t('settings.ai_title')}>
        <div className="box">
          <p className="muted">{t('settings.ai_desc')}</p>
          <div className="form-grid">
            <div className="field">
              <label className="lbl" htmlFor="aiprov">
                {t('settings.provider')}
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
                {t('settings.model_id')}
              </label>
              <input
                id="aimodel"
                className="input"
                placeholder={info.defaultModel || t('settings.required')}
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
          <p className="meta">{t(`ai.keyhelp.${prov}`)}</p>
          {hints[prov] ? (
            <div className="hstack">
              <span>
                {t('settings.key_saved')} <code>{hints[prov]!.hint}</code>
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
                    toast(t('settings.key_works', { model: m }), { kind: 'success' });
                  } catch (e) {
                    toast(errorText(e), { kind: 'error' });
                  } finally {
                    setTesting(false);
                  }
                }}
                disabled={testing}
              >
                {testing ? t('settings.testing') : t('settings.test_key')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  await removeSecret(s, prov);
                  if (st.provider === prov) await setAISettings(s, { ...st, provider: null });
                  await reload();
                  toast(t('settings.key_removed'));
                }}
              >
                {t('settings.remove_key')}
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
                toast(t('settings.key_saved_device'));
              }}
            >
              <input
                className="input"
                style={{ flex: 1, minWidth: 220 }}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('settings.paste_key')}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={t('settings.api_key')}
              />
              <Button type="submit" variant="primary">
                {t('settings.save_key')}
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
            {t('settings.use_provider', { name: info.label })}
          </label>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await removeAllSecrets(s);
              await setAISettings(s, { provider: null, models: st.models });
              await reload();
              toast(t('settings.all_keys_removed'));
            }}
          >
            {t('settings.remove_all')}
          </Button>
        </div>
      </Section>
      <Section title={t('settings.key_storage')}>
        <ul className="meta" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('settings.key_li1')}</li>
          <li>{t('settings.key_li2')}</li>
          <li>{t('settings.key_li3')}</li>
          <li>
            <strong>{t('settings.key_li4_strong')}</strong> {t('settings.key_li4')}{' '}
            <a href={info.consoleUrl} target="_blank" rel="noopener noreferrer">
              {t('settings.provider_console')}
            </a>
          </li>
        </ul>
      </Section>
    </>
  );
}

function IntegrationsSec() {
  useT();
  const s = useSession();
  const url = useLive((ss) => getMeta<string>(ss.db, 'studioUrl'), [], undefined);
  return (
    <Section title={t('settings.sec.integrations')}>
      <div className="box">
        <div className="field">
          <label className="lbl" htmlFor="studio">
            {t('settings.studio_url')}
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
        <p className="meta explain">{t('settings.studio_note')}</p>
        <a className="btn" href="#/studio/import" style={{ alignSelf: 'flex-start' }}>
          {t('settings.import_studio')}
        </a>
      </div>
    </Section>
  );
}

function TrashSec() {
  useT();
  const s = useSession();
  const items = useLive(
    async (ss) => {
      const out: { table: EntityTable; id: string; title: string; deletedAt: string }[] = [];
      for (const tbl of SYNC_TABLES) {
        if (tbl === 'workspace' || tbl === 'links' || tbl === 'media') continue;
        await ss.db.table(tbl).each((r: Record<string, unknown>) => {
          if (r.deletedAt && !r.trashGroup)
            out.push({
              table: tbl,
              id: r.id as string,
              title: String(r.title || r.name || r.statement || r.text || ''),
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
    <Section title={t('settings.trash_title')}>
      <div className="list">
        {items.slice(0, 300).map((i) => (
          <div key={i.id} className="row static">
            <div className="grow">
              <div className="title">{i.title.slice(0, 120) || t('common.untitled')}</div>
              <div className="sub">
                {t(`entity.${i.table}`)} ·{' '}
                {t('settings.trash_line', {
                  date: fmt.date(i.deletedAt),
                  count: Math.max(0, 30 - Math.floor((Date.now() - Date.parse(i.deletedAt)) / 86400000)),
                })}
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => void restore(s, i.table, i.id).then(() => toast(t('settings.restored_item')))}
            >
              {t('common.restore')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDel(i)}>
              {t('settings.delete_now')}
            </Button>
          </div>
        ))}
        {!items.length && <div className="row static meta">{t('settings.trash_empty')}</div>}
      </div>
      <Confirm
        open={!!del}
        onClose={() => setDel(null)}
        title={t('settings.delete_q')}
        body={t('settings.cannot_undo')}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => del && void purgeNow(s, del.table, del.id)}
      />
    </Section>
  );
}

function DiagnosticsSec() {
  useT();
  const s = useSession();
  const st = useStore(syncStatus);
  return (
    <Section title={t('settings.diag_title')}>
      <div className="box">
        <p className="muted">{t('settings.diag_desc')}</p>
        <Button
          onClick={async () => {
            const r = await buildDiagnostics(s, {
              sync: { phase: st.phase, lastSyncAt: st.lastSyncAt, pendingUploads: st.pendingUploads },
            });
            await navigator.clipboard?.writeText(JSON.stringify(r, null, 2));
            toast(t('settings.diag_copied'));
          }}
        >
          {t('settings.diag_copy')}
        </Button>
      </div>
    </Section>
  );
}

function ShortcutsSec() {
  useT();
  const rows: [string, string][] = [
    ['⌘/Ctrl K', t('nav.search_commands')],
    ['⌘/Ctrl J', t('nav.secretary')],
    ['C', t('capture.title')],
    ['T', t('settings.sc.task')],
    ['/', t('nav.search')],
    ['⌘/Ctrl Z', t('settings.sc.undo')],
    [`G → T / I / D / P / C / A / L / N / K / S`, t('settings.sc.goto')],
    [`${t('nav.inbox')}: J / K, ↵, I T R F C N, E`, t('settings.sc.inbox')],
    ['⌘/Ctrl ↵', t('settings.sc.save_capture')],
  ];
  return (
    <Section title={t('settings.shortcuts')}>
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
      <p className="meta">{t('settings.sc.note')}</p>
    </Section>
  );
}

function AboutSec() {
  useT();
  return (
    <Section title={t('settings.sec.about')}>
      <div className="box">
        <div>{t('settings.version', { version: env.version, build: env.name })}</div>
        <ul className="meta" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('settings.about1')}</li>
          <li>{t('settings.about2')}</li>
          <li>{t('settings.about3')}</li>
          <li>{t('settings.about4')}</li>
        </ul>
      </div>
    </Section>
  );
}
