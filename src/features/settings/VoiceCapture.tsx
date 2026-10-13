import { useNavigate } from '@tanstack/react-router';
import {
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Mic,
  RefreshCw,
  Share,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import {
  appsScriptCode,
  assistantInstructions,
  ensureInbox,
  newCaptureKey,
  readInbox,
} from '../../capture/voiceInbox';
import { getMeta } from '../../data/db';
import { update } from '../../data/store';
import { logger } from '../../diagnostics/logger';
import { t, useT } from '../../i18n';
import { errorText } from '../../i18n/render';
import { Button, Section } from '../../ui/kit';

interface VoiceMeta {
  key?: string;
  url?: string;
  verifiedAt?: string;
}
const META = 'voiceCapture';
const MASKED_KEY = '••••••••';
type Diag = 'ok' | 'key' | 'old' | 'drive' | 'login' | 'notjson' | 'blocked';
const URL_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/;

async function copy(text: string, ok: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    toast(t('workshop.copy_fallback'));
  }
}

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  useT();
  const [show, setShow] = useState(!secret);
  return (
    <div className="copy-row">
      <span className="copy-label">{label}</span>
      <code className="copy-value">{show ? value : '•'.repeat(Math.min(24, value.length))}</code>
      {secret && (
        <button
          type="button"
          className="icon-btn sm"
          aria-label={show ? t('voice.hide') : t('voice.show')}
          onClick={() => setShow(!show)}
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      )}
      <button
        type="button"
        className="icon-btn sm"
        aria-label={t('voice.copy_x', { x: label })}
        onClick={() => void copy(value, t('workshop.copied'))}
      >
        <ClipboardCopy size={14} />
      </button>
    </div>
  );
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`voice-step ${done ? 'done' : ''}`}>
      <div className="voice-step-num" aria-hidden>
        {done ? <Check size={15} /> : n}
      </div>
      <div className="voice-step-body">
        <h4>
          {title}
          {done && <span className="sr-only"> ({t('common.done_lower')})</span>}
        </h4>
        {children}
      </div>
    </section>
  );
}

/** Settings › Voice capture: Siri / Share sheet → your Apps Script → Drive inbox → Saga HQ. */
export function VoiceCaptureSec() {
  const { locale } = useT();
  const s = useSession();
  const navigate = useNavigate();
  const { runner, account } = useApp();
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  const meta = useLive((ss) => getMeta<VoiceMeta>(ss.db, META), [], undefined) ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [diag, setDiag] = useState<Diag | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [reportText, setReportText] = useState<string | null>(null);
  const fileId = ws?.voiceInboxFileId;
  // The key is shared by all the user's devices (workspace); older setups kept it on one device only.
  const key = ws?.voiceKey ?? meta.key;
  const setKey = (k: string) =>
    update(s, 'workspace', 'workspace', { voiceKey: k }, { label: 'h.voiceSetup', history: false });
  // URL and verification are shared by all devices too (older setups kept them per device).
  const url = ws?.voiceUrl ?? meta.url;
  const verifiedAt = ws?.voiceVerifiedAt ?? meta.verifiedAt;
  // Personal link to the home-screen capture page; URL and key travel in the #fragment only.
  const quickUrl =
    url && key
      ? `${new URL('quick.html', location.href.split('#')[0]).href}#u=${encodeURIComponent(url)}&k=${encodeURIComponent(key)}`
      : null;
  const setShared = (patch: { voiceUrl?: string; voiceVerifiedAt?: string | null }) =>
    update(s, 'workspace', 'workspace', patch, { label: 'h.voiceSetup', history: false });
  useEffect(() => {
    if (ws && !ws.voiceUrl && meta.url && meta.verifiedAt)
      void setShared({ voiceUrl: meta.url, voiceVerifiedAt: meta.verifiedAt });
  }, [ws?.voiceUrl, meta.url, meta.verifiedAt]);
  useEffect(() => {
    if (ws && !ws.voiceKey && meta.key) void setKey(meta.key);
  }, [ws?.voiceKey, meta.key]);

  const createInbox = async () => {
    if (!runner) return;
    setBusy('inbox');
    try {
      const st = await runner.engine.ensureLayout();
      await ensureInbox(s, runner.drive, st.wsFolderId!);
      if (!key) await setKey(newCaptureKey());
      toast(t('voice.inbox_ready'));
    } catch (e) {
      logger.warn('voice', 'inbox setup failed', e);
      toast(errorText(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Connection test with a precise diagnosis. Apps Script answers simple cross-origin POSTs with
   * CORS headers, so we can read its JSON reply; if the browser can't read it (usually Google's
   * sign-in page because access isn't "Anyone"), we still check whether the message reached Drive.
   */
  const test = async () => {
    if (!runner || !fileId || !key || !url) return;
    setBusy('test');
    setDiag(null);
    setHint(null);
    const nonce = `test-${Math.random().toString(36).slice(2, 10)}`;
    const body = JSON.stringify({ key, text: nonce, source: 'test' });
    let reply: 'json-ok' | 'json-key' | 'json-old' | 'html-login' | 'html-other' | 'unreadable' =
      'unreadable';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
      });
      const text = await res.text();
      try {
        const j = JSON.parse(text) as { ok?: boolean; error?: string; keyHint?: string; v?: number };
        // replies without a version come from an outdated deployment of the script
        reply = j.ok ? 'json-ok' : j.error === 'clave' ? (j.v ? 'json-key' : 'json-old') : 'html-other';
        if (j.keyHint !== undefined) setHint(j.keyHint);
      } catch {
        reply = /accounts\.google\.com|ServiceLogin|signin/i.test(text) ? 'html-login' : 'html-other';
      }
    } catch {
      // CORS-blocked or network: send once more without reading the reply, then check Drive.
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
      }).catch(() => undefined);
    }
    // Early versions of this page showed the key masked as •••••••• in the script preview; a script
    // copied from there was published with that literal key. Detect it and adopt it so it just works.
    let adopted = false;
    if (reply === 'json-key' || reply === 'json-old') {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ key: MASKED_KEY, text: nonce, source: 'test' }),
        });
        const j = JSON.parse(await res.text()) as { ok?: boolean };
        if (j.ok) {
          await setKey(MASKED_KEY);
          adopted = true;
          reply = 'json-ok';
        }
      } catch {
        /* keep the original diagnosis */
      }
    }
    let arrived = false;
    if (reply === 'json-ok' || reply === 'unreadable') {
      for (let i = 0; i < 8 && !arrived; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        arrived = await readInbox(runner.drive, fileId)
          .then((items) => items.some((x) => x.text === nonce))
          .catch(() => false);
      }
    }
    const d: Diag = arrived
      ? 'ok'
      : reply === 'json-key'
        ? 'key'
        : reply === 'json-old'
          ? 'old'
          : reply === 'json-ok'
            ? 'drive'
            : reply === 'html-login'
              ? 'login'
              : reply === 'html-other'
                ? 'notjson'
                : 'blocked';
    setDiag(d);
    if (d === 'ok') {
      await setShared({ voiceVerifiedAt: new Date().toISOString() });
      toast(adopted ? t('voice.test_ok_adopted') : t('voice.test_ok'));
    } else logger.warn('voice', `connection test: ${d}`);
    setBusy(null);
  };

  /** Plain-text report with the real answers (key shown only as its first 4 characters). */
  const report = async () => {
    if (!runner) return;
    setBusy('report');
    const lines: string[] = [
      `Saga HQ build: ${typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'}`,
      `URL: ${url ?? '—'}`,
      `Clave app: ${key ? `${key.slice(0, 4)}… (${key.length})` : '—'} · ${ws?.voiceKey ? 'espacio' : 'local'}`,
      `Buzón: ${fileId ?? '—'}`,
    ];
    const probe = async (label: string, k: string) => {
      if (!url) return;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ key: k, text: 'saga-report', source: 'test' }),
        });
        lines.push(`${label}: HTTP ${res.status} · ${(await res.text()).slice(0, 160).replace(/\s+/g, ' ')}`);
      } catch (e) {
        lines.push(`${label}: ${(e as Error).name} ${(e as Error).message}`.slice(0, 200));
      }
    };
    if (key) await probe('POST clave app', key);
    await probe('POST clave oculta', MASKED_KEY);
    if (fileId)
      await readInbox(runner.drive, fileId)
        .then((items) => lines.push(`Drive: ${items.length} elementos · último ${items.at(-1)?.at ?? '—'}`))
        .catch((e) => lines.push(`Drive: ${(e as Error).message}`.slice(0, 160)));
    const text = lines.join('\n');
    setReportText(text);
    await copy(text, t('voice.report_copied'));
    setBusy(null);
  };

  if (!account || !runner)
    return (
      <Section title={t('settings.sec.voice')}>
        <div className="voice-hero">
          <Mic size={26} aria-hidden />
          <div>
            <h3>{t('voice.hero_title')}</h3>
            <p className="muted">{t('voice.hero_body')}</p>
          </div>
        </div>
        <div className="banner info" style={{ borderRadius: 10 }}>
          {t('voice.needs_google')}
        </div>
        <Button
          variant="primary"
          onClick={() => void navigate({ to: '/settings', search: { section: 'account' } })}
        >
          {t('voice.go_account')}
        </Button>
      </Section>
    );

  return (
    <>
      <div className="voice-hero">
        <div className="voice-orb" aria-hidden>
          <Mic size={24} />
        </div>
        <div>
          <h3>{t('voice.hero_title')}</h3>
          <p className="muted">{t('voice.hero_body')}</p>
          <div className="voice-flow" role="group" aria-label={t('voice.flow_label')}>
            <span>
              <Mic size={13} aria-hidden /> Siri
            </span>
            <span aria-hidden>→</span>
            <span>
              <Globe size={13} aria-hidden /> {t('voice.flow_script')}
            </span>
            <span aria-hidden>→</span>
            <span>
              <ArrowDownToLine size={13} aria-hidden /> Drive
            </span>
            <span aria-hidden>→</span>
            <span>
              <Sparkles size={13} aria-hidden /> Saga HQ
            </span>
          </div>
        </div>
        {verifiedAt && (
          <span className="pill ok voice-status">
            <CheckCircle2 size={13} aria-hidden /> {t('voice.working')}
          </span>
        )}
      </div>

      <Step n={1} title={t('voice.s1_title')} done={!!fileId && !!key}>
        <p className="meta">{t('voice.s1_body')}</p>
        {!fileId || !key ? (
          <Button variant="primary" disabled={busy === 'inbox'} onClick={() => void createInbox()}>
            {busy === 'inbox' ? t('voice.creating') : t('voice.s1_btn')}
          </Button>
        ) : (
          <div className="meta">{t('voice.s1_done')}</div>
        )}
      </Step>

      <Step n={2} title={t('voice.s2_title')} done={!!url}>
        {fileId && key ? (
          <>
            <ol className="voice-howto">
              <li>
                {t('voice.s2_a')}{' '}
                <a href="https://script.new" target="_blank" rel="noopener noreferrer">
                  script.new <ExternalLink size={12} aria-hidden />
                </a>
              </li>
              <li>{t('voice.s2_b')}</li>
              <li>{t('voice.s2_c')}</li>
              <li>{t('voice.s2_d')}</li>
              <li>{t('voice.s2_e')}</li>
            </ol>
            <div className="code-card">
              <div className="code-card-head">
                <span>Code.gs</span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void copy(appsScriptCode(fileId, key), t('voice.script_copied'))}
                >
                  <ClipboardCopy size={14} aria-hidden /> {t('voice.copy_script')}
                </Button>
              </div>
              <pre>{appsScriptCode(fileId, key)}</pre>
            </div>
            <p className="meta explain">{t('voice.s2_note')}</p>
            <div className="field">
              <label className="lbl" htmlFor="vurl">
                {t('voice.url_label')}
              </label>
              <div className="hstack">
                <input
                  id="vurl"
                  className="input"
                  inputMode="url"
                  placeholder="https://script.google.com/macros/s/…/exec"
                  value={urlDraft || url || ''}
                  onChange={(e) => setUrlDraft(e.target.value.trim())}
                />
                <Button
                  disabled={!URL_RE.test(urlDraft)}
                  onClick={() =>
                    void setShared({ voiceUrl: urlDraft, voiceVerifiedAt: null }).then(() =>
                      toast(t('voice.url_saved')),
                    )
                  }
                >
                  {t('common.save')}
                </Button>
              </div>
              {urlDraft && !URL_RE.test(urlDraft) && (
                <div className="meta warn-text">{t('voice.url_bad')}</div>
              )}
            </div>
          </>
        ) : (
          <p className="meta">{t('voice.after_s1')}</p>
        )}
      </Step>

      <Step n={3} title={t('voice.s3_title')} done={!!verifiedAt}>
        <p className="meta">{t('voice.s3_body')}</p>
        <Button disabled={!url || busy === 'test'} onClick={() => void test()}>
          <RefreshCw size={14} aria-hidden className={busy === 'test' ? 'spin' : ''} />{' '}
          {busy === 'test' ? t('voice.testing') : t('voice.test_btn')}
        </Button>
        {diag && diag !== 'ok' && (
          <div className="banner error voice-diag" role="alert">
            <strong>{t(`voice.diag.${diag}`)}</strong>
            {diag === 'key' && hint !== null && (
              <span>{t('voice.key_hint', { deployed: `${hint}…`, mine: `${key?.slice(0, 4)}…` })}</span>
            )}
            <span>{t(`voice.fix.${diag}`)}</span>
            {(diag === 'key' || diag === 'old') && (
              <form
                className="key-fix"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = keyDraft.trim().replace(/^['"]|['"];?$/g, '');
                  if (!/^[\w-]{8,80}$/.test(v)) return;
                  void setKey(v).then(() => {
                    setKeyDraft('');
                    toast(t('voice.key_set'));
                  });
                }}
              >
                <label className="lbl" htmlFor="vkeyfix">
                  {t('voice.key_from_script')}
                </label>
                <div className="hstack">
                  <input
                    id="vkeyfix"
                    className="input mono"
                    value={keyDraft}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="0h70…"
                    onChange={(e) => setKeyDraft(e.target.value)}
                  />
                  <Button type="submit" size="sm" disabled={!keyDraft.trim()}>
                    {t('voice.use_key')}
                  </Button>
                </div>
              </form>
            )}
            {url && <span className="meta">{t('voice.testing_url', { tail: `…${url.slice(-22)}` })}</span>}
          </div>
        )}
        {diag === 'ok' && (
          <div className="banner ok voice-diag" role="status">
            {t('voice.test_ok')}
          </div>
        )}
        <Button size="sm" variant="ghost" disabled={busy === 'report'} onClick={() => void report()}>
          <ClipboardCopy size={14} aria-hidden /> {t('voice.report')}
        </Button>
        {reportText && <pre className="voice-report">{reportText}</pre>}
        {url && key && (
          <p className="meta">
            {t('voice.manual_check')}{' '}
            <a
              href={`${url}?key=${encodeURIComponent(key)}&source=test&text=${encodeURIComponent('saga-test')}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('voice.open_check')} <ExternalLink size={12} aria-hidden />
            </a>
          </p>
        )}
      </Step>

      <Step n={4} title={t('voice.home_title')}>
        <p className="meta">{t('voice.home_body')}</p>
        {quickUrl ? (
          <>
            <div className="hstack wrap">
              <a className="btn primary" href={quickUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={15} aria-hidden /> {t('voice.home_open')}
              </a>
              <Button onClick={() => void copy(quickUrl, t('voice.home_copied'))}>
                <ClipboardCopy size={15} aria-hidden /> {t('voice.home_copy')}
              </Button>
            </div>
            <ol className="voice-howto">
              <li>{t('voice.home_a')}</li>
              <li>{t('voice.home_b')}</li>
              <li>{t('voice.home_c')}</li>
            </ol>
            <p className="meta explain">{t('voice.home_note')}</p>
          </>
        ) : (
          <p className="meta">{t('voice.after_s1')}</p>
        )}
      </Step>

      <Step n={5} title={t('voice.s4_title')}>
        <p className="meta">{t('voice.s4_body')}</p>
        {url && key && (
          <div className="copy-box">
            <CopyRow label="URL" value={url} />
            <CopyRow label="key" value={key} secret />
          </div>
        )}
        <div className="shortcut-mock" role="group" aria-label={t('voice.mock_label')}>
          <div className="sc-title">
            <Wand2 size={15} aria-hidden /> {t('voice.sc_name')}
          </div>
          <div className="sc-action">
            <span className="sc-ico share">
              <Share size={14} aria-hidden />
            </span>
            <div>{t('voice.sc_1')}</div>
          </div>
          <div className="sc-action">
            <span className="sc-ico web">
              <Globe size={14} aria-hidden />
            </span>
            <div>
              {t('voice.sc_2')}
              <ul className="sc-fields">
                <li>
                  <b>key</b> · {t('voice.sc_key')}
                </li>
                <li>
                  <b>text</b> · {t('voice.sc_text')}
                </li>
                <li>
                  <b>source</b> · {t('voice.sc_source')}
                </li>
              </ul>
            </div>
          </div>
          <div className="sc-action">
            <span className="sc-ico notify">
              <Check size={14} aria-hidden />
            </span>
            <div>{t('voice.sc_3')}</div>
          </div>
        </div>
        <ol className="voice-howto">
          <li>{t('voice.s4_a')}</li>
          <li>{t('voice.s4_b')}</li>
          <li>{t('voice.s4_c')}</li>
        </ol>
        {url && key && (
          <div className="voice-planb">
            <p className="meta">
              <b>{t('voice.direct_title')}</b> {t('voice.direct_body')}
            </p>
            <div className="copy-box">
              <CopyRow
                label={t('voice.direct_link')}
                value={`${url}?key=${encodeURIComponent(key)}&source=voz&text=`}
                secret
              />
            </div>
          </div>
        )}
        {quickUrl && (
          <div className="voice-planb">
            <p className="meta">
              <b>{t('voice.planb_title')}</b> {t('voice.planb_body')}
            </p>
            <ol className="voice-howto">
              <li>{t('voice.planb_a')}</li>
              <li>{t('voice.planb_b')}</li>
              <li>{t('voice.planb_c')}</li>
            </ol>
            <div className="copy-box">
              <CopyRow label={t('voice.planb_link')} value={`${quickUrl}&t=`} secret />
            </div>
          </div>
        )}
      </Step>

      <Step n={6} title={t('voice.s5_title')}>
        <p className="meta">{t('voice.s5_body')}</p>
        <ul className="say-list">
          {(['idea', 'task', 'variant', 'radar', 'piece', 'free'] as const).map((k) => (
            <li key={k}>
              <span className="say-quote">«{t(`voice.say.${k}`)}»</span>
              <span className="say-dest">→ {t(`voice.say_dest.${k}`)}</span>
            </li>
          ))}
        </ul>
      </Step>

      <Step n={7} title={t('voice.s6_title')}>
        <p className="meta">{t('voice.s6_body')}</p>
        <div className="code-card">
          <div className="code-card-head">
            <span>ChatGPT · Claude</span>
            <Button
              size="sm"
              onClick={() =>
                void copy(assistantInstructions(locale === 'en' ? 'en' : 'es'), t('voice.instr_copied'))
              }
            >
              <ClipboardCopy size={14} aria-hidden /> {t('voice.copy_instr')}
            </Button>
          </div>
          <pre>{assistantInstructions(locale === 'en' ? 'en' : 'es')}</pre>
        </div>
      </Step>

      <Section title={t('voice.manage')} fold="closed">
        <div className="hstack wrap">
          <Button
            size="sm"
            onClick={() => void runner.pullVoice(true).then((n) => !n && toast(t('voice.nothing_new')))}
          >
            {t('voice.check_now')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void Promise.all([setKey(newCaptureKey()), setShared({ voiceVerifiedAt: null })]).then(() =>
                toast(t('voice.key_rotated')),
              )
            }
          >
            {t('voice.rotate_key')}
          </Button>
        </div>
        <p className="meta explain">{t('voice.privacy')}</p>
      </Section>
    </>
  );
}
