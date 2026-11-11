import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { editor, newDevice, newNote, openNote, register, settled, treeNames, titleInput } from './support';

test('everything exported can be imported again into another account', async ({ page, browser }, testInfo) => {
  await register(page);
  await newNote(page, 'Alpha', 'text of **alpha**');
  await settled(page);
  await page.click('button[aria-label="New note"]');
  await expect(titleInput(page)).toHaveValue('Untitled');
  await titleInput(page).fill('Beta');
  await page.click('.cm-content');
  await page.keyboard.type('text of beta');
  await settled(page);

  // ---- export ----
  await page.goto('/notes/transfer');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export all notes/ }).click();
  const file = testInfo.outputPath('export.zip');
  await (await download).saveAs(file);

  const zip = unzipSync(new Uint8Array(readFileSync(file)));
  expect(Object.keys(zip)).toEqual(expect.arrayContaining(['Alpha.md', 'Beta.md', '_inknote.json']));
  expect(strFromU8(zip['Alpha.md'])).toContain('text of **alpha**');

  // ---- import into ANOTHER account ----
  const other = await newDevice(browser);
  await register(other.page);
  await other.page.goto('/notes/transfer');
  // The page's own picker: the sidebar has a hidden one too (for "Import into this folder").
  await other.page.setInputFiles('app-transfer-page input[type=file]', file);
  await expect(other.page.locator('app-transfer-page')).toContainText('Imported 2 notes', { timeout: 30_000 });
  await settled(other.page);

  await other.page.goto('/notes');
  await expect(treeNames(other.page).filter({ hasText: 'Alpha' })).toBeVisible();
  await expect(treeNames(other.page).filter({ hasText: 'Beta' })).toBeVisible();
  await openNote(other.page, 'Alpha');
  await expect(editor(other.page)).toContainText('text of **alpha**');
  await other.context.close();
});

test('a file that cannot be imported is listed with its reason, and nothing else is lost', async ({ page }, testInfo) => {
  await register(page);
  await page.goto('/notes/transfer');
  const bad = testInfo.outputPath('report.docx');
  writeFileSync(bad, 'not importable');
  const good = testInfo.outputPath('Good note.md');
  writeFileSync(good, '# Good note\n\nhello\n');

  await page.setInputFiles('app-transfer-page input[type=file]', [bad, good]);

  const report = page.locator('app-transfer-page');
  await expect(report).toContainText('Imported 1 note.', { timeout: 30_000 });
  await expect(report).toContainText('report.docx');
  await expect(report).toContainText('only .md, .markdown, .txt and .zip files can be imported');
});
