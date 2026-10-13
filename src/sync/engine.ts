import type { Session } from '../app/session';
import { maxHlc } from '../core/hlc';
import { nowIso } from '../core/util';
import { getMeta, setMeta } from '../data/db';
import { createRecoveryPoint } from '../data/recovery';
import {
  ENTITY_SCHEMAS,
  type EntityTable,
  SCHEMA_VERSION,
  SYNC_TABLES,
  type Tombstone,
  tombstoneSchema,
} from '../data/schema';
import { serializeWorkspace } from '../data/serialize';
import { recomputeDerived } from '../data/store';
import { logger } from '../diagnostics/logger';
import { type DriveApi, DriveError, type DriveFile } from './driveApi';
import { applyTombstone, mergeRecord, stripDerived } from './merge';

export const DRIVE_ROOT_NAME = 'Saga HQ';
const SEGMENT_MAX_RECORDS = 1500;
const COMPACT_AFTER_SEGMENTS = 300;
const SEGMENT_DELETE_AGE_MS = 7 * 86400000;
const BACKUP_EVERY_MS = 7 * 86400000;
const KEEP_BACKUPS = 8;
const LARGE_MERGE = 50;

export interface SyncState {
  rootId?: string;
  wsFolderId?: string;
  journalId?: string;
  snapshotsId?: string;
  mediaId?: string;
  backupsId?: string;
  manifestId?: string;
  pageToken?: string | null;
  pushedRev: string;
  nextSeq: number;
  applied: string[]; // segment keys `${device}:${seq}`
  snapshotsApplied: string[];
  lastBackupAt?: string;
  lastSyncAt?: string;
}

export interface Manifest {
  format: 'saga-hq-drive';
  version: 1;
  workspaceId: string;
  accountId: string;
  schemaVersion: number;
  createdAt: string;
}

export interface Segment {
  format: 'saga-hq-journal';
  version: 1;
  workspaceId: string;
  deviceId: string;
  seq: number;
  createdAt: string;
  schemaVersion: number;
  records: { t: EntityTable; r: Record<string, unknown> }[];
  tombstones: Tombstone[];
}

export interface DriveSnapshot {
  format: 'saga-hq-snapshot';
  version: 1;
  workspaceId: string;
  createdAt: string;
  createdBy: string;
  schemaVersion: number;
  hlc: string;
  tables: Partial<Record<EntityTable, Record<string, unknown>[]>>;
  tombstones: Tombstone[];
}

export class SyncBlockedError extends Error {
  constructor(
    readonly reason: 'accountMismatch' | 'futureSchema' | 'notAccount',
    message: string,
  ) {
    super(message);
    this.name = 'SyncBlockedError';
  }
}

export interface PullReport {
  applied: number;
  skippedInvalid: number;
  conflicts: number;
  segments: number;
}

const ownDevice = (rev: string, device: string) => rev.endsWith(`-${device}`);

export class SyncEngine {
  constructor(
    readonly session: Session,
    readonly drive: DriveApi,
    readonly accountId: string,
    private readonly clock: () => number = Date.now,
  ) {}

  private get db() {
    return this.session.db;
  }
  private get ws() {
    return this.session.workspaceId;
  }

  async state(): Promise<SyncState> {
    return (
      (await getMeta<SyncState>(this.db, 'sync')) ?? {
        pushedRev: '',
        nextSeq: 1,
        applied: [],
        snapshotsApplied: [],
      }
    );
  }
  private async save(st: SyncState): Promise<void> {
    this.session.assertLive();
    await setMeta(this.db, 'sync', st);
  }

  // ---------------- layout ----------------

  async ensureLayout(): Promise<SyncState> {
    const st = await this.state();
    if (st.wsFolderId && st.journalId && st.snapshotsId && st.manifestId && st.mediaId && st.backupsId) {
      return st;
    }
    const d = this.drive;
    let root = (await d.find({ folder: true, appProperties: { sagahq: 'root' } }))[0];
    if (!root) root = await d.createFolder(DRIVE_ROOT_NAME, null, { sagahq: 'root' });
    let wsFolder = (await d.find({ folder: true, appProperties: { sagahq: 'workspace', ws: this.ws } }))[0];
    if (!wsFolder) wsFolder = await d.createFolder(this.ws, root.id, { sagahq: 'workspace', ws: this.ws });
    const sub = async (kind: string, name: string): Promise<DriveFile> => {
      const f = (await d.find({ folder: true, appProperties: { sagahq: kind, ws: this.ws } }))[0];
      return f ?? d.createFolder(name, wsFolder!.id, { sagahq: kind, ws: this.ws });
    };
    const journal = await sub('journal', 'journal');
    const snapshots = await sub('snapshots', 'snapshots');
    const media = await sub('media', 'media');
    const backups = await sub('backups', 'backups');
    let manifestFile = (await d.find({ appProperties: { sagahq: 'manifest', ws: this.ws } }))[0];
    if (!manifestFile) {
      const m: Manifest = {
        format: 'saga-hq-drive',
        version: 1,
        workspaceId: this.ws,
        accountId: this.accountId,
        schemaVersion: SCHEMA_VERSION,
        createdAt: nowIso(),
      };
      manifestFile = await d.createJson('manifest.json', wsFolder.id, m, { sagahq: 'manifest', ws: this.ws });
    }
    await this.verifyManifest(manifestFile.id);
    const next: SyncState = {
      ...st,
      rootId: root.id,
      wsFolderId: wsFolder.id,
      journalId: journal.id,
      snapshotsId: snapshots.id,
      mediaId: media.id,
      backupsId: backups.id,
      manifestId: manifestFile.id,
    };
    await this.save(next);
    return next;
  }

  async verifyManifest(manifestId: string): Promise<void> {
    const m = await this.drive.readJson<Manifest>(manifestId);
    if (m?.format !== 'saga-hq-drive')
      throw new SyncBlockedError('futureSchema', 'Unrecognized Saga HQ data in Drive.');
    if (m.accountId !== this.accountId)
      throw new SyncBlockedError(
        'accountMismatch',
        'This Drive folder belongs to a different Saga HQ account. Sync is blocked to protect both workspaces.',
      );
    if (m.schemaVersion > SCHEMA_VERSION)
      throw new SyncBlockedError(
        'futureSchema',
        'Another device uses a newer Saga HQ version. Update this app to keep syncing.',
      );
  }

  // ---------------- push ----------------

  async collectOutbox(
    pushedRev: string,
  ): Promise<{ records: Segment['records']; tombstones: Tombstone[]; maxRev: string }> {
    const device = this.session.deviceId;
    const records: Segment['records'] = [];
    let maxRev = pushedRev;
    for (const t of SYNC_TABLES) {
      const rows = (await this.db.table(t).where('rev').above(pushedRev).toArray()) as Record<
        string,
        unknown
      >[];
      for (const r of rows) {
        const fr = (r.fieldRevs ?? {}) as Record<string, string>;
        const own = Object.values(fr).filter((v) => ownDevice(v, device) && v > pushedRev);
        if (own.length === 0) continue;
        records.push({ t, r: stripDerived(r) });
        for (const v of own) maxRev = maxHlc(maxRev, v) as string;
      }
    }
    const tombstones = (await this.db.tombstones.where('rev').above(pushedRev).toArray()).filter((x) =>
      ownDevice(x.rev, device),
    );
    for (const tb of tombstones) maxRev = maxHlc(maxRev, tb.rev) as string;
    return { records, tombstones, maxRev };
  }

  async push(): Promise<number> {
    const st = await this.ensureLayout();
    const { records, tombstones, maxRev } = await this.collectOutbox(st.pushedRev);
    if (records.length === 0 && tombstones.length === 0) return 0;
    let seq = st.nextSeq;
    const applied = new Set(st.applied);
    for (let i = 0; i < Math.max(records.length, 1); i += SEGMENT_MAX_RECORDS) {
      const chunk = records.slice(i, i + SEGMENT_MAX_RECORDS);
      const seg: Segment = {
        format: 'saga-hq-journal',
        version: 1,
        workspaceId: this.ws,
        deviceId: this.session.deviceId,
        seq,
        createdAt: nowIso(),
        schemaVersion: SCHEMA_VERSION,
        records: chunk,
        tombstones: i === 0 ? tombstones : [],
      };
      this.session.assertLive();
      await this.drive.createJson(
        `${this.session.deviceId}-${String(seq).padStart(8, '0')}.json`,
        st.journalId!,
        seg,
        {
          sagahq: 'segment',
          ws: this.ws,
          device: this.session.deviceId,
          seq: String(seq),
          at: String(this.clock()),
        },
      );
      applied.add(`${this.session.deviceId}:${seq}`);
      seq++;
    }
    // Watermark only advances after every chunk was written; a failure re-sends next time (idempotent).
    const cur = await this.state();
    await this.save({ ...cur, pushedRev: maxRev, nextSeq: seq, applied: [...applied] });
    return records.length + tombstones.length;
  }

  // ---------------- pull ----------------

  async pull(): Promise<PullReport> {
    const st = await this.ensureLayout();
    const report: PullReport = { applied: 0, skippedInvalid: 0, conflicts: 0, segments: 0 };
    if (!st.pageToken) {
      await this.fullReconcile(report);
      return report;
    }
    let token: string = st.pageToken;
    const toApply: DriveFile[] = [];
    try {
      for (;;) {
        const page = await this.drive.listChanges(token);
        for (const ch of page.changes) {
          const f = ch.file;
          if (ch.removed || !f || f.appProperties?.ws !== this.ws) continue;
          if (f.appProperties.sagahq === 'segment' || f.appProperties.sagahq === 'snapshot') toApply.push(f);
          if (f.appProperties.sagahq === 'manifest') await this.verifyManifest(f.id);
        }
        if (page.nextPageToken) token = page.nextPageToken;
        else {
          token = page.newStartPageToken ?? token;
          break;
        }
      }
    } catch (e) {
      if (e instanceof DriveError && (e.kind === 'badToken' || e.kind === 'notFound')) {
        logger.warn('sync', 'page token invalid; full reconcile');
        await this.save({ ...(await this.state()), pageToken: null });
        await this.fullReconcile(report);
        return report;
      }
      throw e;
    }
    await this.applyFiles(toApply, report);
    await this.save({ ...(await this.state()), pageToken: token, lastSyncAt: nowIso() });
    return report;
  }

  private async fullReconcile(report: PullReport): Promise<void> {
    // Token first, so nothing written during the listing is missed afterwards.
    const token = await this.drive.getStartPageToken();
    const snaps = await this.drive.find({ appProperties: { sagahq: 'snapshot', ws: this.ws } });
    const segs = await this.drive.find({ appProperties: { sagahq: 'segment', ws: this.ws } });
    await this.applyFiles([...snaps, ...segs], report);
    await this.save({ ...(await this.state()), pageToken: token, lastSyncAt: nowIso() });
  }

  private async applyFiles(files: DriveFile[], report: PullReport): Promise<void> {
    const st = await this.state();
    const applied = new Set(st.applied);
    const snapsApplied = new Set(st.snapshotsApplied);
    const snapshots = files.filter(
      (f) => f.appProperties?.sagahq === 'snapshot' && !snapsApplied.has(f.appProperties.hlc ?? f.id),
    );
    const segments = files
      .filter((f) => f.appProperties?.sagahq === 'segment')
      .filter((f) => {
        const key = `${f.appProperties!.device}:${f.appProperties!.seq}`;
        return f.appProperties!.device !== this.session.deviceId && !applied.has(key);
      })
      .sort((a, b) => Number(a.appProperties!.seq) - Number(b.appProperties!.seq));
    const seen = new Set<string>();
    for (const f of snapshots.sort((a, b) =>
      (a.appProperties!.hlc ?? '').localeCompare(b.appProperties!.hlc ?? ''),
    )) {
      this.session.assertLive();
      let snap: DriveSnapshot;
      try {
        snap = await this.drive.readJson<DriveSnapshot>(f.id);
      } catch (e) {
        if (e instanceof DriveError && e.kind === 'notFound') continue;
        throw e;
      }
      if (snap?.format !== 'saga-hq-snapshot' || snap.workspaceId !== this.ws) {
        report.skippedInvalid++;
        continue;
      }
      if (snap.schemaVersion > SCHEMA_VERSION)
        throw new SyncBlockedError(
          'futureSchema',
          'A newer Saga HQ wrote this workspace. Update to keep syncing.',
        );
      const recs: Segment['records'] = [];
      for (const [t, rows] of Object.entries(snap.tables))
        for (const r of rows ?? []) recs.push({ t: t as EntityTable, r });
      await this.applyBatch(recs, snap.tombstones ?? [], report);
      snapsApplied.add(f.appProperties!.hlc ?? f.id);
    }
    for (const f of segments) {
      const key = `${f.appProperties!.device}:${f.appProperties!.seq}`;
      if (seen.has(key)) continue; // duplicate journal file
      seen.add(key);
      this.session.assertLive();
      let seg: Segment;
      try {
        seg = await this.drive.readJson<Segment>(f.id);
      } catch (e) {
        if (e instanceof DriveError && e.kind === 'notFound') continue; // compacted away meanwhile
        if (e instanceof SyntaxError) {
          logger.warn('sync', 'malformed journal segment skipped', key);
          report.skippedInvalid++;
          applied.add(key);
          continue;
        }
        throw e;
      }
      if (seg?.format !== 'saga-hq-journal' || seg.workspaceId !== this.ws || !Array.isArray(seg.records)) {
        logger.warn('sync', 'invalid journal segment skipped', key);
        report.skippedInvalid++;
        applied.add(key);
        continue;
      }
      if (seg.schemaVersion > SCHEMA_VERSION)
        throw new SyncBlockedError(
          'futureSchema',
          'Another device uses a newer Saga HQ version. Update this app to keep syncing.',
        );
      await this.applyBatch(seg.records, Array.isArray(seg.tombstones) ? seg.tombstones : [], report);
      applied.add(key);
      report.segments++;
    }
    const cur = await this.state();
    await this.save({ ...cur, applied: [...applied], snapshotsApplied: [...snapsApplied] });
  }

  /** Validate and merge remote records. Invalid records are skipped; local state is never destroyed. */
  async applyBatch(records: Segment['records'], tombstones: Tombstone[], report: PullReport): Promise<void> {
    const valid: {
      t: EntityTable;
      r: Record<string, unknown> & { id: string; rev: string; fieldRevs: Record<string, string> };
    }[] = [];
    for (const { t, r } of records) {
      if (!(SYNC_TABLES as string[]).includes(t)) {
        report.skippedInvalid++;
        continue;
      }
      const parsed = ENTITY_SCHEMAS[t].safeParse(r);
      if (!parsed.success || (r as { workspaceId?: string }).workspaceId !== this.ws) {
        report.skippedInvalid++;
        continue;
      }
      valid.push({ t, r: parsed.data as never });
    }
    const tombs = tombstones.filter(
      (x) => tombstoneSchema.safeParse(x).success && (SYNC_TABLES as string[]).includes(x.entity),
    );
    if (valid.length + tombs.length > LARGE_MERGE)
      await createRecoveryPoint(this.session, 'sync_merge', { count: valid.length + tombs.length });
    this.session.assertLive();
    const s = this.session;
    const contentIds = new Set<string>();
    const touched = new Map<EntityTable, Set<string>>();
    const touch = (t: EntityTable, id: string) => {
      if (!touched.has(t)) touched.set(t, new Set());
      touched.get(t)!.add(id);
    };
    await this.db.transaction('rw', [...SYNC_TABLES, 'tombstones', 'conflicts', 'meta'], async () => {
      s.hlc.observe((await this.db.meta.get('hlc'))?.value as never);
      for (const { t, r } of valid) {
        s.hlc.receive(r.rev);
        const local = (await this.db.table(t).get(r.id)) as never;
        const tomb = await this.db.tombstones.get(r.id);
        const res = mergeRecord(local, r, tomb);
        if (res.record && res.changed) {
          await this.db.table(t).put(res.record);
          if (res.resurrected) await this.db.tombstones.delete(r.id);
          report.applied++;
          touch(t, r.id);
          if (t === 'content') contentIds.add(r.id);
          const cid = (res.record as { contentId?: string }).contentId;
          if ((t === 'tasks' || t === 'publications') && cid) contentIds.add(cid);
          if (t === 'links' && res.record.fromType === 'content') contentIds.add(res.record.fromId as string);
        }
        for (const c of res.conflicts) {
          report.conflicts++;
          await this.db.conflicts.put({
            id: `${r.id}:${c.field}:${c.loserRev}`,
            table: t,
            recordId: r.id,
            field: c.field,
            value: c.loserValue,
            rev: c.loserRev,
            winnerRev: c.winnerRev,
            at: nowIso(),
          });
        }
      }
      for (const tb of tombs) {
        s.hlc.receive(tb.rev);
        const table = tb.entity as EntityTable;
        const local = (await this.db.table(table).get(tb.id)) as never;
        const existing = await this.db.tombstones.get(tb.id);
        if (!existing || tb.rev > existing.rev) await this.db.tombstones.put(tb);
        const act = applyTombstone(local, tb);
        if (act.delete) {
          await this.db.table(table).delete(tb.id);
          touch(table, tb.id);
          report.applied++;
        } else if (act.trash) {
          await this.db.table(table).update(tb.id, { deletedAt: tb.deletedAt });
          touch(table, tb.id);
        }
      }
      if (contentIds.size) await recomputeDerived(s, contentIds);
      await s.persistClock();
    });
    s.emit([...touched.entries()].map(([table, ids]) => ({ table, ids: [...ids], source: 'sync' as const })));
  }

  // ---------------- compaction & backups ----------------

  async maybeCompact(force = false): Promise<boolean> {
    const st = await this.ensureLayout();
    if (!force && st.applied.length < COMPACT_AFTER_SEGMENTS) return false;
    const data = await serializeWorkspace(this.db);
    const hlc = this.session.hlc.now();
    const tables: DriveSnapshot['tables'] = {};
    for (const [t, rows] of Object.entries(data.tables))
      tables[t as EntityTable] = (rows ?? []).map((r) => stripDerived(r));
    const snap: DriveSnapshot = {
      format: 'saga-hq-snapshot',
      version: 1,
      workspaceId: this.ws,
      createdAt: nowIso(),
      createdBy: this.session.deviceId,
      schemaVersion: SCHEMA_VERSION,
      hlc,
      tables,
      tombstones: data.tombstones,
    };
    this.session.assertLive();
    await this.drive.createJson(`snap-${hlc}.json`, st.snapshotsId!, snap, {
      sagahq: 'snapshot',
      ws: this.ws,
      hlc,
    });
    // Only delete segments this device has applied (or written) and that are old enough.
    const segs = await this.drive.find({ appProperties: { sagahq: 'segment', ws: this.ws } });
    const applied = new Set(st.applied);
    const cutoff = this.clock() - SEGMENT_DELETE_AGE_MS;
    const stillThere = new Set<string>();
    for (const f of segs) {
      const key = `${f.appProperties!.device}:${f.appProperties!.seq}`;
      if (
        (applied.has(key) || f.appProperties!.device === this.session.deviceId) &&
        Number(f.appProperties!.at ?? 0) < cutoff
      ) {
        await this.drive.remove(f.id);
      } else stillThere.add(key);
    }
    // Forget keys of segments that no longer exist (compacted by us or another device).
    const remaining = new Set([...applied].filter((k) => stillThere.has(k)));
    // Keep at least the 3 newest snapshots; older ones are pruned after 30 days.
    const snaps = (await this.drive.find({ appProperties: { sagahq: 'snapshot', ws: this.ws } })).sort(
      (a, b) => (b.appProperties!.hlc ?? '').localeCompare(a.appProperties!.hlc ?? ''),
    );
    const snapCutoff = this.clock() - 30 * 86400000;
    for (const f of snaps.slice(3)) {
      const ms = Number.parseInt((f.appProperties!.hlc ?? '').split('-')[0] ?? '0', 36);
      if (ms < snapCutoff) await this.drive.remove(f.id);
    }
    const cur = await this.state();
    await this.save({
      ...cur,
      applied: [...remaining],
      snapshotsApplied: [...new Set([...cur.snapshotsApplied, hlc])],
    });
    return true;
  }

  async maybeBackup(makeBackup: () => Promise<unknown>, force = false): Promise<boolean> {
    const st = await this.ensureLayout();
    if (!force && st.lastBackupAt && this.clock() - Date.parse(st.lastBackupAt) < BACKUP_EVERY_MS)
      return false;
    const payload = await makeBackup();
    const date = new Date(this.clock()).toISOString().slice(0, 10);
    this.session.assertLive();
    await this.drive.createJson(`backup-${date}.json`, st.backupsId!, payload, {
      sagahq: 'backup',
      ws: this.ws,
      at: String(this.clock()),
    });
    const all = (await this.drive.find({ appProperties: { sagahq: 'backup', ws: this.ws } })).sort(
      (a, b) => Number(b.appProperties!.at) - Number(a.appProperties!.at),
    );
    for (const f of all.slice(KEEP_BACKUPS)) await this.drive.remove(f.id);
    await this.save({ ...(await this.state()), lastBackupAt: new Date(this.clock()).toISOString() });
    return true;
  }

  async footprint(): Promise<{ data: number; media: number; backups: number }> {
    const st = await this.ensureLayout();
    const sum = (fs: DriveFile[]) => fs.reduce((n, f) => n + Number(f.size ?? 0), 0);
    const [segs, snaps, media, backups] = await Promise.all([
      this.drive.find({ appProperties: { sagahq: 'segment', ws: this.ws } }),
      this.drive.find({ appProperties: { sagahq: 'snapshot', ws: this.ws } }),
      this.drive.find({ parent: st.mediaId! }),
      this.drive.find({ appProperties: { sagahq: 'backup', ws: this.ws } }),
    ]);
    return { data: sum(segs) + sum(snaps), media: sum(media), backups: sum(backups) };
  }
}
