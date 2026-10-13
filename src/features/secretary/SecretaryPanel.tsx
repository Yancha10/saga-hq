import { Link } from '@tanstack/react-router';
import { Copy, ExternalLink, History, Send, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { applyAction, type ResolvedAction } from '../../ai/actions';
import {
  type ContextPack,
  type Focus,
  INTENT_LABEL,
  type Intent,
  resolveContext,
  summarizePack,
} from '../../ai/context';
import { buildManualPrompt } from '../../ai/prompts';
import { ask, providerConfig, type SecretaryAnswer } from '../../ai/secretary';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { undoLast } from '../../data/store';
import { Button, Chip, IconButton, Spinner } from '../../ui/kit';

const QUICK: { intent: Intent; label: string; q: string }[] = [
  { intent: 'brief', label: 'Brief me', q: 'What matters today?' },
  {
    intent: 'producer',
    label: 'Finish fastest',
    q: 'Which content can I finish fastest, and what exactly is missing?',
  },
  {
    intent: 'producer',
    label: 'What’s blocking?',
    q: 'What is blocking production right now and how do I unblock it?',
  },
  {
    intent: 'planner',
    label: 'Plan my week',
    q: 'Propose a realistic publication and production plan for the next 7 days.',
  },
  {
    intent: 'analyst',
    label: 'Explain results',
    q: 'What do recent results suggest? Label observations and hypotheses.',
  },
  { intent: 'creative', label: 'New ideas', q: 'Suggest 5 new ideas grounded in my research and learnings.' },
  { intent: 'librarian', label: 'Find…', q: '' },
];

/** The Secretary: grounded in the workspace, facts separated from recommendations, actions as proposals. */
export function SecretaryPanel({
  focus,
  initialIntent,
  onClose,
}: {
  focus?: { entity: 'content' | 'idea' | 'project'; id: string };
  initialIntent?: string;
  onClose: () => void;
}) {
  const s = useSession();
  const { search } = useApp();
  const [hasAI, setHasAI] = useState<boolean | null>(null);
  const [intent, setIntent] = useState<Intent>(
    (initialIntent as Intent) ??
      (focus?.entity === 'content' ? 'producer' : focus?.entity === 'idea' ? 'creative' : 'brief'),
  );
  const [q, setQ] = useState('');
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
  }, [initialIntent]);
  // Deterministic facts are always available (no AI needed).
  useEffect(() => {
    let alive = true;
    setAnswer(null);
    void resolveContext(s, intent, q, f, search).then((p) => alive && setPack(p));
    return () => {
      alive = false;
    };
  }, [intent, focus?.id, s]);

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
      if ((e as Error).name !== 'SessionClosedError') toast((e as Error).message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const copyPrompt = async () => {
    const p = pack ?? (await resolveContext(s, intent, q, f, search));
    await navigator.clipboard?.writeText(
      buildManualPrompt(p, q || QUICK.find((x) => x.intent === intent)?.q || ''),
    );
    toast('Prompt with your workspace context copied');
  };
  const apply = async (ra: ResolvedAction) => {
    if (!answer) return;
    try {
      await applyAction(s, ra, answer.pack);
      setApplied((x) => ({ ...x, [ra.id]: 'applied' }));
      toast(`Applied: ${ra.summary}`, { action: { label: 'Undo', run: () => void undoLast(s) } });
    } catch (e) {
      toast((e as Error).message, { kind: 'error' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sec-panel-head">
        <Sparkles size={17} aria-hidden />
        <strong style={{ flex: 1 }}>Secretary</strong>
        <IconButton label="Recent questions" onClick={() => setShowHistory((v) => !v)}>
          <History size={16} />
        </IconButton>
        <IconButton label="Close Secretary" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>
      <div className="sec-body">
        {showHistory && (
          <div className="box">
            <div className="hstack">
              <h4 style={{ flex: 1 }}>Recent (this device only)</h4>
              <Button size="sm" variant="ghost" onClick={() => void s.db.secretary.clear()}>
                Clear
              </Button>
            </div>
            {sessions.length ? (
              sessions.map((x) => (
                <details key={x.id}>
                  <summary className="meta">
                    {new Date(x.at).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {INTENT_LABEL[x.intent as Intent] ?? x.intent}: {x.question || '—'}
                  </summary>
                  <div className="answer meta">{x.answer}</div>
                </details>
              ))
            ) : (
              <div className="meta">Nothing yet.</div>
            )}
          </div>
        )}
        <div className="chips" role="group" aria-label="Secretary behaviours">
          {QUICK.map((x) => (
            <Chip
              key={x.label}
              on={intent === x.intent && q === x.q}
              onClick={() => {
                setIntent(x.intent);
                if (x.q) {
                  setQ(x.q);
                  if (hasAI) void run(x.q, x.intent);
                } else setQ('');
              }}
            >
              {x.label}
            </Chip>
          ))}
        </div>
        {focus && <div className="meta">Focused on this {focus.entity}.</div>}

        <div className="box">
          <div className="ai-label">Workspace facts</div>
          {pack?.facts.length ? (
            <ul className="facts">
              {pack.facts.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <div className="meta">No open items.</div>
          )}
          {pack?.notes.map((n) => (
            <div key={n} className="meta">
              {n}
            </div>
          ))}
        </div>

        {(intent === 'librarian' || intent === 'ask') && pack && pack.entities.length > 0 && (
          <div className="box">
            <div className="ai-label">Matching records (keyword search)</div>
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
            Using: {summarizePack(pack)} ·{' '}
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
              {showJson ? 'hide' : 'inspect'} context
            </button>
          </div>
        )}
        {showJson && pack && <pre className="json">{JSON.stringify(pack, null, 2)}</pre>}

        {busy && (
          <div className="hstack">
            <Spinner label="Thinking" />{' '}
            <span className="meta">Asking your AI provider with only the context above…</span>
          </div>
        )}
        {answer && (
          <div className="ai-box">
            <div className="ai-label">✧ AI recommendation · {answer.model}</div>
            <div className="answer">{answer.text || '(empty answer)'}</div>
            {answer.removed.length > 0 && (
              <details className="meta">
                <summary>
                  {answer.removed.length} statement(s) removed — they cited records or numbers not in your
                  workspace
                </summary>
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
                    {ra.risk === 'high' ? 'needs confirmation' : 'low risk'}
                  </span>
                </div>
                {ra.action.rationale && <div className="meta">{ra.action.rationale}</div>}
                {ra.diff && <div className="diff">{ra.diff}</div>}
                {ra.invalid ? (
                  <div className="meta" style={{ color: 'var(--danger)' }}>
                    Can’t apply: {ra.invalid}
                  </div>
                ) : applied[ra.id] ? (
                  <div className="meta">
                    {applied[ra.id] === 'applied' ? 'Applied (undo from the toast or ⌘Z)' : 'Dismissed'}
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
                        I reviewed this change
                      </label>
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={ra.risk === 'high' && !confirmHigh[ra.id]}
                      onClick={() => void apply(ra)}
                    >
                      Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setApplied((x) => ({ ...x, [ra.id]: 'dismissed' }))}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {hasAI === false && (
          <div className="box">
            <div className="ai-label">No AI provider configured</div>
            <p className="meta">
              Everything in Saga HQ works without AI. To get written recommendations, add your own API key in
              Settings › AI — or use your ChatGPT/Claude subscription manually:
            </p>
            <div className="hstack">
              <Button size="sm" onClick={() => void copyPrompt()}>
                <Copy size={14} /> Copy context + prompt
              </Button>
              <a
                className="btn ghost sm"
                href="https://chatgpt.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open ChatGPT <ExternalLink size={12} />
              </a>
              <a
                className="btn ghost sm"
                href="https://claude.ai/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Claude <ExternalLink size={12} />
              </a>
            </div>
            <Link to="/settings" search={{ section: 'ai' }} className="meta">
              Set up an API key →
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
                ? 'Find… e.g. old man watching TV in a bar'
                : `Ask (${INTENT_LABEL[intent]})`
            }
            aria-label="Ask the Secretary"
          />
          <Button type="submit" variant="primary" disabled={busy} aria-label={hasAI ? 'Send' : 'Copy prompt'}>
            {hasAI ? <Send size={15} /> : <Copy size={15} />}
          </Button>
        </div>
        <span className="meta">
          Only the context shown above is sent, to your own provider. Actions are proposals — nothing changes
          until you apply.
        </span>
      </form>
    </div>
  );
}
