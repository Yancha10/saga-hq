import { expect, test } from '@playwright/test';
import { startLocal } from './helpers';

test('phone: bottom navigation, capture sheet as bottom sheet, content list (no kanban)', async ({
  page,
}) => {
  await startLocal(page);
  const nav = page.getByRole('navigation', { name: 'Primary' }).last();
  await expect(nav.getByRole('link', { name: 'Today' })).toBeVisible();
  await nav.getByRole('button', { name: 'Capture' }).click();
  await expect(page.getByRole('dialog', { name: 'Capture' })).toBeVisible();
  await page.getByRole('textbox', { name: "What's on your mind?" }).fill('Thumb capture');
  await page.getByRole('button', { name: 'Save' }).click();
  await nav.getByRole('link', { name: 'Content' }).click();
  await expect(page.getByRole('heading', { name: 'Content' }).first()).toBeVisible();
  await expect(page.locator('.board')).toHaveCount(0);
  await nav.getByRole('link', { name: /More/ }).click();
  await expect(page.getByRole('link', { name: /Inbox/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
