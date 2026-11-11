import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { indentOf, newFolder, newNote, register, rowOf, settled } from './support';

test('a note can be dragged into a folder and back out to the top level, and it stays there after a reload', async ({ page }) => {
  await register(page);
  await newNote(page, 'Draggable', 'some text');
  await settled(page);
  await newFolder(page, 'Docs');
  expect(await indentOf(page, 'Draggable')).toBe(0.5); // at the top level, like the folder

  await rowOf(page, 'Draggable').dragTo(rowOf(page, 'Docs'));

  await expect(page.getByText('Moved "Draggable" to "Docs"')).toBeVisible();
  await expect.poll(() => indentOf(page, 'Draggable')).toBe(1.5); // inside the (now open) folder
  await settled(page);
  await page.reload();
  await expect.poll(() => indentOf(page, 'Draggable')).toBe(1.5);

  // out again: onto the empty space of the tree
  await rowOf(page, 'Draggable').dragTo(page.locator('app-explorer-tree'), { targetPosition: { x: 120, y: 420 } });

  await expect(page.getByText('Moved "Draggable" to the top level')).toBeVisible();
  await expect.poll(() => indentOf(page, 'Draggable')).toBe(0.5);
});

test('the right-click menu of a folder exports it as a zip and imports files into it', async ({ page }, testInfo) => {
  await register(page);
  await newNote(page, 'Inside', 'kept in the box');
  await settled(page);
  await newFolder(page, 'Box');
  await rowOf(page, 'Inside').dragTo(rowOf(page, 'Box'));
  await expect.poll(() => indentOf(page, 'Inside')).toBe(1.5);
  await settled(page);

  // the menu itself
  await rowOf(page, 'Box').click({ button: 'right' });
  const menu = page.locator('.cdk-overlay-container li[nz-menu-item]');
  await expect(menu).toContainText(['New note here', 'New subfolder', 'Import into this folder…', 'Export this folder', 'Rename', 'Delete folder']);

  // export
  const download = page.waitForEvent('download');
  await menu.filter({ hasText: 'Export this folder' }).click();
  const zipPath = testInfo.outputPath('Box.zip');
  const saved = await download;
  await saved.saveAs(zipPath);
  expect(saved.suggestedFilename()).toBe('Box.zip');
  const files = Object.keys(unzipSync(new Uint8Array(readFileSync(zipPath)))).filter((n) => n !== '_inknote.json');
  expect(files.sort()).toEqual(['Box/', 'Box/Inside.md']);

  // import INTO the folder: the menu item opens the file picker
  const mdPath = testInfo.outputPath('From file.md');
  writeFileSync(mdPath, '# From file\n\nhello\n');
  await rowOf(page, 'Box').click({ button: 'right' });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.cdk-overlay-container li[nz-menu-item]').filter({ hasText: 'Import into this folder' }).click();
  await (await chooser).setFiles(mdPath);

  await expect(page.getByText('Imported 1 note into "Box"')).toBeVisible();
  await expect.poll(() => indentOf(page, 'From file')).toBe(1.5); // landed in the folder, not at the top
});

test('a click on the empty space of the tree makes new notes and folders go to the top level (like VS Code)', async ({ page }) => {
  await register(page);
  await newNote(page, 'Anchor', 'x');
  await settled(page);
  await newFolder(page, 'Docs'); // made at the top, and now the CURRENT folder
  const newNoteButton = page.locator('button[aria-label="New note"]');
  await expect(newNoteButton).toHaveAttribute('title', 'New note in Docs');

  // while a folder is selected, a new note goes inside it
  await newNote(page, 'Inside docs', 'in');
  await settled(page);
  expect(await indentOf(page, 'Inside docs')).toBe(1.5);

  // click the empty space: nothing is selected, so the next ones are at the top
  await page.locator('app-explorer-tree').click({ position: { x: 120, y: 300 } });
  await expect(newNoteButton).toHaveAttribute('title', 'New note');
  await newNote(page, 'At the top', 'out');
  await settled(page);
  expect(await indentOf(page, 'At the top')).toBe(0.5);

  await page.locator('app-explorer-tree').click({ position: { x: 120, y: 300 } });
  await newFolder(page, 'Top folder');
  expect(await indentOf(page, 'Top folder')).toBe(0.5);
});
