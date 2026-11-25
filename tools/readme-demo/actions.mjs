import { setTimeout as delay } from 'node:timers/promises';

export const button = (page, name) => page.getByRole('button', { name, exact: true });
export const chapter = page => button(page, 'Open chapter At the gates');
export const firstScene = page => page.getByRole('button', { name: /^The first encounter / });

export async function openScene(page) {
  await chapter(page).click();
  await firstScene(page).click();
  await page.getByRole('textbox', { name: 'Scene summary' }).waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export function captureActions(recording) {
  const hold = async (milliseconds = 550) => {
    if (recording) await delay(milliseconds);
  };
  const click = async (locator, milliseconds) => {
    await locator.click();
    await hold(milliseconds);
  };
  return { click, hold };
}

// Chromium's recording omits the system pointer. The marker follows actual input,
// including inside the app's native HTML dialogs.
export async function installPointer(page) {
  await page.evaluate(() => {
    const pointer = document.createElement('span');
    pointer.setAttribute('aria-hidden', 'true');
    pointer.style.cssText = [
      'position:fixed', 'pointer-events:none', 'z-index:2147483647',
      'width:16px', 'height:16px', 'border:2px solid #fff', 'border-radius:50%',
      'background:#16715e', 'box-shadow:0 0 0 1px #225147, 0 1px 5px #14272288',
      'transform:translate(-50%, -50%)', 'transition:scale 120ms',
    ].join(';');
    function move(event) {
      const container = event.target instanceof Element ? event.target.closest('dialog[open]') : null;
      const parent = container ?? document.body;
      if (pointer.parentElement !== parent) parent.append(pointer);
      pointer.style.left = `${event.clientX}px`;
      pointer.style.top = `${event.clientY}px`;
    }
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', event => {
      move(event);
      pointer.style.scale = '1.45';
      setTimeout(() => { pointer.style.scale = '1'; }, 220);
    }, true);
  });
}
