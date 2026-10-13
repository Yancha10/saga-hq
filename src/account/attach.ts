import Dexie from 'dexie';
import { Session } from '../app/session';
import { createRecoveryPoint } from '../data/recovery';
import { SYNC_TABLES } from '../data/schema';
import { serializeWorkspace } from '../data/serialize';
import { recomputeDerived } from '../data/store';
import { stripDerived } from '../sync/merge';
import { removeAccountEntry, removeLocalEntry, updateLocal } from './registry';
import type { WorkspaceRef } from './workspaceRef';

/**
 * Explicit, user-confirmed copy of a local workspace into an account workspace. The local copy is
 * kept (marked attached) until the user removes it, so nothing is moved silently or lost.
 */
export async function copyWorkspaceInto(
  source: Session,
  target: WorkspaceRef,
): Promise<Record<string, number>> {
  const data = await serializeWorkspace(source.db);
  const dest = await Session.open(target);
  try {
    await createRecoveryPoint(dest, 'Before importing a local workspace');
    const rev = dest.hlc.now();
    const counts: Record<string, number> = {};
    const destWs = await dest.db.workspace.get('workspace');
    await dest.db.transaction('rw', [...SYNC_TABLES], async () => {
      for (const t of SYNC_TABLES) {
        let n = 0;
        for (const r of data.tables[t] ?? []) {
          if (t === 'workspace' && destWs?.onboardedAt) continue; // keep the account's own settings
          const fr = Object.fromEntries(
            Object.keys((r.fieldRevs as Record<string, string>) ?? {}).map((k) => [k, rev]),
          );
          await dest.db.table(t).put({
            ...stripDerived(r),
            workspaceId: dest.workspaceId,
            fieldRevs: fr,
            fieldPrev: {},
            rev,
            updatedByDevice: dest.deviceId,
          });
          n++;
        }
        counts[t] = n;
      }
    });
    await recomputeDerived(dest, await dest.db.content.toCollection().primaryKeys());
    await dest.persistClock();
    if (source.ref.kind === 'local' && target.kind === 'account')
      await updateLocal(source.ref.localId, { attachedTo: target.accountId });
    return counts;
  } finally {
    dest.close();
  }
}

/** Permanently remove a workspace's local data from this device (database incl. secrets). */
export async function removeLocalData(ref: WorkspaceRef): Promise<void> {
  await Dexie.delete(ref.dbName);
  if (ref.kind === 'account') await removeAccountEntry(ref.accountId);
  else await removeLocalEntry(ref.localId);
}
