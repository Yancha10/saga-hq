import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../../src/app/session';
import { capture, editContent, flagBlocked, ideaToContent, logSnapshot, markPublished, schedulePublication, togglePin, triage } from '../../src/data/domain';
import { create } from '../../src/data/store';
import { openDevice } from '../helpers';

let s: Session;
afterEach(() => s?.close());

describe('domain flows', () => {
  it('capture suggests without classifying; triage keeps the raw capture as provenance', async () => {
    s = await openDevice();
    const c = await capture(s, { text: 'https://youtu.be/dQw4w9WgXcQ', mode: 'text' });
    expect(c.status).toBe('inbox');
    expect(c.suggestion?.type).toBe('library');
    const t = await capture(s, { text: 'Buy a new mic', mode: 'text' });
    expect(t.suggestion?.type).toBe('task');
    const ref = await triage(s, c, 'research');
    const lib = await s.db.library.get(ref.id);
    expect(lib?.originalUrl).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(lib?.platformRef?.externalId).toBe('dQw4w9WgXcQ');
    expect(lib?.origin?.captureId).toBe(c.id);
    const after = await s.db.captures.get(c.id);
    expect(after?.status).toBe('triaged');
    expect(after?.text).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('idea → content carries hook/concept/references and keeps the idea', async () => {
    s = await openDevice();
    const idea = await create(s, 'ideas', { title: 'Heist', hook: 'Cold open', concept: 'A bank', status: 'shortlisted', cast: ['Old man'] });
    const lib = await create(s, 'library', { title: 'ref', role: 'reference', kind: 'image' });
    await create(s, 'links', { fromType: 'idea', fromId: idea.id, toType: 'library', toId: lib.id, type: 'references' });
    const c = await ideaToContent(s, idea, { formatTemplateId: 'reel', platforms: ['tiktok'] });
    expect(c.hook).toBe('Cold open');
    expect(c.attributes?.cast).toEqual(['Old man']);
    expect((await s.db.ideas.get(idea.id))?.status).toBe('committed');
    expect((await s.db.links.where('fromId').equals(c.id).toArray()).map((l) => l.toId)).toContain(lib.id);
  });

  it('content lifecycle: planned → producing (auto) → scheduled → published → reviewed (7d results)', async () => {
    s = await openDevice();
    let c = await create(s, 'content', { title: 'R', status: 'planned', formatTemplateId: 'reel', platforms: ['instagram'] });
    const r = await editContent(s, c, { script: 'x' });
    expect(r.autoProducing).toBe(true);
    c = (await s.db.content.get(c.id))!;
    expect(c.status).toBe('producing');
    await schedulePublication(s, c, 'instagram', new Date(Date.now() + 3600e3).toISOString());
    c = (await s.db.content.get(c.id))!;
    expect(c.status).toBe('scheduled');
    const pub = (await s.db.publications.where('contentId').equals(c.id).toArray())[0]!;
    await markPublished(s, c, pub, 'https://www.instagram.com/reel/XYZ/', new Date(Date.now() - 7 * 86400e3).toISOString());
    expect((await s.db.content.get(c.id))?.status).toBe('published');
    const pub2 = (await s.db.publications.get(pub.id))!;
    expect(pub2.externalId).toBe('XYZ');
    await logSnapshot(s, pub2, { views: 1000 });
    const snap = (await s.db.snapshots.toArray())[0]!;
    expect(snap.checkpoint).toBe('7d');
    expect((await s.db.content.get(c.id))?.status).toBe('reviewed');
  });

  it('blockers are tasks; focus holds at most 3', async () => {
    s = await openDevice();
    const c = await create(s, 'content', { title: 'R', status: 'producing', formatTemplateId: 'reel', platforms: [] });
    await flagBlocked(s, c, 'Waiting for voice');
    expect((await s.db.content.get(c.id))?._blocked).toBe(1);
    for (let i = 0; i < 3; i++) expect(await togglePin(s, { entity: 'task', id: `t${i}` })).toBe('pinned');
    expect(await togglePin(s, { entity: 'task', id: 't9' })).toBe('full');
    expect(await togglePin(s, { entity: 'task', id: 't0' })).toBe('unpinned');
  });
});
