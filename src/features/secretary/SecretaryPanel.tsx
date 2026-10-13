import { Link } from '@tanstack/react-router';
import { Copy, ExternalLink, History, Send, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { applyAction, type ResolvedAction } from '../../ai/actions';
import {
  type ContextPack,
  type Focus,
  type Intent,
  intentLabel,
  resolveContext,
  summarizePack,
} from '../../ai/context';
import { buildManualPrompt } from '../../ai/prompts';
import { ask, providerConfig, type SecretaryAnswer } from '../../ai/secretary';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { undoLast } from '../../data/store';
import { fmt, t, useT } from '../../i18n';
import { errorText } from '../../i18n/render';
import { Button, Chip, IconButton, Spinner } from '../../ui/kit';

const QUICK: { k: string; intent: Intent; hasQ: boolean }[] = [
  { k: 'brief', intent: 'brief', hasQ: true },
  { k: 'fastest', intent: 'producer', hasQ: true },
  { k: 'blocking', intent: 'producer', hasQ: true },
  { k: 'week', intent: 'planner', hasQ: true },
  { k: 'results', intent: 'analyst', hasQ: true },
  { k: 'ideas', intent: 'creative', hasQ: true },
  { k: 'find', intent: 'librarian', hasQ: false },
];
const quickQ = (x: (typeof QUICK)[number]) => (x.hasQ ? t(`sec.quick.${x.k}.q`) : '');

/** The Secretary: grounded in the workspace, facts separated from recommendations, actions as proposals. */
export function SecretaryPanel({
  focus,
  initialIntent,
  initialQuestion,
  onClose,
}: {
  focus?: { entity: 'content' | 'idea' | 'project'; id: string };
  initialIntent?: string;
  initialQuestion?: string;
  onClose: () => void;
}) {
  const { locale } = useT();
  const s = useSession();
  const { search } = useApp();
  const [hasAI, setHasAI] = useState<boolean | null>(null);
  const [intent, setIntent] = useState<Intent>(
    (initialIntent as Intent) ??
      (focus?.entity === 'content' ? 'producer' : focus?.entity === 'idea' ? 'creative' : 'brief'),
  );
  const [q, setQ] = useState(initialQuestion ?? '');
  const [pack, setPack] = useState<ContextPack | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<SecretaryAnswer | null>(null);
  const [applied, setApplied] = useState<Record<string, 'applied' | 'dismissed'>>({});
  const [confirmHigh, setConfirmHigh] = useState<Record<string, boolean>>({});
  const [showHistory, setShowHistory] = useState(false);
  const sessions = useLive((ss) => ss.db.secretary.orderBy('at').reverse().limit(20).toArray(), [], []);
  const f: Focus = focus ? { entity: focus.entity, id: focus.id } : {};

  useEffect(() => {
    void providerConfig(s).then((c) => setHasAI(!!c));
  }, [s]);
  useEffect(() => {
    if (initialIntent) setIntent(initialIntent as Intent);
    if (initialQuestion) setQ(initialQuestion);
  }, [initialIntent, initialQuestion]);
  // Deterministic facts are always available (no AI needed).
  useEffect(() => {
    let alive = true;
    setAnswer(null);
    void resolveContext(s, intent, q, f, search).then((p) => alive && setPack(p));
    return () => {
      alive = false;
    };
  }, [intent, focus?.id, s, locale]);

  const run = async (question: string, it: Intent = intent) => {
    setBusy(true);
    setAnswer(null);
    setApplied({});
    try {
      const p = await resolveContext(s, it, question, f, search);
      setPack(p);
      if (!hasAI) return;
      const a = await ask(s, p, question);
      setAnswer(a);
    } catch (e) {
      if ((e as Error).name !== 'SessionClosedError') toast(errorText(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const copyPrompt = async () => {
    const p = pack ?? (await resolveContext(s, intent, q, f, search));
    await navigator.clipboard?.writeText(
      buildManualPrompt(p, q || quickQ(QUICK.find((x) => x.intent === intent) ?? QUICK[0]!)),
    );
    toast(t('sec.prompt_copied'));
  };
  const apply = async (ra: ResolvedAction) => {
    if (!answer) return;
    try {
      await applyAction(s, ra, answer.pack);
      setApplied((x) => ({ ...x, [ra.id]: 'applied' }));
      toast(t('sec.applied_toast', { summary: ra.summary }), {
        action: { label: t('common.undo'), run: () => void undoLast(s) },
      });
    } catch (e) {
      toast(errorText(e), { kind: 'error' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sec-panel-head">
        <Sparkles size={17} aria-hidden />
        <strong style={{ flex: 1 }}>{t('nav.secretary')}</strong>
        <IconButton label={t('sec.recent_questions')} onClick={() => setShowHistory((v) => !v)}>
          <History size={16} />
        </IconButton>
        <IconButton label={t('sec.close')} onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>
      <div className="sec-body">
        {showHistory && (
          <div className="box">
            <div className="hstack">
              <h4 style={{ flex: 1 }}>{t('sec.recent')}</h4>
              <Button size="sm" variant="ghost" onClick={() => void s.db.secretary.clear()}>
                {t('common.clear')}
              </Button>
            </div>
            {sessions.length ? (
              sessions.map((x) => (
                <details key={x.id}>
                  <summary className="meta">
                    {fmt.dateTime(x.at)} · {intentLabel(x.intent as Intent)}: {x.question || '—'}
                  </summary>
                  <div className="answer meta">{x.answer}</div>
                </details>
              ))
            ) : (
              <div className="meta">{t('common.nothing_yet')}</div>
            )}
          </div>
        )}
        <div className="chips" role="group" aria-label={t('sec.behaviours')}>
          {QUICK.map((x) => (
            <Chip
              key={x.k}
              on={intent === x.intent && q === quickQ(x)}
              onClick={() => {
                setIntent(x.intent);
                const xq = quickQ(x);
                if (xq) {
                  setQ(xq);
                  if (hasAI) void run(xq, x.intent);
                } else setQ('');
              }}
            >
              {t(`sec.quick.${x.k}`)}
            </Chip>
          ))}
        </div>
        {focus && <div className="meta">{t(`sec.focused.${focus.entity}`)}</div>}

        <div className="box">
          <div className="ai-label">{t('today.facts')}</div>
          {pack?.facts.length ? (
            <ul className="facts">
              {pack.facts.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <div className="meta">{t('today.no_open')}</div>
          )}
          {pack?.notes.map((n) => (
            <div key={n} className="meta">
              {n}
            </div>
          ))}
        </div>

        {(intent === 'librarian' || intent === 'ask') && pack && pack.entities.length > 0 && (
          <div className="box">
            <div className="ai-label">{t('sec.matching')}</div>
            {pack.entities.slice(0, 15).map((e) => (
              <Link
                key={e.id}
                to={
                  e.type === 'content'
                    ? `/content/${e.id}`
                    : e.type === 'idea'
                      ? `/ideas/${e.id}`
                      : e.type === 'library'
                        ? `/library/${e.id}`
                        : e.type === 'learning'
                          ? `/learnings/${e.id}`
                          : e.type === 'project'
                            ? `/projects/${e.id}`
                            : '/tasks'
                }
                className="meta"
              >
                [{e.handle}] {String(e.fields.title ?? e.fields.name ?? e.fields.statement ?? '')}
              </Link>
            ))}
          </div>
        )}

        {pack && (
          <div className="meta">
            {t('sec.using', { summary: summarizePack(pack) })} ·{' '}
            <button
              type="button"
              onClick={() => setShowJson((v) => !v)}
              style={{
                border: 0,
                background: 'none',
                color: 'var(--accent-strong)',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {showJson ? t('sec.hide_context') : t('sec.inspect_context')}
            </button>
          </div>
        )}
        {showJson && pack && <pre className="json">{JSON.stringify(pack, null, 2)}</pre>}

        {busy && (
          <div className="hstack">
            <Spinner label={t('sec.thinking')} /> <span className="meta">{t('sec.asking')}</span>
          </div>
        )}
        {answer && (
          <div className="ai-box">
            <div className="ai-label">✧ {t('sec.ai_reco', { model: answer.model })}</div>
            <div className="answer">{answer.text || t('sec.empty_answer')}</div>
            {answer.removed.length > 0 && (
              <details className="meta">
                <summary>{t('secretary.removed', { count: answer.removed.length })}</summary>
                <ul>
                  {answer.removed.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            )}
            {answer.actions.map((ra) => (
              <div key={ra.id} className="action-card">
                <div className="hstack">
                  <strong style={{ flex: 1 }}>{ra.summary}</strong>
                  <span className={`pill ${ra.risk === 'high' ? 'warn' : ''}`}>
                    {ra.risk === 'high' ? t('sec.needs_confirmation') : t('sec.low_risk')}
                  </span>
                </div>
                {ra.action.rationale && <div className="meta">{ra.action.rationale}</div>}
                {ra.diff && <div className="diff">{ra.diff}</div>}
                {ra.invalid ? (
                  <div className="meta" style={{ color: 'var(--danger)' }}>
                    {t('sec.cant_apply', { reason: ra.invalid })}
                  </div>
                ) : applied[ra.id] ? (
                  <div className="meta">
                    {applied[ra.id] === 'applied' ? t('sec.applied') : t('sec.dismissed')}
                  </div>
                ) : (
                  <div className="hstack">
                    {ra.risk === 'high' && (
                      <label className="check meta" style={{ minHeight: 0 }}>
                        <input
                          type="checkbox"
                          checked={!!confirmHigh[ra.id]}
                          onChange={(e) => setConfirmHigh((x) => ({ ...x, [ra.id]: e.target.checked }))}
                        />{' '}
                        {t('sec.reviewed')}
                      </label>
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={ra.risk === 'high' && !confirmHigh[ra.id]}
                      onClick={() => void apply(ra)}
                    >
                      {t('sec.apply')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setApplied((x) => ({ ...x, [ra.id]: 'dismissed' }))}
                    >
                      {t('common.dismiss')}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {hasAI === false && (
          <div className="box">
            <div className="ai-label">{t('sec.no_provider')}</div>
            <p className="meta">{t('sec.no_provider_body')}</p>
            <div className="hstack">
              <Button size="sm" onClick={() => void copyPrompt()}>
                <Copy size={14} /> {t('sec.copy_context')}
              </Button>
              <a
                className="btn ghost sm"
                href="https://chatgpt.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('sec.open_x', { name: 'ChatGPT' })} <ExternalLink size={12} />
              </a>
              <a
                className="btn ghost sm"
                href="https://claude.ai/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('sec.open_x', { name: 'Claude' })} <ExternalLink size={12} />
              </a>
            </div>
            <Link to="/settings" search={{ section: 'ai' }} className="meta">
              {t('sec.setup_key')}
            </Link>
          </div>
        )}
      </div>
      <form
        className="sec-foot"
        onSubmit={(e) => {
          e.preventDefault();
          if (hasAI) void run(q);
          else void copyPrompt();
        }}
      >
        <div className="hstack" style={{ flexWrap: 'nowrap' }}>
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              intent === 'librarian'
                ? t('sec.find_placeholder')
                : t('sec.ask_placeholder', { intent: intentLabel(intent) })
            }
            aria-label={t('sec.ask_aria')}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={busy}
            aria-label={hasAI ? t('common.send') : t('common.copy_prompt')}
          >
            {hasAI ? <Send size={15} /> : <Copy size={15} />}
          </Button>
        </div>
        <span className="meta">{t('sec.footer')}</span>
      </form>
    </div>
  );
}
