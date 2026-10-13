import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../../src/app/session';
import { banners } from '../../src/app/status';
import { create } from '../../src/data/store';
import { FakeDriveClient, FakeDriveServer } from '../../src/sync/fakeDrive';
import { SyncRunner, syncStatus } from '../../src/sync/runner';
import { openDevice } from '../helpers';

let s: Session;
afterEach(() => {
  s?.close();
  banners.set([]);
});
const tick = () => new Promise((r) => setTimeout(r, 120));

describe('sync runner state machine', () => {
  it('syncs, then pauses on auth errors (local data untouched) and surfaces quota problems', async () => {
    s = await openDevice();
    const srv = new FakeDriveServer();
    const r = new SyncRunner(s, new FakeDriveClient(srv), s.workspaceId);
    await create(s, 'ideas', { title: 'x', status: 'new' });
    r.start();
    await tick();
    expect(syncStatus.get().phase).toBe('idle');
    expect([...srv.files.values()].some((f) => f.meta.appProperties?.sagahq === 'segment')).toBe(true);

    srv.injectFault('auth', 401, 1);
    r.kick();
    await tick();
    expect(syncStatus.get().phase).toBe('needs_auth');
    expect(await s.db.ideas.count()).toBe(1);

    srv.injectFault('quota', 403, 1, 'createJson');
    await create(s, 'ideas', { title: 'y', status: 'new' });
    r.kick();
    await tick();
    expect(banners.get().some((b) => b.msgKey === 'sync.banner.DRIVE_FULL')).toBe(true);
    r.stop();
  });

  it('rate limits back off instead of hammering Drive', async () => {
    s = await openDevice();
    const srv = new FakeDriveServer();
    const r = new SyncRunner(s, new FakeDriveClient(srv), s.workspaceId);
    srv.injectFault('rate', 429, 3);
    r.start();
    await tick();
    const before = srv.calls.length;
    await tick();
    await tick();
    expect(srv.calls.length - before).toBeLessThanOrEqual(1); // no tight retry loop
    expect(syncStatus.get().phase).toBe('error');
    r.stop();
  });
});
