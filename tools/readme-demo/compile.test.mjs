import assert from 'node:assert/strict';
import { button } from './actions.mjs';

export default async function compile({ page, start, click, hold }) {
  await start();
  await click(button(page, 'Compile Book'), 850);
  const dialog = page.getByRole('dialog', { name: 'Compile Book' });
  const preview = dialog.getByRole('region', { name: 'Manuscript preview' });
  await preview.getByText(/By the time Murad reached the gates/).waitFor();
  await dialog.getByLabel('File type').selectOption('html');
  await hold(400);
  await click(dialog.getByLabel('Include title page'), 1050);
  assert.match(await preview.innerText(), /HTML/);
  await preview.getByRole('heading', { name: 'The Academy of Small Wonders', exact: true }).waitFor();
}
