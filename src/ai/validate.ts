import type { ContextPack } from './context';

/**
 * Grounding validator. Removes sentences that cite unknown handles or numbers/dates/times that do
 * not appear in the context pack. Keeps the model from presenting invented facts as workspace facts.
 */
export interface Validated {
  text: string;
  removed: string[];
}

const NUMBERISH =
  /(\d{4}-\d{2}-\d{2}|\b\d{1,2}:\d{2}\b|\b\d+(?:[.,]\d+)?\s?(?:%|×|x\b|k\b|m\b)|\b\d{2,}(?:[.,]\d+)?\b)/gi;

export function validateAnswer(text: string, pack: ContextPack): Validated {
  const handles = new Set(pack.entities.map((e) => e.handle));
  const corpus = JSON.stringify(pack).toLowerCase();
  const removed: string[] = [];
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept: string[] = [];
    for (const sent of sentences) {
      const refs = [...sent.matchAll(/\[([A-Z]\d{1,3})\]/g)].map((m) => m[1]!);
      const badRef = refs.find((r) => !handles.has(r));
      const isRecommendation =
        /recommend|suggest|could|consider|might|try|propose|recomiend|suger|podr[ií]a|considera|prueba|propon|quiz[aá]s/i.test(
          sent,
        );
      let badNum: string | undefined;
      for (const m of sent.matchAll(NUMBERISH)) {
        const tok = m[0].toLowerCase().replace(/\s/g, '');
        const bare = tok.replace(/[%×xkm]$/, '');
        if (/^(15|30|60|7|24|48|72)$/.test(bare) && isRecommendation) continue; // generic durations in advice
        if (!corpus.includes(bare)) {
          badNum = m[0];
          break;
        }
      }
      if (badRef || (badNum && !isRecommendation)) removed.push(sent.trim());
      else kept.push(sent);
    }
    out.push(kept.join(' '));
  }
  return {
    text: out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    removed: removed.filter(Boolean),
  };
}

export function splitActions(text: string): { body: string; actionsJson: string | null } {
  const m = text.match(/```actions\s*([\s\S]*?)```/);
  if (!m) return { body: text, actionsJson: null };
  return { body: text.replace(m[0], '').trim(), actionsJson: m[1]!.trim() };
}
