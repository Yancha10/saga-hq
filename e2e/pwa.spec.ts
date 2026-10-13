import { expect, test } from '@playwright/test';

test('installable manifest, relative scope, service worker registered', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await request.get(new URL(href!, page.url()).toString());
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('./');
  expect(m.scope).toBe('./');
  expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(new URL('./', page.url()).toString());
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
});
