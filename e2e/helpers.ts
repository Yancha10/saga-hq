import { expect, type Page } from '@playwright/test';

export async function startLocal(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: /Start locally/ }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true }).first()).toBeVisible();
  const skip = page.getByRole('button', { name: 'Skip' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

export async function capture(page: Page, text: string): Promise<number> {
  const t0 = Date.now();
  await page.keyboard.press('Escape');
  await page
    .locator('body')
    .click({ position: { x: 5, y: 5 } })
    .catch(() => {});
  await page.keyboard.press('c');
  const box = page.getByRole('textbox', { name: 'What’s on your mind?' });
  await box.fill(text);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Saved to Inbox').last()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); // sheet finished its close transition
  return Date.now() - t0;
}

export async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
}

/** Every string stored in IndexedDB + local/session storage for this origin (for leak scans). */
export async function dumpBrowserStorage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++)
      out.push(localStorage.key(i)!, localStorage.getItem(localStorage.key(i)!) ?? '');
    for (let i = 0; i < sessionStorage.length; i++)
      out.push(sessionStorage.key(i)!, sessionStorage.getItem(sessionStorage.key(i)!) ?? '');
    const dbs = await indexedDB.databases();
    for (const info of dbs) {
      if (!info.name) continue;
      out.push(`DB:${info.name}`);
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(info.name!);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((res) => {
          const tx = db.transaction(store, 'readonly');
          const req = tx.objectStore(store).getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => res([]);
        });
        out.push(
          `STORE:${store}`,
          JSON.stringify(rows, (_k, v) =>
            v instanceof ArrayBuffer || ArrayBuffer.isView(v)
              ? '[binary]'
              : typeof CryptoKey !== 'undefined' && v instanceof CryptoKey
                ? '[cryptokey]'
                : v,
          ),
        );
      }
      db.close();
    }
    return out.join('\n');
  });
}
