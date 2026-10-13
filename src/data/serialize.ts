import type { WorkspaceDB } from './db';
import { type EntityTable, SYNC_TABLES, type Tombstone } from './schema';

/**
 * The single serializer for anything that leaves the live database (recovery points, backups,
 * exports, Drive snapshots). It reads ONLY the allowlisted syncable tables — local-only tables
 * (secrets, crypto keys, history, Secretary sessions, media blobs, meta) are structurally excluded.
 */
export interface WorkspaceData {
  tables: Partial<Record<EntityTable, Record<string, unknown>[]>>;
  tombstones: Tombstone[];
}

export async function serializeWorkspace(db: WorkspaceDB): Promise<WorkspaceData> {
  const tables: WorkspaceData['tables'] = {};
  await db.transaction('r', [...SYNC_TABLES, 'tombstones'], async () => {
    for (const t of SYNC_TABLES) {
      tables[t] = (await db.table(t).toArray()) as Record<string, unknown>[];
    }
  });
  const tombstones = await db.tombstones.toArray();
  return { tables, tombstones };
}

export function countData(d: WorkspaceData): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(d.tables)) counts[k] = v?.length ?? 0;
  counts.tombstones = d.tombstones.length;
  return counts;
}

/** Replace all syncable data atomically (used by restore and recovery). */
export async function replaceWorkspaceData(db: WorkspaceDB, data: WorkspaceData): Promise<void> {
  await db.transaction('rw', [...SYNC_TABLES, 'tombstones'], async () => {
    for (const t of SYNC_TABLES) {
      await db.table(t).clear();
      const rows = data.tables[t] ?? [];
      if (rows.length) await db.table(t).bulkPut(rows);
    }
    await db.tombstones.clear();
    if (data.tombstones.length) await db.tombstones.bulkPut(data.tombstones);
  });
}
