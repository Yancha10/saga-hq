import type { Session } from '../app/session';
import { ulid } from '../core/ulid';
import { nowIso } from '../core/util';
import { logger } from '../diagnostics/logger';
import type { RecoveryPoint } from './db';
import { SCHEMA_VERSION } from './schema';
import { countData, replaceWorkspaceData, serializeWorkspace, type WorkspaceData } from './serialize';

const KEEP = 7;

export async function createRecoveryPoint(
  s: Session,
  reason:
    | 'import_local'
    | 'import_package'
    | 'upgrade'
    | 'restore_point'
    | 'restore_backup'
    | 'merge_backup'
    | 'sync_merge',
  reasonParams?: Record<string, string | number>,
): Promise<RecoveryPoint> {
  const data = await serializeWorkspace(s.db);
  const point: RecoveryPoint = {
    id: ulid(),
    at: nowIso(),
    reason,
    ...(reasonParams ? { reasonParams } : {}),
    schemaVersion: SCHEMA_VERSION,
    counts: countData(data),
    data: JSON.stringify(data),
  };
  await s.db.recovery.put(point);
  const all = await s.db.recovery.orderBy('at').toArray();
  if (all.length > KEEP) await s.db.recovery.bulkDelete(all.slice(0, all.length - KEEP).map((p) => p.id));
  logger.info('recovery', `recovery point: ${reason}`);
  return point;
}

export async function listRecoveryPoints(s: Session): Promise<Omit<RecoveryPoint, 'data'>[]> {
  const all = await s.db.recovery.orderBy('at').reverse().toArray();
  return all.map(({ data: _d, ...rest }) => rest);
}

export async function restoreRecoveryPoint(s: Session, id: string): Promise<void> {
  s.assertLive();
  const point = await s.db.recovery.get(id);
  if (!point) throw new Error('RECOVERY_NOT_FOUND');
  if (point.schemaVersion > SCHEMA_VERSION) throw new Error('RECOVERY_NEWER');
  const data = JSON.parse(point.data) as WorkspaceData;
  await createRecoveryPoint(s, 'restore_point');
  s.assertLive();
  // Restored records get fresh revisions so the restore propagates through sync as a new edit.
  const rev = s.hlc.now();
  for (const rows of Object.values(data.tables)) {
    for (const r of rows ?? []) {
      const fr = (r.fieldRevs ?? {}) as Record<string, string>;
      for (const k of Object.keys(fr)) fr[k] = rev;
      r.rev = rev;
    }
  }
  // Records that exist now but not in the point become tombstones, so other devices drop them too.
  const now = nowIso();
  const keep = new Set<string>();
  for (const rows of Object.values(data.tables)) for (const r of rows ?? []) keep.add(String(r.id));
  const current = await serializeWorkspace(s.db);
  for (const [table, rows] of Object.entries(current.tables)) {
    for (const r of rows ?? []) {
      const rid = String(r.id);
      if (!keep.has(rid) && rid !== 'workspace')
        data.tombstones.push({ id: rid, entity: table, deletedAt: now, rev });
    }
  }
  await replaceWorkspaceData(s.db, data);
  await s.persistClock();
}
