import Dexie, { type DexieOptions, type Table } from 'dexie';
import type { EntityMap, EntityTable, Tombstone } from './schema';

export interface MetaRow {
  key: string;
  value: unknown;
}
export interface HistoryOp {
  table: EntityTable;
  id: string;
  before: Record<string, unknown> | null; // null = created by this op
  after: Record<string, unknown> | null; // null = removed by this op (purge)
}
export interface HistoryEntry {
  id: string;
  at: string;
  actor: 'user' | 'ai' | 'sync' | 'import';
  label: string; // i18n key (language-neutral)
  labelParams?: Record<string, string | number>;
  coalesceKey?: string;
  ops: HistoryOp[];
  undone?: boolean;
}
export interface ConflictCopy {
  id: string;
  table: EntityTable;
  recordId: string;
  field: string;
  value: unknown;
  rev: string;
  winnerRev: string;
  at: string;
  resolved?: boolean;
}
export interface RecoveryPoint {
  id: string;
  at: string;
  reason: string; // stable code, rendered by i18n (`recovery.reason.<code>`)
  reasonParams?: Record<string, string | number>;
  schemaVersion: number;
  counts: Record<string, number>;
  data: string; // JSON of syncable tables only (never secrets / local-only tables)
}
export interface MediaBlobRow {
  id: string; // media id
  kind: 'full' | 'thumb';
  blob: Blob;
  bytes: number;
  lastUsedAt: number;
  pinned: number; // 1 = only copy (not yet uploaded) → never evicted
}
export interface SecretRow {
  key: string; // `${scope}:${provider}` — scope is accountId or local workspace key, never raw sub
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  hint: string; // masked hint for UI, e.g. "sk-…4f2a"
  updatedAt: string;
}
export interface CryptoKeyRow {
  key: string;
  cryptoKey: CryptoKey;
}
export interface SecretarySession {
  id: string;
  at: string;
  intent: string;
  question: string;
  contextSummary: string;
  answer: string;
  provider?: string;
}
export interface UploadJob {
  id: string; // media id
  state: 'queued' | 'uploading' | 'failed';
  attempts: number;
  lastError?: string;
  createdAt: string;
}

/** Local-only tables. These MUST never be serialized into sync, backups or exports. */
export const LOCAL_ONLY_TABLES = [
  'meta',
  'history',
  'conflicts',
  'recovery',
  'mediaBlobs',
  'secrets',
  'cryptoKeys',
  'secretary',
  'uploads',
] as const;

export class WorkspaceDB extends Dexie {
  workspace!: Table<EntityMap['workspace'], string>;
  projects!: Table<EntityMap['projects'], string>;
  ideas!: Table<EntityMap['ideas'], string>;
  captures!: Table<EntityMap['captures'], string>;
  content!: Table<EntityMap['content'], string>;
  publications!: Table<EntityMap['publications'], string>;
  snapshots!: Table<EntityMap['snapshots'], string>;
  tasks!: Table<EntityMap['tasks'], string>;
  events!: Table<EntityMap['events'], string>;
  library!: Table<EntityMap['library'], string>;
  media!: Table<EntityMap['media'], string>;
  learnings!: Table<EntityMap['learnings'], string>;
  links!: Table<EntityMap['links'], string>;
  chapters!: Table<EntityMap['chapters'], string>;
  radar!: Table<EntityMap['radar'], string>;
  sessions!: Table<EntityMap['sessions'], string>;
  tombstones!: Table<Tombstone, string>;
  meta!: Table<MetaRow, string>;
  history!: Table<HistoryEntry, string>;
  conflicts!: Table<ConflictCopy, string>;
  recovery!: Table<RecoveryPoint, string>;
  mediaBlobs!: Table<MediaBlobRow, [string, string]>;
  secrets!: Table<SecretRow, string>;
  cryptoKeys!: Table<CryptoKeyRow, string>;
  secretary!: Table<SecretarySession, string>;
  uploads!: Table<UploadJob, string>;

  constructor(name: string, options?: DexieOptions) {
    super(name, options);
    // Dexie schema v1. Future versions add .version(n).stores(...).upgrade(...) — see migrations.ts.
    this.version(1).stores({
      workspace: 'id, rev',
      projects: 'id, rev, status, updatedAt',
      ideas: 'id, rev, status, projectId, parentIdeaId, updatedAt',
      captures: 'id, rev, status, createdAt',
      content: 'id, rev, status, projectId, ideaId, updatedAt, _nextPublishAt',
      publications: 'id, rev, contentId, status, scheduledAt, publishedAt, platform',
      snapshots: 'id, rev, publicationId, contentId, observedAt',
      tasks: 'id, rev, status, dueAt, projectId, contentId, ideaId',
      events: 'id, rev, startAt, projectId, contentId',
      library: 'id, rev, role, projectId, canonicalUrl, updatedAt',
      media: 'id, rev, sha256',
      learnings: 'id, rev, status, updatedAt',
      links: 'id, rev, fromId, toId',
      tombstones: 'id, rev, entity',
      meta: 'key',
      history: 'id, at',
      conflicts: 'id, recordId, resolved',
      recovery: 'id, at',
      mediaBlobs: '[id+kind], lastUsedAt, pinned',
      secrets: 'key',
      cryptoKeys: 'key',
      secretary: 'id, at',
      uploads: 'id, state',
    });
    // v2 (Saga Lai): Bible chapters, cultural radar, AI workshop sessions. Additive only.
    this.version(2).stores({
      content: 'id, rev, status, projectId, ideaId, updatedAt, _nextPublishAt, externalId',
      ideas: 'id, rev, status, projectId, parentIdeaId, updatedAt, externalId',
      tasks: 'id, rev, status, dueAt, projectId, contentId, ideaId, externalId',
      chapters: 'id, rev, order, status, externalId',
      radar: 'id, rev, startDate, verification, projectId, externalId',
      sessions: 'id, rev, at, contentId',
    });
  }

  entity<T extends EntityTable>(t: T): Table<EntityMap[T], string> {
    return this.table(t) as Table<EntityMap[T], string>;
  }
}

export async function getMeta<T>(db: WorkspaceDB, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export async function setMeta(db: WorkspaceDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
