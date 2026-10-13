import { expect, test } from '@playwright/test';
import { capture, startLocal } from './helpers';

// Runs against the exact production artifact at `/`, at `/saga-hq/` and on a phone viewport.
test('essential: open, local workspace, capture persists across reload, navigation works', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await startLocal(page);
  const isPhone = (page.viewportSize()?.width ?? 1000) < 640;
  if (isPhone) {
    await page.getByRole('button', { name: 'Capture', exact: true }).last().click();
    await page.getByRole('textbox', { name: "What's on your mind?" }).fill('Phone capture idea');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved to Inbox')).toBeVisible();
  } else {
    await capture(page, 'Essential capture idea');
  }
  await page.reload();
  await page.goto('./#/inbox');
  await expect(page.getByText(isPhone ? 'Phone capture idea' : 'Essential capture idea')).toBeVisible();
  for (const [hash, heading] of [
    ['#/ideas', 'Ideas'],
    ['#/content', 'Content'],
    ['#/calendar', 'Calendar'],
    ['#/library', 'Library'],
    ['#/insights', 'Insights'],
    ['#/settings', 'Settings'],
  ]) {
    await page.goto(`./${hash}`);
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
  }
  expect(errors.filter((e) => !/service worker|favicon/i.test(e))).toEqual([]);
});
