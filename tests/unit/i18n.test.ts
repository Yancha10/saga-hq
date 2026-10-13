import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPrompt } from '../../src/ai/prompts';
import type { Session } from '../../src/app/session';
import { capture, ideaToContent, setContentStatus, suggestFor } from '../../src/data/domain';
import {
  CONTENT_STATUSES,
  LIBRARY_KINDS,
  PLATFORMS,
  READINESS_KEYS,
  SHEET_SECTIONS,
  SYNC_TABLES,
} from '../../src/data/schema';
import { serializeWorkspace } from '../../src/data/serialize';
import { create } from '../../src/data/store';
import { detectLocale, fmt, getLocale, LOCALES, parseNum, setLocale, t, translate } from '../../src/i18n';
import { en } from '../../src/i18n/en';
import { es } from '../../src/i18n/es';
import { factText, gapText, historyLabel, reasonText } from '../../src/i18n/render';
import { parseQuery } from '../../src/search/core';
import { openDevice } from '../helpers';

const ROOT = join(__dirname, '../..');
const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
const SOURCES = walk(join(ROOT, 'src')).filter((f) => !f.includes(`${join('src', 'i18n')}`));
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const has = (k: string) => k in EN || `${k}_other` in EN;

describe('dictionaries', () => {
  it('Spanish and English have exactly the same keys and no empty values', () => {
    expect(Object.keys(ES).sort()).toEqual(Object.keys(EN).sort());
    for (const [k, v] of Object.entries(ES)) expect(v.trim(), `es:${k}`).not.toBe('');
    for (const [k, v] of Object.entries(EN)) expect(v.trim(), `en:${k}`).not.toBe('');
  });

  it('placeholders match between languages', () => {
    for (const k of Object.keys(EN)) expect(params(ES[k]!), k).toEqual(params(EN[k]!));
  });

  it('every plural has both _one and _other', () => {
    for (const k of Object.keys(EN)) {
      if (k.endsWith('_one')) expect(EN[`${k.slice(0, -4)}_other`], k).toBeDefined();
      if (k.endsWith('_other')) expect(EN[`${k.slice(0, -6)}_one`], k).toBeDefined();
    }
  });

  it('every literal key used in the source exists (no raw key can reach the UI)', () => {
    const missing: string[] = [];
    const re = /\b(?:t|tr|translate\([^,]+,)\(\s*'([a-z][\w]*(?:\.[\w]+)+)'/g;
    const re2 = /\b(?:t|tr)\('([a-z][\w]*(?:\.[\w]+)+)'/g;
    const re3 = /(?:labelKey|msgKey|label)[:=]\s*["']((?:h|sync|error|common|sheet)\.[\w.]+)["']/g;
    for (const f of SOURCES) {
      const src = readFileSync(f, 'utf8');
      for (const r of [re, re2, re3])
        for (const m of src.matchAll(r)) if (!has(m[1]!)) missing.push(`${f.replace(ROOT, '')}: ${m[1]}`);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('dynamic key families are complete for every neutral enum value', () => {
    const fam = (prefix: string, values: readonly string[]) =>
      values.filter((v) => !has(`${prefix}.${v}`)).map((v) => `${prefix}.${v}`);
    expect([
      ...fam('platform', PLATFORMS),
      ...fam('content.status', CONTENT_STATUSES),
      ...fam('section', SHEET_SECTIONS),
      ...fam('missing', READINESS_KEYS),
      ...fam('library.kind', LIBRARY_KINDS),
      ...fam('library.role', ['inspiration', 'reference', 'asset']),
      ...fam('entity', SYNC_TABLES),
      ...fam(
        'count',
        SYNC_TABLES.filter((x) => x !== 'workspace'),
      ),
      ...fam('idea.status', ['new', 'shortlisted', 'committed', 'parked']),
      ...fam('task.status', ['todo', 'doing', 'done']),
      ...fam('project.status', ['active', 'paused', 'done']),
      ...fam('event.kind', ['production_block', 'milestone', 'deadline', 'external']),
      ...fam('learning.kind', ['observation', 'hypothesis', 'conclusion']),
      ...fam('learning.confidence', ['low', 'medium', 'high']),
      ...fam('capture.mode', ['text', 'voice', 'photo', 'video', 'file', 'link', 'task']),
      ...fam('capture.reason', ['link', 'image', 'task_like', 'free_text', 'captured_task']),
      ...fam('triage', ['idea', 'task', 'research', 'reference', 'asset', 'content', 'note']),
      ...fam('hook', ['question', 'dialogue', 'cold_open', 'reveal', 'text', 'other']),
      ...fam('shot.status', ['todo', 'generating', 'selected', 'final']),
      ...fam('sync.phase', ['off', 'idle', 'syncing', 'offline', 'needs_auth', 'blocked', 'error']),
      ...fam('sync.code', [
        'SYNC_NEEDS_AUTH',
        'SYNC_OTHER_TAB',
        'SYNC_BLOCKED_ACCOUNT',
        'SYNC_BLOCKED_SCHEMA',
        'SYNC_BLOCKED_OTHER',
        'DRIVE_BUSY',
        'DRIVE_ERROR',
        'SYNC_FAILED',
      ]),
      ...fam('auth.error', [
        'AUTH_LOAD_FAILED',
        'AUTH_NOT_CONFIGURED',
        'AUTH_CANCELLED',
        'AUTH_IDENTITY_FAILED',
        'AUTH_ACCOUNT_MISMATCH',
        'AUTH_MOCK_UNAVAILABLE',
      ]),
      ...fam('ai.error', ['auth', 'rate', 'refusal', 'network', 'config', 'other']),
      ...fam('drive.error', ['auth', 'rate', 'quota', 'server', 'notFound', 'network', 'badToken', 'other']),
      ...fam('ai.action', [
        'createTask',
        'createIdea',
        'createContent',
        'changeStatus',
        'scheduleEvent',
        'linkReference',
        'saveLearning',
      ]),
      ...fam('secretary.intent', ['brief', 'ask', 'producer', 'creative', 'planner', 'analyst', 'librarian']),
      ...fam('recovery.reason', [
        'import_local',
        'upgrade',
        'restore_point',
        'restore_backup',
        'merge_backup',
        'sync_merge',
      ]),
      ...fam('backup.error', ['BACKUP_NOT_JSON', 'BACKUP_NOT_SAGA', 'BACKUP_NEWER', 'BACKUP_CHECKSUM']),
      ...fam('fact', [
        'pub_today',
        'blocked',
        'overdue',
        'late',
        'ready',
        'results',
        'gaps',
        'inbox',
        'decisions',
      ]),
      ...fam('reason', [
        'late',
        'publishes_at',
        'within24',
        'within48',
        'only_missing',
        'missing_list',
        'ready_unscheduled',
        'high_priority',
        'focus_project',
        'blocked',
        'overdue',
        'deadline_missed',
        'due_today',
        'deadline_today',
        'due_soon',
        'needs_decision',
        'unblocks',
        'in_progress',
        'quick',
        'waiting_long',
      ]),
      ...fam('metric', [
        'views',
        'likes',
        'comments',
        'shares',
        'saves',
        'avgWatchSec',
        'retentionPct',
        'followers',
        'profileVisits',
        'reach',
      ]),
      ...fam('settings.sec', [
        'workspace',
        'language',
        'account',
        'storage',
        'backup',
        'recovery',
        'ai',
        'integrations',
        'trash',
        'diagnostics',
        'shortcuts',
        'about',
      ]),
    ]).toEqual([]);
  });
});

describe('hardcoded-string audit', () => {
  it('no user-facing English literals in TSX (text nodes, a11y/label props, toasts, dialogs)', () => {
    const ALLOW = new Set(['Saga HQ', 'Saga Studio', 'ChatGPT', 'Claude', 'S', 'https://…']);
    const findings: string[] = [];
    for (const f of SOURCES.filter((x) => x.endsWith('.tsx'))) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const s = line.trim();
          if (/^(\/\/|\*|\/\*)/.test(s)) return;
          const at = `${f.replace(ROOT, '')}:${i + 1}`;
          for (const m of line.matchAll(
            /(aria-label|ariaLabel|title|placeholder|label|alt|confirmLabel|body|sub)="([^"{]*[A-Za-z]{2,}[^"]*)"/g,
          ))
            if (!ALLOW.has(m[2]!)) findings.push(`${at} ${m[1]}="${m[2]}"`);
          for (const m of line.matchAll(/>\s*([A-Za-z][^<>{}=]*[A-Za-z.!?…])\s*<\//g))
            if (!ALLOW.has(m[1]!.trim())) findings.push(`${at} text "${m[1]}"`);
          if (/^[A-Z][a-z]+( [A-Za-z’'.,!?…-]+)+$/.test(s) && !/[,;(]$/.test(s))
            findings.push(`${at} bare "${s}"`);
          for (const m of line.matchAll(/\b(toast|confirm|alert)\(\s*['`"]([^'`"]+)/g))
            findings.push(`${at} ${m[1]} "${m[2]}"`);
        });
    }
    expect(findings).toEqual([]);
  });
});

describe('locale selection', () => {
  afterEach(() => {
    localStorage.removeItem('hq.locale');
    setLocale('en');
  });

  it('detects es* as Spanish and anything else as English', () => {
    expect(detectLocale(['es-ES'])).toBe('es');
    expect(detectLocale(['es-419', 'en'])).toBe('es');
    expect(detectLocale(['es'])).toBe('es');
    expect(detectLocale(['en-US'])).toBe('en');
    expect(detectLocale(['fr-FR'])).toBe('en');
    expect(detectLocale(['pt-BR', 'es-MX'])).toBe('es');
    expect(detectLocale([])).toBe('en');
  });

  it('an explicit choice persists as the hq.locale device preference and sets <html lang>', () => {
    setLocale('es');
    expect(localStorage.getItem('hq.locale')).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(getLocale()).toBe('es');
    setLocale('en');
    expect(localStorage.getItem('hq.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('LOCALES lists both languages', () => {
    expect([...LOCALES].sort()).toEqual(['en', 'es']);
  });
});

describe('formatting & plurals', () => {
  afterEach(() => setLocale('en'));

  it('pluralizes with Intl.PluralRules in both languages', () => {
    expect(translate('es', 'fact.overdue', { count: 1 })).toBe('1 tarea está vencida.');
    expect(translate('es', 'fact.overdue', { count: 3 })).toBe('3 tareas están vencidas.');
    expect(translate('en', 'fact.overdue', { count: 1 })).toBe('1 task is overdue.');
    expect(translate('en', 'fact.overdue', { count: 3 })).toBe('3 tasks are overdue.');
  });

  it('formats numbers and dates per locale', () => {
    expect(translate('es', 'projects.views_cp', { views: 12345, cp: '24h' })).toBe(
      '12.345 visualizaciones (24h)',
    );
    expect(translate('en', 'projects.views_cp', { views: 12345, cp: '24h' })).toBe('12,345 views (24h)');
    setLocale('es');
    expect(fmt.date('2026-10-13T12:00:00Z', { month: 'long' })).toBe('octubre');
    expect(fmt.relDay(Date.now())).toBe('Hoy');
    setLocale('en');
    expect(fmt.relDay(Date.now())).toBe('Today');
  });

  it('parses user-typed numbers in the active locale', () => {
    expect(parseNum('1.234', 'es')).toBe(1234);
    expect(parseNum('1,5', 'es')).toBe(1.5);
    expect(parseNum('1,234', 'en')).toBe(1234);
    expect(parseNum('12k', 'en')).toBe(12000);
    expect(Number.isNaN(parseNum('abc', 'es'))).toBe(true);
  });

  it('never renders a raw dotted key, even for an unknown key', () => {
    expect(translate('es', 'nonexistent.some_key')).toBe('some key');
    expect(translate('es', 'nav.today')).toBe('Hoy');
  });

  it('renders neutral rule codes in the UI language', () => {
    expect(reasonText({ code: 'only_missing', items: ['cover'] })).toBe('only cover missing');
    setLocale('es');
    expect(reasonText({ code: 'only_missing', items: ['cover'] })).toBe('solo falta portada');
    expect(factText({ key: 'blocked', count: 2 })).toBe('2 contenidos están bloqueados.');
    expect(
      gapText({ platform: 'tiktok', weekStart: '2026-10-12', planned: 1, target: 3, remainingDays: 2 }),
    ).toBe('TikTok: 1/3 planificados esta semana (quedan 2 días)');
    expect(historyLabel('h.status', { status: 'ready' })).toBe('Estado → Listo para publicar');
  });

  it('glossary terms', () => {
    setLocale('es');
    expect(t('nav.today')).toBe('Hoy');
    expect(t('capture.title')).toBe('Captura rápida');
    expect(t('status.blocked')).toBe('Bloqueado');
    expect(t('content.status.ready')).toBe('Listo para publicar');
    expect(t('nav.inbox')).toBe('Bandeja');
  });
});

describe('data stays language-neutral', () => {
  let s: Session;
  beforeEach(async () => {
    s = await openDevice();
  });
  afterEach(() => {
    s.close();
    setLocale('en');
  });

  it('records created while the UI is Spanish store only neutral enums, codes and user text', async () => {
    setLocale('es');
    const cap = await capture(s, { text: 'comprar micrófono', mode: 'text', mediaIds: [] });
    expect(cap.suggestion).toMatchObject({ type: 'task', reason: 'task_like' });
    const idea = await create(s, 'ideas', { title: 'Mi idea', status: 'new' });
    const c = await ideaToContent(s, idea, { formatTemplateId: 'reel', platforms: ['tiktok'] });
    await setContentStatus(s, c, 'ready');
    const stored = await s.db.content.get(c.id);
    expect(stored?.status).toBe('ready');
    expect(stored?.title).toBe('Mi idea'); // user content, untouched
    const hist = await s.db.history.toArray();
    for (const h of hist) expect(h.label).toMatch(/^h\.[a-zA-Z]+$/);
    const ws = await s.db.workspace.get('workspace');
    expect(ws?.formatTemplates.find((x) => x.id === 'reel')?.name).toBe(
      'Short video (Reel / TikTok / Short)',
    );
  });

  it('switching language does not change a single byte of workspace data', async () => {
    await create(s, 'ideas', { title: 'Idea', status: 'new' });
    setLocale('en');
    const a = JSON.stringify(await serializeWorkspace(s.db));
    setLocale('es');
    const b = JSON.stringify(await serializeWorkspace(s.db));
    expect(b).toBe(a);
  });
});

describe('language-independent behaviour', () => {
  it('search accepts English and Spanish filter keywords whatever the UI language', () => {
    expect(parseQuery('tipo:tarea estado:listo es:archivado gato')).toMatchObject({
      type: 'tasks',
      status: 'ready',
      includeArchived: true,
      text: 'gato',
    });
    expect(parseQuery('type:task status:ready is:archived cat')).toMatchObject({
      type: 'tasks',
      status: 'ready',
      includeArchived: true,
      text: 'cat',
    });
  });

  it('capture rules recognise Spanish and English to-dos', () => {
    expect(suggestFor('llamar a Marta', null, false)?.type).toBe('task');
    expect(suggestFor('call Marta', null, false)?.type).toBe('task');
    expect(suggestFor('una idea sobre gatos', null, false)?.type).toBe('idea');
  });

  it('the Secretary answers in the UI language by default; action identifiers stay neutral', () => {
    const pack = { locale: 'es', intent: 'brief', today: 'hoy', facts: [], notes: [], entities: [] } as never;
    const p = buildPrompt(pack, '¿Qué importa hoy?');
    expect(p.system).toMatch(/Answer in Spanish/);
    expect(p.system).toMatch(/explicitly asks for another language/);
    expect(p.system).toMatch(/createTask/);
    const pEn = buildPrompt({ ...(pack as object), locale: 'en' } as never, 'x');
    expect(pEn.system).toMatch(/Answer in English/);
  });
});
