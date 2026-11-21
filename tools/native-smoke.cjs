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
  console.log('Usage: node tools/native-smoke.cjs [--exe path/to/shorthand-writer.exe]\nRequires a built Windows app. Launches that exact child with an isolated WebView2 profile and temporary CDP port.');
  process.exit(0);
}
const exeIndex = argv.indexOf('--exe');
if (argv.length && (exeIndex !== 0 || argv.length !== 2 || !argv[1])) {
  console.error('Usage: node tools/native-smoke.cjs [--exe path/to/shorthand-writer.exe]');
  process.exit(2);
}
const exe = path.resolve(root, exeIndex >= 0 ? argv[exeIndex + 1] ?? '' : 'src-tauri/target/release/shorthand-writer.exe');
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
      const button = `Array.from(document.querySelectorAll('button,summary')).find(button => button.getClientRects().length && (button.getAttribute('aria-label') || button.textContent.trim()) === ${JSON.stringify(name)})`;
      await waitFor(`Boolean((${button}) && !(${button}).disabled)`, `enabled ${name} button`);
      await evaluate(`(${button}).click()`);
    };
    const clickSidebarTab = async name => {
      const tab = `Array.from(document.querySelectorAll('[role="tab"]')).find(tab => tab.textContent.trim() === ${JSON.stringify(name)})`;
      await waitFor(`Boolean(${tab})`, `${name} sidebar tab`);
      await evaluate(`(${tab}).click()`);
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
    await waitFor("document.body.innerText.includes('Smoke arrival')", 'persisted Story timeline');
    await dragItems(sceneId, secondSceneId, () => evaluate(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.chapters.find(chapter => chapter.id === ${JSON.stringify(chapterId)}).sceneIds)`), 'Scene handle drag');
    await captureView('story');
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
    await waitFor("document.querySelector('.block-inspector .inspector-toggle')?.getAttribute('aria-expanded') === 'false' && document.querySelector('#scene-details-panel')?.hidden === true", 'optional scene details stays closed after reference insertion');
    report.checks.push('Native keyboard click insertion adds independent emotions and multiple tones at the last focused caret without opening scene details');
    assert.equal(await evaluate("document.querySelector('.project-header-identity')?.firstElementChild?.classList.contains('project-back')"),true,'Back is the leftmost header control');
    await clickSidebarTab('Characters');
    await clickLabel('New character');
    await waitFor("Boolean(document.querySelector('.character-template-browser'))", 'visual stock character browser');
    const setCharacterDraftName = name => evaluate(`(() => { const label=Array.from(document.querySelectorAll('.library-create-character label')).find(item=>item.textContent.trim().startsWith('Character name')); const input=label?.querySelector('input'); if(!input)throw new Error('Character name field missing'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    const beforeTemplateDraft = await readUi();
    await setCharacterDraftName('Tamsin');
    await clickLabel('Preview The Miser');
    assert.ok(await evaluate("Array.from(document.querySelectorAll('.library-create-character textarea')).every(field=>field.value==='')"), 'Previewing a type leaves editable fields blank.');
    assert.deepEqual(await readUi(), beforeTemplateDraft, 'Browsing templates never changes project records.');
    assert.equal(await evaluate("Boolean(document.querySelector('select[aria-label=\"Start from a template\"]'))"), false, 'The visual browser replaces the old template dropdown.');
    await evaluate('window.scrollTo(0,0)');
    await captureView('new-character');
    await clickLabel('Use template');
    await waitFor("Array.from(document.querySelectorAll('.library-create-character textarea')).length===3 && Array.from(document.querySelectorAll('.library-create-character textarea')).every(field=>field.value.trim())", 'applied traditional stock type');
    assert.deepEqual(await readUi(), beforeTemplateDraft, 'An unsubmitted template draft must not change the project.');
    await clickLabel('Create character');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.characters.some(c=>c.name==='Tamsin'&&c.icon==='coins'))", 'traditional stock character with its icon');
    await clickLabel('Undo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>!p.characters.some(c=>c.name==='Tamsin'))", 'Undo removes one atomically created character');
    await clickLabel('Redo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.characters.some(c=>c.name==='Tamsin'&&c.icon==='coins'&&c.voice.trim()))", 'Redo restores the complete profile and icon');
    await clickLabel('New character');
    await clickLabel('Preview The Con Artist');
    await clickLabel('Use template');
    await setCharacterDraftName('Corin');
    await clickLabel('Create character');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.characters.some(c=>c.name==='Corin'&&c.background.trim()&&c.personality.trim()&&c.voice.trim()))", 'genre stock character creation');
    await clickLabel('New character');
    await setCharacterDraftName('Rowan');
    await clickLabel('Choose character icon');
    await clickLabel('Bird icon');
    await clickLabel('Create character');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.characters.some(c=>c.name==='Rowan'&&c.icon==='bird'&&!c.background&&!c.personality&&!c.voice))", 'custom blank character with selected icon');
    await evaluate("(() => {const row=Array.from(document.querySelectorAll('.global-library-character .definition-rows button')).find(button=>button.querySelector('strong')?.textContent.trim()==='Mara');if(!row)throw new Error('Existing Mara profile missing');row.click();})()");
    const beforeCharacterIcon = await readUi();
    await clickLabel('Choose character icon');
    await clickLabel('Crown icon');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.characters.some(c=>c.name==='Mara'&&c.icon==='crown'))", 'editing an existing character icon');
    const afterCharacterIcon = await readUi();
    const oldMara = beforeCharacterIcon.characters.find(c=>c.name==='Mara');
    const newMara = afterCharacterIcon.characters.find(c=>c.name==='Mara');
    assert.deepEqual({...newMara,icon:undefined},{...oldMara,icon:undefined}, 'An icon edit preserves every character writing field.');
    assert.deepEqual(afterCharacterIcon.scenes,beforeCharacterIcon.scenes, 'An icon edit never rewrites inline documents or scene prose.');
    await clickLabel('Undo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.characters.some(c=>c.name==='Mara'&&!(c.icon)))", 'Undo restores the existing character default icon');
    await clickLabel('Redo project change');
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__nativeSmokeSessionId}).then(p=>p.characters.some(c=>c.name==='Mara'&&c.icon==='crown'))", 'Redo restores the character icon');
    await clickLabel('Scene');
    await waitFor("Boolean(document.querySelector('.block-shelf button[aria-label=\"Character: Mara\"] [data-character-icon=\"crown\"]')) && Boolean(document.querySelector('.ProseMirror .character-chip [data-character-icon=\"crown\"]'))", 'live matching character icons in shelf and inline references');
    report.checks.push('Visual stock browsing previews without mutation and creates traditional and genre profiles atomically with Undo/Redo');
    report.checks.push('Custom characters choose icons; existing icon edits preserve writing fields and inline documents and support Undo/Redo');
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
    await clickLabel('Scene');
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
    await clickLabel('Scene');
    projectAfterPresetColor = await readUi();
    await clickLabel('Save');
    await waitFor("document.querySelector('.save-state')?.textContent.includes('Saved locally')", 'custom preset color Save acknowledgement');
    const previousPresetColorSession = await evaluate('window.__nativeSmokeSessionId');
    await clickLabel('Project menu');
    await clickLabel('Open project');
    await waitFor(`window.__nativeSmokeSessionId !== ${JSON.stringify(previousPresetColorSession)}`, 'reopened custom preset color session');
    assert.deepEqual(await readUi(), projectAfterPresetColor, 'Reopening preserves built-in and new custom preset colors.');
    await waitFor("Boolean(document.querySelector('button.scene-open'))", 'Story timeline after preset color reopen');
    assert.ok(await evaluate("(() => { const button=Array.from(document.querySelectorAll('button.scene-open')).find(item=>item.querySelector('h3')?.textContent==='Smoke arrival'); if(!button||button.disabled)return false; button.click(); return true; })()"));
    await waitFor("document.querySelector('[contenteditable=\"true\"][aria-label=\"Scene summary\"]')", 'scene after preset color reopen');
    const persistedColors = await readUi();
    assert.equal(persistedColors.emotions.find(preset => preset.name === 'Awe')?.color, '#000000');
    assert.equal(persistedColors.tones.find(preset => preset.name === 'Stillness')?.color, '#FF00AA');
    report.checks.push('Native Save and UI reopen preserve custom colors on built-in and newly created presets');
    assert.equal(persistedColors.characters.find(character => character.name === 'Tamsin')?.icon, 'coins');
    assert.equal(persistedColors.characters.find(character => character.name === 'Rowan')?.icon, 'bird');
    assert.equal(persistedColors.characters.find(character => character.name === 'Mara')?.icon, 'crown');
    assert.ok(persistedColors.characters.some(character => character.name === 'Corin' && character.voice.trim()));
    report.checks.push('Save and native reopen preserve traditional and genre profiles, custom icons, and edits to existing character icons');
    await clickSidebarTab('Characters');
    await clickLabel('Manage Characters');
    await waitFor("Array.from(document.querySelectorAll('.global-library-character')).some(element=>element.getClientRects().length>0)", 'visible full Characters screen');
    await clickLabel('Choose character icon');
    await captureView('characters');
    await clickLabel('Scene');
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
    await waitFor("document.querySelector('.block-inspector .inspector-toggle')?.getAttribute('aria-expanded') === 'false' && document.querySelector('#scene-details-panel')?.hidden === true", 'reference drops do not open scene details');
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
    await waitFor("document.querySelector('.shelf-toggle')?.getAttribute('aria-expanded') === 'false' && document.querySelector('#scene-block-shelf-panel')?.hidden === true", 'collapsed scene sidebar');
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
