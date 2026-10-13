import { expect, test } from '@playwright/test';
import { capture, go, startLocal } from './helpers';

// The provider is mocked at the network layer; no real key or request ever leaves the test.
test('Secretary with BYOK (mocked provider): grounded answer, facts vs recommendation, validator, proposal → confirm → undo, minimal context sent', async ({
  page,
}) => {
  const bodies: string[] = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    bodies.push(req.postData() ?? '');
    const sent = JSON.parse(req.postData() ?? '{}');
    const userText: string = sent.messages?.[0]?.content ?? '';
    const handle = (userText.match(/"handle":"(C\d+)"/) ?? [])[1] ?? 'C1';
    const text = [
      'Facts: [' + handle + '] is producing and missing a cover.',
      'It had 98765 views yesterday.',
      'Recommendation: finish [' + handle + '] first — it is the closest to done.',
      '```actions',
      JSON.stringify([
        {
          type: 'createTask',
          title: 'Pick a cover for the reel',
          content: handle,
          rationale: 'only the cover is missing',
        },
        { type: 'changeStatus', target: handle, status: 'ready' },
        { type: 'createTask', title: 'Ghost', content: 'C99' },
      ]),
      '```',
    ].join('\n');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: sent.model,
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    });
  });

  await startLocal(page);
  // A record that must NOT be sent for a producer question
  await capture(page, 'Unrelated private diary note');
  // Content that is producing
  await go(page, '#/content');
  await page.getByRole('button', { name: 'New content' }).click();
  await page.getByRole('textbox', { name: 'Content title' }).fill('Reel almost done');
  await page.getByRole('textbox', { name: 'Hook' }).fill('A hook');
  await page.getByRole('textbox', { name: 'Script' }).click();

  // Configure BYOK
  await go(page, '#/settings?section=ai');
  await page.getByLabel('API key').fill('sk-ant-TESTKEY-not-real-123456');
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText(/Key saved:/)).toBeVisible();
  await expect(page.getByText('sk-ant-TESTKEY-not-real-123456')).toHaveCount(0); // masked

  await go(page, '#/');
  await page.keyboard.press('Control+j');
  const panel = page.getByRole('complementary', { name: 'Secretary' });
  await panel.getByRole('button', { name: 'Finish fastest' }).click();
  await expect(panel.getByText(/AI recommendation/)).toBeVisible();
  await expect(panel.getByText(/closest to done/)).toBeVisible();
  // Invented metric removed by the grounding validator
  await expect(panel.locator('.answer')).not.toContainText('98765');
  await expect(panel.getByText(/statement\(s\) removed/)).toBeVisible();
  // Unknown record proposal is not applicable
  await expect(panel.getByText(/Can’t apply: Unknown content C99/)).toBeVisible();

  // Low-risk proposal → apply → undo
  const low = panel.locator('.action-card', { hasText: 'Pick a cover' });
  await low.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText(/Applied: Create task/)).toBeVisible();
  // High-risk proposal requires explicit review
  const high = panel.locator('.action-card', { hasText: 'Change' });
  await expect(high.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await high.getByLabel('I reviewed this change').check();
  await high.getByRole('button', { name: 'Apply' }).click();
  // Undo the high-risk change from its toast
  await page
    .getByRole('status')
    .filter({ hasText: /Applied: Change/ })
    .getByRole('button', { name: 'Undo' })
    .click();

  await go(page, '#/tasks');
  await expect(page.getByRole('main').getByText('Pick a cover for the reel')).toBeVisible();
  await go(page, '#/content');
  await page.getByRole('combobox', { name: 'Platform' }).waitFor();
  await expect(
    page.getByRole('main').locator('.col', { hasText: 'Ready' }).getByText('Reel almost done'),
  ).toHaveCount(0);

  // Only the relevant context went to the provider; the key only in headers
  expect(bodies.length).toBe(1);
  expect(bodies[0]).toContain('Reel almost done');
  expect(bodies[0]).not.toContain('Unrelated private diary note');
  expect(bodies[0]).not.toContain('sk-ant-TESTKEY');
});
