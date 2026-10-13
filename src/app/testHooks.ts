import { ulid } from '../core/ulid';
import { SCHEMA_VERSION } from '../data/schema';
import { currentSession } from './session';

/**
 * E2E-only hooks (included only when VITE_E2E_MOCKS=1; the production build never imports this file).
 * Seeds large synthetic datasets directly so performance can be measured realistically.
 */
export function installTestHooks(): void {
  (window as unknown as { __sagaTest: unknown }).__sagaTest = {
    async seed(n: { projects: number; ideas: number; content: number; secondary: number }) {
      const s = currentSession();
      const now = Date.now();
      const base = () => ({
        workspaceId: s.workspaceId,
        schemaVersion: SCHEMA_VERSION,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        updatedByDevice: s.deviceId,
        rev: s.hlc.now(),
        fieldRevs: {},
      });
      const projects = Array.from({ length: n.projects }, (_, i) => ({
        ...base(),
        id: ulid(),
        name: `Project ${i}`,
        status: 'active',
        isFocus: i < 3,
        color: 1,
      }));
      await s.db.projects.bulkPut(projects as never);
      const statuses = ['planned', 'producing', 'ready', 'scheduled', 'published', 'reviewed'];
      const ideas = Array.from({ length: n.ideas }, (_, i) => ({
        ...base(),
        id: ulid(),
        title: `Idea ${i} ${i % 9 === 0 ? 'halloween' : 'gta'}`,
        status: i % 5 === 0 ? 'shortlisted' : 'new',
        projectId: projects[i % projects.length]?.id ?? null,
      }));
      await s.db.ideas.bulkPut(ideas as never);
      const content = Array.from({ length: n.content }, (_, i) => ({
        ...base(),
        id: ulid(),
        title: `Content ${i} ${i % 7 === 0 ? 'heist' : 'parody'}`,
        status: statuses[i % 6],
        formatTemplateId: 'reel',
        platforms: ['instagram'],
        projectId: projects[i % projects.length]?.id ?? null,
        script: 'lorem ipsum '.repeat(20),
        _readyPct: (i % 10) / 10,
        _missing: ['cover'],
        _blocked: i % 50 === 0 ? 1 : 0,
        _nextPublishAt: i % 6 === 3 ? new Date(now + (i % 14) * 86400000).toISOString() : null,
      }));
      for (let i = 0; i < content.length; i += 2000)
        await s.db.content.bulkPut(content.slice(i, i + 2000) as never);
      const per = Math.floor(n.secondary / 4);
      const tasks = Array.from({ length: per }, (_, i) => ({
        ...base(),
        id: ulid(),
        title: `Task ${i}`,
        status: i % 3 === 0 ? 'done' : 'todo',
        kind: 'task',
        isBlocker: i % 40 === 0,
        contentId: content[i % content.length]?.id ?? null,
        dueAt: i % 5 === 0 ? new Date(now + ((i % 20) - 10) * 86400000).toISOString() : null,
      }));
      const library = Array.from({ length: per }, (_, i) => ({
        ...base(),
        id: ulid(),
        title: `Reference ${i} ${i % 11 === 0 ? 'old man watching tv in a bar' : 'style'}`,
        role: 'reference',
        kind: 'link',
        originalUrl: `https://example.com/${i}`,
      }));
      const events = Array.from({ length: per }, (_, i) => ({
        ...base(),
        id: ulid(),
        title: `Block ${i}`,
        kind: 'production_block',
        startAt: new Date(now + ((i % 60) - 30) * 86400000).toISOString(),
        allDay: false,
      }));
      const pubs = Array.from({ length: per }, (_, i) => ({
        ...base(),
        id: ulid(),
        contentId: content[i % content.length]!.id,
        platform: 'instagram',
        status: i % 2 ? 'published' : 'scheduled',
        scheduledAt: new Date(now + ((i % 30) - 15) * 86400000).toISOString(),
        publishedAt: i % 2 ? new Date(now - (i % 30) * 86400000).toISOString() : null,
      }));
      for (const [t, rows] of [
        ['tasks', tasks],
        ['library', library],
        ['events', events],
        ['publications', pubs],
      ] as const)
        for (let i = 0; i < rows.length; i += 2000) await s.db.table(t).bulkPut(rows.slice(i, i + 2000));
      return { projects: projects.length, ideas: ideas.length, content: content.length, secondary: per * 4 };
    },
  };
}
