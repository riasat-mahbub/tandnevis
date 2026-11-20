#!/usr/bin/env node
// Run only against this repository's built Windows app. No production debug hook is installed.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
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
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
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
      const until = Date.now() + 15_000;
      while (Date.now() < until) { if (await evaluate(expression)) return; await pause(100); }
      throw new Error(`Timed out waiting for ${description}.`);
    };
    const clickLabel = async name => {
      const button = `Array.from(document.querySelectorAll('button')).find(button => (button.getAttribute('aria-label') || button.textContent.trim()) === ${JSON.stringify(name)})`;
      await waitFor(`Boolean((${button}) && !(${button}).disabled)`, `enabled ${name} button`);
      await evaluate(`(${button}).click()`);
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
        await clickLabel('Open Settings');
        await evaluate(`document.querySelector('input[name="appearance"][value="${theme}"]').click()`);
        await clickLabel('Back to writing');
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        for (const width of [1440, 800]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: false });
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
    let session = await invoke('create_project', { path: projectPath, title: 'Native smoke story' });
    let project = session.project;
    const apply = async operation => { project = await invoke('apply_operation', { sessionId: session.sessionId, expectedRevision: project.revision, operation }); return project; };
    await apply({ type: 'createChapter', title: 'Chapter One' });
    const chapterId = project.chapters[0].id;
    await apply({ type: 'createScene', chapterId, title: 'Smoke arrival' });
    const sceneId = project.scenes[0].id;
    await apply({ type: 'updateScene', sceneId, summary: 'A synthetic visitor arrives at the station.', tone: 'Hopeful' });
    await apply({ type: 'createScene', chapterId, title: 'Smoke departure' });
    const secondSceneId = project.scenes[1].id;
    await apply({ type: 'updateScene', sceneId: secondSceneId, summary: 'A letter changes the route home.', tone: 'Wistful' });
    await apply({ type: 'createCharacter', name: 'Mara' });
    const characterId = project.characters[0].id;
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
    await waitFor("Boolean(document.querySelector('.generation-settings-link'))", 'scene generation setup link');
    const generateButton = await evaluate("(() => { const button = Array.from(document.querySelectorAll('.generation-panel button')).find(button => button.textContent.includes('Generate scene')); return button ? { disabled: button.disabled, hasSettingsLink: !!document.querySelector('.generation-settings-link') } : null; })()");
    assert.deepEqual(generateButton, { disabled: true, hasSettingsLink: true }, 'Scene generation must stay disabled until ChatGPT is verified.');
    await evaluate("document.querySelector('.generation-settings-link').click()");
    await waitFor(`document.querySelector('#settings-page')?.innerText.includes(${JSON.stringify(runtime.portable ? 'Portable folder' : 'Standard app data')})`, 'storage mode in Settings');
    await waitFor(`document.querySelector('#settings-page')?.innerText.includes(${JSON.stringify(runtime.dataDirectory)})`, 'portable data path in Settings');
    assert.ok(await evaluate("document.querySelector('#settings-page')?.innerText.includes('Active')"), 'Settings must report the active WebView2 runtime.');
    report.checks.push('Unconfigured scene generation stays disabled; Settings reports portable path and the active local WebView2 runtime');
    await clickLabel('Back to writing');
    await waitFor("document.body.innerText.includes('The train arrives beneath a violet sky.')", 'return to selected scene');
    const uiSummary = 'The visitor steps from the train. Saved through the native scene editor.';
    await evaluate(`(() => { const textarea = document.querySelector('textarea[aria-label="Scene summary"]'); if (!textarea) throw new Error('Scene summary control is missing.'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, ${JSON.stringify(uiSummary)}); textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.blur(); })()`);
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.scenes.find(scene => scene.id === ${JSON.stringify(sceneId)})?.summary === ${JSON.stringify(uiSummary)})`, 'scene summary saved to SQLite through UI');
    report.checks.push('Native Scene summary UI edit reaches the Rust SQLite repository');
    const readUi = () => evaluate("window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId })");
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
    await evaluate("Array.from(document.querySelectorAll('.toolbar-actions button')).find(button => /^Trash\\b/.test(button.textContent.trim())).click()");
    await waitFor("Boolean(document.querySelector('[aria-label=\"Project Trash\"]'))", 'Project Trash panel');
    await clickLabel('Restore');
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.scenes.find(scene => scene.id === ${JSON.stringify(sceneId)})?.beats.some(beat => beat.id === ${JSON.stringify(uiBeatId)}))`, 'visible Trash Restore action');
    await clickLabel('Close panel');
    report.checks.push('Visible beat Duplicate, Move down, Delete, and Trash Restore controls persist native operations');
    uiProject = await readUi();
    const previousUiSession = await evaluate('window.__nativeSmokeSessionId');
    await clickLabel('Open project');
    await waitFor(`window.__nativeSmokeSessionId !== ${JSON.stringify(previousUiSession)}`, 'reopened native UI project session');
    assert.deepEqual(await readUi(), uiProject);
    await waitFor("Boolean(document.querySelector('button.scene-open'))", 'reopened Story timeline');
    assert.ok(await evaluate("(() => { const button = Array.from(document.querySelectorAll('button.scene-open')).find(button => button.querySelector('h3')?.textContent === 'Smoke arrival'); if (!button || button.disabled) return false; button.click(); return true; })()"));
    await waitFor(`document.querySelector('textarea[aria-label="Scene summary"]')?.value === ${JSON.stringify(uiSummary)} && document.body.innerText.includes(${JSON.stringify(uiBeatText)})`, 'reopened native summary and beat edits');
    report.checks.push('Reopening through native UI preserves summary/beat edits and structural actions');
    await evaluate("(() => { const editor = document.querySelector('[contenteditable=\"true\"][aria-label=\"Freeform text for beat 1\"]'); editor.focus(); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); const button = Array.from(document.querySelectorAll('.library button.character-chip')).find(button => button.textContent.trim() === 'Mara'); if (!button) throw new Error('Mara library button is missing.'); button.click(); })()");
    await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.scenes.flatMap(scene => scene.beats).some(beat => JSON.stringify(beat.document).includes(${JSON.stringify(`"characterId":"${characterId}"`)})))`, 'character inserted at native beat caret');
    const chipBounds = await evaluate("(() => { const chip = document.querySelector('.ProseMirror .character-chip'); if (!chip) throw new Error('Inserted character chip is missing.'); chip.scrollIntoView({ block: 'center' }); const bounds = chip.getBoundingClientRect(); return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }; })()");
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...chipBounds, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...chipBounds, button: 'left', clickCount: 1 });
    await waitFor("document.querySelector('.inspector')?.innerText.includes('This character reference only')", 'selected character local inspector');
    await evaluate("(() => { const input = document.querySelector('.inspector .emotion-field input'); if (!input) throw new Error('Local emotion field is missing.'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Relieved'); input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.scenes.flatMap(scene => scene.beats).some(beat => JSON.stringify(beat.document).includes('\"emotion\":\"Relieved\"')))", 'local character emotion saved');
    await clickLabel('Edit reusable profile');
    await waitFor("Boolean(document.querySelector('input[aria-label=\"Character name\"]'))", 'reusable profile editor');
    const beforeRename = await readUi();
    await evaluate("(() => { const input = document.querySelector('input[aria-label=\"Character name\"]'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Mara Vale'); input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await evaluate("document.querySelector('input[aria-label=\"Character name\"]').blur()");
    await waitFor("window.__TAURI_INTERNALS__.invoke('read_project', { sessionId: window.__nativeSmokeSessionId }).then(project => project.characters.some(character => character.name === 'Mara Vale'))", 'reusable character name saved');
    await clickLabel('Close panel');
    await waitFor("document.querySelector('.ProseMirror .character-chip')?.textContent.includes('Mara Vale')", 'latest reusable name rendered in character NodeView');
    await pause(200);
    const afterRename = await readUi();
    assert.equal(afterRename.revision, beforeRename.revision + 1, 'Profile rename must not create extra editor saves');
    assert.equal(afterRename.characters.find(character => character.id === characterId).voice, '');
    assert.ok(afterRename.scenes.flatMap(scene => scene.beats).some(beat => JSON.stringify(beat.document).includes('"emotion":"Relieved"')));
    report.checks.push('Native library insertion, pointer chip selection, occurrence-only emotion, and latest shared name rendering without extra saves');
    const beatOrder = afterRename.scenes.find(scene => scene.id === sceneId).beats.map(beat => beat.id);
    await dragItems(beatOrder[0], beatOrder[1], async () => (await readUi()).scenes.find(scene => scene.id === sceneId).beats.map(beat => beat.id), 'Beat handle drag');
    await evaluate('window.scrollTo(0, 0)');
    await captureView('scene');
    report.checks.push('Actual native Story and Scene UI render the reopened SQLite content');
    report.checks.push('Native Story and Scene inspected in light/dark at 1440px and 800px without horizontal page overflow');
    assert.equal(report.gestureErrors?.length ?? 0, 0, report.gestureErrors?.join('; '));
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
