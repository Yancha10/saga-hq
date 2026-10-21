import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { go } from './helpers';

test.use({ locale: 'es-ES' });

/** Synthetic Saga Lai-shaped package (never the user's real document). */
const PKG = `# Paquete de prueba

## Anexo A Biblia original completa

### Capítulo 0 Inicio

Identificador original: \`0\`

#### Marca Prueba — La biblia

Bienvenida.

### Capítulo 1 1 · Personaje

Identificador original: \`1\`

La protagonista lleva un sombrero verde.

## Anexo B Fichas

### Pieza 1 Faro en la niebla

- **Identificador:** post-1
- **Fecha prevista:** 2030-10-14 19:30 Europe/Oslo
- **Estado inicial:** Idea
- **Pilar:** Viajes
- **Palabra clave de DM:** FARO
- **Formato:** Reel 9:16
- **Duración objetivo:** 30 s

#### Ficha original

- **Gancho:** un faro entre niebla y un sombrero verde.

#### Propuesta ampliada de trabajo

**Apertura:** un faro entre niebla con el sombrero verde.

**Bloque 1 · 0–8 s**

Plano general del faro.

Estado del plano: Pendiente

#### Guion de trabajo inicial

"Subo al faro."

### Pieza 2 Carrusel: tres errores

- **Identificador:** post-2
- **Fecha prevista:** 2030-10-16 13:45 Europe/Oslo
- **Estado inicial:** Guion
- **Formato:** Carrusel

#### Ficha original

Tres imágenes.

## Anexo C Radar

### event-0 Festival de prueba ([Fuente](https://example.com/fest))

- Periodo original: 17–31 ene 2031
- Categoría: Cultura
- Ángulo: Saga en el festival
- Revisión: Por comprobar

## Anexo D Tareas

### Tareas iniciales

- **task-1 · Preparar referencias**
  - Fecha: 2030-10-12
  - Categoría: Arranque
  - Estado: Pendiente
  - Notas: Sin notas

### Checklist importada

- c0: Primer fotograma = el mundo
- c1: Portada elegida

### Decisiones pendientes

#### Decidir el ritmo

Identificador: i1

Tres o cuatro piezas por semana.

Estado: Pendiente
`;

async function start(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: /Empezar en local/ }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true }).first()).toBeVisible();
  const skip = page.getByRole('button', { name: 'Omitir' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function importPkg(page: Page): Promise<void> {
  await go(page, '#/settings?section=import');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'paquete.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(PKG, 'utf8'),
  });
  await expect(page.getByText('Vista previa · paquete.md')).toBeVisible();
}

async function axe(page: Page, label: string, failures: string[]): Promise<void> {
  const r = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa']).analyze();
  for (const v of r.violations) failures.push(`${label} ${v.id}: ${v.nodes.length}`);
}

test('Saga Lai: import, re-import without duplicates, Bible, Radar, week, Workshop and editorial card', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await start(page);
  await importPkg(page);
  await expect(page.getByText('Capítulos de la Biblia')).toBeVisible();
  await page.getByRole('button', { name: 'Importar ahora' }).click();
  await expect(page.getByText(/creados, .* actualizados/)).toBeVisible();

  // Re-import: the same package is recognised, nothing duplicated
  await importPkg(page);
  await expect(page.getByText(/ya están aquí/).first()).toBeVisible();
  await page.getByRole('radio', { name: /Fusionar/ }).check();
  await page.getByRole('button', { name: 'Importar ahora' }).click();
  await expect(page.getByText(/creados, .* actualizados/)).toBeVisible();
  const counts = await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const name = dbs.map((d) => d.name).find((n) => n?.startsWith('sagahq-'))!;
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => res(r.result);
    });
    const count = (store: string) =>
      new Promise<number>((res) => {
        const q = db.transaction(store).objectStore(store).count();
        q.onsuccess = () => res(q.result);
      });
    const out = {
      content: await count('content'),
      chapters: await count('chapters'),
      radar: await count('radar'),
    };
    db.close();
    return out;
  });
  expect(counts).toEqual({ content: 2, chapters: 2, radar: 1 });

  const failures: string[] = [];

  // Bible: read, edit, see the impact suggestion (nothing rewritten)
  await go(page, '#/bible');
  await expect(page.getByRole('heading', { name: 'Biblia' }).first()).toBeVisible();
  await page.getByRole('link', { name: /Personaje/ }).click();
  await expect(page.getByText('La protagonista lleva un sombrero verde.')).toBeVisible();
  await axe(page, 'chapter', failures);
  await page.getByRole('button', { name: 'Editar' }).click();
  await page
    .getByRole('textbox', { name: 'Texto del capítulo' })
    .fill('La protagonista lleva un sombrero verde y niebla.');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText(/pieza.* puede.* necesitar revisión/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Faro en la niebla/ })).toBeVisible();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(page.getByText('La protagonista lleva un sombrero verde.')).toBeVisible();

  // Radar: precision and verification are explicit
  await go(page, '#/radar');
  await expect(page.getByText('Festival de prueba')).toBeVisible();
  await expect(page.getByText('Intervalo').first()).toBeVisible();
  await expect(page.getByText('Por comprobar').first()).toBeVisible();
  await axe(page, 'radar', failures);
  await page.getByRole('button', { name: /Festival de prueba/ }).click();
  await page.getByRole('button', { name: 'Marcar como verificada' }).click();
  await expect(page.getByText('Marcada como verificada hoy').last()).toBeVisible();
  await page.getByRole('button', { name: 'Convertir en campaña' }).click();
  await expect(page.getByRole('dialog', { name: 'Convertir en campaña' })).toBeVisible();
  await page.getByRole('button', { name: /Crear campaña/ }).click();
  await expect(page.getByText(/Campaña creada con 4 piezas/).last()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // My week
  await go(page, '#/week');
  await expect(page.getByText('estimadas / disponibles esta semana')).toBeVisible();
  await axe(page, 'week', failures);

  // Workshop: brief, paste an answer, apply as a variant
  await go(page, '#/workshop');
  const sel = page.getByLabel('Pieza', { exact: true });
  const val = await sel.locator('option', { hasText: 'Faro en la niebla' }).getAttribute('value');
  await sel.selectOption(val!);
  await page.getByRole('button', { name: 'Escribir guion' }).click();
  await expect(page.getByRole('textbox', { name: 'Encargo' })).toHaveValue(/Faro en la niebla/);
  await axe(page, 'workshop', failures);
  await page.getByRole('textbox', { name: 'Respuesta' }).fill('Guion alternativo desde el taller.');
  await page.getByRole('button', { name: 'Guardar como propuesta' }).click();
  await expect(page.getByText('Guardada como propuesta').last()).toBeVisible();
  await page.locator('details.session-card summary').first().click();
  await page.getByRole('button', { name: 'Añadir como variante' }).click();
  await expect(page.getByText(/Añadida como variante/).last()).toBeVisible();

  // Piece: editorial card with the original, the variant and the checklist
  await go(page, '#/content');
  await page
    .getByRole('link', { name: /Faro en la niebla/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /Ficha editorial/ }).first()).toBeVisible();
  await expect(
    page
      .getByText('Texto preparado · entrega manual')
      .or(page.getByText('Palabra clave sin texto de entrega')),
  ).toBeVisible();
  await expect(page.getByText('Guion alternativo desde el taller.')).toBeVisible();
  await expect(page.getByText('Primer fotograma = el mundo')).toBeVisible();
  await axe(page, 'piece', failures);
  expect(failures).toEqual([]);
});

test('Saga Lai screens fit phone widths', async ({ page }) => {
  await start(page);
  await importPkg(page);
  await page.getByRole('button', { name: 'Importar ahora' }).click();
  await expect(page.getByText(/creados, .* actualizados/)).toBeVisible();
  const failures: string[] = [];
  for (const [w, h] of [
    [390, 844],
    [320, 640],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const hash of [
      '#/',
      '#/bible',
      '#/radar',
      '#/week',
      '#/workshop',
      '#/more',
      '#/settings?section=import',
      '#/settings?section=voice',
      '#/settings?section=plan',
    ]) {
      await go(page, hash);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
      if (overflow > 1) failures.push(`${w}x${h} ${hash}: +${overflow}px`);
    }
  }
  expect(failures).toEqual([]);
});

test('Voice capture settings explain the setup and need Google for a local workspace', async ({ page }) => {
  await start(page);
  await go(page, '#/settings?section=voice');
  await expect(page.getByText('Dilo y ya está en Saga HQ')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar Google' })).toBeVisible();
  const r = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

test('Home-screen quick capture page sends to the script and queues offline', async ({ page }) => {
  const sent: string[] = [];
  await page.route('https://script.google.com/**', async (route) => {
    sent.push(route.request().postData() ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, v: 2, id: 'x' }),
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `./quick.html#u=${encodeURIComponent('https://script.google.com/macros/s/TEST/exec')}&k=clave123`,
  );
  await page.getByRole('button', { name: 'Tarea' }).click();
  await page.getByLabel('Tu idea').pressSequentially('llamar al estudio el viernes');
  await page.getByRole('button', { name: 'Guardar en Saga' }).click();
  await expect(page.getByText(/Guardado en Saga/)).toBeVisible();
  expect(JSON.parse(sent[0]!)).toEqual({
    key: 'clave123',
    text: 'Tarea: llamar al estudio el viernes',
    source: 'pantalla-inicio',
  });
  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/quick.png` });
});

test('Quick capture page sends the text a Shortcut passes in #t= once, without a tap', async ({ page }) => {
  const sent: string[] = [];
  await page.route('https://script.google.com/**', async (route) => {
    sent.push(route.request().postData() ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, v: 2, id: 'x' }),
    });
  });
  const u = encodeURIComponent('https://script.google.com/macros/s/TEST/exec');
  await page.goto(`./quick.html#u=${u}&k=clave123&t=${encodeURIComponent('Idea: Saga en un faro')}`);
  await expect(page.getByText(/Guardado en Saga/)).toBeVisible();
  expect(JSON.parse(sent[0]!)).toEqual({ key: 'clave123', text: 'Idea: Saga en un faro', source: 'atajo' });
  expect(page.url()).not.toContain('t=');
  await page.reload();
  await page.waitForTimeout(500);
  expect(sent).toHaveLength(1);
});

test('Plan: pause everything, see it on Today, resume; reminders section passes axe', async ({ page }) => {
  await start(page);
  await go(page, '#/settings?section=plan');
  await expect(page.getByRole('heading', { name: 'Pausar el plan' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Si algo se retrasa/ })).toBeChecked();
  const r = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('button', { name: 'Pausar todo el plan' }).click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(page.getByText(/En pausa desde/).first()).toBeVisible();
  await go(page, '#/');
  await expect(page.getByRole('heading', { name: 'Plan en pausa' })).toBeVisible();
  await page.getByRole('button', { name: /Reanudar/ }).click();
  await expect(page.getByRole('heading', { name: 'Plan en pausa' })).toHaveCount(0);
});
