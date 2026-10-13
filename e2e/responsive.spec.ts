import { expect, test } from '@playwright/test';
import { capture, go, startLocal } from './helpers';

const SIZES: [number, number][] = [
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [320, 640],
  [844, 390],
];

test('no horizontal page overflow at target sizes', async ({ page }) => {
  await startLocal(page);
  await capture(page, 'Responsive check idea');
  const out = process.env.SHOTS_DIR;
  const failures: string[] = [];
  for (const [w, h] of SIZES) {
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
      if (out && ['#/', '#/content', '#/calendar'].includes(hash))
        await page.screenshot({ path: `${out}/${w}x${h}-${hash.replace(/[#/]/g, '') || 'today'}.png` });
    }
  }
  expect(failures).toEqual([]);
});
