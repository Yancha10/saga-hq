import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../../src/app/session';
import {
  addVariant,
  affectedPieces,
  approveVariant,
  buildIcs,
  campaignDraft,
  changedTerms,
  nextActionFor,
  perReach,
} from '../../src/data/saga';
import type { Content, RadarItem } from '../../src/data/schema';
import { undoLast } from '../../src/data/store';
import { applyImport, planImport } from '../../src/import/apply';
import { PackageError, parsePackage, parsePeriod, parseZoned, zonedToUtc } from '../../src/import/sagaLai';
import { openDevice } from '../helpers';

/** Synthetic package with the same structure as the integration document (no real content). */
const FIXTURE = `# Especificación de prueba

## Anexo A Biblia original completa

### Capítulo 0 Inicio

Identificador original: \`0\`

#### Marca Test — La biblia de la cuenta

Texto de inicio con **negrita**.

### Capítulo 1 1 · Personaje

Identificador original: \`1\`

La protagonista lleva un sombrero verde y una bufanda roja.

## Anexo B Las fichas de trabajo

### Pieza 1 Faro en la niebla

- **Identificador:** post-1
- **Fecha prevista:** 2026-10-13 13:45 Europe/Oslo
- **Estado inicial:** Idea
- **Pilar:** Viajes
- **Palabra clave de DM:** FARO
- **Formato:** Reel 9:16
- **Duración objetivo:** 30 s
- **Procedencia del desarrollo:** Propuesta ampliada · 1 oct 2026

#### Ficha original

- **Gancho:** un faro entre niebla.
- **Llamada:** "Comenta FARO."

\`\`\`markdown
STYLE_LOCK: cinematic.
## not a heading inside the fence
\`\`\`

#### Propuesta ampliada de trabajo

**Apertura:** un faro entre niebla con el sombrero verde.

**Objetivo:** Envíos

**Título de portada:** Faro

**Arte:** Luz cálida.

**Sonido:** Olas.

**Continuidad:** Mismo sombrero.

**Llamada a la acción:** "Comenta FARO y te lo mando."

**Bloque 1 · 0–8 s**

Plano general del faro.

Diálogo por plano: Por desarrollar o asignar a partir del guion de trabajo.

Estado del plano: Pendiente

**Bloque 2 · 8–30 s**

Ella sube la escalera.

Diálogo por plano: "Ya llego."

Estado del plano: Pendiente

#### Guion de trabajo inicial

"Subo al faro."

#### Prompt de trabajo inicial

Sin completar.

#### Caption inicial

"Comenta FARO y te lo mando."

#### Stories propuestas

Antes: adelanto.

#### Comentario fijado propuesto

¿Qué ves primero?

#### Notas de producción

Sin completar.

#### Notas de la pieza

Sin completar.

Métricas iniciales: sin resultados registrados.

### Pieza 2 Carrusel: tres errores

- **Identificador:** post-2
- **Fecha prevista:** 2026-11-17 13:45 Europe/Oslo
- **Estado inicial:** Guion
- **Pilar:** Proceso
- **Palabra clave de DM:** Sin definir
- **Formato:** Carrusel
- **Duración objetivo:** No aplica a carrusel

#### Ficha original

Tres imágenes y una regla.

## Fichas de noviembre (piezas 10 a 23)

Introducción del mes que no pertenece a la pieza.

#### Propuesta ampliada de trabajo

**Apertura:** Portada del carrusel.

**Bloque 1 · Diapositiva 1**

Portada.

Estado del plano: Pendiente

## Anexo C Radar completo de oportunidades

### event-0 Festival de prueba ([Fuente](https://example.com/fest))

- Periodo original: 17–31 ene 2027
- Categoría: Cultura
- Ángulo: Saga en el festival
- Revisión: Por comprobar
- Notas: Pendiente.

### event-1 Estreno en primavera

- Periodo original: Abril–mayo 2027
- Categoría: Cine
- Revisión: Por comprobar

## Anexo D Tareas checklist ideas y decisiones

### Tareas iniciales

- **task-1 · Preparar referencias**
  - Fecha: 2026-10-12
  - Categoría: Arranque
  - Estado: Pendiente
  - Notas: Sin notas

### Checklist importada

- c0: Primer fotograma = el mundo
- c1: Portada elegida

### Ideas de emergencia

#### idea-0 Saga en una cabina

Pilar: Viajes

Banco de emergencia.

### Decisiones pendientes

#### Decidir el ritmo

Identificador: i1

Tres o cuatro piezas por semana.

Estado: Pendiente

### Preferencias iniciales

\`\`\`json
{ "weeklyGoal": 3, "timezone": "Europe/Oslo", "name": "Test", "workingHours": 6 }
\`\`\`
`;

describe('Saga Lai package reader', () => {
  const pkg = parsePackage(FIXTURE, 'pkg.md');

  it('reads every annex without losing records', () => {
    expect(pkg.kind).toBe('markdown');
    expect(pkg.chapters.map((c) => c.externalId)).toEqual(['0', '1']);
    expect(pkg.chapters[1]).toMatchObject({ number: '1', title: 'Personaje' });
    expect(pkg.pieces).toHaveLength(2);
    expect(pkg.radar).toHaveLength(2);
    expect(pkg.tasks.map((t) => [t.externalId, t.kind])).toEqual([
      ['task-1', 'task'],
      ['decision-i1', 'decision'],
    ]);
    expect(pkg.ideas[0]).toMatchObject({ externalId: 'idea-0', pillar: 'Viajes', emergency: true });
    expect(pkg.checklist).toEqual([
      { id: 'c0', text: 'Primer fotograma = el mundo' },
      { id: 'c1', text: 'Portada elegida' },
    ]);
    expect(pkg.prefs).toEqual({ timezone: 'Europe/Oslo', weeklyGoal: 3, weeklyHours: 6, ownerName: 'Test' });
    expect(pkg.brand).toBe('Marca Test');
  });

  it('maps a piece: statuses, DST-correct date, proposal, shots, empty markers', () => {
    const [p1, p2] = pkg.pieces;
    expect(p1).toMatchObject({
      externalId: 'post-1',
      title: 'Faro en la niebla',
      status: 'planned',
      plannedAt: '2026-10-13T11:45:00.000Z', // CEST (+02)
      pillar: 'Viajes',
      dmKeyword: 'FARO',
      format: 'reel',
      durationTargetSec: 30,
      hook: 'un faro entre niebla con el sombrero verde.',
      coverText: 'Faro',
      cta: 'Comenta FARO y te lo mando.',
      script: 'Subo al faro.',
      prompt: 'STYLE_LOCK: cinematic.\n## not a heading inside the fence',
    });
    expect(p1!.original).toContain('**Gancho:** un faro');
    expect(p1!.productionNotes).toBeUndefined();
    expect(p1!.shots.map((s) => [s.timeLabel, s.durationSec, s.dialogue])).toEqual([
      ['0–8 s', 8, undefined],
      ['8–30 s', 22, '"Ya llego."'],
    ]);
    expect(p2).toMatchObject({ status: 'script', format: 'carousel', plannedAt: '2026-11-17T12:45:00.000Z' });
    expect(p2!.dmKeyword).toBeUndefined();
    expect(p2!.durationTargetSec).toBeUndefined();
    // month headers that land inside a piece are dropped
    expect(JSON.stringify(p2)).not.toContain('Introducción del mes');
    expect(p2!.shots[0]).toMatchObject({ timeLabel: 'Diapositiva 1' });
    expect(p2!.shots[0]!.durationSec).toBeUndefined();
  });

  it('keeps radar sources and never invents a day', () => {
    expect(pkg.radar[0]).toMatchObject({
      title: 'Festival de prueba',
      sources: [{ label: 'Fuente', url: 'https://example.com/fest' }],
      startDate: '2027-01-17',
      endDate: '2027-01-31',
      precision: 'range',
      verification: 'unverified',
    });
    expect(pkg.radar[1]).toMatchObject({
      startDate: '2027-04-01',
      endDate: '2027-05-31',
      precision: 'month',
    });
  });

  it('parses Spanish periods with honest precision', () => {
    expect(parsePeriod('3 nov 2026')).toEqual({ startDate: '2026-11-03', precision: 'day' });
    expect(parsePeriod('18 abr y 2 may 2027')).toMatchObject({
      startDate: '2027-04-18',
      endDate: '2027-05-02',
      precision: 'multiple',
    });
    expect(parsePeriod('19 y 25–26 mar 2027')).toMatchObject({
      startDate: '2027-03-19',
      endDate: '2027-03-26',
      precision: 'multiple',
    });
    expect(parsePeriod('27 ago–12 sep 2027')).toMatchObject({
      startDate: '2027-08-27',
      endDate: '2027-09-12',
      precision: 'range',
    });
    expect(parsePeriod('Verano de 2027')).toMatchObject({ startDate: '2027-06-21', precision: 'season' });
    expect(parsePeriod('Otoño e invierno 2026–27')).toMatchObject({
      startDate: '2026-09-23',
      endDate: '2027-03-19',
      precision: 'season',
    });
    expect(parsePeriod('Principios de jun 2027')).toMatchObject({
      startDate: '2027-06-01',
      precision: 'month',
    });
    expect(parsePeriod('2027')).toMatchObject({ precision: 'year' });
    expect(parsePeriod('31 dic', '2026-10-10')).toMatchObject({
      startDate: '2026-12-31',
      precision: 'recurring',
    });
    expect(parsePeriod('Septiembre de cada año', '2026-10-10')).toMatchObject({
      startDate: '2027-09-01',
      precision: 'recurring',
    });
    expect(parsePeriod('cuando sea')).toEqual({ precision: 'unknown' });
  });

  it('converts wall-clock times across DST', () => {
    expect(zonedToUtc(2026, 10, 24, 12, 0, 'Europe/Oslo')).toBe('2026-10-24T10:00:00.000Z');
    expect(zonedToUtc(2026, 10, 26, 12, 0, 'Europe/Oslo')).toBe('2026-10-26T11:00:00.000Z');
    expect(parseZoned('2027-01-05 20:00 Europe/Oslo')).toBe('2027-01-05T19:00:00.000Z');
  });

  it('rejects files that are not a package, and reads the v2 seed tolerantly without running scripts', () => {
    expect(() => parsePackage('', 'x.md')).toThrow(PackageError);
    expect(() => parsePackage('# Nothing here', 'x.md')).toThrow(PackageError);
    expect(() => parsePackage('{bad', 'x.json')).toThrow(PackageError);
    const seed = {
      schema: 1,
      edition: 2,
      sections: [{ id: 's1', title: 'Uno', text: 'Cuerpo' }],
      posts: [
        {
          id: 'post-9',
          title: 'Pieza',
          date: '2026-12-01',
          time: '19:30',
          status: 'Producción',
          keyword: 'X',
          detail: { hook: 'gancho' },
          development: {
            scenes: [{ t: '0–5 s', action: 'abre', dialogue: 'hola', status: 'Listo' }],
            aiNotes: [{ text: 'idea IA', task: 'script' }],
          },
          checks: { c0: true },
          metrics: { reach: 1000, shares: 25 },
        },
        { nope: true },
      ],
      settings: { timezone: 'Europe/Oslo', workingHours: 4 },
    };
    const html = `<!doctype html><html><script>alert(1)</script><script id="seed" type="application/json">${JSON.stringify(seed)}</script></html>`;
    const p = parsePackage(html, 'secretaria.html');
    expect(p.kind).toBe('seed');
    expect(p.chapters[0]).toMatchObject({ externalId: 's1', body: 'Cuerpo' });
    expect(p.pieces[0]).toMatchObject({
      externalId: 'post-9',
      status: 'producing',
      plannedAt: '2026-12-01T18:30:00.000Z',
      checks: { c0: true },
      metrics: { reach: 1000, shares: 25 },
    });
    expect(p.pieces[0]!.shots[0]).toMatchObject({ dialogue: 'hola', status: 'selected', durationSec: 5 });
    expect(p.sessions[0]).toMatchObject({ pieceId: 'post-9', response: 'idea IA' });
    expect(p.warnings).toContain('post_skipped');
    expect(p.prefs.weeklyHours).toBe(4);
  });
});

describe('Saga Lai import into a workspace', () => {
  let s: Session;
  afterEach(() => s?.close());

  it('imports once, never duplicates on re-import, merges without overwriting edits, and is undoable', async () => {
    s = await openDevice();
    const pkg = parsePackage(FIXTURE, 'pkg.md');
    const plan = await planImport(s, pkg);
    expect(plan.kinds.pieces).toEqual({ total: 2, existing: 0 });
    expect(plan.pillars).toEqual(['Proceso', 'Viajes']);

    const r1 = await applyImport(s, pkg, { mode: 'merge', seriesPillars: ['Viajes'] });
    expect(r1.created).toBeGreaterThan(0);
    const content = (await s.db.content.toArray()) as Content[];
    expect(content).toHaveLength(2);
    const faro = content.find((c) => c.externalId === 'post-1')!;
    expect(faro.original?.text).toContain('Gancho');
    expect(faro.shots).toHaveLength(2);
    expect(faro.variants?.map((v) => v.field).sort()).toEqual(['caption', 'hook', 'prompt', 'script']);
    const pubs = await s.db.publications.where('contentId').equals(faro.id).toArray();
    expect(pubs[0]).toMatchObject({ status: 'planned', scheduledAt: '2026-10-13T11:45:00.000Z' });
    expect(await s.db.chapters.count()).toBe(2);
    expect(await s.db.radar.count()).toBe(2);
    expect((await s.db.radar.toArray()).every((x) => x.verification === 'unverified')).toBe(true);
    const ws = await s.db.workspace.get('workspace');
    expect(ws).toMatchObject({ timezone: 'Europe/Oslo', weeklyHours: 6, checklistVersion: 1 });
    const projects = await s.db.projects.toArray();
    const series = projects.find((p) => p.kind === 'series')!;
    expect(series.name).toBe('Viajes');
    expect(faro.projectId).toBe(series.id);
    expect(await s.db.recovery.count()).toBeGreaterThan(0);

    // the user edits the script, then re-imports with merge: nothing duplicated, edit kept
    await s.db.content.update(faro.id, { script: 'Mi guion editado' });
    const plan2 = await planImport(s, pkg);
    expect(plan2.kinds.pieces.existing).toBe(2);
    await applyImport(s, pkg, { mode: 'merge', seriesPillars: ['Viajes'] });
    expect(await s.db.content.count()).toBe(2);
    expect(await s.db.chapters.count()).toBe(2);
    expect(await s.db.publications.count()).toBe(2);
    expect(await s.db.projects.count()).toBe(2);
    expect((await s.db.content.get(faro.id))!.script).toBe('Mi guion editado');

    // replace restores package values but never the stored original card
    await applyImport(s, pkg, { mode: 'replace' });
    expect((await s.db.content.get(faro.id))!.script).toBe('Subo al faro.');
    expect(await s.db.content.count()).toBe(2);

    // the last import can be undone
    await undoLast(s);
    expect((await s.db.content.get(faro.id))!.script).toBe('Mi guion editado');
  });
});

describe('editorial helpers', () => {
  let s: Session;
  afterEach(() => s?.close());

  it('approving a variant keeps the previous text as a variant', async () => {
    s = await openDevice();
    await applyImport(s, parsePackage(FIXTURE, 'pkg.md'), { mode: 'merge' });
    let c = (await s.db.content.toArray()).find((x) => x.externalId === 'post-1')!;
    const v = await addVariant(s, c, { field: 'hook', text: 'Nueva apertura', by: 'ai', label: 'Taller' });
    c = (await s.db.content.get(c.id))!;
    await approveVariant(s, c, v.id);
    c = (await s.db.content.get(c.id))!;
    expect(c.hook).toBe('Nueva apertura');
    expect(c.variants?.find((x) => x.id === v.id)?.approved).toBe(true);
    expect(c.variants?.some((x) => x.text === 'un faro entre niebla con el sombrero verde.')).toBe(true);
  });

  it('suggests affected pieces for a Bible edit without rewriting them', () => {
    const pieces = [
      { id: 'a', title: 'Faro', hook: 'sombrero verde en la niebla', status: 'planned' },
      { id: 'b', title: 'Otra', hook: 'nada que ver', status: 'planned' },
    ] as unknown as Content[];
    const words = changedTerms(
      'La protagonista lleva un sombrero verde.',
      'La protagonista lleva un sombrero azul.',
    );
    const hits = affectedPieces(pieces, [...words, 'sombrero']);
    expect(hits.map((h) => h.piece.id)).toEqual(['a']);
  });

  it('ratios need a reach denominator', () => {
    expect(perReach(25, 1000)).toBe(2.5);
    expect(perReach(25, 0)).toBeNull();
    expect(perReach(25, undefined)).toBeNull();
    expect(perReach(undefined, 1000)).toBeNull();
  });

  it('next action follows production order', () => {
    expect(nextActionFor({ status: 'planned', formatTemplateId: 'reel' } as Content).key).toBe('write_hook');
    expect(
      nextActionFor({ status: 'planned', hook: 'h', script: 's', formatTemplateId: 'reel' } as Content).key,
    ).toBe('plan_shots');
    expect(
      nextActionFor({
        status: 'producing',
        hook: 'h',
        script: 's',
        formatTemplateId: 'reel',
        shots: [{ status: 'final' }],
        finalExportUrl: 'x',
        coverUrl: 'y',
        caption: 'c',
      } as unknown as Content).key,
    ).toBe('schedule');
  });

  it('campaigns from unverified radar dates get no calendar dates', () => {
    const titles = { teaser: 'a', main: 'b', making_of: 'c', follow_up: 'd' };
    const r = { startDate: '2027-01-17', precision: 'day', verification: 'unverified' } as RadarItem;
    expect(campaignDraft(r, titles).every((d) => d.date === null)).toBe(true);
    const v = campaignDraft({ ...r, verification: 'verified' }, titles);
    expect(v.map((d) => d.date)).toEqual(['2027-01-12', '2027-01-17', '2027-01-19', '2027-01-24']);
  });

  it('ICS uses the workspace zone with a VTIMEZONE, stable UIDs, escaping and folding', () => {
    const ics = buildIcs(
      [
        {
          uid: 'pub-1@saga-hq',
          start: '2026-10-13T11:45:00.000Z',
          title: 'Faro; niebla, y más\\',
          description: 'línea 1\nlínea 2',
        },
        { uid: 'pub-2@saga-hq', start: '2026-11-17T12:45:00.000Z', title: 'x'.repeat(120) },
      ],
      'Europe/Oslo',
      'Saga',
    );
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:Europe/Oslo');
    expect(ics).toContain('TZOFFSETTO:+0200');
    expect(ics).toContain('DTSTART;TZID=Europe/Oslo:20261013T134500'); // summer time
    expect(ics).toContain('DTSTART;TZID=Europe/Oslo:20261117T134500'); // winter time
    expect(ics).toContain('UID:pub-1@saga-hq');
    expect(ics).toContain('SUMMARY:Faro\\; niebla\\, y más\\\\');
    expect(ics).toContain('DESCRIPTION:línea 1\\nlínea 2');
    for (const line of ics.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    // a zone without the EU rule falls back to UTC
    expect(
      buildIcs([{ uid: 'u', start: '2026-10-13T11:45:00.000Z', title: 't' }], 'America/New_York', 'x'),
    ).toContain('DTSTART:20261013T114500Z');
  });
});
