import { registerSensitive } from '../diagnostics/logger';
import type { ProviderId } from './secrets';

/**
 * Small provider abstraction (ADR-07). BYOK only — no Saga-owned key, no proxy.
 * Anthropic uses the official SDK (loaded lazily); OpenAI uses its public REST API via fetch.
 */
export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
}
export interface CompletionResult {
  text: string;
  model: string;
}
export class ProviderError extends Error {
  constructor(
    readonly kind: 'auth' | 'rate' | 'refusal' | 'network' | 'config' | 'other',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
}

export const PROVIDER_INFO: Record<
  ProviderId,
  { label: string; defaultModel: string; keyHelp: string; consoleUrl: string }
> = {
  anthropic: {
    label: 'Anthropic (Claude API)',
    defaultModel: 'claude-opus-5-5',
    keyHelp: 'An Anthropic API key (sk-ant-…). A Claude.ai subscription does not include API credits.',
    consoleUrl: 'https://console.anthropic.com/',
  },
  openai: {
    label: 'OpenAI API',
    defaultModel: '',
    keyHelp:
      'An OpenAI API key (sk-…). A ChatGPT subscription does not include API billing. Enter a current chat model id from your OpenAI dashboard.',
    consoleUrl: 'https://platform.openai.com/',
  },
};

async function anthropicComplete(cfg: ProviderConfig, req: CompletionRequest): Promise<CompletionResult> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  registerSensitive(cfg.apiKey);
  // The user's own key is used directly from their browser (BYOK); see Settings › AI for the trade-off.
  const client = new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  try {
    const response = await client.beta.messages.create(
      {
        model: cfg.model || PROVIDER_INFO.anthropic.defaultModel,
        max_tokens: req.maxTokens ?? 4000,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      req.signal ? { signal: req.signal } : undefined,
    );
    if (response.stop_reason === 'refusal') {
      throw new ProviderError('refusal', 'The provider declined this request.');
    }
    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    return { text, model: response.model };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      throw new ProviderError('auth', 'The API key was rejected. Check it in Settings › AI.');
    if (e instanceof Anthropic.RateLimitError)
      throw new ProviderError('rate', 'Rate limit or credit limit reached at the provider.');
    if (e instanceof Anthropic.APIConnectionError)
      throw new ProviderError('network', 'Could not reach the provider (offline?).');
    if (e instanceof Anthropic.APIError)
      throw new ProviderError('other', `Provider error (${e.status ?? '?'}).`);
    throw e;
  }
}

async function openaiComplete(cfg: ProviderConfig, req: CompletionRequest): Promise<CompletionResult> {
  if (!cfg.model) throw new ProviderError('config', 'Choose an OpenAI model id in Settings › AI.');
  registerSensitive(cfg.apiKey);
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ProviderError('network', 'Could not reach the provider (offline?).');
  }
  if (res.status === 401 || res.status === 403)
    throw new ProviderError('auth', 'The API key was rejected. Check it in Settings › AI.');
  if (res.status === 429) throw new ProviderError('rate', 'Rate limit or quota reached at the provider.');
  if (!res.ok) throw new ProviderError('other', `Provider error (${res.status}).`);
  const j = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string; refusal?: string | null } }[];
  };
  const msg = j.choices?.[0]?.message;
  if (msg?.refusal) throw new ProviderError('refusal', 'The provider declined this request.');
  return { text: (msg?.content ?? '').trim(), model: j.model ?? cfg.model };
}

export function complete(cfg: ProviderConfig, req: CompletionRequest): Promise<CompletionResult> {
  return cfg.provider === 'anthropic' ? anthropicComplete(cfg, req) : openaiComplete(cfg, req);
}

export async function testProvider(cfg: ProviderConfig): Promise<string> {
  const r = await complete(cfg, {
    system: 'Reply with the single word OK.',
    user: 'Connection test',
    maxTokens: 300,
  });
  return r.model;
}
