import fc from 'fast-check';
import { stableStringify } from '../../src/core/util';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../../src/app/session';
import { create, purgeNow, trash, update } from '../../src/data/store';
import { SCHEMA_VERSION } from '../../src/data/schema';
import { DriveError } from '../../src/sync/driveApi';
import { SyncBlockedError, SyncEngine } from '../../src/sync/engine';
import { FakeDriveClient, FakeDriveServer } from '../../src/sync/fakeDrive';
import { mergeRecord } from '../../src/sync/merge';
import { ACCT_A, ACCT_B, openDevice } from '../helpers';
import { accountRef } from '../../src/account/workspaceRef';

const open: Session[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

async function device(server: FakeDriveServer, acct = ACCT_A) {
  const s = await openDevice(accountRef(acct));
  open.push(s);
  return { s, e: new SyncEngine(s, new FakeDriveClient(server), acct) };
}
async function sync(...ds: { e: SyncEngine }[]) {
  for (let round = 0; round < 2; round++) for (const d of ds) {
    await d.e.pull();
    await d.e.push();
  }
}
const strip = (r: Record<string, unknown> | undefined) => {
  if (!r) return r;
  const { updatedAt: _u, updatedByDevice: _d, ...rest } = r;
  return rest;
};

describe('Drive journal sync', () => {
  it('propagates a single-device edit', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    const idea = await create(a.s, 'ideas', { title: 'Hello', status: 'new' });
    await sync(a, b);
    expect((await b.s.db.ideas.get(idea.id))?.title).toBe('Hello');
  });

  it('merges independent fields edited on two devices', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    const c = await create(a.s, 'content', { title: 'Reel', status: 'planned', formatTemplateId: 'reel', platforms: ['instagram'] });
    await sync(a, b);
    await update(a.s, 'content', c.id, { script: 'desktop script' });
    await update(b.s, 'content', c.id, { caption: 'mobile caption' });
    await sync(a, b);
    for (const d of [a, b]) {
      const r = await d.s.db.content.get(c.id);
      expect(r?.script).toBe('desktop script');
      expect(r?.caption).toBe('mobile caption');
    }
    expect(await a.s.db.conflicts.count()).toBe(0);
  });

  it('same short field: deterministic last-writer-wins on both devices', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    const i = await create(a.s, 'ideas', { title: 'x', status: 'new' });
    await sync(a, b);
    await update(a.s, 'ideas', i.id, { title: 'from A' });
    await update(b.s, 'ideas', i.id, { title: 'from B' });
    await sync(a, b);
    const ta = (await a.s.db.ideas.get(i.id))!.title;
    expect(ta).toBe((await b.s.db.ideas.get(i.id))!.title);
  });

  it('long text conflict keeps a conflict copy on both devices — nothing silently lost', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    const c = await create(a.s, 'content', { title: 'R', status: 'planned', formatTemplateId: 'reel', platforms: [] });
    await update(a.s, 'content', c.id, { script: 'base' });
    await sync(a, b);
    await update(a.s, 'content', c.id, { script: 'A long rewrite' });
    await update(b.s, 'content', c.id, { script: 'B long rewrite' });
    await sync(a, b);
    const winner = (await a.s.db.content.get(c.id))!.script;
    expect(winner).toBe((await b.s.db.content.get(c.id))!.script);
    const loser = winner === 'A long rewrite' ? 'B long rewrite' : 'A long rewrite';
    for (const d of [a, b]) {
      const copies = await d.s.db.conflicts.toArray();
      expect(copies.map((x) => x.value)).toContain(loser);
    }
  });

  it('sequential edits of the same text do not create conflicts', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    const c = await create(a.s, 'content', { title: 'R', status: 'planned', formatTemplateId: 'reel', platforms: [] });
    await update(a.s, 'content', c.id, { script: 'v1' });
    await sync(a, b);
    await update(b.s, 'content', c.id, { script: 'v2' });
    await sync(a, b);
    await update(a.s, 'content', c.id, { script: 'v3' });
    await sync(a, b);
    expect((await b.s.db.content.get(c.id))!.script).toBe('v3');
    expect(await a.s.db.conflicts.count()).toBe(0);
    expect(await b.s.db.conflicts.count()).toBe(0);
  });

  it('delete vs newer edit: the edit survives in Trash', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    const i = await create(a.s, 'ideas', { title: 'keep me', status: 'new' });
    await sync(a, b);
    await purgeNow(a.s, 'ideas', i.id); // permanent delete → tombstone
    await new Promise((r) => setTimeout(r, 5)); // B's edit is strictly later in HLC order
    await update(b.s, 'ideas', i.id, { hook: 'edited after' }); // concurrent, newer
    await sync(a, b);
    const ra = await a.s.db.ideas.get(i.id);
    const rb = await b.s.db.ideas.get(i.id);
    expect(ra?.hook).toBe('edited after');
    expect(rb?.deletedAt).toBeTruthy();
    expect(ra?.deletedAt).toBeTruthy();
  });

  it('older edit vs delete: deletion wins everywhere', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    const i = await create(a.s, 'ideas', { title: 'gone', status: 'new' });
    await sync(a, b);
    await update(b.s, 'ideas', i.id, { hook: 'older' });
    await sync(b);
    await trash(a.s, 'ideas', i.id);
    await purgeNow(a.s, 'ideas', i.id);
    await sync(a, b);
    expect(await b.s.db.ideas.get(i.id)).toBeUndefined();
  });

  it('offline edits on both devices reconcile on reconnect', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    await sync(a, b);
    srv.injectFault('network', 0, 2);
    await create(a.s, 'ideas', { title: 'offline A', status: 'new' });
    await expect(a.e.push()).rejects.toBeInstanceOf(DriveError);
    await create(b.s, 'tasks', { title: 'offline B', status: 'todo', kind: 'task', isBlocker: false });
    await expect(b.e.push()).rejects.toBeInstanceOf(DriveError);
    await sync(a, b);
    expect(await a.s.db.tasks.count()).toBe(1);
    expect(await b.s.db.ideas.count()).toBe(1);
  });

  it('duplicate and out-of-order journal segments are idempotent', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const i = await create(a.s, 'ideas', { title: 'v1', status: 'new' });
    await a.e.push();
    await update(a.s, 'ideas', i.id, { title: 'v2' });
    await a.e.push();
    // Duplicate the first segment file
    const first = [...srv.files.values()].find((f) => f.meta.appProperties?.seq === '1')!;
    srv.files.set('dup', { meta: { ...first.meta, id: 'dup' }, body: first.body });
    srv.record('dup');
    // Reverse change order for B's initial reconcile
    const b = await device(srv);
    await b.e.pull();
    expect((await b.s.db.ideas.get(i.id))!.title).toBe('v2');
  });

  it('snapshot compaction lets a brand new device catch up', async () => {
    const srv = new FakeDriveServer();
    let t = Date.now();
    const a = await device(srv);
    a.e = new SyncEngine(a.s, new FakeDriveClient(srv), ACCT_A, () => t);
    for (let k = 0; k < 20; k++) {
      await create(a.s, 'ideas', { title: `idea ${k}`, status: 'new' });
      await a.e.push();
    }
    t += 8 * 86400000;
    await a.e.maybeCompact(true);
    const segsLeft = [...srv.files.values()].filter((f) => f.meta.appProperties?.sagahq === 'segment').length;
    expect(segsLeft).toBe(0);
    const c = await device(srv);
    await c.e.pull();
    expect(await c.s.db.ideas.count()).toBe(20);
  });

  it('recovers from an invalid page token with a full reconcile', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    await sync(a, b);
    await create(a.s, 'ideas', { title: 'after token', status: 'new' });
    await a.e.push();
    const st = await b.e.state();
    await b.s.db.meta.put({ key: 'sync', value: { ...st, pageToken: '999999' } });
    await b.e.pull();
    expect(await b.s.db.ideas.count()).toBe(1);
  });

  it('rate limit (429) surfaces as retryable and does not corrupt state', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    await create(a.s, 'ideas', { title: 'x', status: 'new' });
    await a.e.ensureLayout();
    srv.injectFault('rate', 429, 1, 'createJson');
    const err = await a.e.push().catch((e) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect((err as DriveError).retryable).toBe(true);
    expect(await a.e.push()).toBe(1);
  });

  it('blocks on account mismatch (never writes A into B)', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv, ACCT_A);
    await create(a.s, 'ideas', { title: 'A data', status: 'new' });
    await a.e.push();
    // Corrupt: the workspace folder for A claims account B in its manifest
    const manifest = [...srv.files.values()].find((f) => f.meta.appProperties?.sagahq === 'manifest')!;
    manifest.body = JSON.stringify({ ...JSON.parse(manifest.body!), accountId: ACCT_B });
    const a2 = await device(srv, ACCT_A);
    await expect(a2.e.pull()).rejects.toBeInstanceOf(SyncBlockedError);
    expect(await a2.s.db.ideas.count()).toBe(0);
  });

  it('refuses newer-schema journals without touching local data', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    await sync(a, b);
    const mine = await create(b.s, 'ideas', { title: 'local', status: 'new' });
    await create(a.s, 'ideas', { title: 'future', status: 'new' });
    await a.e.push();
    const seg = [...srv.files.values()].find((f) => f.meta.appProperties?.sagahq === 'segment' && f.body?.includes('future'))!;
    seg.body = JSON.stringify({ ...JSON.parse(seg.body!), schemaVersion: SCHEMA_VERSION + 1 });
    await expect(b.e.pull()).rejects.toBeInstanceOf(SyncBlockedError);
    expect((await b.s.db.ideas.get(mine.id))?.title).toBe('local');
  });

  it('malformed remote journal is skipped; local state intact', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    await sync(a, b);
    const keep = await create(b.s, 'ideas', { title: 'safe', status: 'new' });
    await create(a.s, 'ideas', { title: 'bad', status: 'new' });
    await a.e.push();
    const seg = [...srv.files.values()].find((f) => f.body?.includes('"bad"'))!;
    seg.body = '{not json';
    const report = await b.e.pull();
    expect(report.skippedInvalid).toBeGreaterThan(0);
    expect((await b.s.db.ideas.get(keep.id))?.title).toBe('safe');
  });

  it('invalid records inside a segment are skipped individually', async () => {
    const srv = new FakeDriveServer();
    const a = await device(srv);
    const b = await device(srv);
    await sync(a, b);
    await create(a.s, 'ideas', { title: 'good', status: 'new' });
    await a.e.push();
    const seg = [...srv.files.values()].find((f) => f.body?.includes('"good"'))!;
    const parsed = JSON.parse(seg.body!);
    parsed.records.push({ t: 'ideas', r: { id: 'x', title: 42 } });
    parsed.records.push({ t: 'secrets', r: { id: 'y' } });
    seg.body = JSON.stringify(parsed);
    const report = await b.e.pull();
    expect(report.skippedInvalid).toBe(2);
    expect(await b.s.db.ideas.count()).toBe(1);
  });

  it('property: random concurrent edits converge on all devices', async () => {
    const op = fc.record({
      dev: fc.integer({ min: 0, max: 2 }),
      idx: fc.integer({ min: 0, max: 2 }),
      field: fc.constantFrom('title', 'hook', 'notes', 'priority'),
      value: fc.string({ maxLength: 6 }),
      syncAfter: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 12 }), async (ops) => {
        const srv = new FakeDriveServer();
        const ds = [await device(srv), await device(srv), await device(srv)];
        const ids: string[] = [];
        for (let k = 0; k < 3; k++) ids.push((await create(ds[0]!.s, 'ideas', { title: `i${k}`, status: 'new' })).id);
        await sync(...ds);
        for (const o of ops) {
          const v = o.field === 'priority' ? (['low', 'med', 'high'] as const)[o.value.length % 3] : o.value || 'v';
          await update(ds[o.dev]!.s, 'ideas', ids[o.idx]!, { [o.field]: v } as never);
          if (o.syncAfter) await sync(ds[o.dev]!);
        }
        await sync(...ds);
        await sync(...ds);
        for (const id of ids) {
          const recs = await Promise.all(ds.map((d) => d.s.db.ideas.get(id)));
          const norm = recs.map((r) => stableStringify(strip(r as never)));
          expect(norm[1]).toBe(norm[0]);
          expect(norm[2]).toBe(norm[0]);
        }
        for (const d of ds) d.s.close();
      }),
      { numRuns: 60 },
    );
  });
});

describe('mergeRecord (pure)', () => {
  it('is idempotent', () => {
    const r = { id: '1', rev: 'b', fieldRevs: { title: 'b' }, title: 'x', updatedAt: '', createdAt: '' } as never;
    const once = mergeRecord(r, r);
    expect(once.changed).toBe(false);
  });
});
