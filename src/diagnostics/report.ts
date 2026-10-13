import type { Session } from '../app/session';
import { env } from '../config/env';
import { SCHEMA_VERSION, SYNC_TABLES } from '../data/schema';
import { getLogs } from './logger';

/**
 * Technical-only diagnostic report for "Copy diagnostic report". No content, prompts, emails,
 * account identifiers, tokens or keys — only counts, versions, states and redacted log lines.
 */
export async function buildDiagnostics(
  s: Session | null,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const counts: Record<string, number> = {};
  if (s) for (const t of SYNC_TABLES) counts[t] = await s.db.table(t).count();
  let storage: unknown = null;
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    storage = { usage: est?.usage, quota: est?.quota, persisted };
  } catch {
    storage = 'unavailable';
  }
  return {
    app: 'saga-hq',
    version: env.version,
    env: env.name,
    schemaVersion: SCHEMA_VERSION,
    workspaceKind: s?.ref.kind ?? 'none',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    standalone:
      typeof window !== 'undefined' ? window.matchMedia?.('(display-mode: standalone)').matches : null,
    storage,
    counts,
    ...extra,
    logs: getLogs()
      .filter((l) => l.level !== 'debug')
      .slice(-80)
      .map((l) => `${l.at} ${l.level} [${l.area}] ${l.message.slice(0, 300)}`),
  };
}
