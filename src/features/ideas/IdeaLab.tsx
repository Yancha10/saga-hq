import { Copy, ExternalLink, FlaskConical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { resolveContext } from '../../ai/context';
import { buildManualPrompt } from '../../ai/prompts';
import { ask, providerConfig } from '../../ai/secretary';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { createVariant } from '../../data/domain';
import type { Idea } from '../../data/schema';
import { Button, Chip, Spinner } from '../../ui/kit';

const GENERATORS = [
  {
    k: 'hooks',
    label: 'Alt hooks ×5',
    q: 'Write 5 alternative hooks for the focused idea [I1]. One per line.',
  },
  {
    k: 'expand',
    label: 'Expand',
    q: 'Expand the focused idea [I1] into a fuller concept: setup, escalation, payoff.',
  },
  { k: 'darker', label: 'Darker', q: 'Write a darker version of the focused idea [I1].' },
  { k: 'funnier', label: 'Funnier', q: 'Write a funnier version of the focused idea [I1].' },
  { k: 'emotional', label: 'More emotional', q: 'Write a more emotional version of the focused idea [I1].' },
  {
    k: 'simpler',
    label: 'Simpler',
    q: 'Write a simpler, easier-to-produce version of the focused idea [I1].',
  },
  {
    k: 'visual',
    label: 'Stronger visual',
    q: 'Propose a stronger visual concept for the focused idea [I1].',
  },
  { k: '15s', label: '15 s cut', q: 'Rewrite the focused idea [I1] as a 15-second piece: beat by beat.' },
  { k: '30s', label: '30 s cut', q: 'Rewrite the focused idea [I1] as a 30-second piece: beat by beat.' },
  { k: 'ending', label: 'Alt ending', q: 'Propose an alternative ending for the focused idea [I1].' },
  { k: 'series', label: 'Series ×5', q: 'Turn the focused idea [I1] into a 5-episode series outline.' },
  {
    k: 'challenge',
    label: 'Challenge it',
    q: 'Critique the focused idea [I1]: weak points, what similar content exists in the context, and what learnings in the context say. Do not rewrite it.',
  },
];

/** Idea Lab: AI transformations when a provider is configured; manual branching + learnings always. */
export function IdeaLab({ idea }: { idea: Idea }) {
  const s = useSession();
  const { search } = useApp();
  const [hasAI, setHasAI] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ k: string; label: string; text: string; removed: number } | null>(
    null,
  );
  const learnings = useLive(
    (ss) =>
      ss.db.learnings
        .where('status')
        .equals('active')
        .toArray()
        .then((ls) => ls.filter((l) => !l.deletedAt).slice(0, 4)),
    [],
    [],
  );
  useEffect(() => {
    void providerConfig(s).then((c) => setHasAI(!!c));
  }, [s]);

  const run = async (g: (typeof GENERATORS)[number]) => {
    setBusy(g.k);
    setResult(null);
    try {
      const pack = await resolveContext(s, 'creative', g.q, { entity: 'idea', id: idea.id }, search);
      const ans = await ask(s, pack, g.q);
      setResult({ k: g.k, label: g.label, text: ans.text, removed: ans.removed.length });
    } catch (e) {
      toast((e as Error).message, { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const copyPrompt = async () => {
    const pack = await resolveContext(
      s,
      'creative',
      'Generate variations',
      { entity: 'idea', id: idea.id },
      search,
    );
    await navigator.clipboard?.writeText(
      buildManualPrompt(
        pack,
        'Suggest 5 variations of [I1] (different hook, tone or format) and 5 alternative hooks.',
      ),
    );
    toast('Prompt with idea context copied — paste it into ChatGPT or Claude');
  };

  return (
    <div className="box">
      <div className="hstack">
        <FlaskConical size={16} aria-hidden />
        <h4 style={{ flex: 1 }}>Idea Lab</h4>
      </div>
      {hasAI ? (
        <div className="chips">
          {GENERATORS.map((g) => (
            <Chip key={g.k} disabled={!!busy} onClick={() => void run(g)}>
              {busy === g.k ? <Spinner label="Working" /> : null}
              {g.label}
            </Chip>
          ))}
        </div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          <p className="meta">
            Branch manually with “New variant”. With an AI key (Settings › AI) the Lab can generate hooks and
            versions. Without one, copy a ready prompt:
          </p>
          <div className="hstack">
            <Button size="sm" onClick={() => void copyPrompt()}>
              <Copy size={14} /> Copy prompt
            </Button>
            <a className="btn ghost sm" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">
              ChatGPT <ExternalLink size={12} />
            </a>
            <a
              className="btn ghost sm"
              href="https://claude.ai/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              Claude <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}
      {result && (
        <div className="ai-box">
          <div className="ai-label">✧ AI suggestion · {result.label} · not saved</div>
          <div className="answer">{result.text}</div>
          {result.removed > 0 && (
            <div className="meta">
              {result.removed} statement(s) removed: they referenced data not in your workspace.
            </div>
          )}
          <div className="hstack">
            {result.k !== 'challenge' && (
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  await createVariant(s, idea, result.label, {
                    raw: result.text,
                    origin: { source: 'ai', confirmedAt: new Date().toISOString() },
                  });
                  toast('Kept as a new variant — the original is unchanged');
                  setResult(null);
                }}
              >
                Keep as variant
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
      {learnings.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="lbl">Learnings to keep in mind</div>
          {learnings.map((l) => (
            <div key={l.id} className="meta">
              <span className="tag">{l.kind}</span> {l.statement}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
