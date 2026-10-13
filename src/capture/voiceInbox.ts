/**
 * Voice/share capture inbox. A tiny Google Apps Script in the user's own account appends
 * dictated or shared texts to a JSON file that THIS app created in its Drive folder (so the
 * app's drive.file scope can read it). On sync the app files each new item where it belongs.
 *
 * The app never rewrites the inbox file (no race with the script); items are de-duplicated by
 * deterministic record ids derived from the item id, so two devices ingesting the same item
 * converge on the same records through sync. The script prunes items older than 60 days.
 */
import type { Session } from '../app/session';
import { extractUrl, parseUrl } from '../core/url';
import { nowIso } from '../core/util';
import { suggestFor } from '../data/domain';
import type { Capture, Content, Variant } from '../data/schema';
import { type Mutator, mutate } from '../data/store';
import type { DriveApi } from '../sync/driveApi';
import { matchPiece, type Route, routeText } from './route';

export const INBOX_FORMAT = 'saga-hq-inbox';
export const INBOX_FILE_NAME = 'Saga HQ · buzón de voz.json';

export interface InboxItem {
  id: string;
  text: string;
  source?: string;
  at?: string;
}
export interface InboxFile {
  format: typeof INBOX_FORMAT;
  version: 1;
  items: InboxItem[];
}

const captureId = (itemId: string) => `vin-${itemId}`.slice(0, 64);
const resultId = (itemId: string) => `vr-${itemId}`.slice(0, 64);
const validId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{6,60}$/.test(v);

/** Create (or find) the inbox file in this workspace's Drive folder and remember its id (synced). */
export async function ensureInbox(s: Session, drive: DriveApi, wsFolderId: string): Promise<string> {
  const ws = await s.db.workspace.get('workspace');
  if (ws?.voiceInboxFileId) return ws.voiceInboxFileId;
  let f = (await drive.find({ appProperties: { sagahq: 'inbox', ws: s.workspaceId } }))[0];
  if (!f) {
    const empty: InboxFile = { format: INBOX_FORMAT, version: 1, items: [] };
    f = await drive.createJson(INBOX_FILE_NAME, wsFolderId, empty, { sagahq: 'inbox', ws: s.workspaceId });
  }
  await mutate(s, { label: 'h.voiceSetup', history: false }, (m) =>
    m.update('workspace', 'workspace', { voiceInboxFileId: f!.id }),
  );
  return f.id;
}

export async function readInbox(drive: DriveApi, fileId: string): Promise<InboxItem[]> {
  const raw = await drive.readJson<Partial<InboxFile>>(fileId);
  if (!raw || raw.format !== INBOX_FORMAT || !Array.isArray(raw.items)) return [];
  return raw.items.filter(
    (i): i is InboxItem => !!i && validId(i.id) && typeof i.text === 'string' && !!i.text.trim(),
  );
}

/** Read the inbox and file every new item. Returns how many were filed. */
export async function pullVoiceInbox(s: Session, drive: DriveApi): Promise<number> {
  const ws = await s.db.workspace.get('workspace');
  if (!ws?.voiceInboxFileId) return 0;
  let items: InboxItem[];
  try {
    items = await readInbox(drive, ws.voiceInboxFileId);
  } catch (e) {
    if ((e as { kind?: string }).kind === 'notFound' || e instanceof SyntaxError) return 0;
    throw e;
  }
  return ingestItems(s, items);
}

export async function ingestItems(s: Session, items: InboxItem[], now = new Date()): Promise<number> {
  const fresh: InboxItem[] = [];
  for (const it of items) {
    if (it.source === 'test') continue; // connection checks never become records
    if (!(await s.db.captures.get(captureId(it.id)))) fresh.push(it);
  }
  if (!fresh.length) return 0;
  const pieces = (await s.db.content.toArray()).filter((c) => !c.deletedAt && !c.archivedAt);
  await mutate(s, { label: 'h.voiceCapture', labelParams: { count: fresh.length } }, async (m) => {
    for (const it of fresh) await fileItem(m, it, pieces, now);
  });
  return fresh.length;
}

async function fileItem(m: Mutator, it: InboxItem, pieces: Content[], now: Date): Promise<void> {
  const text = it.text.trim().slice(0, 20000);
  let route: Route = routeText(text, now);
  const cid = captureId(it.id);
  const rid = resultId(it.id);
  const origin = { source: 'capture' as const, captureId: cid };
  let ref: { entity: string; id: string } | null = null;
  let piece: Content | undefined;
  if (route.kind === 'variant') {
    piece = route.pieceQuery ? matchPiece(route.pieceQuery, pieces) : undefined;
    if (!piece) route = { ...route, kind: 'inbox' };
  }
  switch (route.kind) {
    case 'idea': {
      await m.create('ideas', {
        id: rid,
        title: route.title.slice(0, 300),
        raw: route.body,
        status: 'new',
        ...(route.hook ? { hook: route.hook.slice(0, 2000) } : {}),
        ...(route.pillar ? { pillar: route.pillar.slice(0, 120) } : {}),
        ...(route.situation ? { situation: route.situation.slice(0, 5000) } : {}),
        ...(route.tension ? { tension: route.tension.slice(0, 5000) } : {}),
        ...(route.twist ? { twist: route.twist.slice(0, 5000) } : {}),
        ...(route.payoff ? { payoff: route.payoff.slice(0, 5000) } : {}),
        origin,
      });
      ref = { entity: 'ideas', id: rid };
      break;
    }
    case 'task': {
      await m.create('tasks', {
        id: rid,
        title: route.title.slice(0, 500),
        status: 'todo',
        kind: 'task',
        isBlocker: false,
        ...(route.due ? { dueAt: new Date(`${route.due}T18:00:00`).toISOString() } : {}),
        notes: route.body.length > route.title.length + 3 ? route.body.slice(0, 20000) : null,
        origin,
      });
      ref = { entity: 'tasks', id: rid };
      break;
    }
    case 'piece': {
      await m.create('content', {
        id: rid,
        title: route.title.slice(0, 300),
        concept: route.body.slice(0, 50000),
        status: 'planned',
        formatTemplateId: 'reel',
        platforms: [],
        ...(route.hook ? { hook: route.hook.slice(0, 2000) } : {}),
        ...(route.pillar ? { pillar: route.pillar.slice(0, 120) } : {}),
        origin,
      });
      ref = { entity: 'content', id: rid };
      break;
    }
    case 'radar': {
      await m.create('radar', {
        id: rid,
        title: route.title.slice(0, 500),
        notes: route.body.slice(0, 20000),
        precision: (route.period?.precision as never) ?? 'unknown',
        ...(route.period?.text ? { periodText: route.period.text.slice(0, 300) } : {}),
        ...(route.period?.startDate ? { startDate: route.period.startDate } : {}),
        ...(route.period?.endDate ? { endDate: route.period.endDate } : {}),
        sources: [],
        verification: 'unverified',
        origin,
      });
      ref = { entity: 'radar', id: rid };
      break;
    }
    case 'variant': {
      const cur = (await m.s.db.content.get(piece!.id)) as Content;
      const v: Variant = {
        id: rid,
        field: route.field!,
        text: route.body.slice(0, 100000),
        by: 'user',
        label: 'voice',
        at: nowIso(),
      };
      if (!(cur.variants ?? []).some((x) => x.id === rid))
        await m.update('content', cur.id, { variants: [...(cur.variants ?? []), v] });
      ref = { entity: 'content', id: cur.id };
      break;
    }
    default:
      break;
  }
  const url = extractUrl(text);
  const parsed = url ? parseUrl(url) : null;
  const unmatchedPiece = route.kind === 'inbox' && !!route.pieceQuery;
  await m.create('captures', {
    id: cid,
    text,
    url: url ?? null,
    canonicalUrl: parsed?.canonical ?? null,
    mediaIds: [],
    mode: url ? 'link' : 'text',
    status: ref ? 'triaged' : 'inbox',
    suggestion: ref
      ? null
      : unmatchedPiece
        ? { type: 'idea', by: 'rule', reason: 'voice_piece_not_found' }
        : suggestFor(text, url, false),
    resultRef: ref,
    channel: 'voice',
    inboxId: it.id,
    inboxSource: (it.source ?? 'shortcut').slice(0, 40),
    routedAs: ref ? route.kind : 'inbox',
    origin: { source: 'capture' },
  } as never);
}

/** "Not there": undo the automatic filing of one arrival and leave it in the Inbox. */
export async function sendBackToInbox(s: Session, c: Capture): Promise<void> {
  await mutate(s, { label: 'h.voiceUndo' }, async (m) => {
    const ref = c.resultRef;
    if (ref && c.inboxId) {
      const rid = resultId(c.inboxId);
      if (c.routedAs === 'variant') {
        const cur = await s.db.content.get(ref.id);
        if (cur)
          await m.update('content', cur.id, { variants: (cur.variants ?? []).filter((v) => v.id !== rid) });
      } else if (ref.id === rid) {
        await m.update(ref.entity as never, ref.id, { deletedAt: nowIso() } as never);
      }
    }
    await m.update('captures', c.id, {
      status: 'inbox',
      resultRef: null,
      routedAs: 'inbox',
      suggestion: suggestFor(c.text ?? '', c.url ?? null, false),
    });
  });
}

/** Random capture key for the Apps Script (kept on this device only, never synced). */
export function newCaptureKey(): string {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 28);
}

/** The Apps Script the user pastes into script.google.com (their own account; free). */
export function appsScriptCode(fileId: string, key: string): string {
  return `// Saga HQ · buzón de voz — pega todo esto en script.google.com
// Solo añade lo que dictas al archivo de tu buzón en Drive. Nada más.
const FILE_ID = '${fileId}';
const KEY = '${key}';

function doPost(e) {
  return guardar_(e, e && e.postData ? e.postData.contents : '');
}
function doGet(e) {
  return guardar_(e, '');
}

function guardar_(e, body) {
  var p = (e && e.parameter) || {};
  var data = {};
  try { data = body ? JSON.parse(body) : {}; } catch (err) { data = { text: body }; }
  var key = data.key || p.key;
  var text = String(data.text || p.text || '').trim();
  // keyHint helps Saga HQ tell an outdated deployment apart (first 4 characters only)
  if (key !== KEY) return respuesta_({ ok: false, error: 'clave', v: 2, keyHint: String(KEY).slice(0, 4) });
  if (!text) return respuesta_({ ok: true, vacio: true, message: 'Nada que guardar' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var file = DriveApp.getFileById(FILE_ID);
    var inbox = null;
    try { inbox = JSON.parse(file.getBlob().getDataAsString()); } catch (err) { inbox = null; }
    if (!inbox || !Array.isArray(inbox.items)) inbox = { format: 'saga-hq-inbox', version: 1, items: [] };
    var limite = Date.now() - 60 * 86400000;
    inbox.items = inbox.items.filter(function (i) { return Date.parse(i.at) > limite; }).slice(-500);
    var item = {
      id: Utilities.getUuid(),
      text: text.slice(0, 20000),
      source: String(data.source || p.source || 'atajo').slice(0, 40),
      at: new Date().toISOString(),
    };
    inbox.items.push(item);
    file.setContent(JSON.stringify(inbox));
    return respuesta_({ ok: true, v: 2, id: item.id, message: 'Guardado en Saga HQ' });
  } finally {
    lock.releaseLock();
  }
}

function respuesta_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}

/** Instructions block for ChatGPT custom instructions / Claude project instructions. */
export function assistantInstructions(lang: 'es' | 'en'): string {
  return lang === 'es'
    ? `Cuando te pida "guárdalo para Saga" o terminemos de desarrollar una idea, añade al final un bloque exactamente así (sin nada más dentro):
[SAGA]
tipo: idea | tarea | pieza | radar
titulo: (máximo 12 palabras)
pilar: (si aplica)
gancho: (la apertura, si aplica)
situacion:
tension:
giro:
remate:
fecha: (solo para tareas o radar, p. ej. "viernes" o "17–31 ene 2027")
notas: (resumen breve)
[/SAGA]
Deja vacías las líneas que no apliquen. No inventes fechas.`
    : `When I say "save it for Saga" or we finish developing an idea, end your answer with exactly this block (nothing else inside):
[SAGA]
type: idea | task | piece | radar
title: (max 12 words)
pillar: (if any)
hook: (the opening, if any)
situation:
tension:
twist:
payoff:
date: (tasks or radar only, e.g. "friday" or "17–31 Jan 2027")
notes: (short summary)
[/SAGA]
Leave lines empty when they don't apply. Never invent dates.`;
}
