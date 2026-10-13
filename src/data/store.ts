import type { Session } from '../app/session';
import { clearBanner, saveStatus, setBanner } from '../app/status';
import { ulid } from '../core/ulid';
import { deepEqual, nowIso } from '../core/util';
import { logger } from '../diagnostics/logger';
import type { HistoryEntry, HistoryOp } from './db';
import { deriveContent } from './derive';

import {
  type Content,
  ENTITY_SCHEMAS,
  type EntityMap,
  type EntityTable,
  isDerivedField,
  type Link,
  META_FIELDS,
  type Provenance,
  type Publication,
  SCHEMA_VERSION,
  SYNC_TABLES,
  type Task,
} from './schema';

type MetaKey =
  | 'id'
  | 'workspaceId'
  | 'schemaVersion'
  | 'createdAt'
  | 'updatedAt'
  | 'updatedByDevice'
  | 'rev'
  | 'fieldRevs'
  | 'fieldPrev';
export type NewRecord<T extends EntityTable> = Omit<EntityMap[T], MetaKey> & { id?: string };
export type Patch<T extends EntityTable> = Partial<Omit<EntityMap[T], MetaKey>>;

export interface MutateOpts {
  label: string; // i18n key, e.g. 'h.edit'
  labelParams?: Record<string, string | number>;
  actor?: HistoryEntry['actor'];
  coalesceKey?: string;
  history?: boolean;
}

export class ValidationError extends Error {
  constructor(
    readonly table: string,
    readonly issues: string,
  ) {
    super(`Invalid ${table}: ${issues}`);
    this.name = 'ValidationError';
  }
}

function validate(table: EntityTable, rec: unknown): void {
  const r = ENTITY_SCHEMAS[table].safeParse(rec);
  if (!r.success) {
    throw new ValidationError(
      table,
      r.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    );
  }
}

const COALESCE_MS = 5000;

export class Mutator {
  readonly ops: HistoryOp[] = [];
  readonly touched = new Map<EntityTable, Set<string>>();
  readonly deriveIds = new Set<string>();

  constructor(
    readonly s: Session,
    private readonly origin?: Provenance,
  ) {}

  private touch(table: EntityTable, id: string): void {
    if (!this.touched.has(table)) this.touched.set(table, new Set());
    this.touched.get(table)!.add(id);
  }

  private noteDerive(table: EntityTable, rec: Record<string, unknown>): void {
    if (table === 'content') this.deriveIds.add(rec.id as string);
    if ((table === 'tasks' || table === 'publications') && typeof rec.contentId === 'string')
      this.deriveIds.add(rec.contentId);
    if (table === 'links' && rec.fromType === 'content') this.deriveIds.add(rec.fromId as string);
  }

  async create<T extends EntityTable>(table: T, data: NewRecord<T>): Promise<EntityMap[T]> {
    this.s.assertLive();
    const rev = this.s.hlc.now();
    const now = nowIso();
    const fieldRevs: Record<string, string> = {};
    for (const k of Object.keys(data)) {
      if (!META_FIELDS.has(k) && !isDerivedField(k) && (data as Record<string, unknown>)[k] !== undefined)
        fieldRevs[k] = rev;
    }
    const rec = {
      ...(this.origin && !(data as Record<string, unknown>).origin ? { origin: this.origin } : {}),
      ...data,
      id: data.id ?? ulid(),
      workspaceId: this.s.workspaceId,
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      updatedByDevice: this.s.deviceId,
      rev,
      fieldRevs,
    } as unknown as EntityMap[T];
    validate(table, rec);
    await this.s.db.entity(table).add(rec);
    this.ops.push({ table, id: rec.id, before: null, after: rec as unknown as Record<string, unknown> });
    this.touch(table, rec.id);
    this.noteDerive(table, rec as unknown as Record<string, unknown>);
    return rec;
  }

  async update<T extends EntityTable>(
    table: T,
    id: string,
    patch: Patch<T>,
  ): Promise<EntityMap[T] | undefined> {
    this.s.assertLive();
    const tableRef = this.s.db.entity(table);
    const old = (await tableRef.get(id)) as unknown as Record<string, unknown> | undefined;
    if (!old) return undefined;
    const changed: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (META_FIELDS.has(k) || isDerivedField(k)) continue;
      if (!deepEqual(old[k], v)) changed.push(k);
    }
    if (changed.length === 0) return old as unknown as EntityMap[T];
    const rev = this.s.hlc.now();
    const fieldRevs = { ...(old.fieldRevs as Record<string, string>) };
    const fieldPrev = { ...((old.fieldPrev as Record<string, string>) ?? {}) };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const next: Record<string, unknown> = { ...old };
    for (const k of changed) {
      before[k] = old[k] ?? null;
      const v = (patch as Record<string, unknown>)[k];
      next[k] = v === undefined ? null : v;
      after[k] = next[k];
      if (fieldRevs[k]) fieldPrev[k] = fieldRevs[k];
      else delete fieldPrev[k];
      fieldRevs[k] = rev;
    }
    Object.assign(next, { fieldRevs, fieldPrev, rev, updatedAt: nowIso(), updatedByDevice: this.s.deviceId });
    validate(table, next);
    await tableRef.put(next as unknown as EntityMap[T]);
    this.ops.push({ table, id, before, after });
    this.touch(table, id);
    this.noteDerive(table, old);
    this.noteDerive(table, next);
    return next as unknown as EntityMap[T];
  }

  /** Permanently remove (after trash expiry) and leave a tombstone for sync. */
  async purge(table: EntityTable, id: string): Promise<void> {
    this.s.assertLive();
    const old = (await this.s.db.entity(table).get(id)) as unknown as Record<string, unknown> | undefined;
    if (!old) return;
    await this.s.db.entity(table).delete(id);
    await this.s.db.tombstones.put({ id, entity: table, deletedAt: nowIso(), rev: this.s.hlc.now() });
    this.ops.push({ table, id, before: old, after: null });
    this.touch(table, id);
    this.noteDerive(table, old);
  }
}

export async function recomputeDerived(s: Session, contentIds: Iterable<string>): Promise<void> {
  const ws = await s.db.workspace.get('workspace');
  for (const cid of contentIds) {
    const content = await s.db.content.get(cid);
    if (!content) continue;
    const [tasks, publications, links] = await Promise.all([
      s.db.tasks.where('contentId').equals(cid).toArray() as Promise<Task[]>,
      s.db.publications.where('contentId').equals(cid).toArray() as Promise<Publication[]>,
      s.db.links.where('fromId').equals(cid).toArray() as Promise<Link[]>,
    ]);
    const template = ws?.formatTemplates.find((t) => t.id === content.formatTemplateId);
    const d = deriveContent({ content: content as Content, template, tasks, publications, links });
    const cur = content as Record<string, unknown>;
    const same = Object.entries(d).every(([k, v]) => deepEqual(cur[k], v));
    if (!same) await s.db.content.put({ ...content, ...d });
  }
}

const ALL_TABLES = [...SYNC_TABLES, 'tombstones', 'history', 'meta'];

/**
 * The one write path for user/AI/import mutations. Atomic, validated, HLC-stamped per field,
 * recorded in undo history, derived fields recomputed, and failures surfaced (never silent).
 */
export async function mutate<R>(
  s: Session,
  opts: MutateOpts,
  fn: (m: Mutator) => Promise<R>,
  origin?: Provenance,
): Promise<R> {
  s.assertLive();
  saveStatus.set({ state: 'saving' });
  const m = new Mutator(s, origin);
  try {
    const result = await s.db.transaction('rw', ALL_TABLES, async () => {
      // Other tabs of this browser share the device id: adopt their clock first so revisions stay
      // monotonic per device (IndexedDB serializes these transactions).
      s.hlc.observe((await s.db.meta.get('hlc'))?.value as never);
      const r = await fn(m);
      if (m.deriveIds.size) await recomputeDerived(s, m.deriveIds);
      if (opts.history !== false && m.ops.length) await writeHistory(s, opts, m.ops);
      await s.persistClock();
      return r;
    });
    saveStatus.set({ state: 'saved', at: Date.now() });
    clearBanner('persist');
    const events = [...m.touched.entries()].map(([table, ids]) => ({
      table,
      ids: [...ids],
      source: 'local' as const,
    }));
    if (m.deriveIds.size) events.push({ table: 'content', ids: [...m.deriveIds], source: 'local' });
    s.emit(events);
    return result;
  } catch (e) {
    reportPersistError(e);
    throw e;
  }
}

export function reportPersistError(e: unknown): void {
  const err = e as Error;
  if (err?.name === 'SessionClosedError') return;
  logger.error('store', 'write failed', err);
  const quota = err?.name === 'QuotaExceededError' || /quota/i.test(err?.message ?? '');
  const code = quota
    ? 'error.persist_quota'
    : err?.name === 'ValidationError'
      ? 'error.persist_validation'
      : 'error.persist_failed';
  saveStatus.set({ state: 'error', error: code });
  setBanner({ id: 'persist', kind: 'error', msgKey: code });
}

async function writeHistory(s: Session, opts: MutateOpts, ops: HistoryOp[]): Promise<void> {
  const now = Date.now();
  if (opts.coalesceKey) {
    const last = await s.db.history.orderBy('at').last();
    if (
      last &&
      last.coalesceKey === opts.coalesceKey &&
      !last.undone &&
      now - Date.parse(last.at) < COALESCE_MS
    ) {
      // Merge: keep the earliest `before`, take the latest `after`.
      for (const op of ops) {
        const prev = last.ops.find((o) => o.table === op.table && o.id === op.id);
        if (prev) prev.after = { ...(prev.after ?? {}), ...(op.after ?? {}) };
        else last.ops.push(op);
      }
      last.at = new Date(now).toISOString();
      await s.db.history.put(last);
      return;
    }
  }
  const entry: HistoryEntry = {
    id: ulid(),
    at: new Date(now).toISOString(),
    actor: opts.actor ?? 'user',
    label: opts.label,
    ...(opts.labelParams ? { labelParams: opts.labelParams } : {}),
    ops,
    ...(opts.coalesceKey ? { coalesceKey: opts.coalesceKey } : {}),
  };
  await s.db.history.put(entry);
  // Bounded local history: last 2000 entries.
  const count = await s.db.history.count();
  if (count > 2000) {
    const old = await s.db.history
      .orderBy('at')
      .limit(count - 2000)
      .primaryKeys();
    await s.db.history.bulkDelete(old);
  }
}

// ---------- Convenience commands ----------

export function create<T extends EntityTable>(
  s: Session,
  table: T,
  data: NewRecord<T>,
  label?: string,
  origin?: Provenance,
) {
  return mutate(
    s,
    label ? { label } : { label: 'h.create', labelParams: { entity: table } },
    (m) => m.create(table, data),
    origin,
  );
}

export function update<T extends EntityTable>(
  s: Session,
  table: T,
  id: string,
  patch: Patch<T>,
  opts?: Partial<MutateOpts>,
) {
  return mutate(s, { label: 'h.edit', labelParams: { entity: table }, ...opts }, (m) =>
    m.update(table, id, patch),
  );
}

const CASCADE: Partial<Record<EntityTable, { table: EntityTable; key: string }[]>> = {
  content: [
    { table: 'publications', key: 'contentId' },
    { table: 'snapshots', key: 'contentId' },
    { table: 'tasks', key: 'contentId' },
    { table: 'events', key: 'contentId' },
  ],
  publications: [{ table: 'snapshots', key: 'publicationId' }],
};

/** Move to Trash (recoverable for 30 days). Children of content go with it and come back with it. */
export function trash(s: Session, table: EntityTable, id: string, label = 'h.trash') {
  return mutate(s, { label }, async (m) => {
    const at = nowIso();
    await m.update(table, id, { deletedAt: at, trashGroup: null } as never);
    for (const c of CASCADE[table] ?? []) {
      const kids = (await s.db.table(c.table).where(c.key).equals(id).toArray()) as Record<string, unknown>[];
      for (const k of kids)
        if (!k.deletedAt) await m.update(c.table, k.id as string, { deletedAt: at, trashGroup: id } as never);
    }
  });
}

export function restore(s: Session, table: EntityTable, id: string) {
  return mutate(s, { label: 'h.restore' }, async (m) => {
    await m.update(table, id, { deletedAt: null } as never);
    for (const c of CASCADE[table] ?? []) {
      const kids = (await s.db.table(c.table).where(c.key).equals(id).toArray()) as Record<string, unknown>[];
      for (const k of kids)
        if (k.trashGroup === id)
          await m.update(c.table, k.id as string, { deletedAt: null, trashGroup: null } as never);
    }
  });
}

export function archive(s: Session, table: EntityTable, id: string, archived = true) {
  return mutate(s, { label: archived ? 'h.archive' : 'h.unarchive' }, (m) =>
    m.update(table, id, { archivedAt: archived ? nowIso() : null } as never),
  );
}

export const TRASH_DAYS = 30;
export const TOMBSTONE_DAYS = 180;

export async function purgeExpired(s: Session, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - TRASH_DAYS * 86400000).toISOString();
  let n = 0;
  const victims: [EntityTable, string][] = [];
  for (const t of SYNC_TABLES) {
    if (t === 'workspace') continue;
    await s.db.table(t).each((r: Record<string, unknown>) => {
      if (typeof r.deletedAt === 'string' && r.deletedAt < cutoff) victims.push([t, r.id as string]);
    });
  }
  if (victims.length) {
    await mutate(s, { label: 'h.purgeExpired', history: false }, async (m) => {
      for (const [t, id] of victims) {
        await m.purge(t, id);
        n++;
      }
    });
  }
  const tombCutoff = new Date(now - TOMBSTONE_DAYS * 86400000).toISOString();
  const oldTombs = await s.db.tombstones.filter((t) => t.deletedAt < tombCutoff).primaryKeys();
  await s.db.tombstones.bulkDelete(oldTombs);
  return n;
}

export async function purgeNow(s: Session, table: EntityTable, id: string): Promise<void> {
  await mutate(s, { label: 'h.purge', history: false }, (m) => m.purge(table, id));
}

// ---------- Undo ----------

export async function undoLast(s: Session): Promise<HistoryEntry | null> {
  const entries = await s.db.history.orderBy('at').reverse().limit(50).toArray();
  const entry = entries.find((e) => !e.undone && (e.actor === 'user' || e.actor === 'ai'));
  if (!entry) return null;
  await undoEntry(s, entry);
  return entry;
}

export async function undoEntry(s: Session, entry: HistoryEntry): Promise<void> {
  await mutate(s, { label: 'h.undo', history: false }, async (m) => {
    for (const op of [...entry.ops].reverse()) {
      if (op.before === null) {
        await m.update(op.table, op.id, { deletedAt: nowIso() } as never);
      } else if (op.after === null) {
        // Undo of a purge: recreate from snapshot as a fresh record version.
        const { fieldRevs: _f, fieldPrev: _p, rev: _r, ...rest } = op.before as Record<string, unknown>;
        await s.db.tombstones.delete(op.id);
        await m.create(op.table, rest as never);
      } else {
        await m.update(op.table, op.id, op.before as never);
      }
    }
    entry.undone = true;
    await s.db.history.put(entry);
  });
}
