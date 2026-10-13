import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../../src/app/session';
import { create, mutate, purgeExpired, restore, trash, undoLast, update } from '../../src/data/store';
import { openDevice } from '../helpers';

let s: Session;
afterEach(() => s?.close());

describe('command layer', () => {
  it('stamps per-field HLC revisions and keeps previous revisions', async () => {
    s = await openDevice();
    const idea = await create(s, 'ideas', { title: 'A', status: 'new' });
    expect(idea.fieldRevs.title).toBe(idea.rev);
    const up = await update(s, 'ideas', idea.id, { hook: 'h' });
    expect(up!.fieldRevs.hook! > idea.rev).toBe(true);
    expect(up!.fieldRevs.title).toBe(idea.rev);
    const up2 = await update(s, 'ideas', idea.id, { hook: 'h2' });
    expect(up2!.fieldPrev!.hook).toBe(up!.fieldRevs.hook);
  });

  it('no-op updates do not bump revisions', async () => {
    s = await openDevice();
    const idea = await create(s, 'ideas', { title: 'A', status: 'new' });
    const same = await update(s, 'ideas', idea.id, { title: 'A' });
    expect(same!.rev).toBe(idea.rev);
  });

  it('rejects invalid records and does not persist them', async () => {
    s = await openDevice();
    await expect(create(s, 'tasks', { title: '', status: 'todo', kind: 'task', isBlocker: false } as never)).rejects.toThrow();
    expect(await s.db.tasks.count()).toBe(0);
  });

  it('undo reverts the last user change; coalesces rapid text edits', async () => {
    s = await openDevice();
    const idea = await create(s, 'ideas', { title: 'A', status: 'new' });
    await update(s, 'ideas', idea.id, { hook: 'x' }, { coalesceKey: 'k' });
    await update(s, 'ideas', idea.id, { hook: 'xy' }, { coalesceKey: 'k' });
    await update(s, 'ideas', idea.id, { hook: 'xyz' }, { coalesceKey: 'k' });
    await undoLast(s);
    expect((await s.db.ideas.get(idea.id))!.hook).toBeNull();
  });

  it('trash cascades content children and restore brings them back', async () => {
    s = await openDevice();
    const c = await create(s, 'content', { title: 'C', status: 'planned', formatTemplateId: 'reel', platforms: ['instagram'] });
    const t = await create(s, 'tasks', { title: 'T', status: 'todo', kind: 'task', isBlocker: true, contentId: c.id });
    expect((await s.db.content.get(c.id))!._blocked).toBe(1);
    await trash(s, 'content', c.id);
    expect((await s.db.tasks.get(t.id))!.deletedAt).toBeTruthy();
    await restore(s, 'content', c.id);
    expect((await s.db.tasks.get(t.id))!.deletedAt).toBeNull();
    expect((await s.db.content.get(c.id))!.deletedAt).toBeNull();
  });

  it('purges trash after 30 days into tombstones', async () => {
    s = await openDevice();
    const i = await create(s, 'ideas', { title: 'A', status: 'new' });
    await trash(s, 'ideas', i.id);
    expect(await purgeExpired(s, Date.now() + 31 * 86400000)).toBe(1);
    expect(await s.db.ideas.get(i.id)).toBeUndefined();
    expect(await s.db.tombstones.get(i.id)).toBeTruthy();
  });

  it('a closed session refuses writes (cross-account safety)', async () => {
    s = await openDevice();
    s.close();
    await expect(create(s, 'ideas', { title: 'late', status: 'new' })).rejects.toThrow(/closed/i);
  });

  it('derived readiness follows content edits', async () => {
    s = await openDevice();
    const c = await create(s, 'content', { title: 'C', status: 'planned', formatTemplateId: 'reel', platforms: ['instagram'] });
    expect((await s.db.content.get(c.id))!._missing).toContain('cover');
    await mutate(s, { label: 'x' }, async (m) => {
      await m.update('content', c.id, { hook: 'h', script: 's', finalExportUrl: 'https://e', coverUrl: 'https://c', caption: 'cap' });
      await m.create('publications', { contentId: c.id, platform: 'instagram', status: 'scheduled', scheduledAt: '2030-01-01T10:00:00Z' });
    });
    const d = (await s.db.content.get(c.id))!;
    expect(d._missing).toEqual([]);
    expect(d._readyPct).toBe(1);
    expect(d._nextPublishAt).toBe('2030-01-01T10:00:00Z');
  });
});
