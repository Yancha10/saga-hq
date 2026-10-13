import { z } from 'zod';
import type { Session } from '../app/session';
import { sha256Hex } from '../core/crypto';
import { nowIso } from '../core/util';
import { stripDerived } from '../sync/merge';
import { createRecoveryPoint } from './recovery';
import { ENTITY_SCHEMAS, type EntityTable, SCHEMA_VERSION, SYNC_TABLES, tombstoneSchema } from './schema';
import { countData, replaceWorkspaceData, serializeWorkspace, type WorkspaceData } from './serialize';
import { recomputeDerived } from './store';

/**
 * Manual backup format. Contains ONLY syncable workspace data (+ optional media blobs). Never:
 * Google tokens, raw Google subject, AI keys, decrypted secrets, local diagnostics, history.
 */
export interface BackupFile {
  format: 'saga-hq-backup';
  version: 1;
  schemaVersion: number;
  createdAt: string;
  workspaceName: string;
  counts: Record<string, number>;
  checksum: string; // sha256 of JSON.stringify(data)
  data: WorkspaceData;
  media?: { id: string; mime: string; base64: string }[];
}

const backupShape = z.object({
  format: z.literal('saga-hq-backup'),
  version: z.literal(1),
  schemaVersion: z.number().int().min(1),
  createdAt: z.string(),
  workspaceName: z.string(),
  counts: z.record(z.string(), z.number()),
  checksum: z.string(),
  data: z.object({
    tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
    tombstones: z.array(z.unknown()),
  }),
  media: z.array(z.object({ id: z.string(), mime: z.string(), base64: z.string() })).optional(),
});

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function buildBackup(s: Session, opts: { includeMedia?: boolean } = {}): Promise<BackupFile> {
  const raw = await serializeWorkspace(s.db);
  const data: WorkspaceData = { tables: {}, tombstones: raw.tombstones };
  for (const [t, rows] of Object.entries(raw.tables))
    data.tables[t as EntityTable] = (rows ?? []).map((r) => stripDerived(r));
  const ws = await s.db.workspace.get('workspace');
  const file: BackupFile = {
    format: 'saga-hq-backup',
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    createdAt: nowIso(),
    workspaceName: ws?.name ?? 'Saga HQ',
    counts: countData(data),
    checksum: await sha256Hex(JSON.stringify(data)),
    data,
  };
  if (opts.includeMedia) {
    const blobs = await s.db.mediaBlobs.where('[id+kind]').between(['', 'full'], ['￿', 'full']).toArray();
    file.media = [];
    for (const b of blobs)
      if (b.kind === 'full')
        file.media.push({ id: b.id, mime: b.blob.type, base64: await blobToBase64(b.blob) });
  }
  return file;
}

export interface RestorePreview {
  ok: boolean;
  error?: string;
  file?: BackupFile;
  counts: Record<string, number>;
  invalid: number;
  createdAt?: string;
  workspaceName?: string;
}

/** Parse + validate without touching the database. Malformed input never reaches restore. */
export async function previewBackup(text: string): Promise<RestorePreview> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'BACKUP_NOT_JSON', counts: {}, invalid: 0 };
  }
  const shape = backupShape.safeParse(json);
  if (!shape.success) return { ok: false, error: 'BACKUP_NOT_SAGA', counts: {}, invalid: 0 };
  const file = shape.data as unknown as BackupFile;
  if (file.schemaVersion > SCHEMA_VERSION)
    return {
      ok: false,
      error: 'BACKUP_NEWER',
      counts: {},
      invalid: 0,
    };
  if ((await sha256Hex(JSON.stringify(file.data))) !== file.checksum)
    return {
      ok: false,
      error: 'BACKUP_CHECKSUM',
      counts: {},
      invalid: 0,
    };
  let invalid = 0;
  const counts: Record<string, number> = {};
  for (const t of Object.keys(file.data.tables)) {
    if (!(SYNC_TABLES as string[]).includes(t)) {
      invalid += file.data.tables[t as EntityTable]?.length ?? 0;
      continue;
    }
    const rows = file.data.tables[t as EntityTable] ?? [];
    const good = rows.filter((r) => ENTITY_SCHEMAS[t as EntityTable].safeParse(r).success);
    invalid += rows.length - good.length;
    counts[t] = good.length;
  }
  return { ok: true, file, counts, invalid, createdAt: file.createdAt, workspaceName: file.workspaceName };
}

export async function restoreBackup(
  s: Session,
  file: BackupFile,
  mode: 'replace' | 'merge',
): Promise<Record<string, number>> {
  s.assertLive();
  await createRecoveryPoint(s, mode === 'replace' ? 'restore_backup' : 'merge_backup', {
    date: file.createdAt.slice(0, 10),
  });
  s.assertLive();
  const rev = s.hlc.now();
  const clean: WorkspaceData = { tables: {}, tombstones: [] };
  for (const t of SYNC_TABLES) {
    const rows = (file.data.tables[t] ?? []).filter((r) => ENTITY_SCHEMAS[t].safeParse(r).success);
    clean.tables[t] = rows.map((r) => {
      const fr = { ...(r.fieldRevs as Record<string, string>) };
      for (const k of Object.keys(fr)) fr[k] = rev; // restored data propagates through sync as a fresh edit
      return { ...stripDerived(r), workspaceId: s.workspaceId, fieldRevs: fr, fieldPrev: {}, rev };
    });
  }
  clean.tombstones = (file.data.tombstones ?? []).filter(
    (x) => tombstoneSchema.safeParse(x).success,
  ) as WorkspaceData['tombstones'];
  if (mode === 'replace') {
    const keep = new Set<string>();
    for (const rows of Object.values(clean.tables)) for (const r of rows ?? []) keep.add(String(r.id));
    const current = await serializeWorkspace(s.db);
    const now = nowIso();
    for (const [table, rows] of Object.entries(current.tables))
      for (const r of rows ?? [])
        if (!keep.has(String(r.id)) && r.id !== 'workspace')
          clean.tombstones.push({ id: String(r.id), entity: table, deletedAt: now, rev });
    await replaceWorkspaceData(s.db, clean);
  } else {
    await s.db.transaction('rw', [...SYNC_TABLES], async () => {
      for (const t of SYNC_TABLES) {
        for (const r of clean.tables[t] ?? []) {
          // Merge mode adds records that are missing here; existing local records are kept as-is.
          const local = await s.db.table(t).get(r.id as string);
          if (!local) await s.db.table(t).put(r);
        }
      }
    });
  }
  if (file.media) {
    for (const m of file.media) {
      const blob = base64ToBlob(m.base64, m.mime);
      await s.db.mediaBlobs.put({
        id: m.id,
        kind: 'full',
        blob,
        bytes: blob.size,
        lastUsedAt: Date.now(),
        pinned: 1,
      });
    }
  }
  const allContent = await s.db.content.toCollection().primaryKeys();
  await recomputeDerived(s, allContent);
  await s.persistClock();
  // Verify
  const after = countData(await serializeWorkspace(s.db));
  s.emit(SYNC_TABLES.map((t) => ({ table: t, ids: [], source: 'import' as const })));
  return after;
}

// ---------- CSV export (portability) ----------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Neutralize spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n');
}

export async function exportCsv(s: Session, kind: 'content' | 'tasks' | 'analytics'): Promise<string> {
  if (kind === 'content') {
    const rows = (await s.db.content.toArray()).filter((r) => !r.deletedAt);
    return toCsv(rows as never, [
      'id',
      'title',
      'status',
      'formatTemplateId',
      'platforms',
      'projectId',
      'hook',
      'caption',
      '_nextPublishAt',
      'createdAt',
      'updatedAt',
    ]);
  }
  if (kind === 'tasks') {
    const rows = (await s.db.tasks.toArray()).filter((r) => !r.deletedAt);
    return toCsv(rows as never, [
      'id',
      'title',
      'status',
      'kind',
      'isBlocker',
      'priority',
      'dueAt',
      'projectId',
      'contentId',
      'createdAt',
    ]);
  }
  const snaps = (await s.db.snapshots.toArray()).filter((r) => !r.deletedAt);
  const keys = [...new Set(snaps.flatMap((x) => Object.keys(x.metrics)))].sort();
  const flat = snaps.map((x) => ({ ...x, ...Object.fromEntries(keys.map((k) => [`m:${k}`, x.metrics[k]])) }));
  return toCsv(flat as never, [
    'id',
    'publicationId',
    'contentId',
    'platform',
    'observedAt',
    'checkpoint',
    'source',
    ...keys.map((k) => `m:${k}`),
  ]);
}
