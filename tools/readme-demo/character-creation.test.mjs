import assert from 'node:assert/strict';
import { button } from './actions.mjs';

export default async function characterCreation({ page, start, click, hold }) {
  await button(page, 'Library').click();
  await page.getByRole('dialog', { name: 'Story Library' }).getByRole('button', { name: 'New character', exact: true }).click();
  const wizard = page.getByTestId('character-creation-wizard');
  await wizard.waitFor();
  await start();
  await hold(600);
  await click(button(wizard, 'Choose a stock type'), 700);
  await wizard.getByRole('searchbox', { name: 'Search stock types' }).fill('Schoolmaster');
  await click(button(wizard, 'Preview The Schoolmaster'), 700);
  await click(button(wizard, 'Use this type and continue'), 350);
  await wizard.getByLabel('Character name').fill('Headmistress Vale');
  await click(button(wizard, 'Next: Profile details'));
  await click(wizard.getByText('Optional default guidance', { exact: true }), 200);
  await wizard.getByLabel('Default tone', { exact: true }).selectOption('playful');
  await hold(650);
  await click(button(wizard, 'Next: Review'), 1250);
  assert.match(await wizard.getByTestId('character-wizard-review-guidance').innerText(), /Playful/);
  await click(button(wizard, 'Create character'), 950);
  await wizard.waitFor({ state: 'hidden' });
  const profile = page.getByRole('dialog', { name: 'Story Library' });
  assert.equal(await profile.getByRole('textbox', { name: 'Character name', exact: true }).inputValue(), 'Headmistress Vale');
  assert.equal(await profile.getByRole('combobox', { name: /^Default tone/ }).inputValue(), 'playful');
}
