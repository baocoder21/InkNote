import { expect, test } from '@playwright/test';
import { STORAGE_URL, newDevice, newNote, openNote, pastePicture, register, settled, signIn, treeNames } from './support';

test('a pasted picture is stored and shows on another device, downloaded from the storage', async ({ page, browser }) => {
  const email = await register(page);
  await newNote(page, 'With a picture', 'see below ');
  await pastePicture(page, 'Logo.png');
  await expect(page.locator('.cm-content')).toContainText('](attachment:');
  await settled(page);

  const b = await newDevice(browser);
  const storageRequests: string[] = [];
  b.page.on('request', (r) => r.url().startsWith(`${STORAGE_URL}/`) && storageRequests.push(r.method()));
  await signIn(b.page, email);
  await expect(treeNames(b.page).filter({ hasText: 'With a picture' })).toBeVisible({ timeout: 30_000 });
  await openNote(b.page, 'With a picture');

  const image = b.page.locator('app-markdown-preview img');
  await expect(image).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => image.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  expect(storageRequests, 'the bytes came from the storage with a presigned link the browser can reach').toContain('GET');
  await b.context.close();
});
