import type { Session } from '../app/session';
import { ulid } from '../core/ulid';
import { nowIso } from '../core/util';
import { getMeta, setMeta } from '../data/db';
import type { SearchClient } from '../search/client';
import { parseActions, type ResolvedAction } from './actions';
import { type ContextPack, type Focus, type Intent, resolveContext, summarizePack } from './context';
import { buildPrompt } from './prompts';
import { complete, PROVIDER_INFO, type ProviderConfig } from './providers';
import { getSecret, type ProviderId } from './secrets';
import { splitActions, validateAnswer } from './validate';

export interface AISettings {
  provider: ProviderId | null;
  models: Partial<Record<ProviderId, string>>;
}

export async function getAISettings(s: Session): Promise<AISettings> {
  return (await getMeta<AISettings>(s.db, 'ai')) ?? { provider: null, models: {} };
}
export async function setAISettings(s: Session, v: AISettings): Promise<void> {
  await setMeta(s.db, 'ai', v);
}

export async function providerConfig(s: Session): Promise<ProviderConfig | null> {
  const st = await getAISettings(s);
  if (!st.provider) return null;
  const key = await getSecret(s, st.provider);
  if (!key) return null;
  return {
    provider: st.provider,
    apiKey: key,
    model: st.models[st.provider] || PROVIDER_INFO[st.provider].defaultModel,
  };
}

export interface SecretaryAnswer {
  pack: ContextPack;
  text: string;
  removed: string[];
  actions: ResolvedAction[];
  model: string;
}

export async function prepare(
  s: Session,
  intent: Intent,
  question: string,
  focus: Focus,
  search?: SearchClient,
): Promise<ContextPack> {
  return resolveContext(s, intent, question, focus, search);
}

export async function ask(
  s: Session,
  pack: ContextPack,
  question: string,
  signal?: AbortSignal,
): Promise<SecretaryAnswer> {
  const cfg = await providerConfig(s);
  if (!cfg) throw new Error('No AI provider configured.');
  s.assertLive();
  const prompt = buildPrompt(pack, question);
  const res = await complete(cfg, { ...prompt, maxTokens: 4000, ...(signal ? { signal } : {}) });
  s.assertLive(); // never write a late answer into another account's workspace
  const { body, actionsJson } = splitActions(res.text);
  const v = validateAnswer(body, pack);
  const actions = parseActions(actionsJson, pack);
  await s.db.secretary.put({
    id: ulid(),
    at: nowIso(),
    intent: pack.intent,
    question,
    contextSummary: summarizePack(pack),
    answer: v.text,
    provider: cfg.provider,
  });
  const all = await s.db.secretary.orderBy('at').primaryKeys();
  if (all.length > 50) await s.db.secretary.bulkDelete(all.slice(0, all.length - 50));
  return { pack, text: v.text, removed: v.removed, actions, model: res.model };
}
