import { base32Lower } from './base32';
import { sha256, utf8 } from './crypto';

/**
 * PERMANENT INVARIANT (architecture revision 3, ADR-04).
 * Changing this namespace orphans every user's local databases and Drive manifests.
 * A fixed-vector test (tests/unit/accountId.test.ts) fails if it changes.
 */
export const ACCOUNT_NAMESPACE = 'saga-hq:' as const;
/** Separate namespace so Studio and HQ can compare accounts without exposing `sub`. */
export const HANDOFF_NAMESPACE = 'saga-handoff:' as const;

async function opaque(namespace: string, sub: string): Promise<string> {
  if (!sub) throw new Error('Empty subject');
  const digest = await sha256(utf8(namespace + sub));
  return base32Lower(digest.slice(0, 20)); // 160 bits → 32 chars
}

/** Google OIDC `sub` → opaque 32-char accountId. The raw `sub` must be discarded by the caller. */
export function deriveAccountId(sub: string): Promise<string> {
  return opaque(ACCOUNT_NAMESPACE, sub);
}

export function deriveAccountHint(sub: string): Promise<string> {
  return opaque(HANDOFF_NAMESPACE, sub);
}

export function isAccountId(v: string): boolean {
  return /^[a-z2-7]{32}$/.test(v);
}
