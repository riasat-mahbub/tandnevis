import assert from 'node:assert/strict';
import { button } from './actions.mjs';

export default async function library({ page, start, click, hold, recording }) {
  await start();
  await click(button(page, 'Library'), 800);
  const drawer = page.getByRole('dialog', { name: 'Story Library' });
  const search = drawer.getByRole('searchbox', { name: 'Search all definitions' });
  await search.pressSequentially('Playful', { delay: recording ? 70 : 0 });
  await hold(450);
  const playful = drawer.getByRole('button', { name: /^Playful / });
  assert.equal(await drawer.getByRole('button', { name: /^Murad / }).count(), 0);
  await click(playful, 800);
  assert.equal(await drawer.getByRole('textbox', { name: 'Tone name', exact: true }).inputValue(), 'Playful');
}
