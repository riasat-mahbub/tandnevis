import assert from 'node:assert/strict';
import { button, chapter, firstScene } from './actions.mjs';

export default async function outline({ page, start, click, hold }) {
  await start();
  await hold(900);
  await click(chapter(page), 750);
  await page.getByRole('main', { name: 'Chapter canvas: At the gates' }).waitFor();
  await click(firstScene(page), 850);
  const beat = page.getByRole('textbox', { name: 'Freeform text for beat 1', exact: true });
  assert.match(await beat.innerText(), /Rudra asks/);
  await click(button(page, 'Move beat 1 down'), 950);
  assert.match(await beat.innerText(), /The procession slows/);
}
