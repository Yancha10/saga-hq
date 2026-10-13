import type { Session } from '../app/session';
import { clearBanner, createStore, setBanner } from '../app/status';
import { getMeta } from '../data/db';
import { buildBackup } from '../data/backup';
import { evictCache, markUploaded } from '../media/store';
import { logger } from '../diagnostics/logger';
import { DriveError, type DriveApi } from './driveApi';
import { SyncBlockedError, SyncEngine } from './engine';

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'offline' | 'needs_auth' | 'blocked' | 'error';
export interface SyncStatus {
  phase: SyncPhase;
  message?: string;
  lastSyncAt?: string;
  pendingUploads?: number;
  quota?: { limit?: number; usage: number };
}
export const syncStatus = createStore<SyncStatus>({ phase: 'off' });

const ACTIVE_MS = 60_000;
const IDLE_MS = 5 * 60_000;
const PUSH_DEBOUNCE_MS = 5_000;
const PUSH_MAX_WAIT_MS = 30_000;
const IDLE_AFTER_MS = 2 * 60_000;
const QUOTA_EVERY_MS = 6 * 3600_000;
const LOW_SPACE_BYTES = 1024 ** 3;

/**
 * Adaptive scheduler: fast when active, slow when idle, immediate on focus/reconnect, nothing while
 * hidden, exponential backoff with jitter on rate/server/network errors. Bound to one Session.
 */
export class SyncRunner {
  readonly engine: SyncEngine;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingAt = 0;
  private running = false;
  private again = false;
  private failures = 0;
  private lastInput = Date.now();
  private lastQuotaAt = 0;
  private stopped = false;

  constructor(
    readonly session: Session,
    readonly drive: DriveApi,
    readonly accountId: string,
    private readonly cacheLimit: () => number = () => 1024 ** 3,
  ) {
    this.engine = new SyncEngine(session, drive, accountId);
  }

  start(): void {
    const s = this.session;
    const onVis = () => {
      if (document.visibilityState === 'visible') this.kick();
      else void this.flush();
    };
    const onOnline = () => this.kick();
    const onOffline = () => syncStatus.set((p) => ({ ...p, phase: 'offline' }));
    const onInput = () => {
      this.lastInput = Date.now();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onOnline);
    window.addEventListener('pointerdown', onInput, { passive: true });
    window.addEventListener('keydown', onInput, { passive: true });
    const off = s.onChange((evs) => {
      if (evs.some((e) => e.source === 'local' || e.source === 'import')) this.schedulePush();
    });
    s.addDisposer(() => {
      this.stop();
      off();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onOnline);
      window.removeEventListener('pointerdown', onInput);
      window.removeEventListener('keydown', onInput);
    });
    void getMeta<{ lastSyncAt?: string }>(s.db, 'sync').then((st) => syncStatus.set({ phase: 'idle', ...(st?.lastSyncAt ? { lastSyncAt: st.lastSyncAt } : {}) }));
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.timer = null;
    this.pushTimer = null;
  }

  private schedulePush(): void {
    if (this.stopped) return;
    const now = Date.now();
    if (!this.firstPendingAt) this.firstPendingAt = now;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    const wait = Math.min(PUSH_DEBOUNCE_MS, Math.max(0, this.firstPendingAt + PUSH_MAX_WAIT_MS - now));
    this.pushTimer = setTimeout(() => {
      this.firstPendingAt = 0;
      void this.run('push');
    }, wait);
  }

  kick(): void {
    if (this.stopped) return;
    void this.run('full');
  }

  /** Best-effort immediate push (app hidden / account switch). */
  async flush(): Promise<void> {
    if (this.stopped || !this.session.isLive()) return;
    try {
      await this.engine.push();
    } catch (e) {
      logger.warn('sync', 'flush failed', e);
    }
  }

  private nextDelay(): number {
    if (this.failures > 0) {
      const base = Math.min(15 * 60_000, 5_000 * 2 ** (this.failures - 1));
      return base / 2 + Math.random() * base;
    }
    return Date.now() - this.lastInput > IDLE_AFTER_MS ? IDLE_MS : ACTIVE_MS;
  }

  private reschedule(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; // nothing while hidden
    this.timer = setTimeout(() => void this.run('full'), this.nextDelay());
  }

  private async run(kind: 'full' | 'push'): Promise<void> {
    if (this.stopped || !this.session.isLive()) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      syncStatus.set((p) => ({ ...p, phase: 'offline' }));
      this.reschedule();
      return;
    }
    this.running = true;
    syncStatus.set((p) => ({ ...p, phase: 'syncing' }));
    try {
      if (kind === 'full') await this.engine.pull();
      await this.engine.push();
      if (kind === 'full') await this.housekeeping();
      this.failures = 0;
      clearBanner('sync');
      const st = await this.engine.state();
      const pendingUploads = await this.session.db.uploads.count();
      syncStatus.set((p) => ({ ...p, phase: 'idle', message: undefined, pendingUploads, ...(st.lastSyncAt ? { lastSyncAt: st.lastSyncAt } : {}) }));
    } catch (e) {
      this.handleError(e);
    } finally {
      this.running = false;
      if (this.again && !this.stopped) {
        this.again = false;
        setTimeout(() => void this.run('push'), 50);
      }
      this.reschedule();
    }
  }

  private handleError(e: unknown): void {
    if ((e as Error)?.name === 'SessionClosedError' || (e as Error)?.name === 'AbortError') {
      this.stop();
      return;
    }
    if (e instanceof SyncBlockedError) {
      this.stop();
      syncStatus.set((p) => ({ ...p, phase: 'blocked', message: e.message }));
      setBanner({ id: 'sync', kind: 'error', message: `Sync stopped: ${e.message} Your local data is safe.` });
      return;
    }
    if (e instanceof DriveError) {
      if (e.kind === 'auth') {
        syncStatus.set((p) => ({ ...p, phase: 'needs_auth', message: 'Sync paused — reconnect Google to resume.' }));
        this.failures = 0;
        if (this.timer) clearTimeout(this.timer);
        this.stopped = false;
        return;
      }
      if (e.kind === 'quota') {
        setBanner({ id: 'sync', kind: 'warning', message: 'Your Google Drive is full. Saga HQ keeps working locally; free Drive space to resume syncing.' });
      }
      if (e.kind === 'network') {
        syncStatus.set((p) => ({ ...p, phase: 'offline' }));
        this.failures = Math.min(this.failures + 1, 8);
        return;
      }
      this.failures = Math.min(this.failures + 1, 8);
      syncStatus.set((p) => ({ ...p, phase: 'error', message: e.retryable ? 'Drive is busy — retrying automatically.' : e.message }));
      logger.warn('sync', `drive error ${e.kind} ${e.status}`);
      return;
    }
    this.failures = Math.min(this.failures + 1, 8);
    logger.error('sync', 'sync failed', e);
    syncStatus.set((p) => ({ ...p, phase: 'error', message: 'Sync failed — retrying. Local data is safe.' }));
  }

  private async housekeeping(): Promise<void> {
    await this.processUploads();
    await this.engine.maybeCompact();
    await this.engine.maybeBackup(() => buildBackup(this.session));
    await evictCache(this.session, this.cacheLimit());
    if (Date.now() - this.lastQuotaAt > QUOTA_EVERY_MS) {
      this.lastQuotaAt = Date.now();
      const q = await this.drive.quota();
      syncStatus.set((p) => ({ ...p, quota: q }));
      if (q.limit !== undefined && q.limit - q.usage < LOW_SPACE_BYTES)
        setBanner({ id: 'drive-space', kind: 'warning', message: 'Your Google Drive has less than 1 GB free. Saga HQ never deletes your content automatically — free space in Drive or Settings › Storage.' });
      else clearBanner('drive-space');
    }
  }

  /** Media uploads run separately and never block text sync. */
  async processUploads(limit = 2): Promise<void> {
    const s = this.session;
    const jobs = (await s.db.uploads.toArray()).filter((j) => j.state !== 'failed' || j.attempts < 5).slice(0, limit);
    if (!jobs.length) return;
    const st = await this.engine.ensureLayout();
    for (const job of jobs) {
      s.assertLive();
      const meta = await s.db.media.get(job.id);
      const row = await s.db.mediaBlobs.get([job.id, 'full']);
      if (!meta || !row || meta.driveFileId) {
        await s.db.uploads.delete(job.id);
        continue;
      }
      try {
        await s.db.uploads.update(job.id, { state: 'uploading' });
        const ext = (meta.mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '');
        const f = await this.drive.uploadBlob(`${meta.id}.${ext}`, st.mediaId!, row.blob, { sagahq: 'media', ws: s.workspaceId, mediaId: meta.id }, s.signal);
        s.assertLive();
        await markUploaded(s, meta.id, f.id);
        await s.db.uploads.delete(job.id);
      } catch (e) {
        if ((e as Error).name === 'SessionClosedError') throw e;
        await s.db.uploads.update(job.id, { state: 'failed', attempts: job.attempts + 1, lastError: (e as Error).message });
        if (e instanceof DriveError && (e.kind === 'auth' || e.kind === 'quota')) throw e;
      }
    }
  }
}
