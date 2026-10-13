import { expect, test } from '@playwright/test';
import { capture, go, startLocal } from './helpers';

test('daily loop without any AI key: capture → idea → content → production → schedule → publish → results → learning → find it', async ({
  page,
}) => {
  await startLocal(page);

  // Capture in seconds
  const ms = await capture(page, 'Old man reacts to GTA VI trailer in a bar');
  console.log(`[metric] text capture round-trip: ${ms}ms`);
  expect(ms).toBeLessThan(5000);

  // Triage → Idea
  await go(page, '#/inbox');
  await page.getByRole('button', { name: /Accept: make Idea/ }).click();
  await expect(page.getByText('Moved to Idea')).toBeVisible();

  // Idea detail
  await go(page, '#/ideas');
  await page.getByRole('link', { name: /Old man reacts to GTA VI trailer/ }).click();
  await page.getByRole('textbox', { name: 'Hook' }).fill('He has waited 13 years for this');
  await page.getByRole('textbox', { name: 'Concept' }).click(); // blur → autosave
  await page.getByRole('button', { name: 'Make content' }).click();
  await page.getByRole('button', { name: 'Create content' }).click();
  await expect(page.getByRole('textbox', { name: 'Content title' })).toHaveValue(/Old man reacts/);

  // Production: hook carried over; fill script, export, cover, caption
  await expect(page.getByRole('textbox', { name: 'Hook' })).toHaveValue('He has waited 13 years for this');
  await page
    .getByRole('textbox', { name: 'Script' })
    .fill('Bar. TV on. Trailer starts. He stands up slowly.');
  await page.getByRole('textbox', { name: 'Final export URL' }).fill('https://drive.example.com/final.mp4');
  await page.getByRole('textbox', { name: 'Cover URL' }).fill('https://drive.example.com/cover.jpg');
  await page.getByRole('textbox', { name: 'Caption' }).fill('Thirteen years. #gta6');
  await page.getByRole('textbox', { name: 'Content title' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Moved to Producing' }).first()).toBeVisible();

  // Schedule on Instagram today +2h
  await page.getByRole('button', { name: 'Instagram' }).first().click();
  const when = new Date(Date.now() + 2 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
  await page.getByLabel('Instagram publish time').fill(local);
  await expect(page.getByText('Everything required is in place.')).toBeVisible();

  // Today shows it
  await go(page, '#/');
  await expect(page.getByText(/Old man reacts/).first()).toBeVisible();

  // Publish with URL
  await go(page, '#/content');
  await page
    .getByRole('link', { name: /Old man reacts/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Mark published' }).click();
  await page.getByLabel('Post URL (optional, recommended)').fill('https://www.instagram.com/reel/ABC123/');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Published —/)).toBeVisible();

  // Manual results
  await page.getByRole('button', { name: 'Log results' }).click();
  await page.getByLabel('Views / plays').fill('12500');
  await page.getByLabel('Likes').fill('900');
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page.getByText('Results saved')).toBeVisible();

  // Learning linked to the content
  await page.getByRole('button', { name: 'Write learning' }).click();
  await page.getByLabel('Statement').fill('Bar reaction format got strong early views on Instagram');
  await page.getByRole('button', { name: 'Save learning' }).click();
  await expect(page.getByText('Learning saved')).toBeVisible();

  // Find it again offline-capable search (⌘K)
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: /Search everything/ }).fill('bar reaction');
  await expect(page.getByRole('option', { name: /Bar reaction format/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Learning' }).first()).toBeVisible();
  await expect(page.getByText('Linked evidence')).toBeVisible();
});

test('Secretary without API key gives facts and the copy-prompt fallback', async ({ page }) => {
  await startLocal(page);
  await page.keyboard.press('Control+j');
  const panel = page.getByRole('complementary', { name: 'Secretary' });
  await expect(panel.getByText('No AI provider configured')).toBeVisible();
  await expect(panel.getByText('Workspace facts', { exact: true })).toBeVisible();
  await expect(panel.getByRole('link', { name: /Open ChatGPT/ })).toHaveAttribute(
    'href',
    'https://chatgpt.com/',
  );
  await expect(panel.getByRole('link', { name: /Open Claude/ })).toHaveAttribute(
    'href',
    'https://claude.ai/new',
  );
});

test('backup export → restore round trip in the browser', async ({ page }) => {
  await startLocal(page);
  await capture(page, 'Backup me');
  await go(page, '#/settings?section=backup');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.getByText(/Backup “/)).toBeVisible();
  await page.getByRole('button', { name: 'Restore…' }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText(/Restored:/)).toBeVisible();
  await go(page, '#/inbox');
  await expect(page.getByText('Backup me')).toBeVisible();
});
