import { expect, test } from '@playwright/test';

test.use({ locale: 'es-ES' });

test('offline in Spanish: app opens, language can be switched offline and the choice persists', async ({
  page,
  context,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: /Empezar en local/ }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true }).first()).toBeVisible();
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await new Promise<void>((r) => {
      const sw = reg.active ?? reg.waiting ?? reg.installing;
      if (!sw || sw.state === 'activated') return r();
      sw.addEventListener('statechange', () => sw.state === 'activated' && r());
    });
  });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true }).first()).toBeVisible();
  await page.goto(page.url().replace(/#.*$/, '#/settings?section=language'));
  await page.getByLabel('Idioma').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await context.setOffline(false);
});
