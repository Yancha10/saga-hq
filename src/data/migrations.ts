import type { Session } from '../app/session';
import { setMeta } from './db';
import { createRecoveryPoint } from './recovery';
import { SCHEMA_VERSION } from './schema';

/**
 * Additive, forward-only, deterministic migrations. Each entry upgrades data from version n-1 to n.
 * A recovery point is taken before any migration runs. Unknown future versions never reach here
 * (Session.open refuses them), so an old client can never overwrite newer data.
 */
export const MIGRATIONS: Record<number, (s: Session) => Promise<void>> = {
  // 2: async (s) => { ... }  // example: backfill a new optional field with a default
};

export async function runMigrations(s: Session, from: number): Promise<number> {
  if (from >= SCHEMA_VERSION) return from;
  await createRecoveryPoint(s, 'upgrade', { from, to: SCHEMA_VERSION });
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (m) await m(s);
    await setMeta(s.db, 'schemaVersion', v);
  }
  return SCHEMA_VERSION;
}
