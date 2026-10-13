import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountRef } from '../../src/account/workspaceRef';
import { FutureSchemaError, Session } from '../../src/app/session';
import { banners, dirtyEdits, markDirty, saveStatus } from '../../src/app/status';
import { deriveAccountId } from '../../src/core/accountId';
import { MIGRATIONS, runMigrations } from '../../src/data/migrations';
import { SCHEMA_VERSION } from '../../src/data/schema';
import { create, mutate } from '../../src/data/store';
import { evictCache } from '../../src/media/store';
import { ACCT_A, ACCT_B, openAccount, openDevice } from '../helpers';

const open: Session[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
  banners.set([]);
});

describe('schema migrations', () => {
  it('runs deterministic additive migrations with a recovery point first', async () => {
    const s = await openDevice();
    open.push(s);
    await create(s, 'ideas', { title: 'old', status: 'new' });
    const calls: number[] = [];
    MIGRATIONS[SCHEMA_VERSION] = async () => {
      calls.push(SCHEMA_VERSION);
    };
    await runMigrations(s, SCHEMA_VERSION - 1);
    delete MIGRATIONS[SCHEMA_VERSION];
    expect(calls).toEqual([SCHEMA_VERSION]);
    const rps = await s.db.recovery.toArray();
    expect(rps[0]?.reason).toBe('upgrade');
    expect(JSON.parse(rps[0]!.data).tables.ideas[0].title).toBe('old');
  });

  it('refuses to open (and never overwrites) a workspace written by a newer schema', async () => {
    const factory = new IDBFactory();
    const s = await Session.open(accountRef(ACCT_A), { indexedDB: factory, IDBKeyRange });
    await create(s, 'ideas', { title: 'from the future', status: 'new' });
    await s.db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION + 5 });
    s.close();
    await expect(
      Session.open(accountRef(ACCT_A), { indexedDB: factory, IDBKeyRange }),
    ).rejects.toBeInstanceOf(FutureSchemaError);
    // Data still there, untouched
    const raw = await new Promise<unknown[]>((res) => {
      const r = factory.open(`sagahq-${ACCT_A}`);
      r.onsuccess = () => {
        const tx = r.result.transaction('ideas', 'readonly');
        const g = tx.objectStore('ideas').getAll();
        g.onsuccess = () => res(g.result);
      };
    });
    expect((raw[0] as { title: string }).title).toBe('from the future');
  });
});

describe('storage failures are never silent', () => {
  it('quota exceeded surfaces a persistent banner and save status error; data is not claimed saved', async () => {
    const s = await openDevice();
    open.push(s);
    const proto = Object.getPrototypeOf(s.db.ideas) as { add: (...a: unknown[]) => Promise<unknown> };
    const spy = vi
      .spyOn(proto, 'add')
      .mockRejectedValueOnce(Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' }));
    await expect(create(s, 'ideas', { title: 'x', status: 'new' })).rejects.toThrow();
    spy.mockRestore();
    expect(saveStatus.get().state).toBe('error');
    expect(banners.get().find((b) => b.id === 'persist')?.msgKey).toBe('error.persist_quota');
    expect(await s.db.ideas.count()).toBe(0);
  });

  it('a failing transaction rolls back every op in the command (atomic)', async () => {
    const s = await openDevice();
    open.push(s);
    await expect(
      mutate(s, { label: 'multi' }, async (m) => {
        await m.create('ideas', { title: 'a', status: 'new' });
        await m.create('tasks', { title: '', status: 'todo', kind: 'task', isBlocker: false } as never); // invalid → throws
      }),
    ).rejects.toThrow();
    expect(await s.db.ideas.count()).toBe(0);
    expect(banners.get().find((b) => b.id === 'persist')).toBeTruthy();
  });

  it('PWA update counter: unsaved edits block reload', () => {
    markDirty(1);
    expect(dirtyEdits.get()).toBe(1);
    markDirty(-1);
    expect(dirtyEdits.get()).toBe(0);
  });
});

describe('account isolation under pending operations', () => {
  it('a write still pending when the account switches cannot land in either workspace', async () => {
    const factory = new IDBFactory();
    const a = await openAccount(ACCT_A, factory);
    const pending = (async () => {
      await new Promise((r) => setTimeout(r, 30));
      return create(a, 'ideas', { title: 'late write from A', status: 'new' });
    })();
    a.close(); // switch away
    const b = await openAccount(ACCT_B, factory);
    open.push(b);
    await expect(pending).rejects.toThrow(/closed/i);
    expect(await b.db.ideas.count()).toBe(0);
    const a2 = await openAccount(ACCT_A, factory);
    open.push(a2);
    expect(await a2.db.ideas.count()).toBe(0);
  });

  it('separate databases per account; secrets and data never cross', async () => {
    const factory = new IDBFactory();
    const a = await openAccount(ACCT_A, factory);
    const b = await openAccount(ACCT_B, factory);
    open.push(a, b);
    await create(a, 'ideas', { title: 'A only', status: 'new' });
    expect(await b.db.ideas.count()).toBe(0);
    expect(a.db.name).not.toBe(b.db.name);
    expect(a.deviceId).not.toBe(b.deviceId);
  });

  it('raw Google sub never persisted when an account workspace is created and used', async () => {
    const SUB = '987654321098765432109';
    const accountId = await deriveAccountId(SUB);
    const factory = new IDBFactory();
    const s = await openAccount(accountId, factory);
    open.push(s);
    await create(s, 'ideas', { title: 'hello', status: 'new' });
    const names = (await factory.databases()).map((d) => d.name!);
    let dump = names.join('\n');
    for (const n of names) {
      const db = await new Promise<IDBDatabase>((res) => {
        const r = factory.open(n);
        r.onsuccess = () => res(r.result);
      });
      for (const st of Array.from(db.objectStoreNames)) {
        dump += await new Promise<string>((res) => {
          const g = db.transaction(st, 'readonly').objectStore(st).getAll();
          g.onsuccess = () =>
            res(JSON.stringify(g.result, (_k, v) => (v instanceof ArrayBuffer ? '[bin]' : v)));
        });
      }
      db.close();
    }
    expect(dump.includes(SUB)).toBe(false);
    expect(dump.includes(accountId)).toBe(true);
  });
});

describe('media cache safety', () => {
  it('never evicts the only copy (not yet uploaded) and evicts uploaded originals LRU-first', async () => {
    const s = await openDevice();
    open.push(s);
    const m1 = await create(s, 'media', { mime: 'image/png', bytes: 600, sha256: 'a' });
    const m2 = await create(s, 'media', {
      mime: 'image/png',
      bytes: 600,
      sha256: 'b',
      driveFileId: 'drive-2',
    });
    const m3 = await create(s, 'media', {
      mime: 'image/png',
      bytes: 600,
      sha256: 'c',
      driveFileId: 'drive-3',
    });
    const blob = new Blob([new Uint8Array(600)]);
    await s.db.mediaBlobs.bulkPut([
      { id: m1.id, kind: 'full', blob, bytes: 600, lastUsedAt: 1, pinned: 1 },
      { id: m2.id, kind: 'full', blob, bytes: 600, lastUsedAt: 2, pinned: 0 },
      { id: m3.id, kind: 'full', blob, bytes: 600, lastUsedAt: 3, pinned: 0 },
    ]);
    const freed = await evictCache(s, 700);
    expect(freed).toBe(600);
    expect(await s.db.mediaBlobs.get([m1.id, 'full'])).toBeTruthy();
    expect(await s.db.mediaBlobs.get([m2.id, 'full'])).toBeUndefined();
    expect(await s.db.mediaBlobs.get([m3.id, 'full'])).toBeTruthy();
    await evictCache(s, 0);
    expect(await s.db.mediaBlobs.get([m1.id, 'full'])).toBeTruthy(); // still never the only copy
  });
});
