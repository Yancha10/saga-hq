import { describe, expect, it } from 'vitest';
import { parseUrl } from '../../src/core/url';
import type { Content, Publication, Snapshot, Task, Workspace } from '../../src/data/schema';
import { findOutliers, snapCheckpoint } from '../../src/rules/analytics';
import { cadenceGaps } from '../../src/rules/cadence';
import { scoreCandidates } from '../../src/rules/priority';
import { buildToday } from '../../src/rules/today';
import { SearchCore, parseQuery, toDoc } from '../../src/search/core';

const base = { workspaceId: 'w', schemaVersion: 1, updatedByDevice: 'd', rev: 'r', fieldRevs: {}, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
const NOW = Date.parse('2026-10-13T09:00:00');
const content = (o: Partial<Content>): Content => ({ ...base, id: 'c', title: 'Reel', status: 'producing', formatTemplateId: 'reel', platforms: ['instagram'], ...o }) as Content;
const task = (o: Partial<Task>): Task => ({ ...base, id: 't', title: 'Task', status: 'todo', kind: 'task', isBlocker: false, ...o }) as Task;

describe('priority engine', () => {
  it('ranks publishing-today-with-missing-items first and explains why', () => {
    const c = scoreCandidates({
      now: NOW,
      projects: [],
      content: [
        content({ id: 'a', title: 'Later', _nextPublishAt: '2026-10-20T10:00:00Z', _missing: ['cover'] }),
        content({ id: 'b', title: 'Today', _nextPublishAt: new Date(NOW + 6 * 3600e3).toISOString(), _missing: ['cover', 'caption'] }),
      ],
      tasks: [task({ id: 'x', title: 'Overdue', dueAt: '2026-10-10T10:00:00Z' })],
    });
    expect(c[0]!.title).toBe('Today');
    expect(c[0]!.reasons.join(' ')).toMatch(/publishes/);
    expect(c.find((x) => x.title === 'Overdue')!.reasons).toContain('overdue');
  });
  it('blocked items are demoted and flagged', () => {
    const c = scoreCandidates({ now: NOW, projects: [], tasks: [], content: [content({ id: 'a', priority: 'high', _blocked: 1 })] });
    expect(c[0]!.blocked).toBe(true);
    expect(c[0]!.reasons).toContain('blocked');
  });
});

describe('Today model', () => {
  it('never auto-pins focus; detects nearly finished content missing a cover', () => {
    const t = buildToday({
      now: NOW,
      workspace: { focus: [], cadence: [] } as unknown as Workspace,
      tasks: [],
      projects: [],
      snapshots: [],
      events: [],
      captures: [],
      ideas: [],
      content: [content({ id: 'a', title: 'Almost', _missing: ['cover'], _nextPublishAt: new Date(NOW + 3600e3 * 20).toISOString() })],
      publications: [{ ...base, id: 'p', contentId: 'a', platform: 'instagram', status: 'scheduled', scheduledAt: new Date(NOW + 3600e3 * 20).toISOString() } as Publication],
    });
    expect(t.focus.pinned).toHaveLength(0);
    expect(t.focus.suggested.length).toBeGreaterThan(0);
    expect(t.attention.some((a) => a.kind === 'missing' && a.detail.includes('cover'))).toBe(true);
    expect(t.quickWins[0]?.reasons.join()).toMatch(/only cover missing/);
  });
});

describe('cadence', () => {
  it('reports gaps against weekly targets without scheduling anything', () => {
    const gaps = cadenceGaps({ cadence: [{ platform: 'instagram', perWeek: 4, preferredDays: [4] }] } as unknown as Workspace, [], NOW);
    expect(gaps.some((g) => g.message.includes('0/4'))).toBe(true);
    expect(gaps.some((g) => g.day)).toBe(true);
  });
});

describe('analytics', () => {
  it('snaps checkpoints and finds outliers only with n ≥ 5', () => {
    expect(snapCheckpoint(25)).toBe('24h');
    expect(snapCheckpoint(50)).toBeNull();
    const pubs: Publication[] = [];
    const snaps: Snapshot[] = [];
    const cmap = new Map<string, Content>();
    for (let i = 0; i < 7; i++) {
      pubs.push({ ...base, id: `p${i}`, contentId: `c${i}`, platform: 'tiktok', status: 'published' } as Publication);
      snaps.push({ ...base, id: `s${i}`, publicationId: `p${i}`, contentId: `c${i}`, platform: 'tiktok', observedAt: '', ageHours: 24, checkpoint: '24h', source: 'manual', metrics: { views: i === 6 ? 10000 : 1000 } } as Snapshot);
      cmap.set(`c${i}`, content({ id: `c${i}` }));
    }
    const o = findOutliers(pubs, snaps, cmap);
    expect(o[0]?.publicationId).toBe('p6');
    expect(o[0]!.ratio).toBe(10);
    expect(findOutliers(pubs.slice(0, 4), snaps, cmap)).toHaveLength(0);
  });
});

describe('URL parsing (local only)', () => {
  it('extracts platform ids, strips tracking, keeps the raw URL', () => {
    const y = parseUrl('https://youtu.be/dQw4w9WgXcQ?si=abc')!;
    expect(y.platform).toBe('youtube');
    expect(y.externalId).toBe('dQw4w9WgXcQ');
    expect(y.canonical).not.toContain('si=');
    expect(y.original).toBe('https://youtu.be/dQw4w9WgXcQ?si=abc');
    expect(parseUrl('https://www.tiktok.com/@saga/video/7300000000000000000')!.externalId).toBe('7300000000000000000');
    expect(parseUrl('https://instagram.com/reel/ABC123/')!.kind).toBe('video');
    expect(parseUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('search core', () => {
  it('finds by keyword with filters and prefix', () => {
    const core = new SearchCore();
    core.addAll([
      toDoc('library', { ...base, id: 'r1', title: 'Old man watching TV in a bar', role: 'reference', kind: 'image' })!,
      toDoc('ideas', { ...base, id: 'i1', title: 'GTA heist cold open', status: 'new' })!,
      toDoc('ideas', { ...base, id: 'i2', title: 'Archived idea about bars', status: 'parked', archivedAt: 'x' })!,
    ]);
    expect(core.search('old man bar')[0]?.id).toBe('r1');
    expect(core.search('hei type:idea')[0]?.id).toBe('i1');
    expect(core.search('bars').map((h) => h.id)).not.toContain('i2');
    expect(core.search('bars is:archived').map((h) => h.id)).toContain('i2');
    expect(parseQuery('foo type:research').type).toBe('library');
  });
  it('stays interactive at scale (benchmark)', () => {
    const core = new SearchCore();
    const docs = Array.from({ length: 20000 }, (_, i) => toDoc('content', { ...base, id: `c${i}`, title: `Content ${i} ${i % 7 === 0 ? 'halloween' : 'gta'}`, script: `script body ${i} lorem ipsum`, status: 'planned' })!);
    const t0 = performance.now();
    core.addAll(docs);
    const build = performance.now() - t0;
    const t1 = performance.now();
    const hits = core.search('hallow');
    const q = performance.now() - t1;
    expect(hits.length).toBeGreaterThan(0);
    console.log(`[bench] search index 20k docs: build ${build.toFixed(0)}ms, query ${q.toFixed(1)}ms`);
    expect(q).toBeLessThan(200);
  });
});
