import { expect, test, type Page } from '@playwright/test';
import { newNote, register, settled } from './support';

const widthOf = async (page: Page, selector: string): Promise<number> => (await page.locator(selector).boundingBox())!.width;
/** The share of the width taken by the editor (the two panes and the 8 px divider fill the grid). */
const editorShare = async (page: Page): Promise<number> => (await widthOf(page, 'app-markdown-editor')) / (await widthOf(page, '.panes'));

test('the divider between the editor and the preview can be dragged, is remembered, and resets with a double click', async ({ page }) => {
  await register(page);
  await newNote(page, 'Resize me', 'some text');
  await settled(page);
  expect(await editorShare(page)).toBeCloseTo(0.5, 1);

  // drag it with the mouse to about 30% of the width
  const panes = (await page.locator('.panes').boundingBox())!;
  const divider = page.locator('app-split-divider');
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(panes.x + panes.width * 0.3, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await editorShare(page)).toBeCloseTo(0.3, 1);
  await expect(divider).toHaveAttribute('aria-valuenow', /^(29|30|31)$/);

  // it is kept for the next visit
  await page.reload();
  await expect(page.locator('app-markdown-editor')).toBeVisible();
  expect(await editorShare(page)).toBeCloseTo(0.3, 1);

  // it cannot be dragged away: the editor keeps at least a fifth of the width
  const again = (await divider.boundingBox())!;
  await page.mouse.move(again.x + again.width / 2, again.y + 40);
  await page.mouse.down();
  await page.mouse.move(panes.x + 2, again.y + 40, { steps: 6 });
  await page.mouse.up();
  expect(await editorShare(page)).toBeGreaterThanOrEqual(0.19);

  // the keyboard works too, and a double click goes back to half and half
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '22');
  await divider.dblclick();
  expect(await editorShare(page)).toBeCloseTo(0.5, 1);
});

test('the text of a table cell starts at the left whatever the table says, and a short word is not broken apart', async ({ page }) => {
  await register(page);
  await newNote(page, 'Table', '');
  await page.keyboard.insertText(
    ['| Model | Strength | Task |', '| :--- | :----: | ---: |', '| Sonnet | Team coding | Implement, refactor |', '| Opus | Design | Video, games |'].join('\n'),
  );
  const cells = page.locator('app-markdown-preview table th, app-markdown-preview table td');
  await expect(cells).toHaveCount(9);

  const aligns = await cells.evaluateAll((all) => all.map((c) => getComputedStyle(c).textAlign));
  expect(aligns).toEqual(Array(9).fill('left')); // the centered and the right-aligned columns too

  // "Sonnet" is on ONE line (a narrow column used to cut it into "Sonn" and "et")
  const lines = await page.locator('app-markdown-preview td', { hasText: 'Sonnet' }).evaluate((td) => {
    const range = document.createRange();
    range.selectNodeContents(td);
    return range.getClientRects().length;
  });
  expect(lines).toBe(1);
});
