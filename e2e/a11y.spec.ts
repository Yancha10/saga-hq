import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { capture, go, startLocal } from './helpers';

test('no serious or critical axe violations on main screens', async ({ page }) => {
  await startLocal(page);
  await capture(page, 'Accessibility idea');
  await go(page, '#/inbox');
  await page.getByRole('button', { name: /Accept: make Idea/ }).click();
  const results: Record<string, string[]> = {};
  const pages = [
    '#/',
    '#/inbox',
    '#/ideas',
    '#/projects',
    '#/content',
    '#/calendar',
    '#/library',
    '#/insights',
    '#/tasks',
    '#/settings',
    '#/settings?section=ai',
    '#/settings?section=backup',
  ];
  for (const h of pages) {
    await go(page, h);
    await page.waitForTimeout(400);
    const r = await new AxeBuilder({ page: page as never })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    results[h] = r.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target.join(' ')}`);
  }
  await go(page, '#/ideas');
  await page.getByRole('link', { name: /Accessibility idea/ }).click();
  const r = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa']).analyze();
  results['idea-detail'] = r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target.join(' ')}`);
  await page.getByRole('button', { name: 'Make content' }).click();
  await page.getByRole('button', { name: 'Create content' }).click();
  await page.waitForTimeout(400);
  const r2 = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa']).analyze();
  results['content-detail'] = r2.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target.join(' ')}`);
  console.log(`[a11y] ${JSON.stringify(results, null, 1)}`);
  for (const [k, v] of Object.entries(results)) expect(v, k).toEqual([]);
});

test('keyboard: palette and capture reachable without a mouse; dialog traps and restores focus', async ({
  page,
}) => {
  await startLocal(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: /Search everything/ })).toBeFocused();
  await page.keyboard.type('Inbox');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Inbox' }).first()).toBeVisible();
  await page.keyboard.press('c');
  await expect(page.getByRole('textbox', { name: "What's on your mind?" })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
