import { expect, test } from '@playwright/test';
import { capture, startLocal } from './helpers';

test('opens with zero network after first load and keeps working offline', async ({ page, context }) => {
  await startLocal(page);
  await capture(page, 'Captured before going offline');
  // Wait for the service worker to precache the shell
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await new Promise<void>((r) => {
      const sw = reg.active ?? reg.waiting ?? reg.installing;
      if (!sw || sw.state === 'activated') return r();
      sw.addEventListener('statechange', () => sw.state === 'activated' && r());
    });
  });
  await page.reload(); // controlled by the SW now
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true }).first()).toBeVisible();
  await capture(page, 'Captured while offline');
  await page.goto(page.url().replace(/#.*$/, '#/inbox'));
  await expect(page.getByText('Captured while offline')).toBeVisible();
  await expect(page.getByText('Captured before going offline')).toBeVisible();
  // Search works offline
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: /Search everything/ }).fill('offline');
  await expect(page.getByRole('option', { name: /Captured while offline/ })).toBeVisible();
  await context.setOffline(false);
});
