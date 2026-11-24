#!/usr/bin/env node
// Run only against this repository's built Windows app. No production debug hook is installed.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const starterCatalog = require('../src/content/starter-presets.json');

const root = path.resolve(__dirname, '..');
const presetPalette = ['#BE527A', '#B98116', '#C85343', '#8260AD', '#527FB0', '#25877F', '#657080'];
const presetFamilyNames = ['Connection', 'Positive energy', 'Conflict', 'Unease', 'Vulnerability', 'Discovery', 'Focus'];
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log('Usage: node tools/native-smoke.cjs [--wizard-continuation | --workspace | --compile | --relationships] [--exe path/to/shorthand-writer.exe]\nRequires a built Windows app. Launches that exact child with an isolated WebView2 profile and temporary CDP port.');
  process.exit(0);
}
const exeIndex = argv.indexOf('--exe');
const continuationIndex = argv.indexOf('--wizard-continuation');
const focusedWorkspace = argv.includes('--workspace');
const focusedCompile = argv.includes('--compile');
const focusedRelationships = argv.includes('--relationships');
const modeArgs = argv.filter(arg => arg === '--wizard-continuation' || arg === '--workspace' || arg === '--compile' || arg === '--relationships');
const remainingArgs = argv.filter(arg => !modeArgs.includes(arg));
const validArgs = modeArgs.length <= 1 && (remainingArgs.length === 0 || remainingArgs.length === 2 && remainingArgs[0] === '--exe' && !!remainingArgs[1]);
if (!validArgs) {
  console.error('Usage: node tools/native-smoke.cjs [--wizard-continuation | --workspace | --compile | --relationships] [--exe path/to/shorthand-writer.exe]');
  process.exit(2);
}
const exe = path.resolve(root, exeIndex >= 0 ? argv[exeIndex + 1] ?? '' : 'src-tauri/target/release/shorthand-writer.exe');
const focusedWizardContinuation = continuationIndex >= 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function rgbChannels(value) {
  const match = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value);
  assert.ok(match, `Expected computed RGB color, received ${value}`);
  return match.slice(1).map(Number);
}
function linearChannel(channel) {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}
function contrastRatio(background, foreground) {
  const luminance = color => {
    const [red, green, blue] = rgbChannels(color).map(linearChannel);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const values = [luminance(background), luminance(foreground)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function assertDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Refusing recursive cleanup outside this smoke run directory.');
  }
}
async function checkedCleanupTarget(run, temporary) {
  const resolvedRun = path.resolve(run);
  const resolvedTarget = path.resolve(temporary);
  assertDescendant(resolvedRun, resolvedTarget);
  const stats = await fs.lstat(resolvedTarget);
  if (stats.isSymbolicLink()) throw new Error('Refusing recursive cleanup of a linked temporary directory.');
  const [realRun, realTarget] = await Promise.all([fs.realpath(resolvedRun), fs.realpath(resolvedTarget)]);
  assertDescendant(realRun, realTarget);
  return realTarget;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function requestWindowClose(processId) {
  assert.ok(Number.isSafeInteger(processId) && processId > 0, 'Close target must be the exact launched child process.');
  // WM_CLOSE follows the same native path as the title-bar cross. Resolve only
  // our own child HWND; never enumerate or signal unrelated application windows.
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class SmokeClose { [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool PostMessage(IntPtr hWnd, uint message, UIntPtr wParam, IntPtr lParam); }'
$target = [System.Diagnostics.Process]::GetProcessById(${processId})
$target.Refresh()
if ($target.MainWindowHandle -eq [IntPtr]::Zero) { throw 'The smoke child does not have a main window.' }
if (-not [SmokeClose]::PostMessage($target.MainWindowHandle, 0x0010, [UIntPtr]::Zero, [IntPtr]::Zero)) { throw 'Could not post WM_CLOSE to the smoke child window.' }
`;
  const command = Buffer.from(script, 'utf16le').toString('base64');
  const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let errorText = '';
  helper.stderr.on('data', chunk => { errorText += chunk.toString(); });
  await new Promise((resolve, reject) => {
    helper.once('error', reject);
    helper.once('exit', code => code === 0 ? resolve() : reject(new Error(`Native close helper failed (${code}): ${errorText.trim()}`)));
  });
}
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const observers = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method) observers.get(message.method)?.forEach(handler => handler(message.params));
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout); pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('Native WebView debugger disconnected.')); }
    pending.clear();
  });
  return {
    close: () => socket.close(),
    on(method, handler) { const handlers = observers.get(method) ?? new Set(); handlers.add(handler); observers.set(method, handlers); return () => handlers.delete(handler); },
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20_000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    }),
  };
}
async function main() {
  if (process.platform !== 'win32') throw new Error('This native smoke runner currently supports Windows WebView2 only.');
  if (!existsSync(exe)) throw new Error(`Build the desktop executable first; missing ${exe}`);
  if (typeof WebSocket !== 'function') throw new Error('Node 22.12+ with built-in WebSocket is required.');
  const base = path.join(root, '.tools', 'native-smoke');
  await fs.mkdir(base, { recursive: true });
  const run = await fs.mkdtemp(path.join(base, 'run-'));
  const temporary = path.join(run, 'temporary');
  await fs.mkdir(temporary);
  const projectPath = path.join(temporary, 'synthetic.shorthand');
  const report = { executable: exe, startedAt: new Date().toISOString(), checks: [], screenshots: [], layout: [], gestures: [], limitations: ['OS chooser interaction requires separate verification.'], passed: false };
  const port = await freePort();
  const appLog = await fs.open(path.join(run, 'app.log'), 'w');
  const child = spawn(exe, [], {
    cwd: root, windowsHide: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`, ...(!existsSync(path.join(path.dirname(exe), 'portable.mode')) ? { WEBVIEW2_USER_DATA_FOLDER: path.join(temporary, 'webview') } : {}) },
    stdio: ['ignore', appLog.fd, appLog.fd],
  });
  let childError, cdp;
  child.on('error', error => { childError = error; });
  const stop = () => { if (child.exitCode === null && !child.killed) child.kill(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    let target;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !target) {
      if (childError) throw childError;
      if (child.exitCode !== null) throw new Error(`Native app exited before CDP connected (${child.exitCode}).`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
        target = (await response.json()).find(item => item.type === 'page' && item.webSocketDebuggerUrl && !item.url.startsWith('devtools:'));
      } catch { /* The app is still starting. */ }
      if (!target) await pause(200);
    }
    if (!target) throw new Error('WebView2 CDP did not become available. Check that the executable is a local build and WebView2 is installed.');
    cdp = await connect(target.webSocketDebuggerUrl);
    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result?.value;
    };
    const waitFor = async (expression, description) => {
      const booleanExpression = `Promise.resolve((${expression})).then(value => Boolean(value))`;
      const until = Date.now() + 15_000;
      while (Date.now() < until) { if (await evaluate(booleanExpression)) return; await pause(100); }
      throw new Error(`Timed out waiting for ${description}.`);
    };
    const clickLabel = async name => {
      if (['Characters', 'Emotions', 'Tones'].includes(name)) {
        await evaluate("(() => { const drawer=document.querySelector('.story-library-drawer[open]');if(drawer){drawer.querySelector('.library-all')?.click();}else{document.querySelector('[aria-label=\"Library\"]')?.click();} })()");
      }
      const button = `Array.from(document.querySelectorAll('button,summary')).find(button => button.getClientRects().length && !button.closest('[inert],[aria-hidden="true"]') && (button.getAttribute('aria-label') || button.textContent.trim()) === ${JSON.stringify(name)})`;
      await waitFor(`Boolean((${button}) && !(${button}).disabled)`, `enabled ${name} button`);
      await evaluate(`(${button}).click()`);
    };
    const keyboardActivateLabel = async name => {
      const button = `Array.from(document.querySelectorAll('button,summary')).find(button => button.getClientRects().length && !button.closest('[inert],[aria-hidden="true"]') && (button.getAttribute('aria-label') || button.textContent.trim()) === ${JSON.stringify(name)})`;
      await waitFor(`Boolean((${button}) && !(${button}).disabled)`, `enabled ${name} button`);
      // Let Settings finish restoring its focus, then reach the action through
      // actual keyboard navigation rather than racing its animation frame.
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      for (let index = 0; index < 64; index++) {
        if (await evaluate(`document.activeElement === (${button})`)) break;
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      }
      const focusVisible = await evaluate(`(${button}).matches(':focus-visible')`);
      assert.equal(focusVisible, true, `${name} must show keyboard focus before activation.`);
      await evaluate(`(${button}).click()`);
    };
    const clickSidebarTab = async name => {
      await evaluate(`(() => {const shelf=Array.from(document.querySelectorAll('.block-shelf')).find(element=>element.getClientRects().length);const toggle=shelf?.querySelector('.shelf-toggle');if(toggle?.getAttribute('aria-expanded')==='false')toggle.click();})()`);
      await evaluate(`(() => {const group=Array.from(document.querySelectorAll('.writing-tool-group')).find(group=>group.getClientRects().length&&group.querySelector('h3')?.textContent===${JSON.stringify(name)});const more=group?.querySelector('.group-more[aria-expanded="false"]');if(more)more.click();group?.scrollIntoView({block:'nearest'});})()`);
    };
    // Intercept a real Chromium dragstart, then deliver that browser-created
    // payload to the actual target. No synthetic DataTransfer or renderer hook.
    const dragBlock = async (sourceSelector, targetSelector, description, modifiers = 0) => {
      await evaluate('window.scrollTo(0, 0)');
      const geometry = await evaluate(`(() => {
        const source=document.querySelector(${JSON.stringify(sourceSelector)}), target=document.querySelector(${JSON.stringify(targetSelector)});
        if (!source || !target) throw new Error('Missing drag source or destination');
        source.scrollIntoView({block:'nearest',inline:'nearest'});
        const s=source.getBoundingClientRect(), t=target.getBoundingClientRect();
        return {source:{x:s.x+s.width/2,y:s.y+s.height/2},target:{x:t.x+Math.min(t.width/2,85),y:t.y+t.height/2}};
      })()`);
      let resolveDrag;
      const intercepted = new Promise(resolve => { resolveDrag=resolve; });
      const off = cdp.on('Input.dragIntercepted', data => resolveDrag(data.data));
      await cdp.send('Input.setInterceptDrags', {enabled:true});
      try {
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...geometry.source});
        await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...geometry.source,button:'left',buttons:1,clickCount:1,modifiers});
        for (let step=1;step<=8;step++) {
          await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:geometry.source.x+(geometry.target.x-geometry.source.x)*step/8,y:geometry.source.y+(geometry.target.y-geometry.source.y)*step/8,button:'left',buttons:1,modifiers});
        }
        let timeout;
        const data = await Promise.race([intercepted,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error(`Native dragstart did not fire for ${description}`)),2500);})]).finally(()=>clearTimeout(timeout));
        assert.ok(data.items.some(item=>item.mimeType.startsWith('application/x-shorthand-')), 'Native drag payload must carry a structured block');
        for (const type of ['dragEnter','dragOver','drop']) await cdp.send('Input.dispatchDragEvent',{type,...geometry.target,data,modifiers});
        report.gestures.push({description,...geometry,actualDragStart:true});
      } finally {
        off();
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...geometry.target,button:'left',buttons:0,clickCount:1});
        await cdp.send('Input.setInterceptDrags',{enabled:false});
      }
    };
    const dragItems = async (sourceId, targetId, readOrder, description) => {
      const before = await readOrder();
      const geometry = await evaluate(`(() => { const source = document.querySelector('[data-item-id="${sourceId}"] .drag-handle'); const target = document.querySelector('[data-item-id="${targetId}"] .note-card'); if (!source || !target) throw new Error('Drag controls missing.'); source.scrollIntoView({ block: 'center' }); let start = source.getBoundingClientRect(), end = target.getBoundingClientRect(); const middle = (start.y + start.height / 2 + end.y + end.height / 2) / 2; window.scrollBy(0, middle - innerHeight / 2); start = source.getBoundingClientRect(); end = target.getBoundingClientRect(); return { start: { x: start.x + start.width / 2, y: start.y + start.height / 2 }, end: { x: end.x + end.width / 2, y: end.y + end.height / 2 }, viewport: innerHeight }; })()`);
      assert.ok(geometry.start.y > 80 && geometry.start.y < geometry.viewport && geometry.end.y > 80 && geometry.end.y < geometry.viewport, `${description} targets must be visible`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...geometry.start });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...geometry.start, button: 'left', buttons: 1, clickCount: 1 });
      await pause(200);
      for (let step = 1; step <= 24; step++) {
        const fraction = step / 24;
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: geometry.start.x + (geometry.end.x - geometry.start.x) * fraction, y: geometry.start.y + (geometry.end.y - geometry.start.y) * fraction, button: 'left', buttons: 1 });
        await pause(20);
      }
      const feedback = await evaluate("({ dragging: document.querySelectorAll('.dragging').length, dropTargets: document.querySelectorAll('.drop-target').length })");
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...geometry.end, button: 'left', buttons: 0, clickCount: 1 });
      let after = before;
      const until = Date.now() + 5000;
      while (Date.now() < until) { after = await readOrder(); if (after.join() !== before.join()) break; await pause(100); }
      report.gestures.push({ description, before, after, feedback });
      if (after.join() === before.join()) (report.gestureErrors ??= []).push(`${description} did not change the persisted reading order`);
      else report.checks.push(`${description} changed native SQLite order through real pointer input`);
      await evaluate('window.scrollTo(0, 0)');
    };
    const captureView = async view => {
      for (const theme of ['light', 'dark']) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
        await clickLabel('Open Settings');
        await evaluate(`document.querySelector('input[name="appearance"][value="${theme}"]').click()`);
        await clickLabel('Back to writing');
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        if (view === 'emotions') {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
          const row = await evaluate(`(() => { const button=Array.from(document.querySelectorAll('.global-library-emotion .definition-rows>li>button.preset-colored')).find(item=>item.getClientRects().length&&item.querySelector('strong')?.textContent.trim()==='Awe'); const small=button?.querySelector('small'); if(!button||!small) throw new Error('Visible custom preset row text is missing.'); return {background:getComputedStyle(button).backgroundColor,ink:getComputedStyle(button).color,smallInk:getComputedStyle(small).color}; })()`);
          assert.equal(row.smallInk, row.ink, 'Preset row secondary text inherits the helper-selected foreground.');
          assert.ok(contrastRatio(row.background, row.ink) >= 4.5, `Preset row text meets contrast in ${theme}.`);
          assert.ok(contrastRatio(row.background, row.smallInk) >= 4.5, `Preset row secondary text meets contrast in ${theme}.`);
        }
        if (view === 'scene') {
          for (const [tab, selector, reference] of [
            ['Emotions', '[aria-label="Emotion: Awe"]', '.ProseMirror .block-emotion'],
            ['Tones', '[aria-label="Tone: Tender"]', '.ProseMirror .block-tone'],
          ]) {
            await clickSidebarTab(tab);
            await waitFor(`Boolean(document.querySelector('.block-shelf ${selector}') && document.querySelector('${reference}'))`, `${tab} inline and shelf color samples`);
            const groups = await evaluate("Array.from(document.querySelectorAll('.block-shelf .preset-color-group-heading')).map(heading=>heading.textContent.trim())");
            assert.deepEqual(groups, [...presetFamilyNames, 'Custom colors'], `${tab} displays the seven named families and its custom color group.`);
            const colors = await evaluate(`(() => { const shelf=document.querySelector('.block-shelf ${selector}'), inline=document.querySelector('${reference}'); return { shelf:getComputedStyle(shelf).backgroundColor, inline:getComputedStyle(inline).backgroundColor }; })()`);
            assert.equal(colors.shelf, colors.inline, `${tab} shelf and inline blocks use the same computed color in ${theme}.`);
          }
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
          const actionStyles = await evaluate(`(() => {
            const buttons=Array.from(document.querySelectorAll('.app button.primary:not(:disabled)')).filter(button=>button.getClientRects().length).map(button=>({label:button.getAttribute('aria-label')||button.textContent.trim(),disabled:button.disabled,color:getComputedStyle(button).color,background:getComputedStyle(button).backgroundColor}));
            const probePanel=document.createElement('section'); probePanel.className='generation-panel'; probePanel.style.cssText='position:fixed;left:-10000px;top:0';
            const probe=document.createElement('button'); probe.type='button'; probe.className='generation-primary'; probe.textContent='Generation contrast probe'; probePanel.append(probe); document.querySelector('.app').append(probePanel);
            const generation={disabled:probe.disabled,color:getComputedStyle(probe).color,background:getComputedStyle(probe).backgroundColor}; probePanel.remove();
            return {buttons,generation};
          })()`);
          assert.ok(actionStyles.buttons.length, 'The scene must expose at least one enabled primary action.');
          for (const button of [...actionStyles.buttons, actionStyles.generation]) {
            assert.equal(button.disabled, false, `${button.label ?? 'GenerationPanel action'} must be enabled for its contrast check.`);
            assert.equal(button.color, 'rgb(255, 255, 255)', `${button.label ?? 'GenerationPanel action'} uses white text.`);
            assert.ok(contrastRatio(button.background, button.color) >= 4.5, `${button.label ?? 'GenerationPanel action'} has at least 4.5:1 contrast in ${theme}.`);
          }
          const presetProbe = await evaluate(`(() => {
            const probe=document.createElement('button'); probe.type='button'; probe.className='story-block block-tone preset-colored'; probe.textContent='Preset hover contrast probe'; probe.setAttribute('data-native-preset-hover-probe','');
            probe.style.cssText='position:fixed;left:24px;top:24px;z-index:2147483647;--preset-bg-light:#FDFDDB;--preset-ink-light:#000000;--preset-bg-dark:#787911;--preset-ink-dark:#FFFFFF';
            document.querySelector('.app').append(probe); const rect=probe.getBoundingClientRect();
            const read=()=>({background:getComputedStyle(probe).backgroundColor,ink:getComputedStyle(probe).color,filter:getComputedStyle(probe).filter});
            return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,normal:read()};
          })()`);
          const presetBackground = theme === 'dark' ? 'rgb(120, 121, 17)' : 'rgb(253, 253, 219)';
          const presetInk = theme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)';
          const assertPresetState = (state, name) => {
            assert.equal(state.background, presetBackground, `Preset ${name} background stays fixed in ${theme}.`);
            assert.equal(state.ink, presetInk, `Preset ${name} ink stays fixed in ${theme}.`);
            assert.ok(state.filter === 'none' || state.filter === 'brightness(1)', `Preset ${name} has no contrast-reducing filter in ${theme}.`);
            assert.ok(contrastRatio(state.background, state.ink) >= 4.5, `Preset ${name} keeps 4.5:1 contrast in ${theme}.`);
          };
          try {
            assertPresetState(presetProbe.normal, 'normal');
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: presetProbe.x, y: presetProbe.y });
            await waitFor("document.querySelector('[data-native-preset-hover-probe]')?.matches(':hover')", 'preset hover probe');
            assertPresetState(await evaluate("(() => { const probe=document.querySelector('[data-native-preset-hover-probe]'),style=getComputedStyle(probe); return {background:style.backgroundColor,ink:style.color,filter:style.filter}; })()"), 'hover');
            await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: presetProbe.x, y: presetProbe.y, button: 'left', buttons: 1, clickCount: 1 });
            await waitFor("document.querySelector('[data-native-preset-hover-probe]')?.matches(':active')", 'preset pressed probe');
            assertPresetState(await evaluate("(() => { const probe=document.querySelector('[data-native-preset-hover-probe]'),style=getComputedStyle(probe); return {background:style.backgroundColor,ink:style.color,filter:style.filter}; })()"), 'pressed');
          } finally {
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: presetProbe.x, y: presetProbe.y, button: 'left', buttons: 0, clickCount: 1 });
            await evaluate("(() => { const probe=document.querySelector('[data-native-preset-hover-probe]'); probe?.blur(); probe?.remove(); })()");
          }
        }
        for (const width of [1440, 800]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: false });
          if (view === 'scene') await evaluate("(() => { const toggle=document.querySelector('.shelf-toggle'); if(toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click(); })()");
          await pause(200);
          const layout = await evaluate("({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, activeControl: document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 })");
          report.layout.push({ view, theme, width, ...layout });
          const filename = `${view}-${theme}-${width}.png`;
          const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          await fs.writeFile(path.join(run, filename), Buffer.from(screenshot.data, 'base64'));
          report.screenshots.push(filename);
          assert.equal(layout.horizontalOverflow, false, `${view} must fit the ${width}px viewport`);
        }
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      await clickLabel('Open Settings');
      await evaluate("document.querySelector('input[name=\"appearance\"][value=\"light\"]').click()");
      await clickLabel('Back to writing');
    };
    const captureWizardScreenshots = async (view, expectedStep, sizes, themes, options = {}) => {
      for (const theme of themes) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
        await clickLabel('Open Settings');
        await evaluate(`document.querySelector('input[name="appearance"][value="${theme}"]').click()`);
        await clickLabel('Back to writing');
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await waitFor("document.querySelector('.app')?.dataset.theme === " + JSON.stringify(theme), view + ' appearance');
        for (const { width, height } of sizes) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
          if (options.browserView) await waitFor("document.querySelector('[data-testid=\"character-creation-wizard\"]')?.dataset.browserView === " + JSON.stringify(options.browserView), view + ' browser view');
          if (options.browserDetail !== undefined) await waitFor("document.querySelector('[data-testid=\"character-wizard-stock-browser\"]')?.dataset.detailOpen === " + JSON.stringify(String(options.browserDetail)), view + ' browser detail');
          await waitFor(`document.querySelector('[data-testid="character-creation-wizard"]')?.dataset.wizardStep === ${JSON.stringify(expectedStep)}`, `${view} wizard step`);
          if (options.openDetails) await evaluate(`(() => { const disclosure=document.querySelector(${JSON.stringify(options.openDetails)}); if (!disclosure) throw new Error('Wizard disclosure missing: '+${JSON.stringify(options.openDetails)}); disclosure.open=true; })()`);
          const checkKeyboardHeading = options.focusHeading && theme === 'light' && width === 1440;
          if (checkKeyboardHeading) {
            await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
            await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
            await evaluate("document.querySelector('#character-wizard-heading')?.focus({preventScroll:true})");
            await waitFor("document.activeElement?.id === 'character-wizard-heading'", `${view} focused step heading`);
          }
          await evaluate('window.scrollTo(0,0)');
          if (options.scrollTo) await evaluate(`document.querySelector(${JSON.stringify(options.scrollTo)})?.scrollIntoView({block:'center',inline:'nearest'})`);
          await pause(120);
          const layout = await evaluate(`(() => {
            const wizard=document.querySelector('[data-testid="character-creation-wizard"]');
            const content=wizard?.querySelector('[data-testid="character-wizard-content"]');
            const footer=wizard?.querySelector('[data-testid="character-wizard-footer"]');
            const browser=wizard?.querySelector('[data-testid="character-wizard-stock-browser"]');
            const guidance=wizard?.querySelector('[data-testid="character-wizard-default-guidance"]');
            const reviewGuidance=wizard?.querySelector('[data-testid="character-wizard-review-guidance"]');
            const visible=element=>Boolean(element?.getClientRects().length);
            const inViewport=element=>{const rect=element?.getBoundingClientRect();return Boolean(rect&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth);};
            return {
              step:wizard?.dataset.wizardStep,
              browserView:wizard?.dataset.browserView,
              browserDetail:browser?.dataset.detailOpen ?? null,
              browserVisible:visible(browser),
              resultsVisible:visible(browser?.querySelector('[data-testid="character-wizard-stock-results"]')),
              previewVisible:visible(browser?.querySelector('[aria-label="Stock type preview"]')),
              choicesVisible:visible(wizard?.querySelector('[data-testid="character-wizard-starting-choices"]')),
              nameVisible:visible(content?.querySelector('#character-wizard-name')),
              profileFieldCount:content?.querySelectorAll('.wizard-profile-field').length ?? 0,
              iconGridVisible:visible(content?.querySelector('[aria-label="Character icon choices"]')),
              reviewSubmitVisible:Array.from(wizard?.querySelectorAll('button') ?? []).some(button=>visible(button)&&button.textContent.trim()==='Create character'),
              saveReminderVisible:visible(wizard?.querySelector('.wizard-review-save-note')),
              guidanceDisclosureOpen:guidance?.open ?? false,
              guidanceVisible:visible(guidance),
              guidanceControlsVisible:visible(guidance?.querySelector('.wizard-default-guidance-fields')),
              guidanceControlsInViewport:inViewport(guidance?.querySelector('.wizard-default-guidance-fields')),
              reviewGuidanceVisible:visible(reviewGuidance),
              reviewGuidanceInViewport:inViewport(reviewGuidance),
              reviewGuidanceLabelled:Boolean(reviewGuidance?.getAttribute('aria-labelledby')&&document.getElementById(reviewGuidance.getAttribute('aria-labelledby'))),
              reviewGuidanceEditLabel:reviewGuidance?.querySelector('[data-testid="character-wizard-edit-default-guidance"]')?.textContent.trim() ?? null,
              reviewDefaultTone:reviewGuidance?.querySelector('[data-testid="character-wizard-review-default-tone"]')?.textContent.trim() ?? null,
              reviewDefaultEmotion:reviewGuidance?.querySelector('[data-testid="character-wizard-review-default-emotion"]')?.textContent.trim() ?? null,
              headingFocused:document.activeElement?.id==='character-wizard-heading',
              headingOutline:(()=>{const heading=wizard?.querySelector('#character-wizard-heading');const style=heading?getComputedStyle(heading):null;return style?{style:style.outlineStyle,width:style.outlineWidth,color:style.outlineColor}:null})(),
              footerVisible:visible(footer),
              footerPosition:footer?getComputedStyle(footer).position:null,
              viewport:innerWidth,
              scrollWidth:document.documentElement.scrollWidth,
              horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,
              activeControl:document.activeElement?.getAttribute('aria-label')||document.activeElement?.tagName
            };
          })()`);
          assert.equal(layout.step, expectedStep, `${view} must capture the expected wizard phase.`);
          assert.equal(layout.footerVisible, true, `${view} exposes the wizard footer.`);
          assert.equal(layout.footerPosition, 'static', `${view} keeps the footer in page flow.`);
          assert.equal(layout.horizontalOverflow, false, `${view} fits the ${width}px native window.`);
          if (options.browserView) assert.equal(layout.browserView, options.browserView, `${view} keeps the expected browser mode.`);
          if (options.browserDetail !== undefined) assert.equal(layout.browserDetail, String(options.browserDetail), `${view} keeps the expected results/detail state.`);
          if (expectedStep === 'starting-point' && options.browserView === 'choices') {
            assert.equal(layout.choicesVisible, true, `${view} shows only the starting choices.`);
            assert.equal(layout.browserVisible, false, `${view} hides the stock catalog until requested.`);
          }
          if (expectedStep === 'identity') {
            assert.equal(layout.nameVisible, true, `${view} shows the name field.`);
            assert.equal(layout.profileFieldCount, 0, `${view} keeps profile fields on their own step.`);
            assert.equal(layout.browserVisible, false, `${view} hides the stock catalog.`);
            assert.equal(layout.iconGridVisible, false, `${view} keeps the icon grid collapsed until requested.`);
          }
          if (expectedStep === 'details') {
            assert.equal(layout.nameVisible, false, `${view} hides identity controls.`);
            assert.equal(layout.profileFieldCount, 3, `${view} shows all three optional fields.`);
            assert.equal(layout.browserVisible, false, `${view} hides the stock catalog.`);
          }
          if (expectedStep === 'review') {
            assert.equal(layout.nameVisible, false, `${view} hides editable identity controls.`);
            assert.equal(layout.profileFieldCount, 0, `${view} hides editable profile fields.`);
            assert.equal(layout.browserVisible, false, `${view} hides the stock catalog.`);
            assert.equal(layout.reviewSubmitVisible, true, `${view} exposes Create character only on Review.`);
            assert.equal(layout.saveReminderVisible, true, `${view} explains that project Save writes the new character to disk.`);
            assert.equal(layout.reviewGuidanceVisible, true, `${view} includes the default-guidance summary on Review.`);
            assert.equal(layout.reviewGuidanceLabelled, true, `${view} labels the Review guidance section for assistive technology.`);
            assert.equal(layout.reviewGuidanceEditLabel, 'Edit default guidance', `${view} names the Review edit action.`);
          }
          if (options.openDetails) {
            assert.equal(layout.guidanceDisclosureOpen, true, `${view} opens its optional default-guidance disclosure.`);
            assert.equal(layout.guidanceControlsVisible, true, `${view} exposes the default selectors and explanations.`);
            assert.equal(layout.guidanceControlsInViewport, true, `${view} places the expanded guidance controls in the captured viewport.`);
          }
          if (options.assertReviewGuidance) {
            assert.equal(layout.reviewDefaultTone, options.assertReviewGuidance.tone, `${view} includes the selected tone in Review.`);
            assert.equal(layout.reviewDefaultEmotion, options.assertReviewGuidance.emotion, `${view} includes the selected emotion in Review.`);
          }
          if (options.expectReviewGuidance) {
            assert.equal(layout.reviewGuidanceVisible, true, `${view} scrolls the default-guidance summary into view.`);
            assert.equal(layout.reviewGuidanceInViewport, true, `${view} places the default-guidance summary in the captured viewport.`);
            assert.equal(layout.reviewDefaultTone, options.expectReviewGuidance.tone, `${view} reviews the selected tone.`);
            assert.equal(layout.reviewDefaultEmotion, options.expectReviewGuidance.emotion, `${view} reviews the selected emotion.`);
          }
          if (checkKeyboardHeading) {
            assert.equal(layout.headingFocused, true, `${view} captures the exact heading focused in keyboard modality.`);
            assert.notEqual(layout.headingOutline?.style, 'none', `${view} shows a keyboard focus outline on the heading.`);
            assert.ok(Number.parseFloat(layout.headingOutline?.width) >= 1, `${view} keyboard heading outline is at least one pixel wide.`);
          }
          const footerBottom = await evaluate(`(() => { const footer=document.querySelector('[data-testid="character-wizard-footer"]'); return footer.getBoundingClientRect().bottom+window.scrollY; })()`);
          await evaluate(`window.scrollTo(0,Math.max(0,${footerBottom}-innerHeight))`);
          await pause(80);
          const footerReachable = await evaluate(`(() => { const rect=document.querySelector('[data-testid="character-wizard-footer"]').getBoundingClientRect(); return rect.top>=-1&&rect.bottom<=innerHeight+1; })()`);
          assert.equal(footerReachable, true, `${view} footer is reachable by normal page scrolling.`);
          await evaluate('window.scrollTo(0,0)');
          if (options.scrollTo) await evaluate(`document.querySelector(${JSON.stringify(options.scrollTo)})?.scrollIntoView({block:'center',inline:'nearest'})`);
          await pause(80);
          const screenshotTargetSelector = options.openDetails ? '[data-testid="character-wizard-default-guidance"] .wizard-default-guidance-fields' : options.expectReviewGuidance ? options.scrollTo : null;
          const screenshotTargetInViewport = screenshotTargetSelector ? await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(screenshotTargetSelector)}); const rect=element?.getBoundingClientRect(); return Boolean(rect&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth); })()`) : null;
          if (screenshotTargetSelector) assert.equal(screenshotTargetInViewport, true, `${view} restores the intended guidance region before taking its screenshot.`);
          report.layout.push({ view, theme, width, height, ...layout, footerReachable, screenshotTargetInViewport });
          assert.equal(layout.viewport, width, view + ' emulates the requested viewport width.');
          if (expectedStep === 'starting-point' && options.browserView === 'catalog' && width > 900) {
            assert.equal(layout.resultsVisible, true, view + ' keeps catalog results visible in the wide layout.');
            assert.equal(layout.previewVisible, true, view + ' keeps the type preview visible in the wide layout.');
          }
          if (expectedStep === 'starting-point' && options.browserDetail === 'false' && width <= 900) {
            assert.equal(layout.resultsVisible, true, view + ' shows the results list in narrow mode.');
            assert.equal(layout.previewVisible, false, view + ' hides the preview in narrow results mode.');
          }
          if (expectedStep === 'starting-point' && options.browserDetail === 'true' && width <= 900) {
            assert.equal(layout.resultsVisible, false, view + ' hides results in narrow detail mode.');
            assert.equal(layout.previewVisible, true, view + ' shows the selected detail in narrow mode.');
          }
          const filename = `${view}-${theme}-${width}x${height}.png`;
          const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          await fs.writeFile(path.join(run, filename), Buffer.from(screenshot.data, 'base64'));
          report.screenshots.push(filename);
        }
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      await clickLabel('Open Settings');
      await evaluate('document.querySelector("input[name=\\"appearance\\"][value=\\"light\\"]").click()');
      await clickLabel('Back to writing');
    };
    await waitFor("typeof window.__TAURI_INTERNALS__?.invoke === 'function'", 'real Tauri bridge');
    const invoke = (command, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
    const runtime = await invoke('app_runtime_info');
    const expectedDataDirectory = path.join(path.dirname(exe), 'data');
    const portablePackage = existsSync(path.join(path.dirname(exe), 'portable.mode'));
    assert.equal(runtime.portable, portablePackage, 'The executable must detect its explicit portable marker.');
    if (portablePackage) {
      assert.equal(path.resolve(runtime.dataDirectory).toLowerCase(), path.resolve(expectedDataDirectory).toLowerCase(), 'Portable data must live beside the selected executable.');
      report.checks.push('Portable runtime resolves writable app data beside the executable, independently of the development working directory');
    }
    if (focusedRelationships) {
      await require('./relationship-smoke.cjs')({ invoke, evaluate, clickLabel, waitFor, cdp, report, run, projectPath, temporary });
      await requestWindowClose(child.pid);
      if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(10_000)]);
      assert.equal(child.exitCode, 0, 'The saved relationship fixture closes through the native close handler.');
      report.passed = true;
      return;
    }
    if (focusedWorkspace) {
      await require('./workspace-smoke.cjs')({ invoke, evaluate, clickLabel, waitFor, cdp, report, run, projectPath, dragBlock });
      await requestWindowClose(child.pid);
      if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(10_000)]);
      assert.equal(child.exitCode, 0, 'The saved workspace closes through the native close handler.');
      report.passed = true;
      return;
    }
    if (focusedCompile) {
      await require('./compile-smoke.cjs')({ invoke, evaluate, clickLabel, waitFor, cdp, report, run, projectPath, temporary });
      await requestWindowClose(child.pid);
      if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(10_000)]);
      assert.equal(child.exitCode, 0, 'The saved compile fixture closes through the native close handler.');
      report.checks.push('The saved Compile Book fixture closes normally through the native title-bar close handler.');
      report.passed = true;
      return;
    }
    if (focusedWizardContinuation) {
      await waitFor("document.querySelector('.app')?.dataset.theme === 'light'", 'Platinum default for focused wizard continuation');
      const fixture = await invoke('create_project', { path: projectPath, title: 'Native wizard continuation' });
      let fixtureProject = fixture.project;
      const applyFixture = async operation => {
        fixtureProject = await invoke('apply_operation', { sessionId: fixture.sessionId, expectedRevision: fixtureProject.revision, operation });
        return fixtureProject;
      };
      await applyFixture({ type: 'createChapter', title: 'Chapter One' });
      const chapterId = fixtureProject.chapters[0].id;
      await applyFixture({ type: 'createScene', chapterId, title: 'Continuation arrival' });
      const sceneId = fixtureProject.scenes[0].id;
      await applyFixture({ type: 'createBeat', sceneId, document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A visitor waits beside the station door.' }] }] }, text: 'A visitor waits beside the station door.' });
      await invoke('save_project', { sessionId: fixture.sessionId });
      await evaluate(`(() => { const original=window.fetch.bind(window); window.__nativeSmokeCommands=[]; window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url);const command=url.hostname==='ipc.localhost'?decodeURIComponent(url.pathname.slice(1)):null;if(command)window.__nativeSmokeCommands.push(command);if(command==='plugin:dialog|open')return new Response(JSON.stringify(${JSON.stringify(projectPath)}),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}});const response=await original(input,init);if(command==='open_project'&&response.headers.get('Tauri-Response')==='ok')window.__nativeSmokeSessionId=(await response.clone().json()).sessionId;return response;}; })()`);
      await clickLabel('Project menu');
      await clickLabel('Open project');
      await waitFor("Boolean(document.querySelector('.story-canvas')?.getClientRects().length)", 'newly opened Story canvas');
      await clickLabel('Open chapter Chapter One');
      await waitFor("Boolean(window.__nativeSmokeSessionId)", 'focused continuation fixture opened through the native UI');
      await waitFor("Array.from(document.querySelectorAll('button.scene-open')).some(button=>button.querySelector('h3')?.textContent==='Continuation arrival')", 'focused continuation scene on Story timeline');
      await evaluate("(() => {const button=Array.from(document.querySelectorAll('button.scene-open')).find(item=>item.querySelector('h3')?.textContent==='Continuation arrival');if(!button||button.disabled)throw new Error('Continuation scene missing');button.click();})()");
      await waitFor("Boolean(document.querySelector('.destination-view:not([hidden]) .scene-layout'))", 'focused continuation scene opened');

      const readUi = async () => invoke('read_project', { sessionId: await evaluate('window.__nativeSmokeSessionId') });
      const setWizardValue = async (selector, value) => {
        await evaluate("(() => { const element=document.querySelector(" + JSON.stringify(selector) + "); if(!element)throw new Error('Wizard field missing: '+" + JSON.stringify(selector) + "); const prototype=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,'value').set.call(element," + JSON.stringify(value) + "); element.dispatchEvent(new Event('input',{bubbles:true})); })()");
        await waitFor("document.querySelector(" + JSON.stringify(selector) + ")?.value === " + JSON.stringify(value), 'focused wizard field ' + selector);
      };
      const waitForWizardStep = step => waitFor("document.querySelector('[data-testid=\"character-creation-wizard\"]')?.dataset.wizardStep === " + JSON.stringify(step), 'focused wizard step ' + step);
      const selectWizardPreset = async (type, name) => {
        const selector = `#character-wizard-default-${type}`;
        const id = await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)})?.options??[]).find(option=>option.textContent.trim()===${JSON.stringify(name)})?.value??''`);
        assert.ok(id, `The continuation project has an active ${type} preset ${name}.`);
        await evaluate(`(() => {const select=document.querySelector(${JSON.stringify(selector)});if(!select)throw new Error('Missing '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(id)});select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await waitFor(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(id)}`, `focused ${type} ${name}`);
        return id;
      };
      const readWizardGuidance = () => evaluate("Object.fromEntries(['tone','emotion'].map(type=>[type,document.querySelector('#character-wizard-default-'+type)?.value??null]))");

      await clickLabel('New character');
      await clickLabel('Choose a stock type');
      await clickLabel('Preview The Miser');
      await clickLabel('Use this type and continue');
      await setWizardValue('#character-wizard-name', 'Guidance Sample');
      await clickLabel('Next: Profile details');
      await waitForWizardStep('details');
      const neutralToneId = await evaluate("Array.from(document.querySelector('#character-wizard-default-tone')?.options??[]).find(option=>option.textContent.trim()==='Neutral')?.value??''");
      assert.ok(neutralToneId, 'Neutral is a real tone option in the focused continuation.');
      assert.equal(await evaluate("document.querySelector('#character-wizard-default-tone')?.options[0]?.value"), '', 'None is the empty tone option.');
      await evaluate("(() => {const details=document.querySelector('[data-testid=\"character-wizard-default-guidance\"]');if(!details)throw new Error('Default guidance missing');details.querySelector('summary').click();})()");
      const toneId = await selectWizardPreset('tone', 'Reflective');
      const emotionId = await selectWizardPreset('emotion', 'Curious');
      const selectedGuidance = { tone: toneId, emotion: emotionId };
      assert.deepEqual(await readWizardGuidance(), selectedGuidance);
      await setWizardValue('#character-wizard-background', 'Raised among careful traders, this character risks savings on an act of generosity.');
      await setWizardValue('#character-wizard-personality', 'Patient with numbers, guarded with praise, and bold when someone is exploited.');
      await setWizardValue('#character-wizard-voice', 'Measured and practical, with warmth between careful phrases.');
      await captureWizardScreenshots('focused-wizard-details-expanded-guidance', 'details', [{ width: 1440, height: 960 }, { width: 800, height: 960 }, { width: 800, height: 600 }], ['light', 'dark'], { openDetails: '[data-testid="character-wizard-default-guidance"]', scrollTo: '.wizard-default-guidance' });
      report.checks.push('Focused Details captures show expanded guidance at 1440x960, 800x960, and 800x600 in both themes.');

      await clickLabel('Next: Review');
      await waitForWizardStep('review');
      const reviewGuidance = { tone: 'Reflective', emotion: 'Curious' };
      await captureWizardScreenshots('focused-wizard-review-selected-guidance', 'review', [{ width: 1440, height: 960 }, { width: 800, height: 960 }, { width: 800, height: 600 }], ['light', 'dark'], { scrollTo: '[data-testid="character-wizard-review-guidance"]', assertReviewGuidance: reviewGuidance, expectReviewGuidance: reviewGuidance });
      report.checks.push('Focused Review captures show selected guidance at 1440x960, 800x960, and 800x600 in both themes.');
      const beforeGuidanceCreate = await readUi();
      await clickLabel('Create character');
      await waitFor("Boolean(document.querySelector('.destination-view:not([hidden]) .scene-layout'))", 'return to continuation scene after guidance creation');
      const afterGuidanceCreate = await readUi();
      const createdGuidanceCharacters = afterGuidanceCreate.characters.filter(character=>!beforeGuidanceCreate.characters.some(existing=>existing.id===character.id));
      assert.equal(createdGuidanceCharacters.length, 1, 'Review creates one character from this draft.');
      assert.equal(createdGuidanceCharacters[0].defaultToneId, toneId, 'Create keeps the selected tone ID.');
      assert.equal(createdGuidanceCharacters[0].defaultEmotionId, emotionId, 'Create keeps the selected emotion ID.');
      await clickLabel('Save');
      await waitFor("document.querySelector('.save-state')?.textContent.includes('Saved locally')", 'Save selected guidance character');
      const sessionBeforeReopen = await evaluate('window.__nativeSmokeSessionId');
      await clickLabel('Project menu');
      await clickLabel('Open project');
      await waitFor("Boolean(document.querySelector('.story-canvas')?.getClientRects().length)", 'newly opened Story canvas');
      await clickLabel('Open chapter Chapter One');
      await waitFor(`window.__nativeSmokeSessionId!==${JSON.stringify(sessionBeforeReopen)}`, 'focused project reopened through native UI');
      const reopenedCharacter = (await readUi()).characters.find(character=>character.name==='Guidance Sample');
      assert.equal(reopenedCharacter?.defaultToneId, toneId, 'Save/reopen preserves the selected tone ID.');
      assert.equal(reopenedCharacter?.defaultEmotionId, emotionId, 'Save/reopen preserves the selected emotion ID.');
      report.checks.push('Focused creation and Save/reopen preserve the selected default tone and emotion IDs.');
      await waitFor("Array.from(document.querySelectorAll('button.scene-open')).some(button=>button.querySelector('h3')?.textContent==='Continuation arrival')", 'Story timeline after focused reopen');
      await evaluate("(() => {const button=Array.from(document.querySelectorAll('button.scene-open')).find(item=>item.querySelector('h3')?.textContent==='Continuation arrival');if(!button||button.disabled)throw new Error('Continuation scene missing after reopen');button.click();})()");
      await waitFor("Boolean(document.querySelector('.destination-view:not([hidden]) .scene-layout'))", 'continuation scene restored after focused reopen');

      const beforeResumeDraft = await readUi();
      await clickLabel('New character');
      await clickLabel('Choose a stock type');
      await clickLabel('Preview The Miser');
      await clickLabel('Use this type and continue');
      await setWizardValue('#character-wizard-name', 'Draft Only');
      await clickLabel('Next: Profile details');
      await setWizardValue('#character-wizard-background', 'A writer-owned background carried through replacement.');
      await setWizardValue('#character-wizard-personality', 'Private, precise, and more generous than expected.');
      await setWizardValue('#character-wizard-voice', 'Evenly paced, with a dry aside when needed.');
      await evaluate("(() => {const details=document.querySelector('[data-testid=\"character-wizard-default-guidance\"]');details.querySelector('summary').click();})()");
      const resumeToneId = await selectWizardPreset('tone', 'Hopeful');
      const resumeEmotionId = await selectWizardPreset('emotion', 'Curious');
      const resumeGuidance = { tone: resumeToneId, emotion: resumeEmotionId };
      await clickLabel('Name and icon');
      await clickLabel('Change starting point');
      await clickLabel('Preview The Con Artist');
      await clickLabel('Use this type and continue');
      await clickLabel('Replace profile fields');
      await waitForWizardStep('identity');
      await clickLabel('Profile details');
      assert.deepEqual(await readWizardGuidance(), resumeGuidance, 'Stock replacement preserves the draft tone and emotion IDs.');
      await clickLabel('Characters');
      await clickLabel('Resume character draft');
      await waitForWizardStep('details');
      assert.deepEqual(await readWizardGuidance(), resumeGuidance, 'Resume restores both selected default IDs.');
      await clickLabel('Cancel creation');
      await clickLabel('Discard draft');
      await waitFor("Boolean(document.querySelector('.destination-view:not([hidden]) .scene-layout'))", 'return after resumed draft discard');
      assert.deepEqual(await readUi(), beforeResumeDraft, 'Discarding the resumed draft leaves the project unchanged.');
      report.checks.push('Selected guidance survives stock replacement and navigation away/back in a resumed draft.');

      const beforeBlankCreate = await readUi();
      await clickLabel('New character');
      await clickLabel('Start blank');
      await setWizardValue('#character-wizard-name', 'Rowan');
      await clickLabel('Review now');
      await waitForWizardStep('review');
      assert.equal(await evaluate("document.querySelector('[data-testid=\"character-wizard-review-default-tone\"]')?.textContent.trim()"), 'None', 'Blank review leaves tone unset.');
      assert.equal(await evaluate("document.querySelector('[data-testid=\"character-wizard-review-default-emotion\"]')?.textContent.trim()"), 'None', 'Blank review leaves emotion unset.');
      await clickLabel('Create character');
      await waitFor("Boolean(document.querySelector('.destination-view:not([hidden]) .scene-layout'))", 'return after blank character creation');
      const afterBlankCreate = await readUi();
      const createdBlankCharacters = afterBlankCreate.characters.filter(character=>!beforeBlankCreate.characters.some(existing=>existing.id===character.id));
      assert.equal(createdBlankCharacters.length, 1, 'The blank route creates exactly one character.');
      assert.equal(createdBlankCharacters[0].defaultToneId, '', 'Blank character tone stays None.');
      assert.equal(createdBlankCharacters[0].defaultEmotionId, '', 'Blank character emotion stays None.');
      assert.ok(['background','personality','voice'].every(field=>createdBlankCharacters[0][field]===''), 'Blank creation keeps its optional profile fields empty.');
      report.checks.push('Blank creation leaves the optional profile, tone, and emotion unset.');
      report.passed = true;
      return;
    }
    await waitFor("document.querySelector('.app')?.dataset.theme === 'light'", 'Platinum default');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.app')).backgroundColor"), 'rgb(229, 235, 234)');
    report.checks.push('Fresh startup uses the Platinum background');
    await clickLabel('Open Settings');
    assert.equal(await evaluate("(() => { const checkbox = Array.from(document.querySelectorAll('label')).find(label => label.querySelector('strong')?.textContent === 'Autosave')?.querySelector('input[type=checkbox]'); if (!checkbox) throw new Error('Autosave setting is missing.'); return checkbox.checked; })()"), false, 'Manual save must be the first-run default.');
    await clickLabel('Back to writing');
    let session = await invoke('create_project', { path: projectPath, title: 'Native smoke story' });
    assert.deepEqual(session.project.tones.map(tone => tone.name).sort(), starterCatalog.tones.map(tone=>tone.name).sort());
    assert.deepEqual(session.project.emotions.map(emotion => emotion.name).sort(), starterCatalog.emotions.map(emotion=>emotion.name).sort());
    const seededColors = [...session.project.tones, ...session.project.emotions].map(preset => preset.color).filter(Boolean);
    assert.deepEqual([...new Set(seededColors)].sort(), [...presetPalette].sort(), 'Starter definitions must seed all seven named palette colors.');
    for (const preset of [...session.project.tones, ...session.project.emotions]) {
      const catalogPreset = [...starterCatalog.tones, ...starterCatalog.emotions].find(item => item.name === preset.name);
      assert.ok(catalogPreset, `Starter catalog entry ${preset.name} must exist.`);
      assert.equal(preset.color ?? '', catalogPreset.color, `${preset.name} keeps its catalog default color.`);
    }
    for (const preset of [...session.project.tones,...session.project.emotions]) assert.ok(preset.meaning.trim() && preset.guidance.trim() && preset.example.trim(), `${preset.name} needs complete guidance`);
    report.checks.push('New native projects contain all 42 starter definitions with seven seeded palette colors');
    assert.equal(await invoke('project_has_unsaved_changes', { sessionId: session.sessionId }), false);
    const initialProjectFile = await fs.readFile(projectPath);
    let project = session.project;
    const apply = async operation => { project = await invoke('apply_operation', { sessionId: session.sessionId, expectedRevision: project.revision, operation }); return project; };
    const awePresetId = project.emotions.find(preset => preset.name === 'Awe')?.id;
    assert.ok(awePresetId, 'Starter Awe preset is found by name.');
    await apply({ type: 'updatePreset', kind: 'emotion', presetId: awePresetId, color: '' });
    assert.equal(project.emotions.find(preset => preset.id === awePresetId)?.color ?? '', '', 'Clearing a starter color restores its catalog fallback.');
    report.checks.push('Native preset color reset stores the catalog fallback for older uncolored definitions');
    await apply({ type: 'createChapter', title: 'Chapter One' });
    const chapterId = project.chapters[0].id;
    await apply({ type: 'createScene', chapterId, title: 'Smoke arrival' });
    const sceneId = project.scenes[0].id;
    await apply({ type: 'updateScene', sceneId, summary: 'A synthetic visitor arrives at the station.', tone: 'Hopeful' });
    await apply({ type: 'createScene', chapterId, title: 'Smoke departure' });
    const secondSceneId = project.scenes[1].id;
    await apply({ type: 'updateScene', sceneId: secondSceneId, summary: 'A letter changes the route home.', tone: 'Wistful' });
    await apply({ type: 'createCharacter', name: 'Mara' });
    const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The train arrives beneath a violet sky.' }] }] };
    await apply({ type: 'createBeat', sceneId, document, text: 'The train arrives beneath a violet sky.' });
    const beatId = project.scenes[0].beats[0].id;
    const updatedDocument = { type: 'doc', content: [...document.content, { type: 'paragraph', content: [{ type: 'text', text: 'A brass bell rings twice.' }] }] };
    await apply({ type: 'updateBeat', beatId, document: updatedDocument, text: 'The train arrives beneath a violet sky.\n\nA brass bell rings twice.' });
    assert.deepEqual(project.scenes[0].beats[0].document, updatedDocument);
    await apply({ type: 'duplicateBeat', beatId });
    assert.notEqual(project.scenes[0].beats[1].id, beatId);
    await apply({ type: 'reorderBeats', sceneId, ids: project.scenes[0].beats.map(beat => beat.id).reverse() });
    await apply({ type: 'deleteBeat', beatId });
    const trashId = project.trash.find(item => item.kind === 'beat').id;
    await apply({ type: 'restoreTrash', trashId });
    assert.ok(project.scenes[0].beats.some(beat => beat.id === beatId));
    await apply({ type: 'undo' }); await apply({ type: 'redo' });
    report.checks.push('Real native create/edit/duplicate/reorder/Trash/restore/undo/redo');
    await assert.rejects(() => invoke('apply_operation', { sessionId: session.sessionId, expectedRevision: 0, operation: { type: 'renameProject', title: 'Must not save' } }));
    await assert.rejects(() => invoke('read_project', { sessionId: 'invalid-session' }));
    await assert.rejects(() => invoke('read_file', { path: projectPath }));
    report.checks.push('Stale revisions, invalid sessions, and unregistered generic file commands rejected');
    const importPath = path.join(temporary, 'import.md');
    const importedMarkdown = '## Interchange\n\n### Smoke import\n\nPlain text imported from a synthetic file.\n';
    await fs.writeFile(importPath, importedMarkdown);
    project = await invoke('import_markdown_file', { sessionId: session.sessionId, expectedRevision: project.revision, path: importPath });
    assert.ok(project.scenes.some(scene => scene.title === 'Smoke import'));
    assert.equal(project.importSources.at(-1).markdown, importedMarkdown);
    assert.equal(await fs.readFile(importPath, 'utf8'), importedMarkdown);
    report.checks.push('Native Markdown import retains exact source bytes and leaves the source file unchanged');
    const markdown = await invoke('export_markdown', { sessionId: session.sessionId });
    assert.ok(markdown.includes('Smoke arrival'));
    const exportPath = path.join(temporary, 'synthetic.md');
    await invoke('export_markdown_file', { sessionId: session.sessionId, path: exportPath });
    assert.equal(await fs.readFile(exportPath, 'utf8'), markdown);
    report.checks.push('Native Markdown export file matches command result');
    assert.equal(await invoke('project_has_unsaved_changes', { sessionId: session.sessionId }), true, 'Working edits must remain unsaved until an explicit Save.');
    assert.deepEqual(await fs.readFile(projectPath), initialProjectFile, 'Manual-mode operations must leave the project file bytes unchanged before Save.');
    assert.deepEqual(await invoke('save_project', { sessionId: session.sessionId }), project);
    assert.notDeepEqual(await fs.readFile(projectPath), initialProjectFile, 'Save must write the completed working project to disk.');
    assert.equal(await invoke('project_has_unsaved_changes', { sessionId: session.sessionId }), false);
    report.checks.push('Explicit Save persists the complete working project and clears native unsaved state');
    await invoke('close_project', { sessionId: session.sessionId });
    await assert.rejects(() => invoke('read_project', { sessionId: session.sessionId }));
    session = await invoke('open_project', { path: projectPath });
    assert.deepEqual(session.project, project);
    report.checks.push('Close revokes session; reopen preserves persisted snapshot and IDs');
    await invoke('close_project', { sessionId: session.sessionId });

    // Only the chooser is replaced to avoid automating an OS dialog. All project IPC remains native.
    await evaluate(`(() => { const original = window.fetch.bind(window); window.__nativeSmokeCommands = []; window.fetch = async (input, init) => { const url = new URL(typeof input === 'string' ? input : input.url); const command = url.hostname === 'ipc.localhost' ? decodeURIComponent(url.pathname.slice(1)) : null; if (command) window.__nativeSmokeCommands.push(command); if (command === 'plugin:dialog|open') return new Response(JSON.stringify(${JSON.stringify(projectPath)}), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }); const response = await original(input, init); if (command === 'open_project' && response.headers.get('Tauri-Response') === 'ok') window.__nativeSmokeSessionId = (await response.clone().json()).sessionId; return response; }; })()`);
    const openProjectButton = "Array.from(document.querySelectorAll('button')).find(button => !button.disabled && (button.getAttribute('aria-label') || button.textContent.trim()) === 'Open project')";
    await waitFor(`Boolean(${openProjectButton})`, 'Open project control');
    await evaluate(`(${openProjectButton}).click()`);
    await waitFor("Boolean(document.querySelector('.story-canvas')?.getClientRects().length)", 'newly opened Story canvas');
    await clickLabel('Open chapter Chapter One');
    await waitFor("document.body.innerText.includes('Smoke arrival')", 'persisted Chapter canvas');
    await dragItems(sceneId, secondSceneId, () => evaluate(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.chapters.find(chapter => chapter.id === ${JSON.stringify(chapterId)}).sceneIds)`), 'Scene handle drag');
    await captureView('chapter');
    assert.ok(await evaluate("(() => { const button = Array.from(document.querySelectorAll('button.scene-open')).find(button => button.querySelector('h3')?.textContent === 'Smoke arrival'); if (!button || button.disabled) return false; button.click(); return true; })()"), 'Persisted scene Open control must be clickable');
    await waitFor("document.body.innerText.includes('The train arrives beneath a violet sky.')", 'persisted scene beats');
    await waitFor("Boolean(document.querySelector('.scene-generate-actions'))", 'scene generation actions');
    const generateButton = await evaluate("(() => { const button=Array.from(document.querySelectorAll('.scene-generate-actions button')).find(button=>button.textContent.includes('Generate prose')); return button ? {disabled:button.disabled,hasSettingsLink:Array.from(document.querySelectorAll('.scene-generate-actions button')).some(button=>button.textContent.trim()==='Open Settings')} : null; })()");
    assert.deepEqual(generateButton, { disabled: true, hasSettingsLink: true }, 'Scene generation must stay disabled until ChatGPT is verified.');
    await clickLabel('Open Settings');
    await waitFor(`document.querySelector('#settings-page')?.innerText.includes(${JSON.stringify(runtime.portable ? 'Portable folder' : 'Standard app data')})`, 'storage mode in Settings');
    await waitFor(`document.querySelector('#settings-page')?.innerText.includes(${JSON.stringify(runtime.dataDirectory)})`, 'portable data path in Settings');
    assert.ok(await evaluate("document.querySelector('#settings-page')?.innerText.includes('Active')"), 'Settings must report the active WebView2 runtime.');
    report.checks.push('Unconfigured scene generation stays disabled; Settings reports portable path and the active local WebView2 runtime');
    await clickLabel('Back to writing');
    await waitFor("document.body.innerText.includes('The train arrives beneath a violet sky.')", 'return to selected scene');
    const uiSummary = 'The visitor steps from the train. Saved through the native scene editor.';
    await evaluate("(() => { const editor=document.querySelector('[contenteditable=\"true\"][aria-label=\"Scene summary\"]'); if(!editor)throw new Error('Summary board missing'); editor.focus(); const range=document.createRange();range.selectNodeContents(editor); const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range); })()");
    await cdp.send('Input.insertText',{text:uiSummary});
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.scenes.find(scene => scene.id === ${JSON.stringify(sceneId)})?.summary === ${JSON.stringify(uiSummary)})`, 'scene summary saved to SQLite through UI');
    report.checks.push('Native Scene summary UI edit reaches the Rust SQLite repository');
    const readUi = () => evaluate("window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId })");
    const setCustomPresetColor = async (kind, color) => evaluate(`(() => { const library=Array.from(document.querySelectorAll('.global-library-${kind}')).find(element=>element.getClientRects().length); const input=library?.querySelector('.definition-detail input[aria-label="Custom color"]'); if(!input||!input.getClientRects().length) throw new Error('Visible ${kind} custom color input is missing.'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(color)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    const uiProse = 'A synthetic prose draft saved from the packaged desktop editor.';
    await evaluate(`(() => { const textarea = document.querySelector('.scene-prose-editor textarea'); if (!textarea) throw new Error('Scene prose editor is missing.'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, ${JSON.stringify(uiProse)}); textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.blur(); })()`);
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.scenes.find(scene => scene.id === ${JSON.stringify(sceneId)})?.prose === ${JSON.stringify(uiProse)})`, 'editable scene prose persisted to SQLite');
    report.checks.push('Scene prose editor saves through native SQLite independently of beat directions');
    let uiProject = await readUi();
    const uiBeatId = uiProject.scenes.find(scene => scene.id === sceneId).beats[0].id;
    const uiBeatText = 'A native keyboard edit survives reopening.';
    await evaluate("(() => { const editor = document.querySelector('[contenteditable=\"true\"][aria-label=\"Freeform text for beat 1\"]'); if (!editor) throw new Error('Beat editor is missing.'); editor.focus(); const range = document.createRange(); range.selectNodeContents(editor); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); })()");
    await cdp.send('Input.insertText', { text: uiBeatText });
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.scenes.flatMap(scene => scene.beats).find(beat => beat.id === ${JSON.stringify(uiBeatId)})?.text === ${JSON.stringify(uiBeatText)})`, 'native keyboard beat edit saved to SQLite');
    report.checks.push('Chromium keyboard text insertion in the native beat editor is saved by Rust');
    const initialCount = uiProject.scenes.find(scene => scene.id === sceneId).beats.length;
    await clickLabel('Duplicate beat 1');
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.scenes.find(scene => scene.id === ${JSON.stringify(sceneId)})?.beats.length === ${initialCount + 1})`, 'visible beat Duplicate action');
    await clickLabel('Move beat 1 down');
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.scenes.find(scene => scene.id === ${JSON.stringify(sceneId)})?.beats[1]?.id === ${JSON.stringify(uiBeatId)})`, 'visible beat Move down action');
    await clickLabel('Delete beat 2');
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => !project.scenes.find(scene => scene.id === ${JSON.stringify(sceneId)})?.beats.some(beat => beat.id === ${JSON.stringify(uiBeatId)}))`, 'visible beat Delete action');
    await clickLabel('Project menu');
    await evaluate("Array.from(document.querySelectorAll('.project-menu button')).find(button => /^Trash\\b/.test(button.textContent.trim())).click()");
    await waitFor("Boolean(document.querySelector('#trash-heading'))", 'Project Trash screen');
    await clickLabel('Restore');
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.scenes.find(scene => scene.id === ${JSON.stringify(sceneId)})?.beats.some(beat => beat.id === ${JSON.stringify(uiBeatId)}))`, 'visible Trash Restore action');
    await clickLabel('Back to scene');
    report.checks.push('Visible beat Duplicate, Move down, Delete, and Trash Restore controls persist native operations');
    uiProject = await readUi();
    assert.equal(await evaluate("window.__TAURI_INTERNALS__.invoke('project_has_unsaved_changes', { sessionId: window.__nativeSmokeSessionId })"), true);
    await clickLabel('Save');
    await waitFor("document.querySelector('.save-state')?.textContent.includes('Saved locally')", 'manual Save acknowledgement');
    assert.equal(await evaluate("window.__TAURI_INTERNALS__.invoke('project_has_unsaved_changes', { sessionId: window.__nativeSmokeSessionId })"), false);
    const previousUiSession = await evaluate('window.__nativeSmokeSessionId');
    await clickLabel('Project menu');
    await clickLabel('Open project');
    await waitFor("Boolean(document.querySelector('.story-canvas')?.getClientRects().length)", 'newly opened Story canvas');
    await clickLabel('Open chapter Chapter One');
    await waitFor(`window.__nativeSmokeSessionId !== ${JSON.stringify(previousUiSession)}`, 'reopened native UI project session');
    assert.deepEqual(await readUi(), uiProject);
    await waitFor("Boolean(document.querySelector('button.scene-open'))", 'reopened Story timeline');
    assert.ok(await evaluate("(() => { const button = Array.from(document.querySelectorAll('button.scene-open')).find(button => button.querySelector('h3')?.textContent === 'Smoke arrival'); if (!button || button.disabled) return false; button.click(); return true; })()"));
    await waitFor(`document.querySelector('[contenteditable="true"][aria-label="Scene summary"]')?.textContent === ${JSON.stringify(uiSummary)} && document.body.innerText.includes(${JSON.stringify(uiBeatText)})`, 'reopened native summary and beat edits');
    report.checks.push('Reopening through native UI preserves summary/beat edits and structural actions');
    assert.equal(await evaluate("document.querySelector('.block-shelf .shelf-toggle')?.getAttribute('aria-expanded')"), 'true', 'The scene sidebar starts expanded.');
    await evaluate("(() => { const editor = document.querySelector('[contenteditable=\"true\"][aria-label=\"Freeform text for beat 1\"]'); if (!editor) throw new Error('Beat editor missing.'); editor.focus(); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); })()");
    const activeBeatId = await evaluate("document.querySelector('.beat-content[data-board-id]')?.getAttribute('data-board-id')");
    assert.ok(activeBeatId, 'The active beat card exposes its drop-board ID.');
    await clickSidebarTab('Characters');
    await evaluate("document.querySelector('.block-shelf button[aria-label=\"Character: Mara\"]')?.click()");
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => { const character=project.characters.find(item=>item.name==='Mara'); const beat=project.scenes.flatMap(scene=>scene.beats).find(item=>item.id===${JSON.stringify(activeBeatId)}); const find=(node,type,result=[])=>{ if(node?.type===type) result.push(node); for(const child of node?.content??[]) find(child,type,result); return result; }; return Boolean(character && find(beat?.document,'characterReference').some(node=>node.attrs.characterId===character.id)); })`, 'character click inserts at the last focused beat caret');
    await clickSidebarTab('Emotions');
    await evaluate("document.querySelector('.block-shelf button[aria-label=\"Emotion: Awe\"]')?.click()");
    await evaluate("document.querySelector('.block-shelf button[aria-label=\"Emotion: Awe\"]')?.click()");
    await clickSidebarTab('Tones');
    await evaluate("document.querySelector('.block-shelf button[aria-label=\"Tone: Tender\"]')?.click()");
    await evaluate("document.querySelector('.block-shelf button[aria-label=\"Tone: Tense\"]')?.click()");
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => { const beat=project.scenes.flatMap(scene=>scene.beats).find(beat=>beat.id===${JSON.stringify(activeBeatId)}); const find=(node,type,result=[])=>{ if(node?.type===type) result.push(node); for(const child of node?.content??[]) find(child,type,result); return result; }; const awe=project.emotions.find(item=>item.name==='Awe'); const toneIds=project.tones.filter(item=>item.name==='Tender'||item.name==='Tense').map(item=>item.id); return find(beat?.document,'emotionReference').filter(node=>node.attrs.emotionId===awe?.id).length===2 && find(beat?.document,'toneReference').filter(node=>toneIds.includes(node.attrs.toneId)).length===2; })`, 'multiple independent emotions and tones inserted at the remembered caret');
    const clickInserted = await readUi();
    const beatAfterClicks = clickInserted.scenes.flatMap(scene => scene.beats).find(beat => beat.id === activeBeatId);
    const collectReferences = (node, type, result = []) => { if (node?.type === type) result.push(node); for (const child of node?.content ?? []) collectReferences(child, type, result); return result; };
    const aweId = clickInserted.emotions.find(emotion => emotion.name === 'Awe')?.id;
    assert.ok(aweId, 'Starter Awe emotion is present.');
    assert.equal(collectReferences(beatAfterClicks.document, 'emotionReference').filter(node => node.attrs.emotionId === aweId && !node.attrs.targetOccurrenceId).length, 2, 'New emotions are independent and unbound.');
    assert.equal(collectReferences(beatAfterClicks.document, 'toneReference').length, 2, 'The beat retains both tone references.');
    await waitFor("document.querySelector('.scene-settings .inspector-toggle')?.getAttribute('aria-expanded') === 'false' && document.querySelector('.block-inspector-body')?.hidden === true", 'optional scene details stays closed after reference insertion');
    report.checks.push('Native keyboard click insertion adds independent emotions and multiple tones at the last focused caret without opening scene details');
    assert.equal(await evaluate("document.querySelector('.project-header-identity')?.firstElementChild?.classList.contains('project-back')"),true,'Back is the leftmost header control');
    await clickSidebarTab('Characters');
    await clickLabel('Save');
    await waitFor("document.querySelector('.save-state')?.textContent.includes('Saved locally')", 'clean project before character wizard checks');
    let characterWorkflowDiskSnapshot = await fs.readFile(projectPath);
    const beforeCharacterWizard = await readUi();
    assert.equal(beforeCharacterWizard.characters.some(character => character.name === 'Tamsin Revised'), false, 'The project has no Tamsin record before wizard creation.');
    const setWizardValue = async (selector, value) => {
      await evaluate("(() => { const element=document.querySelector(" + JSON.stringify(selector) + "); if(!element) throw new Error('Wizard field missing: ' + " + JSON.stringify(selector) + "); const prototype=element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,'value').set.call(element," + JSON.stringify(value) + "); element.dispatchEvent(new Event('input',{bubbles:true})); })()");
      await waitFor("document.querySelector(" + JSON.stringify(selector) + ")?.value === " + JSON.stringify(value), 'wizard field ' + selector);
    };
    const selectWizardPreset = async (type, name) => {
      const selector = `#character-wizard-default-${type}`;
      const id = await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)})?.options ?? []).find(option=>option.textContent.trim()===${JSON.stringify(name)})?.value ?? ''`);
      assert.ok(id, `The active ${type} preset ${name} is available in the wizard.`);
      await evaluate(`(() => { const select=document.querySelector(${JSON.stringify(selector)}); if(!select) throw new Error('Wizard selector missing: '+${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(id)}); select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
      await waitFor(`document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(id)}`, `wizard default ${type} ${name}`);
      return id;
    };
    const readWizardGuidance = () => evaluate("Object.fromEntries(['tone','emotion'].map(type=>[type,document.querySelector('#character-wizard-default-'+type)?.value ?? null]))");
    const readWizardProfile = () => evaluate("Object.fromEntries(['background','personality','voice'].map(field=>[field,document.querySelector('#character-wizard-'+field)?.value ?? null]))");
    const readWizardReviewedProfile = () => evaluate("Object.fromEntries(['background','personality','voice'].map(field=>{const heading=document.getElementById('character-wizard-review-'+field);return [field,heading?.closest('.wizard-review-section')?.querySelector('p')?.textContent.trim() ?? ''];}))");
    const readWizardIcon = () => evaluate("document.querySelector('.character-icon-picker-status [data-character-icon]')?.getAttribute('data-character-icon') ?? null");
    const waitForWizardStep = step => waitFor("document.querySelector('[data-testid=\"character-creation-wizard\"]')?.dataset.wizardStep === " + JSON.stringify(step), 'wizard step ' + step);

    await clickLabel('New character');
    await waitForWizardStep('starting-point');
    await captureWizardScreenshots('wizard-starting-point', 'starting-point', [{ width: 1440, height: 960 }, { width: 800, height: 960 }], ['light', 'dark'], { browserView: 'choices' });
    await clickLabel('Choose a stock type');
    await waitFor("document.querySelector('[data-testid=\"character-creation-wizard\"]')?.dataset.browserView === 'catalog'", 'stock catalog view');
    await captureWizardScreenshots('wizard-stock-results', 'starting-point', [{ width: 800, height: 600 }], ['light', 'dark'], { browserView: 'catalog', browserDetail: 'false' });

    await clickLabel('Ensemble roles');
    await waitFor("document.querySelectorAll('.character-template-result').length === 5", 'five ensemble-role results');
    const ensembleRoleTitles = await evaluate("Array.from(document.querySelectorAll('.character-template-result strong')).map(element=>element.textContent.trim()).sort()");
    assert.deepEqual(ensembleRoleTitles, ['Ensemble Brains', 'Ensemble Heart', 'Ensemble Lancer', 'Ensemble Leader', 'Ensemble Powerhouse'], 'The Ensemble roles category exposes all five individual functions.');
    await setWizardValue('input[aria-label="Search stock types"]', '5 man band');
    await waitFor("document.querySelectorAll('.character-template-result').length === 5", 'five literal 5 man band results');
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.character-template-result strong')).map(element=>element.textContent.trim()).sort()"), ensembleRoleTitles, 'The literal “5 man band” search returns all five individual role templates.');
    await captureWizardScreenshots('wizard-ensemble-search', 'starting-point', [{ width: 800, height: 960 }], ['light', 'dark'], { browserView: 'catalog', browserDetail: 'false' });
    await clickLabel('Preview Ensemble Leader');
    await clickLabel('Use this type and continue');
    await waitForWizardStep('identity');
    await setWizardValue('#character-wizard-name', 'Avery');
    await clickLabel('Next: Profile details');
    await waitForWizardStep('details');
    assert.deepEqual(await readWizardGuidance(), { tone: '', emotion: '' }, 'Applying an Ensemble role does not choose a tone or emotion.');
    await clickLabel('Next: Review');
    await waitForWizardStep('review');
    assert.equal(await evaluate("document.querySelector('[data-testid=\"character-wizard-review-default-tone\"]')?.textContent.trim()"), 'None', 'The role review keeps tone unset.');
    assert.equal(await evaluate("document.querySelector('[data-testid=\"character-wizard-review-default-emotion\"]')?.textContent.trim()"), 'None', 'The role review keeps emotion unset.');
    const beforeEnsembleCreate = await readUi();
    await clickLabel('Create character');
    await waitFor("Boolean(document.querySelector('.destination-view:not([hidden]) .scene-layout'))", 'return to the scene after creating one ensemble-role character');
    const afterEnsembleCreate = await readUi();
    const newEnsembleCharacters = afterEnsembleCreate.characters.filter(character => !beforeEnsembleCreate.characters.some(existing => existing.id === character.id));
    assert.equal(newEnsembleCharacters.length, 1, 'Selecting one ensemble role creates exactly one character, not a forced five-person group.');
    assert.equal(newEnsembleCharacters[0].name, 'Avery', 'The role remains one writer-named character.');
    assert.equal(newEnsembleCharacters[0].icon, 'compass', 'The selected Leader role supplies its icon.');
    assert.ok(['background', 'personality', 'voice'].every(field=>newEnsembleCharacters[0][field].trim()), 'The selected role contributes its individual profile suggestions.');
    assert.equal(newEnsembleCharacters[0].defaultToneId, '', 'The selected role does not assign a default tone.');
    assert.equal(newEnsembleCharacters[0].defaultEmotionId, '', 'The selected role does not assign a default emotion.');
    report.checks.push('The Ensemble roles category and literal “5 man band” search each return five results; applying one role creates one character with no automatic tone or emotion.');

    await clickLabel('New character');
    await waitForWizardStep('starting-point');
    await clickLabel('Choose a stock type');
    await waitFor("document.querySelector('[data-testid=\"character-creation-wizard\"]')?.dataset.browserView === 'catalog'", 'stock catalog reset for the next draft');
    const beforeStockPreview = await readUi();
    await clickLabel('Preview The Miser');
    assert.deepEqual(await readUi(), beforeStockPreview, 'Previewing a stock result never mutates the project.');
    await captureWizardScreenshots('wizard-stock-wide', 'starting-point', [{ width: 1440, height: 960 }], ['light'], { browserView: 'catalog', browserDetail: 'false' });
    await captureWizardScreenshots('wizard-stock-compact', 'starting-point', [{ width: 800, height: 960 }], ['dark'], { browserView: 'catalog', browserDetail: 'true' });
    await captureWizardScreenshots('wizard-stock-detail', 'starting-point', [{ width: 800, height: 600 }], ['light', 'dark'], { browserView: 'catalog', browserDetail: 'true' });
    await clickLabel('Use this type and continue');
    await waitForWizardStep('identity');
    assert.equal(await readWizardIcon(), 'coins', 'The untouched stock icon follows into Name and icon.');
    await captureWizardScreenshots('wizard-identity', 'identity', [{ width: 1440, height: 960 }, { width: 800, height: 960 }], ['light', 'dark']);
    await setWizardValue('#character-wizard-name', 'Tamsin');
    await keyboardActivateLabel('Next: Profile details');
    await waitForWizardStep('details');
    await waitFor("document.activeElement?.id === 'character-wizard-heading'", 'keyboard transition focuses the profile details heading');
    await captureWizardScreenshots('wizard-details', 'details', [{ width: 1440, height: 960 }, { width: 800, height: 960 }], ['light', 'dark'], { focusHeading: true });
    assert.deepEqual(await readWizardGuidance(), { tone: '', emotion: '' }, 'A newly applied stock type starts with both defaults set to None.');
    const neutralToneId = await evaluate("Array.from(document.querySelector('#character-wizard-default-tone')?.options ?? []).find(option=>option.textContent.trim()==='Neutral')?.value ?? ''");
    assert.ok(neutralToneId, 'Neutral is an available tone preset with a real project ID.');
    assert.equal(await evaluate("document.querySelector('#character-wizard-default-tone')?.options[0]?.value"), '', 'The None tone option has an empty ID.');
    assert.notEqual(neutralToneId, '', 'None is distinct from the Neutral preset.');
    assert.notEqual(neutralToneId, (await readWizardGuidance()).tone, 'The initial unset tone is not Neutral.');
    await evaluate("(() => { const disclosure=document.querySelector('[data-testid=\"character-wizard-default-guidance\"]'); if(!disclosure)throw new Error('Default guidance disclosure missing'); disclosure.querySelector('summary').click(); })()");
    await waitFor("document.querySelector('[data-testid=\"character-wizard-default-guidance\"]')?.open === true", 'expanded optional default guidance');
    assert.deepEqual(await evaluate("(() => { const disclosure=document.querySelector('[data-testid=\"character-wizard-default-guidance\"]'); const selector=type=>document.querySelector('#character-wizard-default-'+type); return { summaryNamed:Boolean(disclosure?.querySelector('summary')?.textContent.trim()), summaryKeyboardReachable:disclosure?.querySelector('summary')?.tabIndex===0, toneLabelled:selector('tone')?.labels?.length===1, emotionLabelled:selector('emotion')?.labels?.length===1, toneHelpConnected:document.getElementById(selector('tone')?.getAttribute('aria-describedby'))?.id==='character-wizard-default-tone-note', emotionHelpConnected:document.getElementById(selector('emotion')?.getAttribute('aria-describedby'))?.id==='character-wizard-default-emotion-note' }; })()"), { summaryNamed: true, summaryKeyboardReachable: true, toneLabelled: true, emotionLabelled: true, toneHelpConnected: true, emotionHelpConnected: true }, 'Default guidance uses a keyboard-reachable disclosure, associated labels, and connected explanations.');
    const selectedToneId = await selectWizardPreset('tone', 'Reflective');
    const selectedEmotionId = await selectWizardPreset('emotion', 'Curious');
    const chosenGuidance = { tone: selectedToneId, emotion: selectedEmotionId };
    assert.match(await evaluate("document.querySelector('[data-testid=\"character-wizard-default-tone-preview\"]')?.innerText ?? ''"), /thoughtful pause|considered observations/i, 'The chosen tone shows its current writing guidance.');
    assert.match(await evaluate("document.querySelector('[data-testid=\"character-wizard-default-emotion-preview\"]')?.innerText ?? ''"), /unanswered question|notice details/i, 'The chosen emotion shows its current expression guidance.');
    await captureWizardScreenshots('wizard-details-expanded-guidance', 'details', [{ width: 1440, height: 960 }, { width: 800, height: 960 }, { width: 800, height: 600 }], ['light', 'dark'], { openDetails: '[data-testid="character-wizard-default-guidance"]', scrollTo: '.wizard-default-guidance' });
    report.checks.push('A stock profile begins with empty tone/emotion IDs distinct from Neutral; selecting real presets shows their current guidance.');
    const initialStockProfile = await readWizardProfile();
    assert.ok(Object.values(initialStockProfile).every(value => typeof value === 'string' && value.trim()), 'The applied stock type supplies all three optional suggestions.');
    const tamsinBackground = 'Raised among careful traders, Tamsin now risks her savings on a quiet act of generosity.';
    const tamsinPersonality = 'Patient with numbers and guarded with praise; she becomes unexpectedly bold when someone is being exploited.';
    const tamsinVoice = 'Measured, practical, and warmer when she forgets to count the cost.';
    await setWizardValue('#character-wizard-background', tamsinBackground);
    await setWizardValue('#character-wizard-personality', tamsinPersonality);
    await setWizardValue('#character-wizard-voice', tamsinVoice);
    await clickLabel('Next: Review');
    await waitForWizardStep('review');
    await captureWizardScreenshots('wizard-review', 'review', [{ width: 1440, height: 960 }, { width: 800, height: 960 }], ['light', 'dark'], { assertReviewGuidance: { tone: 'Reflective', emotion: 'Curious' } });
    await captureWizardScreenshots('wizard-review-default-guidance', 'review', [{ width: 1440, height: 960 }, { width: 800, height: 960 }, { width: 800, height: 600 }], ['light', 'dark'], { scrollTo: '[data-testid="character-wizard-review-guidance"]', assertReviewGuidance: { tone: 'Reflective', emotion: 'Curious' }, expectReviewGuidance: { tone: 'Reflective', emotion: 'Curious' } });
    assert.equal(await evaluate("document.querySelector('#character-wizard-review-name')?.textContent.trim()"), 'Tamsin', 'Review shows the current identity.');
    await clickLabel('Edit name and icon');
    await setWizardValue('#character-wizard-name', 'Tamsin Revised');
    await clickLabel('Review now');
    await waitForWizardStep('review');
    assert.equal(await evaluate("document.querySelector('#character-wizard-review-name')?.textContent.trim()"), 'Tamsin Revised', 'Review returns after an identity edit.');
    await clickLabel('Edit baseline voice');
    const tamsinRevisedVoice = 'Measured, practical, and warmer when she forgets to count the cost; she corrects herself with a small joke.';
    await setWizardValue('#character-wizard-voice', tamsinRevisedVoice);
    await clickLabel('Next: Review');
    await waitForWizardStep('review');
    assert.equal((await readWizardReviewedProfile()).voice, tamsinRevisedVoice, 'Review preserves its details edit.');

    const editedProfileBeforeReplacement = await readWizardReviewedProfile();
    await clickLabel('Edit name and icon');
    await clickLabel('Change starting point');
    await clickLabel('Preview The Con Artist');
    await clickLabel('Use this type and continue');
    await waitFor("document.querySelector('#character-wizard-starting-point-confirm-heading')?.textContent.includes('Replace background, personality, baseline voice')", 'stock replacement confirmation');
    const replacementHeading = await evaluate("document.querySelector('#character-wizard-starting-point-confirm-heading')?.textContent.trim()");
    assert.equal(replacementHeading, 'Replace background, personality, baseline voice?', 'Confirmation names every profile field that will change.');
    await clickLabel('Keep current fields');
    await waitFor("document.querySelector('.character-template-preview-title h3')?.textContent.trim() === 'The Miser'", 'declined replacement restores the applied stock preview');
    await clickLabel('Name and icon');
    await clickLabel('Profile details');
    assert.deepEqual(await readWizardProfile(), editedProfileBeforeReplacement, 'Declining a replacement retains every edited field.');
    assert.deepEqual(await readWizardGuidance(), chosenGuidance, 'Declining a profile replacement keeps both selected defaults.');
    await clickLabel('Name and icon');
    await clickLabel('Change starting point');
    await clickLabel('Preview The Con Artist');
    await clickLabel('Use this type and continue');
    await waitFor("Boolean(document.querySelector('#character-wizard-starting-point-confirm-heading'))", 'confirmed stock replacement prompt');
    await clickLabel('Replace profile fields');
    await waitForWizardStep('identity');
    assert.equal(await readWizardIcon(), 'hat-glasses', 'An untouched icon follows the confirmed new stock type.');
    await clickLabel('Profile details');
    const conArtistProfile = await readWizardProfile();
    assert.deepEqual(await readWizardGuidance(), chosenGuidance, 'Applying a different stock type retains the selected tone and emotion.');
    assert.notDeepEqual(conArtistProfile, editedProfileBeforeReplacement, 'Confirmed replacement updates the applied profile fields.');
    assert.ok(Object.values(conArtistProfile).every(value => typeof value === 'string' && value.trim()), 'The replacement retains all three stock suggestions.');
    await clickLabel('Name and icon');
    await clickLabel('Change starting point');
    await clickLabel('Preview The Miser');
    await clickLabel('Use this type and continue');
    await waitFor("Boolean(document.querySelector('#character-wizard-starting-point-confirm-heading'))", 'restore original stock type confirmation');
    await clickLabel('Replace profile fields');
    await waitForWizardStep('identity');
    assert.equal(await readWizardIcon(), 'coins', 'The untouched icon follows when the original stock type is reapplied.');
    await setWizardValue('#character-wizard-name', 'Tamsin Revised');
    await clickLabel('Next: Profile details');
    await setWizardValue('#character-wizard-background', tamsinBackground);
    await setWizardValue('#character-wizard-personality', tamsinPersonality);
    await setWizardValue('#character-wizard-voice', tamsinRevisedVoice);
    assert.deepEqual(await readWizardGuidance(), chosenGuidance, 'Restoring the original stock type retains the writer-selected defaults.');
    await clickLabel('Next: Review');
    await waitForWizardStep('review');
    assert.equal(await evaluate("document.querySelector('#character-wizard-review-name')?.textContent.trim()"), 'Tamsin Revised');
    assert.equal(await evaluate("document.querySelector('[data-testid=\"character-wizard-review-default-tone\"]')?.textContent.trim()"), 'Reflective', 'Review identifies the selected tone.');
    assert.equal(await evaluate("document.querySelector('[data-testid=\"character-wizard-review-default-emotion\"]')?.textContent.trim()"), 'Curious', 'Review identifies the selected emotion.');
    assert.match(await evaluate("document.querySelector('[data-testid=\"character-creation-wizard\"] .wizard-review-save-note')?.innerText.trim() ?? ''"), /project Save to write project changes to disk/i, 'Review reminds the user to Save before Create submits the new character.');

    const beforeTamsinCreate = await readUi();
    assert.equal(beforeTamsinCreate.characters.filter(character => character.name === 'Tamsin Revised').length, 0, 'The draft has not created a project record before Review submission.');
    await clickLabel('Create character');
    await waitFor("Boolean(document.querySelector('.destination-view:not([hidden]) .scene-layout'))", 'return to the original scene after creation');
    const afterTamsinCreate = await readUi();
    const newTamsin = afterTamsinCreate.characters.filter(character => !beforeTamsinCreate.characters.some(existing => existing.id === character.id) && character.name === 'Tamsin Revised');
    assert.equal(newTamsin.length, 1, 'Review submits exactly one new character.');
    assert.deepEqual(newTamsin[0], { id: newTamsin[0].id, name: 'Tamsin Revised', background: tamsinBackground, personality: tamsinPersonality, voice: tamsinRevisedVoice, icon: 'coins', archived: false, defaultToneId: selectedToneId, defaultEmotionId: selectedEmotionId }, 'Creation uses the exact reviewed profile, icon, and selected default IDs.');
    assert.deepEqual(afterTamsinCreate.scenes, beforeTamsinCreate.scenes, 'Returning to the original scene does not insert a character reference or alter prose.');
    assert.equal(await invoke('project_has_unsaved_changes', { sessionId: await evaluate('window.__nativeSmokeSessionId') }), true, 'Character creation stays in the working copy until Save.');
    await clickLabel('Undo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>!p.characters.some(c=>c.name==='Tamsin Revised'))", 'Undo removes the created character');
    await clickLabel('Redo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.characters.some(c=>c.name==='Tamsin Revised'&&c.icon==='coins'&&c.voice=== " + JSON.stringify(tamsinRevisedVoice) + '&&c.defaultToneId===' + JSON.stringify(selectedToneId) + '&&c.defaultEmotionId===' + JSON.stringify(selectedEmotionId) + '))', 'Redo restores the complete reviewed profile, icon, and default guidance');

    assert.deepEqual(await fs.readFile(projectPath), characterWorkflowDiskSnapshot, 'Creation and history stay out of the project file until Save.');
    await clickLabel('Save');
    await waitFor("document.querySelector('.save-state')?.textContent.includes('Saved locally')", 'saving the character with selected defaults');
    const savedCharacterWorkflowDiskSnapshot = await fs.readFile(projectPath);
    const preReopenCharacterSession = await evaluate('window.__nativeSmokeSessionId');
    await clickLabel('Project menu');
    await clickLabel('Open project');
    await waitFor("Boolean(document.querySelector('.story-canvas')?.getClientRects().length)", 'newly opened Story canvas');
    await clickLabel('Open chapter Chapter One');
    await waitFor(`window.__nativeSmokeSessionId !== ${JSON.stringify(preReopenCharacterSession)}`, 'reopened native UI project after saving selected defaults');
    const reopenedTamsin = (await readUi()).characters.find(character=>character.name==='Tamsin Revised');
    assert.ok(reopenedTamsin, 'The created character remains in the project after reopen.');
    assert.equal(reopenedTamsin.defaultToneId, selectedToneId, 'Save/reopen preserves the selected default tone ID.');
    assert.equal(reopenedTamsin.defaultEmotionId, selectedEmotionId, 'Save/reopen preserves the selected default emotion ID.');
    report.checks.push('A stock-derived character keeps its explicitly chosen defaults through type replacement, Undo/Redo, Save, and native UI reopen.');
    characterWorkflowDiskSnapshot = savedCharacterWorkflowDiskSnapshot;
    await waitFor("Boolean(document.querySelector('button.scene-open'))", 'reopened Story timeline before blank character creation');
    await evaluate("(() => {const button=Array.from(document.querySelectorAll('button.scene-open')).find(item=>item.querySelector('h3')?.textContent==='Smoke arrival');if(!button||button.disabled)throw new Error('Smoke arrival scene missing after native reopen');button.click();})()");
    await waitFor("Boolean(document.querySelector('.destination-view:not([hidden]) .scene-layout'))", 'reopen Smoke arrival scene before blank character creation');
    const beforeRowanCreate = await readUi();
    await clickLabel('New character');
    await clickLabel('Start blank');
    await setWizardValue('#character-wizard-name', 'Rowan');
    await clickLabel('Choose character icon');
    await clickLabel('Bird icon');
    assert.equal(await readWizardIcon(), 'bird', 'A blank character can choose a custom icon.');
    await clickLabel('Review now');
    await waitForWizardStep('review');
    assert.equal(await evaluate("document.querySelectorAll('.wizard-review-empty').length === 3 && Array.from(document.querySelectorAll('.wizard-review-empty')).every(item=>item.textContent.trim()==='Not added')"), true, 'Blank review keeps all three optional fields empty.');
    await clickLabel('Create character');
    await waitFor("Boolean(document.querySelector('.destination-view:not([hidden]) .scene-layout'))", 'return to the original scene after blank creation');
    const afterRowanCreate = await readUi();
    const newRowan = afterRowanCreate.characters.filter(character => !beforeRowanCreate.characters.some(existing => existing.id === character.id) && character.name === 'Rowan');
    assert.equal(newRowan.length, 1, 'The blank route creates exactly one project record.');
    assert.deepEqual(newRowan[0], { id: newRowan[0].id, name: 'Rowan', background: '', personality: '', voice: '', icon: 'bird', archived: false, defaultToneId: '', defaultEmotionId: '' }, 'The blank route creates with the chosen icon and empty optional fields.');
    assert.deepEqual(afterRowanCreate.scenes, beforeRowanCreate.scenes, 'Blank creation also returns without inserting a scene reference.');
    assert.deepEqual(await fs.readFile(projectPath), characterWorkflowDiskSnapshot, 'Blank creation also stays unsaved until project Save.');

    const beforeDiscardedDraft = await readUi();
    await clickLabel('New character');
    await clickLabel('Choose a stock type');
    await clickLabel('Preview The Miser');
    await clickLabel('Use this type and continue');
    await setWizardValue('#character-wizard-name', 'Draft Only');
    await clickLabel('Choose character icon');
    await clickLabel('Crown icon');
    await clickLabel('Next: Profile details');
    await setWizardValue('#character-wizard-background', 'A writer-owned field to carry through a profile replacement.');
    await setWizardValue('#character-wizard-personality', 'Private, precise, and more generous than expected.');
    await setWizardValue('#character-wizard-voice', 'Evenly paced, with a dry aside when needed.');
    await evaluate("(() => { const disclosure=document.querySelector('[data-testid=\"character-wizard-default-guidance\"]'); if(!disclosure)throw new Error('Default guidance disclosure missing'); disclosure.querySelector('summary').click(); })()");
    const resumedToneId = await selectWizardPreset('tone', 'Hopeful');
    const resumedEmotionId = await selectWizardPreset('emotion', 'Curious');
    const resumedGuidance = { tone: resumedToneId, emotion: resumedEmotionId };
    await clickLabel('Name and icon');
    await clickLabel('Change starting point');
    await clickLabel('Preview The Con Artist');
    await clickLabel('Use this type and continue');
    await waitFor("Boolean(document.querySelector('#character-wizard-starting-point-confirm-heading'))", 'explicit icon replacement prompt');
    await clickLabel('Replace profile fields');
    await waitForWizardStep('identity');
    assert.equal(await readWizardIcon(), 'crown', 'An explicitly chosen icon stays across profile replacement.');
    await clickLabel('Profile details');
    const resumedProfile = await readWizardProfile();
    assert.deepEqual(await readWizardGuidance(), resumedGuidance, 'Changing a stock type retains the resume draft’s chosen guidance.');
    assert.ok(Object.values(resumedProfile).every(value => typeof value === 'string' && value.trim()), 'The changed stock profile is ready to resume.');
    await clickLabel('Characters');
    await clickLabel('Resume character draft');
    await waitForWizardStep('details');
    assert.deepEqual(await readWizardProfile(), resumedProfile, 'Resume restores the draft at its current step.');
    assert.deepEqual(await readWizardGuidance(), resumedGuidance, 'Resume restores both selected default IDs.');
    await clickLabel('Name and icon');
    assert.equal(await evaluate("document.querySelector('#character-wizard-name')?.value"), 'Draft Only', 'Resume restores the draft identity.');
    assert.equal(await readWizardIcon(), 'crown', 'Resume restores the explicitly chosen icon.');
    await clickLabel('Profile details');
    await clickLabel('Cancel creation');
    await clickLabel('Discard draft');
    await waitFor("Boolean(document.querySelector('.destination-view:not([hidden]) .scene-layout'))", 'return to the origin scene after discarding the resumed draft');
    assert.deepEqual(await readUi(), beforeDiscardedDraft, 'Canceling and discarding a resumed draft does not change the project.');
    assert.deepEqual(await fs.readFile(projectPath), characterWorkflowDiskSnapshot, 'Unsubmitted draft text is never written to the project file.');
    report.checks.push('The four-step stock route captures in both themes and widths; blank and stock creation submit one reviewed operation, support safe profile replacement, preserve icon choices, return to the scene without insertion, and remain undoable/unsaved until Save.');
    report.checks.push('A resumed draft keeps its step, name, profile and custom icon; explicit discard removes only the draft and writes no project data.');
    report.checks.push('A resumed draft retains its selected tone and emotion IDs through stock replacement and navigation away/back.');
    report.checks.push('Stock default icons follow a confirmed type change; declining preserves every writer-edited profile field and restores the applied preview.');

    await clickSidebarTab('Characters');
    await clickLabel('Manage Characters');
    await waitFor("Array.from(document.querySelectorAll('.global-library-character')).some(element=>element.getClientRects().length>0)", 'visible full Characters screen');
    await evaluate("(() => {const row=Array.from(document.querySelectorAll('.global-library-character .definition-rows button')).find(button=>button.querySelector('strong')?.textContent.trim()==='Mara');if(!row)throw new Error('Existing Mara profile missing');row.click();})()");
    const beforeCharacterIcon = await readUi();
    await clickLabel('Choose character icon');
    await clickLabel('Crown icon');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.characters.some(c=>c.name==='Mara'&&c.icon==='crown'))", 'editing an existing character icon');
    const afterCharacterIcon = await readUi();
    const oldMara = beforeCharacterIcon.characters.find(character => character.name === 'Mara');
    const newMara = afterCharacterIcon.characters.find(character => character.name === 'Mara');
    assert.deepEqual({ ...newMara, icon: undefined }, { ...oldMara, icon: undefined }, 'An icon edit preserves every character writing field.');
    assert.deepEqual(afterCharacterIcon.scenes, beforeCharacterIcon.scenes, 'An icon edit never rewrites inline documents or scene prose.');
    await clickLabel('Undo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.characters.some(c=>c.name==='Mara'&&!c.icon))", 'Undo restores the existing character default icon');
    await clickLabel('Redo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.characters.some(c=>c.name==='Mara'&&c.icon==='crown'))", 'Redo restores the character icon');
    await clickLabel('Return to Smoke arrival');
    await waitFor("Boolean(document.querySelector('.block-shelf button[aria-label=\"Character: Mara\"] [data-character-icon=\"crown\"]')) && Boolean(document.querySelector('.ProseMirror .character-chip [data-character-icon=\"crown\"]'))", 'live matching character icons in shelf and inline references');
    report.checks.push('Existing character icon edits preserve writing fields and inline documents and support Undo/Redo');

    await clickSidebarTab('Tones');
    await clickLabel('Manage Tones');
    await waitFor("Array.from(document.querySelectorAll('.global-library-tone')).some(element=>element.getClientRects().length>0)", 'visible full Tones screen');
    assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).some(button=>/^Add starter (tones|emotions)$/.test(button.textContent.trim()))"),false,'Starter presets never require an Add button');
    await clickLabel('New tone');
    await evaluate("(() => { const input=Array.from(document.querySelectorAll('.global-library-tone .library-create input')).find(element=>element.getClientRects().length); if(!input)throw new Error('Visible new Tone name input is missing.'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Stillness'); input.dispatchEvent(new Event('input',{bubbles:true})); })()");
    await clickLabel('Create tone');
    await waitFor("Array.from(document.querySelectorAll('.global-library-tone .definition-detail input[aria-label=\"Tone name\"]')).some(input=>input.getClientRects().length>0&&input.value==='Stillness')", 'visible new reusable tone editor');
    await evaluate("(() => { const label=Array.from(document.querySelectorAll('.global-library-tone .definition-detail label')).find(item=>item.getClientRects().length&&item.textContent.startsWith('Writing guidance')); const textarea=label?.querySelector('textarea'); if(!textarea)throw new Error('Visible tone guidance field is missing.'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'Let quiet pauses carry the scene.'); textarea.dispatchEvent(new Event('input',{bubbles:true})); })()");
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.tones.some(t=>t.name==='Stillness'&&t.guidance==='Let quiet pauses carry the scene.'))", 'tone guidance in the native working copy');
    await setCustomPresetColor('tone', '#FF00AA');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.tones.some(t=>t.name==='Stillness'&&t.color==='#FF00AA'))", 'custom color on the new tone');
    await clickLabel('Undo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>{const tone=p.tones.find(t=>t.name==='Stillness');return !!tone&&(tone.color??'')===''})", 'Undo restores the new tone default color');
    await clickLabel('Redo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.tones.some(t=>t.name==='Stillness'&&t.color==='#FF00AA'))", 'Redo restores the new tone custom color');
    report.checks.push('A new preset color can be customized, undone, and redone through native UI history');
    await captureView('tones');
    await clickLabel('Return to Smoke arrival');
    await clickSidebarTab('Emotions');
    await clickLabel('Manage Emotions');
    await waitFor("Array.from(document.querySelectorAll('.global-library-emotion')).some(element=>element.getClientRects().length>0)", 'visible full Emotions screen');
    await evaluate("(() => { const row=Array.from(document.querySelectorAll('.global-library-emotion .definition-rows button')).find(button=>button.getClientRects().length&&button.querySelector('strong')?.textContent.trim()==='Awe'); if(!row) throw new Error('Visible starter Awe row is missing.'); row.click(); })()");
    await waitFor("Array.from(document.querySelectorAll('.global-library-emotion .definition-detail input[aria-label=\"Custom color\"]')).some(input=>input.getClientRects().length>0)", 'visible starter preset color editor after row selection');
    const projectBeforePresetColor = await readUi();
    const aweBeforePresetColor = projectBeforePresetColor.emotions.find(preset => preset.name === 'Awe');
    assert.ok(aweBeforePresetColor, 'Starter Awe preset is found by name in the library.');
    const referencedDocumentsBeforePresetColor = projectBeforePresetColor.scenes.flatMap(scene => [scene.summaryDocument, ...scene.beats.map(beat => beat.document)]);
    await setCustomPresetColor('emotion', '#000000');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.emotions.some(e=>e.name==='Awe'&&e.color==='#000000'))", 'custom color on the built-in Awe preset');
    let projectAfterPresetColor = await readUi();
    const referencedDocumentsAfterPresetColor = projectAfterPresetColor.scenes.flatMap(scene => [scene.summaryDocument, ...scene.beats.map(beat => beat.document)]);
    assert.deepEqual(referencedDocumentsAfterPresetColor, referencedDocumentsBeforePresetColor, 'Changing a preset color never writes summary or beat documents.');
    await clickLabel('Undo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>{const preset=p.emotions.find(e=>e.name==='Awe');return !!preset&&(preset.color??'')===''})", 'Undo restores the built-in catalog fallback');
    await clickLabel('Redo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.emotions.some(e=>e.name==='Awe'&&e.color==='#000000'))", 'Redo restores the built-in custom color');
    report.checks.push('Built-in preset color edits preserve inline documents and participate in Undo/Redo');
    await captureView('emotions');
    await clickLabel('Return to Smoke arrival');
    projectAfterPresetColor = await readUi();
    await clickLabel('Save');
    await waitFor("document.querySelector('.save-state')?.textContent.includes('Saved locally')", 'custom preset color Save acknowledgement');
    const previousPresetColorSession = await evaluate('window.__nativeSmokeSessionId');
    await clickLabel('Project menu');
    await clickLabel('Open project');
    await waitFor("Boolean(document.querySelector('.story-canvas')?.getClientRects().length)", 'newly opened Story canvas');
    await clickLabel('Open chapter Chapter One');
    await waitFor(`window.__nativeSmokeSessionId !== ${JSON.stringify(previousPresetColorSession)}`, 'reopened custom preset color session');
    assert.deepEqual(await readUi(), projectAfterPresetColor, 'Reopening preserves built-in and new custom preset colors.');
    await waitFor("Boolean(document.querySelector('button.scene-open'))", 'Story timeline after preset color reopen');
    assert.ok(await evaluate("(() => { const button=Array.from(document.querySelectorAll('button.scene-open')).find(item=>item.querySelector('h3')?.textContent==='Smoke arrival'); if(!button||button.disabled)return false; button.click(); return true; })()"));
    await waitFor("document.querySelector('[contenteditable=\"true\"][aria-label=\"Scene summary\"]')", 'scene after preset color reopen');
    const persistedColors = await readUi();
    assert.equal(persistedColors.emotions.find(preset => preset.name === 'Awe')?.color, '#000000');
    assert.equal(persistedColors.tones.find(preset => preset.name === 'Stillness')?.color, '#FF00AA');
    report.checks.push('Native Save and UI reopen preserve custom colors on built-in and newly created presets');
    assert.equal(persistedColors.characters.find(character => character.name === 'Tamsin Revised')?.icon, 'coins');
    assert.equal(persistedColors.characters.find(character => character.name === 'Rowan')?.icon, 'bird');
    assert.equal(persistedColors.characters.find(character => character.name === 'Mara')?.icon, 'crown');
    assert.ok(persistedColors.characters.find(character => character.name === 'Tamsin Revised')?.voice.includes('small joke'));
    report.checks.push('Save and native reopen preserve stock and blank wizard profiles, custom icons, and edits to existing character icons');
    await clickSidebarTab('Characters');
    await clickLabel('Manage Characters');
    await waitFor("Array.from(document.querySelectorAll('.global-library-character')).some(element=>element.getClientRects().length>0)", 'visible full Characters screen');
    await clickLabel('Choose character icon');
    await captureView('characters');
    await clickLabel('Return to Smoke arrival');
    await clickSidebarTab('Characters');
    await dragBlock('.block-shelf button[aria-label="Character: Mara"]','.summary-board h2','Character from shelf onto summary heading');
    await waitFor("document.querySelectorAll('.summary-board .character-chip').length === 1", 'native character drag into summary heading');
    await clickSidebarTab('Emotions');
    await dragBlock('.block-shelf button[aria-label="Emotion: Awe"]','.summary-board h2','Emotion from shelf into summary text');
    await dragBlock('.block-shelf button[aria-label="Emotion: Awe"]','.summary-board h2','Second emotion from shelf into summary text');
    await dragBlock('.block-shelf button[aria-label="Emotion: Awe"]','.beat-label','Emotion from shelf into beat label/card');
    await waitFor("document.querySelectorAll('.summary-board .block-emotion').length === 2 && document.querySelectorAll('[data-item-id] .block-emotion').length >= 3", 'independent emotions dropped on summary and beat cards');
    await clickSidebarTab('Tones');
    await dragBlock('.block-shelf button[aria-label="Tone: Tender"]','.summary-board h2','Tone from shelf into summary text');
    await dragBlock('.block-shelf button[aria-label="Tone: Tense"]','.summary-board h2','Second tone from shelf into summary text');
    await waitFor("document.querySelectorAll('.summary-board .block-tone').length === 2", 'multiple tones retained on the summary');
    let blockProject = await readUi();
    const blockScene = blockProject.scenes.find(scene => scene.id === sceneId);
    const summaryReferences = collectReferences(blockScene.summaryDocument, 'toneReference');
    assert.equal(summaryReferences.length, 2, 'The summary stores multiple tones in document order.');
    const unboundSummaryEmotions = collectReferences(blockScene.summaryDocument, 'emotionReference');
    assert.equal(unboundSummaryEmotions.length, 2);
    assert.ok(unboundSummaryEmotions.every(node => !node.attrs.targetOccurrenceId), 'Summary emotions do not require character targets.');
    await dragBlock('.summary-board .block-tone',`.beat-content[data-board-id="${activeBeatId}"] .beat-label`,'Move an inline tone from summary to beat');
    await waitFor("document.querySelectorAll('.summary-board .block-tone').length === 1 && document.querySelectorAll('[data-item-id] .block-tone').length === 3", 'cross-board tone move preserves the other tone and both beat tones');
    const emotionsBeforeMove = await evaluate(`document.querySelectorAll('[data-board-id="${activeBeatId}"] .block-emotion').length`);
    await dragBlock('.summary-board .block-emotion',`.beat-content[data-board-id="${activeBeatId}"] .beat-label`,'Move an inline emotion from summary to beat');
    await waitFor(`document.querySelectorAll('.summary-board .block-emotion').length === 1 && document.querySelectorAll('[data-board-id="${activeBeatId}"] .block-emotion').length === ${emotionsBeforeMove + 1}`, 'cross-board emotion move requires no character target');
    const beatCharactersBeforeCopy = await evaluate(`document.querySelectorAll('[data-board-id="${activeBeatId}"] .character-chip').length`);
    const beatEmotionsBeforeCopy = await evaluate(`document.querySelectorAll('[data-board-id="${activeBeatId}"] .block-emotion').length`);
    const summaryOccurrence = await evaluate("document.querySelector('.summary-board .character-chip')?.getAttribute('data-occurrence-id')");
    await dragBlock('.summary-board .character-chip',`.beat-content[data-board-id="${activeBeatId}"] .beat-label`,'Ctrl-drag inline character copy from summary to beat',2);
    await waitFor(`document.querySelectorAll('[data-board-id="${activeBeatId}"] .character-chip').length === ${beatCharactersBeforeCopy + 1}`, 'native inline character copy');
    assert.equal(await evaluate(`document.querySelectorAll('[data-board-id="${activeBeatId}"] .block-emotion').length`), beatEmotionsBeforeCopy, 'Copying a character never copies an unrelated emotion.');
    assert.equal(await evaluate("document.querySelector('.summary-board .character-chip')?.getAttribute('data-occurrence-id')"),summaryOccurrence,'Copy retains the original summary occurrence');
    const copiedIds = await evaluate(`Array.from(document.querySelectorAll('[data-board-id="${activeBeatId}"] .character-chip')).map(node=>node.getAttribute('data-occurrence-id'))`);
    assert.equal(copiedIds.includes(summaryOccurrence),false,'Copied character gets a new occurrence identity');
    blockProject = await readUi();
    const finalScene = blockProject.scenes.find(scene => scene.id === sceneId);
    const movedBeat = finalScene.beats.find(beat => beat.id === activeBeatId);
    assert.equal(collectReferences(finalScene.summaryDocument, 'emotionReference').length, 1);
    assert.equal(collectReferences(movedBeat.document, 'emotionReference').length, emotionsBeforeMove + 1);
    assert.equal(collectReferences(movedBeat.document, 'toneReference').length, 3);
    report.checks.push('Actual pointer drops place all reference kinds on summary headings and beat card labels; emotions and multiple tones remain independent inline references');
    report.checks.push('Generic inline drag moves emotions and tones across boards and Ctrl-drag copies only the selected character with a fresh occurrence ID');
    await waitFor("document.querySelector('.scene-settings .inspector-toggle')?.getAttribute('aria-expanded') === 'false' && document.querySelector('.block-inspector-body')?.hidden === true", 'reference drops do not open scene details');
    const colors=await evaluate("Object.fromEntries(['character','emotion','tone'].map(kind=>[kind,getComputedStyle(document.querySelector('.ProseMirror .block-'+kind)).backgroundColor]))");
    assert.ok(Object.values(colors).every(color => typeof color === 'string' && color.startsWith('rgb(')), 'Character, emotion, and tone references all have a computed background.');
    const roseTone = starterCatalog.tones.find(preset => preset.name === 'Tender');
    const roseEmotion = starterCatalog.emotions.find(preset => preset.name === 'Affectionate');
    assert.ok(roseTone && roseEmotion);
    assert.equal(roseTone.color, roseEmotion.color, 'Tone and emotion definitions may share the same named palette family.');
    await evaluate("document.querySelector('details.generation-preview').open=true");
    await waitFor("document.querySelector('.generation-preview pre')?.textContent.includes('Referenced reusable blocks:') && document.querySelector('.generation-preview pre')?.textContent.includes('- Tone: Tender') && document.querySelector('.generation-preview pre')?.textContent.includes('- Emotion: Awe')", 'generation preview includes definitions referenced inline');
    report.checks.push('Referenced definitions appear in generation context; optional scene details remain closed after insertion');
    const beatOrder = blockProject.scenes.find(scene => scene.id === sceneId).beats.map(beat => beat.id);
    await dragItems(beatOrder[0], beatOrder[1], async () => (await readUi()).scenes.find(scene => scene.id === sceneId).beats.map(beat => beat.id), 'Beat handle drag');
    await evaluate('window.scrollTo(0, 0)');
    const expandedWritingWidth = await evaluate("document.querySelector('.scene-writing').getBoundingClientRect().width");
    await clickLabel('Collapse block sidebar');
    await waitFor("document.querySelector('.shelf-toggle')?.getAttribute('aria-expanded') === 'false' && document.querySelector('.block-shelf-body')?.hidden === true", 'collapsed scene sidebar');
    const collapsedWritingWidth = await evaluate("document.querySelector('.scene-writing').getBoundingClientRect().width");
    assert.ok(collapsedWritingWidth > expandedWritingWidth, 'Collapsing the sidebar must give scene writing more width at 1440px.');
    await clickLabel('Expand block sidebar');
    await waitFor("document.querySelector('.shelf-toggle')?.getAttribute('aria-expanded') === 'true'", 'expanded scene sidebar');
    await evaluate("document.querySelector('details.generation-preview').open=false");
    await captureView('scene');
    report.checks.push('Actual native Story and Scene UI render the reopened SQLite content');
    report.checks.push('Preset shelf and inline colors match in light/dark; enabled white-text actions and preset normal/hover/pressed states keep 4.5:1 contrast');
    report.checks.push('Native Story, library, template draft, and expanded-sidebar Scene inspected in light/dark at 1440px and 800px without horizontal overflow');
    report.checks.push('Collapsing the Scene sidebar at 1440px gives the writing area more width and can be expanded again');
    assert.equal(report.gestureErrors?.length ?? 0, 0, report.gestureErrors?.join('; '));
    assert.equal(await evaluate("window.__TAURI_INTERNALS__.invoke('project_has_unsaved_changes', { sessionId: window.__nativeSmokeSessionId })"), true, 'Reference and beat order changes remain unsaved in manual mode.');
    await requestWindowClose(child.pid);
    await waitFor("Boolean(document.querySelector('.unsaved-dialog[open]'))", 'unsaved changes prompt after native title-bar close request');
    await clickLabel('Cancel');
    await waitFor("!document.querySelector('.unsaved-dialog')", 'cancelled native close prompt');
    assert.equal(child.exitCode, null, 'Cancel keeps the child app open.');
    assert.equal(await evaluate("window.__TAURI_INTERNALS__.invoke('project_has_unsaved_changes', { sessionId: window.__nativeSmokeSessionId })"), true, 'Cancel preserves unsaved working changes.');
    report.checks.push('Native title-bar close request opens the unsaved prompt; Cancel keeps the project and edits open');
    await clickLabel('Save');
    await waitFor("document.querySelector('.save-state')?.textContent.includes('Saved locally')", 'final manual Save acknowledgement');
    const wizardScreenshots = report.screenshots.filter(filename => filename.startsWith('wizard-')).sort();
    const expectedWizardScreenshots = [
      'wizard-starting-point-light-1440x960.png', 'wizard-starting-point-light-800x960.png',
      'wizard-starting-point-dark-1440x960.png', 'wizard-starting-point-dark-800x960.png',
      'wizard-stock-results-light-800x600.png', 'wizard-stock-results-dark-800x600.png',
      'wizard-stock-wide-light-1440x960.png', 'wizard-stock-compact-dark-800x960.png',
      'wizard-stock-detail-light-800x600.png', 'wizard-stock-detail-dark-800x600.png',
      'wizard-ensemble-search-light-800x960.png', 'wizard-ensemble-search-dark-800x960.png',
      'wizard-identity-light-1440x960.png', 'wizard-identity-light-800x960.png',
      'wizard-identity-dark-1440x960.png', 'wizard-identity-dark-800x960.png',
      'wizard-details-light-1440x960.png', 'wizard-details-light-800x960.png',
      'wizard-details-dark-1440x960.png', 'wizard-details-dark-800x960.png',
      'wizard-details-expanded-guidance-light-1440x960.png', 'wizard-details-expanded-guidance-light-800x960.png', 'wizard-details-expanded-guidance-light-800x600.png',
      'wizard-details-expanded-guidance-dark-1440x960.png', 'wizard-details-expanded-guidance-dark-800x960.png', 'wizard-details-expanded-guidance-dark-800x600.png',
      'wizard-review-light-1440x960.png', 'wizard-review-light-800x960.png',
      'wizard-review-dark-1440x960.png', 'wizard-review-dark-800x960.png',
      'wizard-review-default-guidance-light-1440x960.png', 'wizard-review-default-guidance-light-800x960.png', 'wizard-review-default-guidance-light-800x600.png',
      'wizard-review-default-guidance-dark-1440x960.png', 'wizard-review-default-guidance-dark-800x960.png', 'wizard-review-default-guidance-dark-800x600.png',
    ].sort();
    assert.deepEqual(wizardScreenshots, expectedWizardScreenshots, 'The native visual batch contains exactly 36 wizard captures at the agreed viewport matrix.');
    await requestWindowClose(child.pid);
    if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(10_000)]);
    assert.equal(child.exitCode, 0, 'A saved project must close normally through its native title-bar close handler.');
    report.checks.push('A saved project closes normally after a native title-bar close request');
    report.passed = true;
  } catch (error) {
    report.error = error.stack ?? String(error);
    if (cdp) {
      try {
        const state = await cdp.send('Runtime.evaluate', { expression: "({ url: location.href, bodyText: document.body.innerText, alerts: Array.from(document.querySelectorAll('[role=alert]')).map(element => element.innerText), interceptedCommands: window.__nativeSmokeCommands, invokeDescriptor: Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__ || {}, 'invoke') })", returnByValue: true });
        report.failureState = state.result?.value;
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await fs.writeFile(path.join(run, 'failure.png'), Buffer.from(screenshot.data, 'base64'));
        report.screenshots.push('failure.png');
      } catch (diagnosticError) { report.diagnosticError = diagnosticError.message; }
    }
    throw error;
  } finally {
    cdp?.close(); stop();
    if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(5000)]);
    await appLog.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    // Both lexical and real paths are checked immediately before the recursive removal.
    try { const cleanupTarget = await checkedCleanupTarget(run, temporary); await fs.rm(cleanupTarget, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    catch (error) { report.cleanupError = error.message; report.passed = false; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`Native smoke ${report.passed ? 'passed' : 'failed'}; evidence: ${run}`);
  }
}
module.exports = { assertDescendant, checkedCleanupTarget };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
