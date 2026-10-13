import { expect, test } from '@playwright/test';
import { go, startLocal } from './helpers';

test('performance with a large synthetic workspace', async ({ page }) => {
  test.setTimeout(300_000);
  const c0 = Date.now();
  await page.goto('./');
  await page.getByRole('button', { name: /Start locally/ }).waitFor();
  const coldFirstVisitMs = Date.now() - c0;
  await startLocal(page);
  const w0 = Date.now();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true }).first()).toBeVisible();
  const warmEmptyReloadMs = Date.now() - w0;
  const t0 = Date.now();
  const counts = await page.evaluate(() =>
    (window as unknown as { __sagaTest: { seed: (n: object) => Promise<object> } }).__sagaTest.seed({
      projects: 100,
      ideas: 1000,
      content: 10000,
      secondary: 50000,
    }),
  );
  const seedMs = Date.now() - t0;
  const m: Record<string, number> = { coldFirstVisitMs, warmEmptyReloadMs, seedMs };
  const time = async (name: string, fn: () => Promise<void>) => {
    const s = Date.now();
    await fn();
    m[name] = Date.now() - s;
  };
  await time('coldReloadToToday', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true }).first()).toBeVisible();
    await expect(page.getByText('Needs attention')).toBeVisible();
  });
  await time('ideasList', async () => {
    await go(page, '#/ideas');
    await expect(page.getByRole('link', { name: /Idea \d+/ }).first()).toBeVisible();
  });
  await time('contentBoard', async () => {
    await go(page, '#/content');
    await expect(page.locator('.card').first()).toBeVisible();
  });
  await time('projectDashboard', async () => {
    await go(page, '#/projects');
    await page
      .getByRole('link', { name: /Project 1\b/ })
      .first()
      .click();
    await expect(page.getByText('Next action')).toBeVisible();
  });
  await time('calendarWeek', async () => {
    await go(page, '#/calendar');
    await expect(page.locator('.week')).toBeVisible();
  });
  await go(page, '#/');
  await page.waitForTimeout(3000); // let the search worker finish indexing
  await time('globalSearch', async () => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: /Search everything/ }).fill('old man watching');
    await expect(page.getByRole('option', { name: /old man watching tv/ }).first()).toBeVisible({
      timeout: 20000,
    });
  });
  await page.keyboard.press('Escape');
  await time('localSave', async () => {
    await page.keyboard.press('c');
    await page.getByRole('textbox', { name: "What's on your mind?" }).fill('perf capture');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByText('Saved to Inbox')).toBeVisible();
  });
  await time('accountSwitchReload', async () => {
    await page.evaluate(() => location.reload());
    await expect(page.getByRole('heading', { name: 'Today', exact: true }).first()).toBeVisible();
  });
  console.log(`[perf] dataset ${JSON.stringify(counts)}\n[perf] ${JSON.stringify(m)}`);
  expect(m.coldReloadToToday).toBeLessThan(15000);
  expect(m.globalSearch).toBeLessThan(20000);
});
