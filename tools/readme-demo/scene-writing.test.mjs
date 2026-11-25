import assert from 'node:assert/strict';
import { button, openScene } from './actions.mjs';

export default async function sceneWriting({ page, start, click, hold }) {
  await openScene(page);
  await start();

  const summary = page.getByRole('textbox', { name: 'Scene summary' });
  await click(summary, 250);
  await summary.press('Control+End');
  await summary.press('Enter');
  await click(button(page, 'Character: Murad'));
  await page.getByLabel('Search all story blocks').fill('Awe');
  await click(button(page, 'Emotion: Awe'), 800);
  assert.match(await summary.innerText(), /Murad.*Awe/s);

  const prose = page.getByRole('textbox', { name: 'Scene prose', exact: true });
  await click(prose, 250);
  await prose.press('Control+End');
  await prose.press('Enter');
  await prose.press('Enter');
  const line = 'Rudra took a brass key from his sleeve.';
  for (const word of line.match(/\S+\s*/g)) {
    await page.keyboard.insertText(word);
    await hold(100);
  }
  assert.ok((await prose.inputValue()).endsWith(line));
  await hold(900);
}
