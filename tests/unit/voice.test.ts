import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../../src/app/session';
import { matchPiece, parseWhen, routeText } from '../../src/capture/route';
import {
  appsScriptCode,
  ensureInbox,
  ingestItems,
  pullVoiceInbox,
  readInbox,
  sendBackToInbox,
} from '../../src/capture/voiceInbox';
import { create } from '../../src/data/store';
import { SyncEngine } from '../../src/sync/engine';
import { FakeDriveClient, FakeDriveServer } from '../../src/sync/fakeDrive';
import { ACCT_A, openDevice } from '../helpers';

// Wednesday 14 Oct 2026, 10:00 local
const NOW = new Date(2026, 9, 14, 10, 0);

describe('voice router', () => {
  it('routes by leading keyword, in Spanish and English', () => {
    expect(routeText('Idea: Saga en un videoclub de 1995', NOW)).toMatchObject({
      kind: 'idea',
      title: 'Saga en un videoclub de 1995',
    });
    expect(routeText('Tarea: llamar al estudio el viernes', NOW)).toMatchObject({
      kind: 'task',
      title: 'llamar al estudio',
      due: '2026-10-16',
    });
    expect(routeText('Task: send the invoice tomorrow', NOW)).toMatchObject({
      kind: 'task',
      due: '2026-10-15',
    });
    expect(routeText('Recuérdame comprar cinta el 12 de noviembre', NOW)).toMatchObject({
      kind: 'task',
      due: '2026-11-12',
    });
    expect(routeText('Pieza: making of del faro', NOW)).toMatchObject({
      kind: 'piece',
      title: 'making of del faro',
    });
    expect(routeText('una frase cualquiera sin palabra clave', NOW).kind).toBe('inbox');
    expect(routeText('Llamar a Noa pasado mañana', NOW)).toMatchObject({ kind: 'task', due: '2026-10-16' });
  });

  it('variants name their piece and field', () => {
    expect(routeText('Guion para Faro: sube la escalera y se apaga la luz', NOW)).toMatchObject({
      kind: 'variant',
      field: 'script',
      pieceQuery: 'Faro',
      body: 'sube la escalera y se apaga la luz',
    });
    expect(routeText('Gancho para la pieza 27: un tren que no llega', NOW)).toMatchObject({
      field: 'hook',
      pieceQuery: 'pieza 27',
    });
  });

  it('radar keeps honest date precision and stays unverified downstream', () => {
    const r = routeText('Radar: festival de cine 17–31 ene 2027', NOW);
    expect(r.kind).toBe('radar');
    expect(r.period).toMatchObject({ startDate: '2027-01-17', endDate: '2027-01-31', precision: 'range' });
    expect(routeText('Radar: algo en marzo de 2027', NOW).period).toMatchObject({ precision: 'month' });
    expect(routeText('Radar: rumor sin fecha', NOW).period).toBeUndefined();
  });

  it('reads the structured block from ChatGPT/Claude', () => {
    const r = routeText(
      'Aquí tienes la idea desarrollada.\n\n[SAGA]\ntipo: idea\ntítulo: Saga en una cabina sin monedas\npilar: Saga se cuela\ngancho: suena el teléfono\nsituación: 1990, lluvia\ngiro: contesta ella misma\nremate: se cuelga\n[/SAGA]',
      NOW,
    );
    expect(r).toMatchObject({
      kind: 'idea',
      title: 'Saga en una cabina sin monedas',
      pillar: 'Saga se cuela',
      hook: 'suena el teléfono',
      situation: '1990, lluvia',
      twist: 'contesta ella misma',
      payoff: 'se cuelga',
    });
    expect(routeText('[SAGA]\ntype: task\ntitle: Book studio\ndate: friday\n[/SAGA]', NOW)).toMatchObject({
      kind: 'task',
      due: '2026-10-16',
    });
  });

  it('parses spoken dates', () => {
    expect(parseWhen('hoy', NOW).date).toBe('2026-10-14');
    expect(parseWhen('el miércoles', NOW).date).toBe('2026-10-21'); // same weekday → next week
    expect(parseWhen('el 3/1', NOW).date).toBe('2027-01-03');
    expect(parseWhen('por la mañana', NOW).date).toBeUndefined();
  });

  it('matches pieces by words or by number', () => {
    const pieces = [
      { id: 'a', title: 'Faro en la niebla', externalId: 'post-1' },
      { id: 'b', title: 'Videoclub, viernes de 1995', externalId: 'post-27' },
    ];
    expect(matchPiece('faro', pieces)?.id).toBe('a');
    expect(matchPiece('el videoclub', pieces)?.id).toBe('b');
    expect(matchPiece('pieza 27', pieces)?.id).toBe('b');
    expect(matchPiece('algo que no existe', pieces)).toBeUndefined();
  });
});

describe('voice inbox', () => {
  const sessions: Session[] = [];
  afterEach(() => {
    for (const s of sessions.splice(0)) s.close();
  });

  it('files each new item once, ignores tests, and two devices converge on the same records', async () => {
    const server = new FakeDriveServer();
    const a = await openDevice();
    const b = await openDevice();
    sessions.push(a, b);
    const da = new FakeDriveClient(server);
    const ea = new SyncEngine(a, da, ACCT_A);
    const st = await ea.ensureLayout();
    const fileId = await ensureInbox(a, da, st.wsFolderId!);
    expect((await a.db.workspace.get('workspace'))?.voiceInboxFileId).toBe(fileId);
    await create(a, 'content', {
      title: 'Faro en la niebla',
      status: 'planned',
      formatTemplateId: 'reel',
      platforms: [],
      hook: 'un faro',
    });

    // what the Apps Script writes
    await da.updateJson(fileId, {
      format: 'saga-hq-inbox',
      version: 1,
      items: [
        { id: 'item-0001', text: 'Idea: Saga en un videoclub', source: 'voz', at: '2026-10-14T08:00:00Z' },
        { id: 'item-0002', text: 'Tarea: grabar la voz el viernes', at: '2026-10-14T08:01:00Z' },
        { id: 'item-0003', text: 'Guion para Faro: sube y se apaga', at: '2026-10-14T08:02:00Z' },
        { id: 'item-0004', text: 'Guion para Inexistente: algo', at: '2026-10-14T08:03:00Z' },
        { id: 'item-0005', text: 'test-abc', source: 'test', at: '2026-10-14T08:04:00Z' },
        { id: 'bad id!', text: 'ignored' },
      ],
    });
    expect(await readInbox(da, fileId)).toHaveLength(5);
    expect(await pullVoiceInbox(a, da)).toBe(4);
    expect(await pullVoiceInbox(a, da)).toBe(0); // idempotent

    const caps = (await a.db.captures.toArray()).filter((c) => c.channel === 'voice');
    expect(caps.map((c) => [c.inboxId, c.routedAs, c.status]).sort()).toEqual([
      ['item-0001', 'idea', 'triaged'],
      ['item-0002', 'task', 'triaged'],
      ['item-0003', 'variant', 'triaged'],
      ['item-0004', 'inbox', 'inbox'],
    ]);
    expect((await a.db.ideas.get('vr-item-0001'))?.title).toBe('Saga en un videoclub');
    expect((await a.db.tasks.get('vr-item-0002'))?.dueAt).toBeTruthy();
    const faro = (await a.db.content.toArray()).find((c) => c.title === 'Faro en la niebla')!;
    expect(faro.variants?.find((v) => v.id === 'vr-item-0003')).toMatchObject({
      field: 'script',
      text: 'sube y se apaga',
    });
    expect(faro.hook).toBe('un faro'); // approved text untouched
    expect(caps.find((c) => c.inboxId === 'item-0004')?.suggestion?.reason).toBe('voice_piece_not_found');

    // a second device ingesting the same items produces the same ids (sync merges them, no duplicates)
    await ingestItems(b, [{ id: 'item-0001', text: 'Idea: Saga en un videoclub' }], NOW);
    expect(await b.db.ideas.get('vr-item-0001')).toBeTruthy();
    expect(await b.db.captures.get('vin-item-0001')).toBeTruthy();

    // "not here": back to the Inbox, the filed record goes to Trash
    const ideaCap = (await a.db.captures.get('vin-item-0001'))!;
    await sendBackToInbox(a, ideaCap);
    expect(await a.db.captures.get('vin-item-0001')).toMatchObject({ status: 'inbox', routedAs: 'inbox' });
    expect((await a.db.ideas.get('vr-item-0001'))?.deletedAt).toBeTruthy();
    const varCap = (await a.db.captures.get('vin-item-0003'))!;
    await sendBackToInbox(a, varCap);
    expect((await a.db.content.get(faro.id))?.variants?.some((v) => v.id === 'vr-item-0003')).toBe(false);
  });
});

describe('Apps Script (run against a simulated Google runtime)', () => {
  function runtime(initial: string) {
    let content = initial;
    const env = {
      DriveApp: {
        getFileById: (id: string) => {
          if (id !== 'FILE123') throw new Error('not found');
          return {
            getBlob: () => ({ getDataAsString: () => content }),
            setContent: (c: string) => (content = c),
          };
        },
      },
      LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
      Utilities: { getUuid: () => `uuid-${Math.random().toString(36).slice(2, 10)}` },
      ContentService: {
        MimeType: { JSON: 'json' },
        createTextOutput: (s: string) => ({ setMimeType: () => ({ body: s }) }),
      },
    };
    const code = appsScriptCode('FILE123', 'secretkey');
    const fns = new Function(...Object.keys(env), `${code}\nreturn { doPost: doPost, doGet: doGet };`)(
      ...Object.values(env),
    ) as {
      doPost: (e: unknown) => { body: string };
      doGet: (e: unknown) => { body: string };
    };
    return { fns, read: () => JSON.parse(content) };
  }

  it('appends with the right key, rejects a wrong key, prunes old items, accepts GET', () => {
    const old = { id: 'old-item-1', text: 'viejo', at: '2020-01-01T00:00:00Z' };
    const { fns, read } = runtime(JSON.stringify({ format: 'saga-hq-inbox', version: 1, items: [old] }));
    const ok = JSON.parse(
      fns.doPost({
        postData: { contents: JSON.stringify({ key: 'secretkey', text: ' Idea: hola ', source: 'voz' }) },
      }).body,
    );
    expect(ok.ok).toBe(true);
    expect(read().items).toHaveLength(1); // the 2020 item was pruned
    expect(read().items[0]).toMatchObject({ text: 'Idea: hola', source: 'voz' });
    const bad = JSON.parse(
      fns.doPost({ postData: { contents: JSON.stringify({ key: 'nope', text: 'x' }) } }).body,
    );
    expect(bad).toEqual({ ok: false, error: 'clave' });
    expect(read().items).toHaveLength(1);
    JSON.parse(fns.doGet({ parameter: { key: 'secretkey', text: 'Tarea: algo' } }).body);
    expect(read().items).toHaveLength(2);
    // plain-text body (no JSON) is not accepted without the key
    expect(JSON.parse(fns.doPost({ postData: { contents: 'just text' } }).body).ok).toBe(false);
  });

  it('recovers from a corrupted inbox file', () => {
    const { fns, read } = runtime('not json');
    fns.doPost({ postData: { contents: JSON.stringify({ key: 'secretkey', text: 'hola' }) } });
    expect(read()).toMatchObject({ format: 'saga-hq-inbox', version: 1 });
    expect(read().items).toHaveLength(1);
  });
});
