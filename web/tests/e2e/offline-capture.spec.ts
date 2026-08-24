import { expect, test } from '@playwright/test';

test('offline Capture preserves exact text in the encrypted sync queue', async ({ page }) => {
  const rawText = '  Keep this exact offline thought.  ';
  await page.goto('/offline-capture.html');
  await page.getByRole('textbox').fill(rawText);
  await page.getByRole('button', { name: 'Save for sync' }).click();
  await expect(page.getByRole('status')).toHaveText('Capture saved for sync.');

  const queued = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('planner-ai-capture-queue', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const transaction = database.transaction(['captures', 'meta'], 'readonly');
    const records = await read<
      Array<{ id: string; text: { iv: number[]; ciphertext: ArrayBuffer } }>
    >(transaction.objectStore('captures').getAll());
    const key = await read<CryptoKey>(transaction.objectStore('meta').get('capture-key-v1'));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(records[0].text.iv) },
      key,
      records[0].text.ciphertext
    );
    database.close();
    return {
      count: records.length,
      id: records[0].id,
      rawText: new TextDecoder().decode(plaintext),
    };
  });

  expect(queued.count).toBe(1);
  expect(queued.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(queued.rawText).toBe(rawText);
});

test('PWA metadata points to the private offline shell', async ({ request }) => {
  const manifestResponse = await request.get('/manifest.json');
  expect(manifestResponse.ok()).toBe(true);
  await expect(manifestResponse.json()).resolves.toMatchObject({
    name: 'Planner AI',
    start_url: '/inbox',
    display: 'standalone',
  });
  expect((await request.get('/sw.js')).ok()).toBe(true);
  expect((await request.get('/planner-icon.svg')).ok()).toBe(true);
});
