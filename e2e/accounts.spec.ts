import { expect, type Page, test } from '@playwright/test';
import { capture, dumpBrowserStorage, go } from './helpers';

const SUB_A = '111111111111111111111';
const SUB_B = '222222222222222222222';
const SUB_C = '333333333333333333333';

async function mockSignIn(page: Page, sub: string, email: string, trigger: () => Promise<void>) {
  const answers = [sub, email];
  const handler = (d: import('@playwright/test').Dialog) => void d.accept(answers.shift());
  page.on('dialog', handler);
  await trigger();
  await page.waitForLoadState('load');
  await expect(page.getByRole('heading', { name: 'Today', exact: true }).first()).toBeVisible();
  page.off('dialog', handler);
  const skip = page.getByRole('button', { name: 'Skip' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test('peer accounts A/B/C are isolated; raw Google sub never persisted; db names use opaque ids', async ({
  page,
}) => {
  await page.goto('./');
  await mockSignIn(page, SUB_A, 'a@example.com', () =>
    page.getByRole('button', { name: /Continue with Google/ }).click(),
  );
  await capture(page, 'Account A private strategy');

  // Add account B (peer, not guest)
  await go(page, '#/settings?section=account');
  await mockSignIn(page, SUB_B, 'b@example.com', () =>
    page.getByRole('button', { name: 'Add Google account' }).click(),
  );
  await go(page, '#/inbox');
  await expect(page.getByText('Account A private strategy')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: /Search everything/ }).fill('private strategy');
  await expect(page.getByText(/No matching records/)).toBeVisible();
  await page.keyboard.press('Escape');
  // Secretary context in B never contains A
  await page.keyboard.press('Control+j');
  await page.getByRole('button', { name: /inspect context/ }).click();
  await expect(page.locator('pre.json')).not.toContainText('Account A');
  await page.keyboard.press('Control+j');
  await capture(page, 'Account B note');

  // Account C
  await go(page, '#/settings?section=account');
  await mockSignIn(page, SUB_C, 'c@example.com', () =>
    page.getByRole('button', { name: 'Add Google account' }).click(),
  );
  await go(page, '#/inbox');
  await expect(page.getByText('Account A private strategy')).toHaveCount(0);
  await expect(page.getByText('Account B note')).toHaveCount(0);

  // Switch A ↔ B repeatedly; each side only ever sees its own data
  for (let i = 0; i < 3; i++) {
    for (const [email, mine, other] of [
      ['a@example.com', 'Account A private strategy', 'Account B note'],
      ['b@example.com', 'Account B note', 'Account A private strategy'],
    ] as const) {
      await go(page, '#/settings?section=account');
      await page.locator('.row', { hasText: email }).getByRole('button', { name: 'Switch' }).click();
      await page.waitForLoadState('load');
      await go(page, '#/inbox');
      await expect(page.getByText(mine)).toBeVisible();
      await expect(page.getByText(other)).toHaveCount(0);
    }
  }

  const dump = await dumpBrowserStorage(page);
  for (const sub of [SUB_A, SUB_B, SUB_C]) expect(dump.includes(sub), `raw sub ${sub} persisted`).toBe(false);
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  const ws = names.filter((n) => n?.startsWith('sagahq-') && n !== 'sagahq-registry');
  expect(ws.length).toBe(3);
  for (const n of ws) expect(n).toMatch(/^sagahq-[a-z2-7]{32}$/);
  // B's backup never contains A (we are on B after the loop)
  await go(page, '#/settings?section=backup');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const fs = await import('node:fs');
  const text = fs.readFileSync((await dl.path())!, 'utf8');
  expect(text).toContain('Account B note');
  expect(text).not.toContain('Account A private strategy');
  for (const sub of [SUB_A, SUB_B, SUB_C]) expect(text.includes(sub)).toBe(false);
});
