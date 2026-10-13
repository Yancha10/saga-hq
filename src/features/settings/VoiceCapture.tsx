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
import { type ReactNode, useState } from 'react';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import {
  appsScriptCode,
  assistantInstructions,
  ensureInbox,
  newCaptureKey,
  readInbox,
} from '../../capture/voiceInbox';
import { getMeta, setMeta } from '../../data/db';
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
const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

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
  const fileId = ws?.voiceInboxFileId;
  const key = meta.key;
  const save = (patch: VoiceMeta) => setMeta(s.db, META, { ...meta, ...patch });

  const createInbox = async () => {
    if (!runner) return;
    setBusy('inbox');
    try {
      const st = await runner.engine.ensureLayout();
      await ensureInbox(s, runner.drive, st.wsFolderId!);
      if (!meta.key) await save({ key: newCaptureKey() });
      toast(t('voice.inbox_ready'));
    } catch (e) {
      logger.warn('voice', 'inbox setup failed', e);
      toast(errorText(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (!runner || !fileId || !key || !meta.url) return;
    setBusy('test');
    const nonce = `test-${Math.random().toString(36).slice(2, 10)}`;
    try {
      // Apps Script web apps accept simple cross-origin POSTs; the response is opaque, so we verify
      // by reading the inbox file back from Drive.
      await fetch(meta.url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ key, text: nonce, source: 'test' }),
      });
      let ok = false;
      for (let i = 0; i < 8 && !ok; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        ok = (await readInbox(runner.drive, fileId)).some((x) => x.text === nonce);
      }
      if (ok) {
        await save({ verifiedAt: new Date().toISOString() });
        toast(t('voice.test_ok'));
      } else toast(t('voice.test_fail'), { kind: 'error' });
    } catch (e) {
      logger.warn('voice', 'test failed', e);
      toast(t('voice.test_fail'), { kind: 'error' });
    } finally {
      setBusy(null);
    }
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
        {meta.verifiedAt && (
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

      <Step n={2} title={t('voice.s2_title')} done={!!meta.url}>
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
              <pre>{appsScriptCode(fileId, '••••••••')}</pre>
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
                  value={urlDraft || meta.url || ''}
                  onChange={(e) => setUrlDraft(e.target.value.trim())}
                />
                <Button
                  disabled={!URL_RE.test(urlDraft)}
                  onClick={() =>
                    void save({ url: urlDraft, verifiedAt: undefined }).then(() =>
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

      <Step n={3} title={t('voice.s3_title')} done={!!meta.verifiedAt}>
        <p className="meta">{t('voice.s3_body')}</p>
        <Button disabled={!meta.url || busy === 'test'} onClick={() => void test()}>
          <RefreshCw size={14} aria-hidden className={busy === 'test' ? 'spin' : ''} />{' '}
          {busy === 'test' ? t('voice.testing') : t('voice.test_btn')}
        </Button>
      </Step>

      <Step n={4} title={t('voice.s4_title')}>
        <p className="meta">{t('voice.s4_body')}</p>
        {meta.url && key && (
          <div className="copy-box">
            <CopyRow label="URL" value={meta.url} />
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
      </Step>

      <Step n={5} title={t('voice.s5_title')}>
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

      <Step n={6} title={t('voice.s6_title')}>
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
              void save({ key: newCaptureKey(), verifiedAt: undefined }).then(() =>
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
