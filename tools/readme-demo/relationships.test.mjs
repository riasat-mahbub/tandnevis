import assert from 'node:assert/strict';
import { button, openScene } from './actions.mjs';

export default async function relationships({ page, start, click, hold }) {
  await openScene(page);
  await start();
  await click(button(page, 'Character graph'), 550);
  await click(button(page, 'After'), 400);
  await click(button(page, 'Fit'), 350);

  const graph = page.locator('.scene-destination:not([hidden]) .relationship-panel');
  const connector = button(graph, 'Start relationship from Murad');
  const rudra = button(graph, 'Focus Rudra');
  await connector.scrollIntoViewIfNeeded();
  const from = await connector.boundingBox();
  const to = await rudra.boundingBox();
  assert.ok(from && to, 'Both drag endpoints are visible');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await hold(260);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    const fraction = step / 10;
    await page.mouse.move(
      (from.x + from.width / 2) * (1 - fraction) + (to.x + to.width / 2) * fraction,
      (from.y + from.height / 2) * (1 - fraction) + (to.y + to.height / 2) * fraction,
    );
    await hold(42);
  }
  await page.mouse.up();
  await graph.getByRole('heading', { name: 'New relationship', exact: true }).waitFor();
  await click(button(graph, 'Trusts'), 600);
  await click(button(graph, 'Apply relationship'), 950);
  await button(graph, 'Edit Murad toward Rudra: Trusts').waitFor();
  const change = page.getByRole('button', { name: /Relationship change: Murad → Rudra.*Trusts.*planned/ });
  await change.waitFor();
  await change.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await hold(1350);
}
