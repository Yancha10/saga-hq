import Dexie, { type DexieOptions } from 'dexie';
import type { WorkspaceRef } from '../account/workspaceRef';
import { base32Lower } from '../core/base32';
import { randomBytes } from '../core/crypto';
import { Hlc, type HlcState } from '../core/hlc';
import { nowIso } from '../core/util';
import { getMeta, setMeta, WorkspaceDB } from '../data/db';
import { DEFAULT_TEMPLATES } from '../data/defaults';
import { runMigrations } from '../data/migrations';
import { type EntityTable, SCHEMA_VERSION, type Workspace } from '../data/schema';
import { logger } from '../diagnostics/logger';

export class SessionClosedError extends Error {
  constructor() {
    super('Workspace session closed');
    this.name = 'SessionClosedError';
  }
}
export class FutureSchemaError extends Error {
  constructor(readonly found: number) {
    super(`Workspace was written by a newer Saga HQ (schema ${found}).`);
    this.name = 'FutureSchemaError';
  }
}

export interface ChangeEvent {
  table: EntityTable;
  ids: string[];
  source: 'local' | 'sync' | 'import';
}
type Listener = (e: ChangeEvent[]) => void;

let generationCounter = 0;

/**
 * One open workspace. Every account-bound async operation captures its Session and must call
 * `assertLive()` before mutating. Closing aborts in-flight work (AbortController) and closes the DB,
 * so a late callback can never write into a different account's workspace.
 */
export class Session {
  readonly generation = ++generationCounter;
  readonly abort = new AbortController();
  private listeners = new Set<Listener>();
  private disposers: (() => void)[] = [];
  closed = false;

  private constructor(
    readonly ref: WorkspaceRef,
    readonly db: WorkspaceDB,
    readonly deviceId: string,
    readonly hlc: Hlc,
  ) {}

  get workspaceId(): string {
    return this.ref.workspaceId;
  }
  get signal(): AbortSignal {
    return this.abort.signal;
  }

  static async open(ref: WorkspaceRef, options?: DexieOptions): Promise<Session> {
    const existing = options ? false : await Dexie.exists(ref.dbName).catch(() => false);
    const db = new WorkspaceDB(ref.dbName, options);
    try {
      await db.open();
    } catch (e) {
      db.close();
      if (e instanceof Error && e.name === 'VersionError') throw new FutureSchemaError(-1);
      throw e;
    }
    const stored = await getMeta<number>(db, 'schemaVersion');
    if (stored !== undefined && stored > SCHEMA_VERSION) {
      db.close();
      throw new FutureSchemaError(stored);
    }
    let deviceId = await getMeta<string>(db, 'deviceId');
    if (!deviceId) {
      deviceId = base32Lower(randomBytes(10)); // per-workspace device id: not linkable across accounts
      await setMeta(db, 'deviceId', deviceId);
    }
    const hlcState = (await getMeta<HlcState>(db, 'hlc')) ?? { ms: 0, c: 0 };
    const session = new Session(ref, db, deviceId, new Hlc(deviceId, hlcState));
    await runMigrations(session, stored ?? (existing ? 1 : SCHEMA_VERSION));
    await session.ensureWorkspaceRecord();
    logger.info('session', `opened workspace (${ref.kind})`, `gen=${session.generation}`);
    return session;
  }

  private async ensureWorkspaceRecord(): Promise<void> {
    const ws = await this.db.workspace.get('workspace');
    if (ws) return;
    const now = nowIso();
    const rev = this.hlc.now();
    const record: Workspace = {
      id: 'workspace',
      workspaceId: this.workspaceId,
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      updatedByDevice: this.deviceId,
      // Initial defaults use the minimal HLC so any real edit on any device wins over them.
      rev: `000000000-0000-${this.deviceId}`,
      fieldRevs: {},
      name: '', // rendered with a localized placeholder; never store UI-language defaults
      platforms: [],
      cadence: [],
      formatTemplates: DEFAULT_TEMPLATES,
      focus: [],
      onboardedAt: null,
      scoringEnabled: false,
    };
    void rev;
    await this.db.workspace.put(record);
    await setMeta(this.db, 'schemaVersion', SCHEMA_VERSION);
  }

  assertLive(): void {
    if (this.closed || this.abort.signal.aborted) throw new SessionClosedError();
  }

  isLive(): boolean {
    return !this.closed && !this.abort.signal.aborted;
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  emit(events: ChangeEvent[]): void {
    if (this.closed || events.length === 0) return;
    for (const l of this.listeners) {
      try {
        l(events);
      } catch (e) {
        logger.error('session', 'listener failed', e);
      }
    }
  }

  /** Register cleanup (timers, workers, object URLs) to run when the session closes. */
  addDisposer(fn: () => void): void {
    this.disposers.push(fn);
  }

  async persistClock(): Promise<void> {
    await setMeta(this.db, 'hlc', this.hlc.snapshot());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    for (const d of this.disposers.splice(0)) {
      try {
        d();
      } catch (e) {
        logger.warn('session', 'disposer failed', e);
      }
    }
    this.listeners.clear();
    this.db.close();
    logger.info('session', `closed gen=${this.generation}`);
  }
}

let current: Session | null = null;
export function setCurrentSession(s: Session | null): void {
  current = s;
}
export function currentSession(): Session {
  if (!current) throw new SessionClosedError();
  return current;
}
export function maybeSession(): Session | null {
  return current;
}
