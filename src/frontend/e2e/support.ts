import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Browser, BrowserContext, Page, expect } from '@playwright/test';

export const PASSWORD = 'E2e-pass-123!';
export const STORAGE_URL = process.env['E2E_STORAGE_URL'] ?? 'http://localhost:9000';

/** A small real PNG (the app icon): pasted into notes to test attachments. */
export const PNG = readFileSync(join(__dirname, '..', 'public', 'icons', 'icon-192.png'));

export const uniqueEmail = (): string => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** Registers a NEW account through the page and waits until the notes page is open and synchronized. */
export async function register(page: Page, email = uniqueEmail()): Promise<string> {
  await page.goto('/register');
  await page.fill('input[type=email]', email);
  const passwords = page.locator('input[type=password]');
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/notes/);
  await settled(page);
  return email;
}

/** Signs in an existing account (another "device": usually a fresh browser context). */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/notes/);
}

/** A second device: its own cookies, its own local database. */
export async function newDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** The title field of the open note ("app-note-editor input" alone matches the pickers and the Edit/Split/Preview switch too). */
export const titleInput = (page: Page) => page.getByLabel('Note title');

export const syncLabel = (page: Page) => page.locator('app-sync-status .sync__label');

/**
 * Waits until every change has been sent ("All changes synced"). The line still says "synced" for a moment AFTER typing
 * (the autosave waits 0.4 s), so first give it a chance to leave that state, then wait for it to come back.
 */
export async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(() => !/All changes synced/.test(document.querySelector('app-sync-status .sync__label')?.textContent ?? ''), null, { timeout: 3000 })
    .catch(() => undefined);
  await expect(syncLabel(page)).toHaveText(/All changes synced/, { timeout: 40_000 });
}

/** Creates a note with a title and a text, returns its id. */
export async function newNote(page: Page, title: string, text: string): Promise<string> {
  const before = page.url();
  await page.click('button[aria-label="New note"]');
  await page.waitForURL((u) => /\/notes\/[0-9a-f-]{36}$/.test(u.pathname) && u.href !== before);
  const id = new URL(page.url()).pathname.split('/').pop()!;
  await expect(titleInput(page)).toHaveValue('Untitled');
  await titleInput(page).fill(title);
  await page.click('.cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
  return id;
}

export const editor = (page: Page) => page.locator('.cm-content');
export const treeNames = (page: Page) => page.locator('app-explorer-tree .row__name');

export async function openNote(page: Page, title: string): Promise<void> {
  await page.locator('app-explorer-tree .row', { hasText: title }).first().click();
  await expect(titleInput(page)).toHaveValue(title);
}

/** Pastes a picture into the editor, like Ctrl+V of an image on the clipboard. */
export async function pastePicture(page: Page, name: string): Promise<void> {
  await page.evaluate(
    ({ name, b64 }) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'image/png' }));
      document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { name, b64: PNG.toString('base64') },
  );
}
