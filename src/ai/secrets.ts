import { secretScope } from '../account/workspaceRef';
import type { Session } from '../app/session';
import { nowIso } from '../core/util';
import { registerSensitive } from '../diagnostics/logger';

/**
 * BYOK secret store (ADR-07). Local only, per account/workspace scope, AES-GCM encrypted with a
 * NON-EXTRACTABLE WebCrypto key kept in this workspace's IndexedDB.
 *
 * Honest limit: this protects against copying raw database files and casual inspection. It is NOT
 * server-grade secret storage — any script running on this origin could ask the browser to decrypt.
 * Secrets never enter sync, Drive, backups, exports, recovery points, logs or diagnostics.
 */
export type ProviderId = 'openai' | 'anthropic';

async function wrappingKey(s: Session): Promise<CryptoKey> {
  const id = `wrap:${secretScope(s.ref)}`;
  const row = await s.db.cryptoKeys.get(id);
  if (row) return row.cryptoKey;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await s.db.cryptoKeys.put({ key: id, cryptoKey: key });
  return key;
}

export function maskSecret(v: string): string {
  const t = v.trim();
  if (t.length <= 8) return '••••';
  return `${t.slice(0, 3)}…${t.slice(-4)}`;
}

const rowKey = (s: Session, p: ProviderId) => `${secretScope(s.ref)}:${p}`;

export async function saveSecret(s: Session, provider: ProviderId, value: string): Promise<void> {
  s.assertLive();
  const v = value.trim();
  if (!v) throw new Error('Empty key');
  const key = await wrappingKey(s);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(v));
  await s.db.secrets.put({
    key: rowKey(s, provider),
    iv,
    ciphertext,
    hint: maskSecret(v),
    updatedAt: nowIso(),
  });
}

export async function getSecret(s: Session, provider: ProviderId): Promise<string | null> {
  s.assertLive();
  const row = await s.db.secrets.get(rowKey(s, provider));
  if (!row) return null;
  const key = await wrappingKey(s);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: row.iv as BufferSource },
    key,
    row.ciphertext,
  );
  const v = new TextDecoder().decode(plain);
  registerSensitive(v);
  return v;
}

export async function secretHints(
  s: Session,
): Promise<Partial<Record<ProviderId, { hint: string; updatedAt: string }>>> {
  const out: Partial<Record<ProviderId, { hint: string; updatedAt: string }>> = {};
  for (const p of ['openai', 'anthropic'] as ProviderId[]) {
    const r = await s.db.secrets.get(rowKey(s, p));
    if (r) out[p] = { hint: r.hint, updatedAt: r.updatedAt };
  }
  return out;
}

export async function removeSecret(s: Session, provider: ProviderId): Promise<void> {
  await s.db.secrets.delete(rowKey(s, provider));
}

export async function removeAllSecrets(s: Session): Promise<void> {
  await s.db.secrets.clear();
  await s.db.cryptoKeys.clear();
}
