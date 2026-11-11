import { expect, test } from '@playwright/test';
import { editor, newNote, register, settled, titleInput } from './support';

const bar = (page: import('@playwright/test').Page) => page.locator('.cm-ink-selection-toolbar');

test('selecting text shows a formatting bar; its buttons format the selection; it goes away with the selection', async ({ page }) => {
  await register(page);
  await newNote(page, 'Format me', 'hello brave new world');
  await expect(bar(page)).toBeHidden(); // a cursor only

  await page.keyboard.press('Shift+Home'); // select the line with the keyboard
  await expect(bar(page)).toBeVisible();

  await bar(page).getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(editor(page)).toContainText('**hello brave new world**');
  await expect(bar(page)).toBeVisible(); // the selection is still there: the next button can be used at once

  await bar(page).getByRole('button', { name: 'Bold', exact: true }).click(); // a switch
  await expect(editor(page)).not.toContainText('**');

  await bar(page).getByRole('button', { name: 'Bulleted list' }).click();
  await expect(editor(page)).toContainText('- hello brave new world');

  await page.keyboard.press('ArrowRight'); // the selection ends
  await expect(bar(page)).toBeHidden();
  await settled(page);
});

test('the bar waits for the mouse button when the selection is dragged, and leaves with the focus', async ({ page }) => {
  await register(page);
  await newNote(page, 'Drag select', 'one two three four five');
  const line = await page.locator('.cm-line').first().boundingBox();
  const y = line!.y + line!.height / 2;

  await page.mouse.move(line!.x + 3, y);
  await page.mouse.down();
  await page.mouse.move(line!.x + 140, y, { steps: 6 });
  await expect(bar(page)).toBeHidden(); // still dragging
  await page.mouse.up();
  await expect(bar(page)).toBeVisible();

  await titleInput(page).click(); // the editor loses the focus
  await expect(bar(page)).toBeHidden();
});

test('one undo takes a whole formatting step back', async ({ page }) => {
  await register(page);
  await newNote(page, 'Undo me', 'plain words');
  await page.keyboard.press('Shift+Home');
  await bar(page).getByRole('button', { name: 'Italic' }).click();
  await expect(editor(page)).toContainText('*plain words*');

  await page.keyboard.press('Control+z');

  await expect(editor(page)).not.toContainText('*');
});
