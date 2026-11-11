import { expect, test } from '@playwright/test';
import { editor, newDevice, newNote, openNote, register, settled, signIn, treeNames, titleInput } from './support';

test('a note reaches a second device by itself, and a change on one device shows on the other', async ({ page, browser }) => {
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  const email = await register(page);

  await newNote(page, 'Shared note', 'written on device A');
  await settled(page);
  expect(sockets.some((u) => u.includes('/hubs/sync')), 'the real-time connection (SignalR) is open through nginx').toBe(true);

  const b = await newDevice(browser);
  await signIn(b.page, email);
  await expect(treeNames(b.page).filter({ hasText: 'Shared note' })).toBeVisible({ timeout: 30_000 });
  await openNote(b.page, 'Shared note');
  await expect(editor(b.page)).toContainText('written on device A');

  // real time: typing on B appears on A without any reload
  await b.page.click('.cm-content');
  await b.page.keyboard.press('Control+End');
  await b.page.keyboard.type(' + typed on B');
  await expect(editor(page)).toContainText('typed on B', { timeout: 30_000 });
  await b.context.close();
});

test('a reload on a note address keeps the session (nginx falls back to the app, the refresh cookie restores the login)', async ({ page }) => {
  await register(page);
  const id = await newNote(page, 'Deep link', 'still here');
  await settled(page);

  await page.goto(`/notes/${id}`);

  await expect(titleInput(page)).toHaveValue('Deep link');
  await expect(editor(page)).toContainText('still here');
});

test('a visitor who is not signed in is sent to the login page', async ({ page }) => {
  await page.goto('/notes');

  await page.waitForURL(/\/login/);
});

test('the installed app opens a note offline (service worker + local database)', async ({ page, context }) => {
  await register(page);
  const id = await newNote(page, 'Offline note', 'available without a connection');
  await settled(page);
  await page.goto(`/notes/${id}`);
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated');
  await page.waitForTimeout(4000); // let the service worker finish keeping the app files

  await context.setOffline(true);
  await page.reload();

  await expect(titleInput(page)).toHaveValue('Offline note');
  await expect(editor(page)).toContainText('available without a connection');

  // back online: changes made offline are sent. (Wait for the page to settle before leaving it: see support.ts.)
  await context.setOffline(false);
  await settled(page);
});
