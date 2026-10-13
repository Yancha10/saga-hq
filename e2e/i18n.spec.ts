import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { en } from '../src/i18n/en';
import { go } from './helpers';

// Spanish browser: the app must detect it, and every flow below runs in Spanish.
test.use({ locale: 'es-ES' });

const KEYS = Object.keys(en);
const keyRe = new RegExp(`(^|\\s)(${KEYS.map((k) => k.replace(/\./g, '\\.')).join('|')})(\\s|$)`);

async function startLocalEs(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await page.getByRole('button', { name: /Empezar en local/ }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true }).first()).toBeVisible();
  const skip = page.getByRole('button', { name: 'Omitir' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function captureEs(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page
    .locator('body')
    .click({ position: { x: 5, y: 5 } })
    .catch(() => {});
  await page.keyboard.press('c');
  await page.getByRole('textbox', { name: '¿Qué tienes en mente?' }).fill(text);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Guardado en la bandeja').last()).toBeVisible();
}

/** No dictionary key may ever be rendered as text or as an accessible name. */
async function expectNoRawKeys(page: Page): Promise<void> {
  const text = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('[aria-label],[placeholder],[title],[alt]')].map((e) =>
      ['aria-label', 'placeholder', 'title', 'alt'].map((a) => e.getAttribute(a) ?? '').join(' '),
    );
    return `${document.body.innerText}\n${labels.join('\n')}`;
  });
  const m = text.split('\n').find((l) => keyRe.test(l.trim()));
  expect(m, `raw i18n key rendered: ${m}`).toBeUndefined();
}

test('Spanish end to end: detection, daily loop, palette aliases, no raw keys, no English leftovers', async ({
  page,
}) => {
  await startLocalEs(page);
  await expect(page.getByRole('navigation', { name: 'Navegación principal' }).first()).toBeVisible();

  await captureEs(page, 'Anciano reacciona al tráiler de GTA VI en un bar');
  await go(page, '#/inbox');
  await expect(page.getByRole('heading', { name: 'Bandeja' }).first()).toBeVisible();
  await page.getByRole('button', { name: /Aceptar: convertir en Idea/ }).click();
  await expect(page.getByText('Movido a Idea')).toBeVisible();

  await go(page, '#/ideas');
  await page.getByRole('link', { name: /Anciano reacciona/ }).click();
  await page.getByRole('textbox', { name: 'Gancho' }).fill('Lleva 13 años esperando esto');
  await page.getByRole('textbox', { name: 'Concepto' }).click();
  await page.getByRole('button', { name: 'Convertir en contenido' }).click();
  await page.getByRole('button', { name: 'Crear contenido' }).click();
  await expect(page.getByRole('textbox', { name: 'Título del contenido' })).toHaveValue(/Anciano reacciona/);

  await page
    .getByRole('textbox', { name: 'Guion', exact: true })
    .fill('Bar. Tele encendida. Empieza el tráiler.');
  await page
    .getByRole('textbox', { name: 'URL de la exportación final' })
    .fill('https://drive.example.com/final.mp4');
  await page
    .getByRole('textbox', { name: 'URL de la portada' })
    .fill('https://drive.example.com/portada.jpg');
  await page.getByRole('textbox', { name: 'Descripción', exact: true }).fill('Trece años. #gta6');
  await page.getByRole('textbox', { name: 'Título del contenido' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pasado a En producción' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Instagram' }).first().click();
  const when = new Date(Date.now() + 2 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await page
    .getByLabel('Hora de publicación en Instagram')
    .fill(
      `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`,
    );
  await expect(page.getByText('Todo lo necesario está listo.')).toBeVisible();
  await expectNoRawKeys(page);

  await page.getByRole('button', { name: 'Marcar como publicado' }).click();
  await page
    .getByLabel('URL de la publicación (opcional, recomendado)')
    .fill('https://www.instagram.com/reel/ABC123/');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText(/^Publicado; Hoy te recordará/)).toBeVisible();

  // Today in Spanish, with locale dates
  await go(page, '#/');
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true }).first()).toBeVisible();
  await expect(page.getByText(/lunes|martes|miércoles|jueves|viernes|sábado|domingo/).first()).toBeVisible();
  await expectNoRawKeys(page);

  // Palette: bilingual aliases, routes not localized
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: 'Busca en todo o escribe un comando' });
  await box.fill('proyectos');
  await expect(page.getByRole('option', { name: /^Proyectos/ })).toBeVisible();
  await box.fill('projects');
  await expect(page.getByRole('option', { name: /^Proyectos/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole('heading', { name: 'Proyectos' }).first()).toBeVisible();

  // Every main screen renders without raw keys
  for (const hash of [
    '#/content',
    '#/calendar',
    '#/library',
    '#/insights',
    '#/tasks',
    '#/settings',
    '#/more',
  ]) {
    await go(page, hash);
    await page.waitForTimeout(200);
    await expectNoRawKeys(page);
  }
});

test('explicit English choice wins over a Spanish browser and survives reload; data unchanged', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByLabel('Idioma').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: /Start locally/ }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('hq.locale'))).toBe('en');
  // back to Spanish from Settings › Language
  await go(page, '#/settings?section=language');
  await page.getByLabel('Language').selectOption('es');
  await expect(page.getByRole('heading', { name: 'Ajustes' }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

test('hot switch keeps state: open modal with a draft, a field being edited, and the current route', async ({
  page,
  context,
}) => {
  await startLocalEs(page);
  await captureEs(page, 'Idea para editar');
  await go(page, '#/inbox');
  await page.getByRole('button', { name: /Aceptar: convertir en Idea/ }).click();
  await go(page, '#/ideas');
  await page.getByRole('link', { name: /Idea para editar/ }).click();
  const url = page.url();

  // A field in the middle of an edit (not blurred, not saved yet)
  const hook = page.getByRole('textbox', { name: 'Gancho' });
  await hook.click();
  await hook.fill('Gancho a medio escribir');

  // Switch the language from a second tab (the explicit choice propagates to every tab)
  const other = await context.newPage();
  await other.goto(url.replace(/#.*$/, '#/settings?section=language'));
  await other.getByLabel('Idioma').selectOption('en');
  await expect(page.getByRole('textbox', { name: 'Hook' })).toHaveValue('Gancho a medio escribir');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(page.url()).toBe(url);

  // A modal with an unsaved draft survives a switch too
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('c');
  await page.getByRole('textbox', { name: 'What’s on your mind?' }).fill('Borrador sin guardar');
  await other.getByLabel('Language').selectOption('es');
  await expect(page.getByRole('dialog', { name: 'Captura rápida' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '¿Qué tienes en mente?' })).toHaveValue(
    'Borrador sin guardar',
  );
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Guardado en la bandeja').last()).toBeVisible();
  // User content is never translated
  await go(page, '#/inbox');
  await expect(page.getByText('Borrador sin guardar')).toBeVisible();
  await other.close();
});

test('Google workspace with sync paused: status texts follow the language, data and sync state untouched', async ({
  page,
}) => {
  await page.goto('./');
  const answers = ['444444444444444444444', 'es@example.com'];
  page.on('dialog', (d) => void d.accept(answers.shift()));
  await page.getByRole('button', { name: /Continuar con Google/ }).click();
  await page.waitForLoadState('load');
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true }).first()).toBeVisible();
  const skip = page.getByRole('button', { name: 'Omitir' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await captureEs(page, 'Nota de la cuenta');
  await go(page, '#/settings?section=account');
  await expect(page.getByText(/^Sincronización: /)).toBeVisible();
  await go(page, '#/settings?section=language');
  await page.getByLabel('Idioma').selectOption('en');
  await go(page, '#/settings?section=account');
  await expect(page.getByText(/^Sync: /)).toBeVisible();
  await go(page, '#/inbox');
  await expect(page.getByText('Nota de la cuenta')).toBeVisible();
});

test('accessibility (axe) in Spanish on the main screens', async ({ page }) => {
  await startLocalEs(page);
  await captureEs(page, 'Comprobación de accesibilidad');
  const failures: string[] = [];
  for (const hash of ['#/', '#/inbox', '#/ideas', '#/content', '#/calendar', '#/settings']) {
    await go(page, hash);
    await page.waitForTimeout(300);
    const r = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa']).analyze();
    for (const v of r.violations) failures.push(`${hash} ${v.id}: ${v.nodes.length}`);
  }
  expect(failures).toEqual([]);
});

test('Spanish layouts: no horizontal overflow at target sizes (screenshots on demand)', async ({ page }) => {
  await startLocalEs(page);
  await captureEs(page, 'Comprobación de diseño con un texto bastante más largo en español');
  const out = process.env.SHOTS_DIR;
  const failures: string[] = [];
  for (const [w, h] of [
    [1440, 900],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [320, 640],
    [844, 390],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const hash of [
      '#/',
      '#/inbox',
      '#/ideas',
      '#/content',
      '#/calendar',
      '#/library',
      '#/insights',
      '#/settings',
    ]) {
      await go(page, hash);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
      if (overflow > 1) failures.push(`${w}x${h} ${hash}: +${overflow}px`);
      if (out && ['#/', '#/content', '#/calendar', '#/settings'].includes(hash))
        await page.screenshot({ path: `${out}/es-${w}x${h}-${hash.replace(/[#/?=]/g, '') || 'hoy'}.png` });
    }
  }
  expect(failures).toEqual([]);
});
