// Focused native Compile Book review. Uses a fresh SQLite project/profile from
// native-smoke and intercepts only the chooser result; the Rust writer remains real.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function reviewCompile({ invoke, evaluate, clickLabel, waitFor, cdp, report, run, projectPath, temporary }) {
  const title = 'The Orchard of 雪';
  const initialProse = 'The first line holds café, 雪, and <script>alert("literal")</script> & more.\nA second line stays separate.\n\nA final paragraph.';
  const updatedProse = initialProse + '\nQUEUED prose edit — no project Save.';
  const latestProse = updatedProse + '\nREFRESHED snapshot prose.';
  const proseFile = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

  const fixture = await invoke('create_project', { path: projectPath, title });
  let project = fixture.project;
  const apply = async operation => {
    project = await invoke('apply_operation', { sessionId: fixture.sessionId, expectedRevision: project.revision, operation });
    return project;
  };
  await apply({ type: 'createChapter', title: 'The glass orchard' });
  const firstChapterId = project.chapters[0].id;
  await apply({ type: 'createScene', chapterId: firstChapterId, title: 'A page with marks' });
  const proseSceneId = project.chapters[0].sceneIds[0];
  await apply({ type: 'updateScene', sceneId: proseSceneId, prose: initialProse, summary: 'SUMMARY ONLY: do not export this sentence.' });
  await apply({ type: 'createBeat', sceneId: proseSceneId, document: proseFile('BEAT DIRECTION ONLY: not manuscript prose.'), text: 'BEAT DIRECTION ONLY: not manuscript prose.' });
  await apply({ type: 'createScene', chapterId: firstChapterId, title: 'An unfinished page' });
  const emptySceneId = project.chapters[0].sceneIds[1];
  await apply({ type: 'updateScene', sceneId: emptySceneId, prose: ' \n\t ', summary: 'EMPTY SUMMARY ONLY.' });
  await apply({ type: 'createBeat', sceneId: emptySceneId, document: proseFile('EMPTY BEAT ONLY.'), text: 'EMPTY BEAT ONLY.' });
  await apply({ type: 'createChapter', title: 'The afterlight' });
  const secondChapterId = project.chapters[1].id;
  await apply({ type: 'createScene', chapterId: secondChapterId, title: 'The coda' });
  const codaSceneId = project.chapters[1].sceneIds[0];
  await apply({ type: 'updateScene', sceneId: codaSceneId, prose: 'The second chapter closes with one clear sentence.', summary: 'CODA SUMMARY ONLY.' });
  await apply({ type: 'createBeat', sceneId: codaSceneId, document: proseFile('CODA BEAT ONLY.'), text: 'CODA BEAT ONLY.' });
  await invoke('save_project', { sessionId: fixture.sessionId });

  const overwritePath = path.join(temporary, 'Compile Book overwrite.md');
  const failurePath = path.join(temporary, 'Blocked output.txt');
  const retryPath = path.join(temporary, 'Compile Book retry.txt');
  const htmlPath = path.join(temporary, 'Compile Book export.html');
  await fs.writeFile(overwritePath, 'OVERWRITE SENTINEL', 'utf8');
  await fs.mkdir(failurePath);
  await evaluate(
    "(function(){const original=window.fetch.bind(window);window.__compileSmokeCommands=[];" +
    "window.__compileSmokeChoices=" + JSON.stringify([overwritePath, failurePath, retryPath, null]) + ";" +
    "window.__compileSmokeChooserRequests=[];window.fetch=async function(input,init){" +
    "const url=new URL(typeof input==='string'?input:input.url);" +
    "const command=url.hostname==='ipc.localhost'?decodeURIComponent(url.pathname.slice(1)):null;" +
    "if(command)window.__compileSmokeCommands.push(command);" +
    "if(command==='plugin:dialog|open')return new Response(JSON.stringify(" + JSON.stringify(projectPath) + "),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}});" +
    "if(command==='plugin:dialog|save'){const chosen=window.__compileSmokeChoices.shift();window.__compileSmokeChooserRequests.push({chosen,body:init?.body??null});" +
    "return new Response(JSON.stringify(chosen),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}});}" +
    "const response=await original(input,init);if(command==='open_project'&&response.headers.get('Tauri-Response')==='ok')" +
    "window.__compileSmokeSession=(await response.clone().json()).sessionId;return response;};})()"
  );
  await clickLabel('Project menu');
  await clickLabel('Open project');
  await waitFor('Boolean(window.__compileSmokeSession)', 'saved compile fixture opened through the project UI');
  await clickLabel('Open chapter The glass orchard');
  await evaluate(
    "(function(){const button=Array.from(document.querySelectorAll('.scene-open')).find(item=>item.querySelector('h3')?.textContent==='A page with marks');" +
    "if(!button)throw new Error('Compile prose scene missing from the chapter canvas.');button.click();})()"
  );
  await waitFor("Boolean(document.querySelector('.scene-prose-editor textarea[aria-label=\"Scene prose\"]'))", 'scene prose editor');
  assert.equal(await invoke('project_has_unsaved_changes', { sessionId: await evaluate('window.__compileSmokeSession') }), false, 'The fixture starts saved.');
  await evaluate(
    "(function(){const editor=document.querySelector('.scene-prose-editor textarea[aria-label=\"Scene prose\"]');" +
    "window.__compileSmokeEditor=editor;window.__compileSmokeOriginalEditor=editor.value;" +
    "Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor," + JSON.stringify(updatedProse) + ");" +
    "editor.dispatchEvent(new Event('input',{bubbles:true}));})()"
  );
  await waitFor("document.querySelector('.scene-prose-editor textarea')?.value.includes('QUEUED prose edit')", 'latest queued prose in the editor');
  await waitFor("document.querySelector('.save-state')?.textContent.includes('Unsaved changes')", 'queued prose marked unsaved');
  await evaluate("window.__compileSmokeCommands=[];document.querySelector('.compile-trigger')?.focus();document.querySelector('.compile-trigger')?.click()");
  await waitFor("Boolean(document.querySelector('.compile-dialog[open]'))&&document.querySelector('.compile-preview')?.getAttribute('aria-busy')!=='true'", 'Compile Book preview ready after workspace flush');
  await waitFor("document.querySelector('.manuscript-prose')?.textContent.includes('QUEUED prose edit')", 'latest queued prose in initial snapshot');
  assert.equal(await evaluate("document.querySelector('.compile-config input[type=radio][value=scene]')?.checked"), true, 'Opening from a scene defaults to scene scope.');
  assert.equal(await invoke('project_has_unsaved_changes', { sessionId: await evaluate('window.__compileSmokeSession') }), true, 'Opening Compile Book flushes prose into the working database without saving the project file.');
  report.checks.push('Opening from a scene flushes the latest queued prose into its preview without a project Save.');

  const closeCompile = async () => {
    await clickLabel('Close');
    await waitFor("!document.querySelector('.compile-dialog[open]')", 'Compile Book dialog closed');
  };
  await closeCompile();
  assert.equal(await evaluate("document.querySelector('.scene-prose-editor textarea')===window.__compileSmokeEditor"), true, 'Closing compilation keeps the originating scene editor mounted.');
  assert.equal(await evaluate("document.activeElement===document.querySelector('.compile-trigger')"), true, 'Closing compilation restores focus to its trigger.');
  report.checks.push('Close returns focus to Compile Book and preserves the same mounted scene prose editor.');

  const setAppearance = async theme => {
    await clickLabel('Open Settings');
    await evaluate("document.querySelector('input[name=\"appearance\"][value=" + JSON.stringify(theme) + "]')?.click()");
    await clickLabel('Back to writing');
    await waitFor("document.querySelector('.app')?.dataset.theme===" + JSON.stringify(theme), theme + ' appearance');
  };
  const capture = async (theme, width, height) => {
    await evaluate("document.querySelector('.compile-trigger')?.focus();document.querySelector('.compile-trigger')?.click()");
    await waitFor("Boolean(document.querySelector('.compile-dialog[open]'))&&document.querySelector('.compile-preview')?.getAttribute('aria-busy')!=='true'", 'Compile Book layout preview ready');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await new Promise(resolve => setTimeout(resolve, 140));
    const layout = await evaluate(
      "(()=>{const dialog=document.querySelector('.compile-dialog'),body=document.querySelector('.compile-body'),config=document.querySelector('.compile-config'),preview=document.querySelector('.compile-preview');" +
      "return {theme:document.querySelector('.app')?.dataset.theme,width:innerWidth,scrollWidth:document.documentElement.scrollWidth," +
      "dialog:{left:dialog.getBoundingClientRect().left,right:dialog.getBoundingClientRect().right,width:dialog.getBoundingClientRect().width}," +
      "bodyDisplay:getComputedStyle(body).display,configBottom:config.getBoundingClientRect().bottom,previewTop:preview.getBoundingClientRect().top};})()"
    );
    assert.equal(layout.theme, theme);
    assert.equal(layout.width, width);
    assert.ok(layout.dialog.left >= -1 && layout.dialog.right <= width + 1, 'Compile dialog fits the viewport.');
    assert.ok(layout.scrollWidth <= width + 1, 'Compile view has no horizontal document overflow.');
    if (width <= 780) assert.equal(layout.bodyDisplay, 'block', 'Narrow Compile Book stacks options above preview.');
    const filename = 'compile-' + theme + '-' + width + 'x' + height + '.png';
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(path.join(run, filename), Buffer.from(screenshot.data, 'base64'));
    report.screenshots.push(filename);
    report.layout.push({ view: 'compile', ...layout });
    await closeCompile();
  };
  for (const theme of ['light', 'dark']) {
    await setAppearance(theme);
    for (const [width, height] of [[1440, 960], [800, 900], [780, 900], [390, 844]]) await capture(theme, width, height);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  }
  await setAppearance('light');

  await evaluate("document.querySelector('.compile-trigger')?.focus();document.querySelector('.compile-trigger')?.click()");
  await waitFor("Boolean(document.querySelector('.compile-dialog[open]'))&&document.querySelector('.compile-preview')?.getAttribute('aria-busy')!=='true'", 'functional Compile Book preview ready');
  await waitFor("document.querySelector('.manuscript-prose')?.textContent.includes('QUEUED prose edit')", 'queued prose snapshot reopened');
  await evaluate(
    "(function(){const editor=window.__compileSmokeEditor;" +
    "Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor," + JSON.stringify(latestProse) + ");" +
    "editor.dispatchEvent(new Event('input',{bubbles:true}));})()"
  );
  await waitFor("Boolean(document.querySelector('.compile-stale'))", 'stale preview notice after new prose arrives');
  assert.equal(await evaluate("document.querySelector('.manuscript-prose')?.textContent.includes('REFRESHED snapshot prose')"), false, 'The preview does not silently change with newer prose.');
  assert.equal(await evaluate("document.querySelector('.compile-actions button.primary')?.disabled"), true, 'Export is disabled while the preview is stale.');
  await clickLabel('Refresh preview');
  await waitFor("!document.querySelector('.compile-stale')&&document.querySelector('.manuscript-prose')?.textContent.includes('REFRESHED snapshot prose')", 'explicit refreshed snapshot');
  report.checks.push('A newer queued edit marks the immutable preview stale, blocks export, and appears only after Refresh preview.');

  const setScope = async scope => {
    await evaluate("document.querySelector('.compile-config input[type=radio][value=" + JSON.stringify(scope) + "]')?.click()");
  };
  const selectOption = async (suffix, value) => {
    await evaluate(
      "(function(){const select=document.querySelector('.compile-config select[id$=" + JSON.stringify('-' + suffix) + "]');" +
      "if(!select)throw new Error('Missing compile " + suffix + " selector.');" +
      "Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select," + JSON.stringify(value) + ");" +
      "select.dispatchEvent(new Event('change',{bubbles:true}));})()"
    );
  };
  const previewText = () => evaluate("document.querySelector('.compile-preview')?.innerText??''");
  await setScope('story');
  let preview = await previewText();
  assert.match(preview, /REFRESHED snapshot prose/);
  assert.match(preview, /The second chapter closes with one clear sentence/);
  assert.doesNotMatch(preview, /SUMMARY ONLY|BEAT DIRECTION ONLY|EMPTY BEAT ONLY|CODA BEAT ONLY/);
  assert.match(await evaluate("document.querySelector('.compile-summary strong')?.textContent??''"), /2 of 3 scenes/);
  await selectOption('empty', 'placeholder');
  assert.match(await previewText(), /Unfinished: An unfinished page/);
  await selectOption('empty', 'require');
  assert.match(await previewText(), /The second chapter closes with one clear sentence/);
  assert.equal(await evaluate("document.querySelector('.compile-actions button.primary')?.disabled"), true, 'Require-all disables story export while a scene is empty.');
  await selectOption('empty', 'skip');
  await setScope('chapter');
  await selectOption('chapter', secondChapterId);
  preview = await previewText();
  assert.match(preview, /The second chapter closes with one clear sentence/);
  assert.doesNotMatch(preview, /REFRESHED snapshot prose/);
  await setScope('scene');
  await selectOption('chapter', firstChapterId);
  await selectOption('scene', emptySceneId);
  assert.equal(await evaluate("document.querySelector('.compile-actions button.primary')?.disabled"), true, 'An empty scene is not exportable with the default skip policy.');
  await selectOption('empty', 'placeholder');
  assert.match(await previewText(), /Unfinished: An unfinished page/);
  await selectOption('empty', 'require');
  assert.equal(await evaluate("document.querySelector('.compile-actions button.primary')?.disabled"), true, 'Require-all blocks an empty single-scene export.');
  await selectOption('empty', 'skip');
  await setScope('story');
  await selectOption('format', 'md');
  assert.match(await previewText(), /REFRESHED snapshot prose/);
  report.checks.push('Story, chapter, and scene scopes follow selected IDs; empty-scene policies work, and summaries/beats stay out of the manuscript.');

  const clickCheckbox = async label => evaluate(
    "(function(){const item=Array.from(document.querySelectorAll('.compile-config label')).find(label=>label.textContent.trim()===" + JSON.stringify(label) + ");" +
    "if(!item)throw new Error('Missing compile option: " + label + "');item.click();})()"
  );
  await clickCheckbox('Include title page');
  await clickCheckbox('Include contents');
  await clickCheckbox('Show scene titles');
  await waitFor("document.querySelector('.compile-config input[type=checkbox]')?.checked", 'title page option applied');
  const chooserBaseline = await evaluate('window.__compileSmokeChooserRequests.length');
  await clickLabel('Export MD');
  await waitFor("window.__compileSmokeCommands.includes('write_compiled_manuscript')", 'native Markdown write command');
  await waitFor("document.querySelector('.compile-summary [role=status]')?.textContent.includes('Exported manuscript to')", 'Markdown export success feedback');
  let markdown = await fs.readFile(overwritePath, 'utf8');
  assert.doesNotMatch(markdown, /OVERWRITE SENTINEL/);
  assert.match(markdown, /REFRESHED snapshot prose/);
  assert.match(markdown, /&lt;script&gt;/);
  assert.match(markdown, /# Contents/);
  assert.doesNotMatch(markdown, /SUMMARY ONLY|BEAT DIRECTION ONLY|EMPTY BEAT ONLY/);
  assert.ok((await evaluate('window.__compileSmokeChooserRequests.length')) > chooserBaseline, 'Markdown export requested its configured format chooser.');

  await selectOption('format', 'txt');
  await clickLabel('Export TXT');
  await waitFor("document.querySelector('.compile-error[role=alert]')", 'native write failure feedback');
  assert.ok(await fs.stat(failurePath).then(stats => stats.isDirectory()), 'The deliberate failure destination remains a directory.');
  const failedWriteCount = await evaluate("window.__compileSmokeCommands.filter(command=>command==='write_compiled_manuscript').length");
  await clickLabel('Export TXT');
  await waitFor("window.__compileSmokeCommands.filter(command=>command==='write_compiled_manuscript').length>" + failedWriteCount, 'retry writer command');
  await waitFor("document.querySelector('.compile-error[role=alert]')===null&&document.querySelector('.compile-summary [role=status]')?.textContent.includes('Exported manuscript to')", 'TXT retry success feedback');
  const txt = await fs.readFile(retryPath, 'utf8');
  assert.match(txt, /REFRESHED snapshot prose/);
  assert.match(txt, /Contents/);
  assert.doesNotMatch(txt, /&lt;script&gt;/, 'Plain text keeps literal markup instead of HTML escaping it.');
  assert.doesNotMatch(txt, /SUMMARY ONLY|BEAT DIRECTION ONLY|EMPTY BEAT ONLY/);
  report.checks.push('Markdown overwrite and TXT retry use the real Rust writer; literal Unicode/markup survives with format-specific escaping.');

  await selectOption('format', 'html');
  const commandCountBeforeCancel = await evaluate("window.__compileSmokeCommands.filter(command=>command==='write_compiled_manuscript').length");
  await clickLabel('Export HTML');
  await waitFor("window.__compileSmokeChooserRequests.length>=4", 'HTML chooser cancellation');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await evaluate("window.__compileSmokeCommands.filter(command=>command==='write_compiled_manuscript').length"), commandCountBeforeCancel, 'Canceling the chooser does not call the native writer.');
  assert.equal(await evaluate("document.querySelector('.compile-error[role=alert]')===null"), true, 'Chooser cancellation is silent.');
  assert.equal(await evaluate("document.querySelector('.compile-summary [role=status]')===null"), true, 'Chooser cancellation does not show success feedback.');

  // Give the final format the third queued chooser result by choosing it once
  // more; the cancelled selection above is deliberately terminal and silent.
  await evaluate("window.__compileSmokeChoices.push(" + JSON.stringify(htmlPath) + ")");
  await clickLabel('Export HTML');
  await waitFor("window.__compileSmokeCommands.filter(command=>command==='write_compiled_manuscript').length>" + commandCountBeforeCancel, 'native HTML write command');
  await waitFor("document.querySelector('.compile-summary [role=status]')?.textContent.includes('Exported manuscript to')", 'HTML export success feedback');
  const html = await fs.readFile(htmlPath, 'utf8');
  assert.match(html, /<meta charset=\"utf-8\">/);
  assert.match(html, /&lt;script&gt;alert\(&quot;literal&quot;\)&lt;\/script&gt; &amp; more\./);
  assert.match(html, /REFRESHED snapshot prose/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /SUMMARY ONLY|BEAT DIRECTION ONLY|EMPTY BEAT ONLY/);
  assert.deepEqual(await evaluate("window.__compileSmokeCommands.filter(command=>command==='save_project')"), [], 'Compilation never saves the project file.');
  report.checks.push('HTML is UTF-8 with escaped prose, and chooser cancellation is silent without invoking the writer.');
  report.compileExport = {
    chooser: 'Tauri plugin dialog save result intercepted in WebView2; Windows OS Save dialog was not opened.',
    nativeWriter: 'Real write_compiled_manuscript Tauri command',
    files: [overwritePath, retryPath, htmlPath],
    canceledFormat: 'html',
  };
  report.limitations = ['The export chooser result was intercepted for deterministic path, failure, retry, and cancel coverage; Windows OS Save dialog interaction still needs separate verification.'];

  await closeCompile();
  await clickLabel('Save');
  await waitFor("document.querySelector('.save-state')?.textContent.includes('Saved locally')", 'fixture saved before native close');
};
