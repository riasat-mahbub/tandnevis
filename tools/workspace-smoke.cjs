// Focused native workspace review. Called by native-smoke with its isolated project/profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function reviewWorkspace({ invoke, evaluate, clickLabel, waitFor, cdp, report, run, projectPath, dragBlock }) {
  const fixture = await invoke('create_project', { path: projectPath, title: 'The Academy of Small Wonders' });
  let project = fixture.project;
  const apply = async operation => { project = await invoke('apply_operation', { sessionId: fixture.sessionId, expectedRevision: project.revision, operation }); };
  await apply({ type: 'createChapter', title: 'At the gates' });
  const firstChapter = project.chapters[0].id;
  await apply({ type: 'createScene', chapterId: firstChapter, title: 'The first encounter' });
  const firstScene = project.scenes[0].id;
  await apply({ type: 'updateScene', sceneId: firstScene, summary: 'As the procession reaches the academy gates, two strangers recognize something familiar in each other. Neither is ready to say what.' });
  await apply({ type: 'createScene', chapterId: firstChapter, title: 'A question left unanswered' });
  await apply({ type: 'createChapter', title: 'Inside the academy' });
  await apply({ type: 'createScene', chapterId: project.chapters[1].id, title: 'The room of borrowed names' });
  await apply({ type: 'createCharacter', name: 'Murad' });
  await apply({ type: 'createCharacter', name: 'Rudra' });
  for (const text of [
    'The procession slows at the gates. Murad notices a stranger watching from the shade and decides to approach.',
    'Rudra asks whether Murad has been here before. The question sounds casual, but he watches carefully for the answer.',
    'A bell interrupts them. They follow the others inside, each privately resolving to learn more about the other.',
  ]) await apply({ type: 'createBeat', sceneId: firstScene, document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, text });
  for (const title of ['The archive', 'The first lesson', 'A door after dusk']) await apply({ type: 'createChapter', title });
  await invoke('save_project', { sessionId: fixture.sessionId });
  await evaluate(`(() => { const original=window.fetch.bind(window); window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url);const command=url.hostname==='ipc.localhost'?decodeURIComponent(url.pathname.slice(1)):null;if(command==='plugin:dialog|open')return new Response(JSON.stringify(${JSON.stringify(projectPath)}),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}});const response=await original(input,init);if(command==='open_project'&&response.headers.get('Tauri-Response')==='ok')window.__workspaceReviewSession=(await response.clone().json()).sessionId;return response;}; })()`);
  await clickLabel('Project menu'); await clickLabel('Open project');
  await waitFor("Boolean(window.__workspaceReviewSession)", 'workspace fixture opened');
  assert.equal(await evaluate("document.querySelector('.writing-view-switch')===null && document.querySelector('.story-canvas').getClientRects().length>0"), true, 'Story starts as a chapter canvas without destination tabs.');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 600, deviceScaleFactor: 1, mobile: false });
  const storyPosition = await evaluate('window.scrollTo(0,180);window.scrollY');
  assert.ok(storyPosition > 0, 'The story fixture has a real scroll position.');
  await clickLabel('Open chapter At the gates');
  await waitFor("Boolean(document.querySelector('.chapter-destination:not([hidden]) .chapter-canvas'))", 'dedicated chapter canvas');
  await waitFor('window.scrollY===0', 'initial chapter scroll position');
  const chapterPosition = await evaluate('window.scrollTo(0,80);window.scrollY');
  assert.ok(chapterPosition > 0, 'The chapter fixture has a real scroll position.');
  await evaluate("Array.from(document.querySelectorAll('.scene-open')).find(button=>button.querySelector('h3')?.textContent==='The first encounter').click()");
  await clickLabel('Zoom out to chapter');
  await waitFor(`Math.abs(window.scrollY-${chapterPosition})<1`, 'zoom-out restores chapter position');
  await clickLabel('Zoom out to story');
  await waitFor(`Math.abs(window.scrollY-${storyPosition})<1`, 'zoom-out restores story position');
  await clickLabel('Open chapter At the gates');
  await waitFor(`Math.abs(window.scrollY-${chapterPosition})<1`, 'reopening the chapter restores its position');
  report.checks.push('Native zoom-out returns Scene → Chapter → Story and restores independent real scroll positions.');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await evaluate("Array.from(document.querySelectorAll('.scene-open')).find(button=>button.querySelector('h3')?.textContent==='The first encounter').click()");
  const active = '.scene-destination:not([hidden])';
  const editor = `${active} [aria-label="Scene summary"]`;
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(editor)})?.editor)`, 'native rich-text editor');
  await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(editor)});window.__workspaceEditor=element;const editor=element.editor;editor.commands.focus();editor.commands.setTextSelection(4); })()`);
  await clickLabel('Character: Murad');
  await evaluate(`(() => {const input=document.querySelector('${active} .block-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Awe');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await clickLabel('Emotion: Awe');
  await evaluate(`(() => {const input=document.querySelector('${active} .block-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Playful');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await clickLabel('Tone: Playful');
  await clickLabel('Clear search');
  await dragBlock(`${active} .story-block[aria-label="Character: Rudra"]`, `${active} .summary-board-heading`, 'Grouped shelf reference drop into summary');
  await waitFor(`window.__workspaceEditor.editor.getText().includes('Rudra')`, 'real reference drag inserts into the summary');
  const richText = await evaluate(`(() => { const editor=window.__workspaceEditor.editor;return {json:editor.getJSON(),selection:editor.state.selection.from,text:editor.getText()}; })()`);
  const nodes = richText.json.content[0].content;
  for (const type of ['characterReference', 'emotionReference', 'toneReference']) assert.ok(nodes.some(node => node.type === type), `${type} is inserted within the text`);
  assert.ok(nodes.some(node=>node.type==='text'), 'References stay within ordinary rich text.');
  await clickLabel('Next scene'); await clickLabel('Next scene');
  assert.equal(await evaluate(`document.querySelector('${active} [aria-label="Scene title"]').value`), 'The room of borrowed names');
  await clickLabel('Previous scene'); await clickLabel('Previous scene');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(editor)})===window.__workspaceEditor`), true);
  assert.equal(await evaluate('window.__workspaceEditor.editor.state.selection.from'), richText.selection);
  assert.equal(await evaluate('window.__workspaceEditor.editor.can().undo()'), true);
  assert.deepEqual(await evaluate("(() => { const ids=Array.from(document.querySelectorAll('[id]'),element=>element.id);return [...new Set(ids.filter((id,index)=>ids.indexOf(id)!==index))]; })()"), [], 'Cached editors retain unique accessible label and panel IDs.');
  report.checks.push('Native inline references insert between ordinary text and retain caret, editor identity, and undo history across chapter boundaries.');

  const beatId = project.scenes[0].beats[0].id;
  await clickLabel('Move beat 1 down');
  await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:window.__workspaceReviewSession}).then(project=>project.scenes.find(scene=>scene.id===${JSON.stringify(firstScene)}).beats[1]?.id===${JSON.stringify(beatId)})`, 'native beat reordering');
  await clickLabel('New character');
  await waitFor("document.querySelector('[data-testid=" + JSON.stringify('character-creation-wizard') + "]')?.dataset.wizardStep==='starting-point'", 'original character wizard');
  await clickLabel('Cancel creation');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(editor)})===window.__workspaceEditor`), true);
  report.checks.push('The original character wizard returns to the same editor; supported beat movement changes native reading order.');

  await clickLabel('Jump to scene: The first encounter');
  await waitFor("Boolean(document.querySelector('dialog[open] input[type=search]'))", 'outline opens');
  await evaluate("(() => {const input=document.querySelector('dialog[open] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'borrowed');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await waitFor("document.querySelectorAll('dialog[open] .outline-scene').length===1", 'outline search');
  await clickLabel('The room of borrowed names');
  await clickLabel('Jump to scene: The room of borrowed names');
  await clickLabel('Open chapter At the gates');
  assert.equal(await evaluate("document.querySelector('.chapter-destination:not([hidden]) main').getAttribute('aria-label')"), 'Chapter canvas: At the gates');
  await clickLabel('Library'); await clickLabel('Characters');
  await clickLabel('Return to At the gates');
  await clickLabel('Compact scene list');
  report.checks.push('Story drills into a dedicated chapter canvas; the outline opens chapter or scene canvases, and Library returns to its originating chapter.');

  async function capture(name, width, height) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate('window.scrollTo(0,0)');
    await new Promise(resolve => setTimeout(resolve, 120));
    const layout = await evaluate(`(() => { const scene=document.querySelector('${active} .scene-writing');const beats=Array.from(document.querySelectorAll('${active} .timeline-item'));const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,width:r.width,right:r.right};};return {name:${JSON.stringify(name)},width:innerWidth,scrollWidth:document.documentElement.scrollWidth,drawerOverflow:(()=>{const drawer=document.querySelector('.story-library-drawer[open]');return !!drawer&&drawer.scrollWidth>drawer.clientWidth+1;})(),editor:scene?rect(scene):null,beats:beats.map(rect)}; })()`);
    report.layout.push(layout);
    assert.ok(layout.scrollWidth <= width + 1, `${name} has no horizontal document overflow`);
    assert.equal(layout.drawerOverflow, false, `${name} keeps the drawer within its width`);
    if (layout.beats.length) assert.ok(layout.beats.every(beat => Math.abs(beat.left - layout.beats[0].left) < 1 && Math.abs(beat.width - layout.beats[0].width) < 1), `${name} keeps every editable beat in one comfortable column`);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(path.join(run, name + '.png'), Buffer.from(screenshot.data, 'base64'));
    report.screenshots.push(name + '.png');
  }
  await clickLabel('Library');
  await waitFor("Boolean(document.querySelector('.story-library-drawer[open]'))", 'Story Library drawer opens');
  assert.equal(await evaluate("document.querySelector('.story-library-drawer').contains(document.activeElement)"), true, 'Opening the drawer moves focus inside.');
  await capture('workspace-library-drawer-desktop', 1440, 960);
  await capture('workspace-library-drawer-narrow', 390, 844);
  await cdp.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await cdp.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await waitFor("!document.querySelector('.story-library-drawer[open]')", 'Escape dismisses the library drawer');
  await cdp.send('Emulation.setDeviceMetricsOverride', {width:1440,height:960,deviceScaleFactor:1,mobile:false});
  await capture('workspace-chapter-compact', 1440, 960);
  await clickLabel('Compact scene list'); await capture('workspace-chapter-timeline', 1440, 960);
  await clickLabel('Zoom out to story'); await capture('workspace-story-chapters', 1440, 960);
  await clickLabel('Open chapter At the gates');
  await evaluate("Array.from(document.querySelectorAll('.scene-open')).find(button=>button.querySelector('h3')?.textContent==='The first encounter').click()");
  await clickLabel('Jump to scene: The first encounter'); await capture('workspace-outline', 1440, 960); await clickLabel('Close story outline');
  for (const theme of ['light', 'dark']) {
    await clickLabel('Open Settings');
    await evaluate(`document.querySelector('input[name="appearance"][value="${theme}"]').click()`);
    await clickLabel('Back to writing');
    for (const width of [1440, 800, 390]) {
      if (width === 1440 && await evaluate(`Boolean(document.querySelector('${active} [aria-label="Expand block sidebar"]'))`)) await clickLabel('Expand block sidebar');
      if (width < 900 && await evaluate(`Boolean(document.querySelector('${active} [aria-label="Collapse block sidebar"]'))`)) await clickLabel('Collapse block sidebar');
      await capture(`workspace-scene-${theme}-${width}`, width, width === 390 ? 844 : 960);
    }
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await clickLabel('Expand block sidebar'); await clickLabel('Expand scene details');
  await capture('workspace-both-panels-open', 1440, 960);
  await clickLabel('Collapse scene details'); await clickLabel('Collapse block sidebar');
  await capture('workspace-both-panels-collapsed', 1440, 960);
  report.checks.push('Batched desktop, tablet, and narrow captures verify light/dark layout, single-column beats, and both panel states.');
  await clickLabel('Save');
  await waitFor("document.querySelector('.save-state')?.textContent.includes('Saved locally')", 'manual Save');
};
