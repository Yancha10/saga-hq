import { Copy, ExternalLink, FlaskConical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { resolveContext } from '../../ai/context';
import { buildManualPrompt } from '../../ai/prompts';
import { ask, providerConfig } from '../../ai/secretary';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { createVariant } from '../../data/domain';
import type { Idea } from '../../data/schema';
import { t, useT } from '../../i18n';
import { errorText } from '../../i18n/render';
import { Button, Chip, Spinner } from '../../ui/kit';

const GENERATORS = [
  'hooks',
  'expand',
  'darker',
  'funnier',
  'emotional',
  'simpler',
  'visual',
  's15',
  's30',
  'ending',
  'series',
  'challenge',
] as const;
type Gen = (typeof GENERATORS)[number];

/** Idea Lab: AI transformations when a provider is configured; manual branching + learnings always. */
export function IdeaLab({ idea }: { idea: Idea }) {
  useT();
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

  const run = async (g: Gen) => {
    const q = t(`lab.${g}.q`);
    const label = t(`lab.${g}`);
    setBusy(g);
    setResult(null);
    try {
      const pack = await resolveContext(s, 'creative', q, { entity: 'idea', id: idea.id }, search);
      const ans = await ask(s, pack, q);
      setResult({ k: g, label, text: ans.text, removed: ans.removed.length });
    } catch (e) {
      toast(errorText(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const copyPrompt = async () => {
    const pack = await resolveContext(
      s,
      'creative',
      t('lab.manual_query'),
      { entity: 'idea', id: idea.id },
      search,
    );
    await navigator.clipboard?.writeText(buildManualPrompt(pack, t('lab.manual_prompt')));
    toast(t('lab.prompt_copied'));
  };

  return (
    <div className="box">
      <div className="hstack">
        <FlaskConical size={16} aria-hidden />
        <h4 style={{ flex: 1 }}>{t('lab.title')}</h4>
      </div>
      {hasAI ? (
        <div className="chips">
          {GENERATORS.map((g) => (
            <Chip key={g} disabled={!!busy} onClick={() => void run(g)}>
              {busy === g ? <Spinner label={t('common.working')} /> : null}
              {t(`lab.${g}`)}
            </Chip>
          ))}
        </div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          <p className="meta">{t('lab.no_ai')}</p>
          <div className="hstack">
            <Button size="sm" onClick={() => void copyPrompt()}>
              <Copy size={14} /> {t('common.copy_prompt')}
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
          <div className="ai-label">✧ {t('lab.ai_suggestion', { label: result.label })}</div>
          <div className="answer">{result.text}</div>
          {result.removed > 0 && (
            <div className="meta">{t('secretary.removed', { count: result.removed })}</div>
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
                  toast(t('lab.kept'));
                  setResult(null);
                }}
              >
                {t('lab.keep')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
              {t('inbox.discard')}
            </Button>
          </div>
        </div>
      )}
      {learnings.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="lbl">{t('lab.learnings')}</div>
          {learnings.map((l) => (
            <div key={l.id} className="meta">
              <span className="tag">{t(`learning.kind.${l.kind}`)}</span> {l.statement}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
