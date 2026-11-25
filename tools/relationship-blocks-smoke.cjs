const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({ invoke, evaluate, clickLabel, waitFor, cdp, report, run, projectPath }) => {
  const fixture = await invoke('create_project', { path: projectPath, title: 'Reluctant trust' });
  let p = fixture.project;
  const apply = async operation => p = await invoke('apply_operation', { sessionId: fixture.sessionId, expectedRevision: p.revision, operation });
  for (const name of ['Aisha', 'Vikram', 'Rustam']) await apply({ type: 'createCharacter', name });
  const [a, b, c] = p.characters.map(v => v.id);
  await apply({ type: 'createChapter', title: 'Learning to listen' });
  const chapterId = p.chapters[0].id;
  for (const title of ['The difficult task', 'A later friendship']) await apply({ type: 'createScene', chapterId, title });
  const [sceneId, later] = p.scenes.map(s => s.id);
  const change = (sourceId, targetId, where, description) => ({ type: 'setRelationship', change: { sourceId, targetId, sceneId: where, phase: where ? 'after' : 'before', description, kind: 'attitude', mutual: false, status: where ? 'planned' : 'established' } });
  await apply(change(a, b, '', 'Kindly disposed; rejects his claimed authority.'));
  await apply(change(b, a, '', 'Resents taking direction from her.'));
  await apply(change(c, b, '', 'Cooperates, without trusting his judgment.'));
  await apply(change(a, b, later, 'FUTURE FRIENDSHIP must stay out of the earlier prompt.'));
  await apply({ type: 'updateScene', sceneId, summary: 'Vikram reluctantly accepts Aisha’s help with a difficult task.' });
  await invoke('save_project', { sessionId: fixture.sessionId });
  const savedBytes = await fs.readFile(projectPath);
  await evaluate(`(() => {const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url);const cmd=url.hostname==='ipc.localhost'?decodeURIComponent(url.pathname.slice(1)):null;if(cmd==='plugin:dialog|open')return new Response(JSON.stringify(${JSON.stringify(projectPath)}),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}});const response=await original(input,init);if(cmd==='open_project'&&response.headers.get('Tauri-Response')==='ok')window.__relationshipSession=(await response.clone().json()).sessionId;return response;};})()`);
  await clickLabel('Project menu'); await clickLabel('Open project');
  await waitFor('Boolean(window.__relationshipSession)', 'fixture opened');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await clickLabel('Character graph');
  await waitFor("document.querySelector('.story-canvas .relationship-panel')?.open", 'story graph');
  await clickLabel('Open chapter Learning to listen');
  await evaluate("Array.from(document.querySelectorAll('.scene-open')).find(v=>v.querySelector('h3')?.textContent==='The difficult task').click()");
  const active = '.scene-destination:not([hidden])', panel = active + ' .relationship-panel';
  await waitFor(`document.querySelector('${active} .summary-board .tiptap')`, 'summary editor');
  await clickLabel('Character graph'); await clickLabel('After'); await clickLabel('Fit');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('${panel} button')).some(v=>/Save SVG|Add relationship|Reset labels/.test(v.textContent))`), false);
  const drag = async (from, to, dx = 0, dy = 0) => {
    let g;
    // Navigation restores scroll on its next frame. Let that settle before positioning the pointer.
    for (let attempt = 0; attempt < 4; attempt++) {
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await evaluate(`(()=>{document.activeElement?.blur();const el=document.querySelector('${panel} .relationship-viewport');const r=el.getBoundingClientRect();window.scrollTo({top:window.scrollY+r.top-(innerHeight-r.height)/2,behavior:'instant'});})()`);
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      g = await evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(from)}),b=document.querySelector(${JSON.stringify(to)});if(!a||!b)throw new Error('Missing connector/character');const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return {x:x.x+x.width/2,y:x.y+x.height/2,tx:y.x+y.width/2+${dx},ty:y.y+y.height/2+${dy},height:innerHeight,scrollY,scrollHeight:document.documentElement.scrollHeight}})()`);
      if (g.y > 140 && g.y < g.height - 30 && g.ty > 140 && g.ty < g.height - 30) break;
    }
    assert.ok(g.y > 0 && g.y < g.height && g.ty > 0 && g.ty < g.height, 'Both drag endpoints must be visible before pointer input.');
    const hit = await evaluate(`(()=>{const e=document.elementFromPoint(${g.x},${g.y});return {tag:e?.tagName,connector:e?.closest('[data-connector]')?.getAttribute('data-connector'),character:e?.closest('[data-character]')?.getAttribute('data-character')};})()`);
    report.gestures.push({ from, to, geometry: g, sourceHit: hit });
    for (const event of [{ type: 'mouseMoved', x: g.x, y: g.y }, { type: 'mousePressed', x: g.x, y: g.y, button: 'left', clickCount: 1 }, { type: 'mouseMoved', x: (g.x+g.tx)/2, y: (g.y+g.ty)/2, button: 'left', buttons: 1 }, { type: 'mouseMoved', x: g.tx, y: g.ty, button: 'left', buttons: 1 }, { type: 'mouseReleased', x: g.tx, y: g.ty, button: 'left', clickCount: 1 }]) await cdp.send('Input.dispatchMouseEvent', event);
  };
  await drag(`${panel} [data-connector="${b}"]`, `${panel} [data-character="${a}"]`);
  await waitFor(`document.querySelector('${panel} .relationship-form textarea')`, 'edge editor after connector drop');
  const write = async text => {
    await evaluate(`(()=>{const el=document.querySelector('${panel} .relationship-form textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(`document.querySelector('${panel} .relationship-form').requestSubmit()`);
  };
  const sessionId = await evaluate('window.__relationshipSession');
  const read = () => invoke('read_project', { sessionId });
  const waitChange = text => waitFor(`window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:${JSON.stringify(sessionId)}}).then(p=>p.relationshipChanges.some(r=>r.sceneId===${JSON.stringify(sceneId)}&&r.description===${JSON.stringify(text)}))`, 'shared relationship persisted');
  const original = 'Respects her help; pride and resentment remain.';
  await write(original); await waitChange(original);
  p = await read();
  const record = p.relationshipChanges.find(r => r.sceneId === sceneId && r.description === original);
  const hasBlock = (node, id) => node?.type === 'relationshipChange' && node.attrs?.changeId === id || (node?.content ?? []).some(n => hasBlock(n, id));
  assert.ok(hasBlock(p.scenes.find(s => s.id === sceneId).summaryDocument, record.id));
  await waitFor(`document.querySelector('${active} .summary-board')?.textContent.includes(${JSON.stringify(original)})`, 'graph change appears in live summary');
  assert.deepEqual(await fs.readFile(projectPath), savedBytes);
  report.checks.push('Real connector dragging updates a directed relationship and appends its shared summary block without implicit Save.');
  await evaluate(`document.querySelector('${active} .summary-board [data-relationship-change]').click()`);
  await waitFor(`document.querySelector('${panel} .relationship-form textarea')`, 'summary block opens same edge controls');
  const revised = 'Respects her judgment, while remaining proud.';
  await write(revised); await waitChange(revised);
  assert.ok((await read()).relationshipChanges.some(r => r.id === record.id && r.description === revised));
  await evaluate(`document.querySelector('${active} .generation-preview').open=true`);
  const context = await evaluate(`document.querySelector('${active} .generation-preview pre').textContent`);
  assert.match(context, /Relationship change:/); assert.match(context, /Respects her judgment/); assert.doesNotMatch(context, /FUTURE FRIENDSHIP/);
  report.checks.push('Summary block editing preserves record identity and updates the graph and native AI briefing.');
  await evaluate(`document.querySelector('${active} .summary-board .tiptap').focus()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send('Input.insertText', { text: 'The task remains difficult; their relationship is unchanged.' });
  await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:${JSON.stringify(sessionId)}}).then(p=>!p.relationshipChanges.some(r=>r.id===${JSON.stringify(record.id)}))`, 'block deletion removes corresponding change');
  await clickLabel('Undo project change');
  await waitChange(revised);
  assert.ok(hasBlock((await read()).scenes.find(s => s.id === sceneId).summaryDocument, record.id));
  report.checks.push('Deleting a summary change cancels its graph override; one project Undo restores both.');
  await clickLabel('Character graph'); await clickLabel('Fit');
  await drag(`${panel} [data-character="${c}"] rect`, `${panel} [data-character="${c}"] rect`, 35, 20);
  await waitFor(`window.__TAURI_INTERNALS__.invoke('read_project',{sessionId:${JSON.stringify(sessionId)}}).then(p=>Boolean(p.relationshipLayout?.[${JSON.stringify(c)}]))`, 'character layout persisted');
  for (const theme of ['light', 'dark']) {
    await clickLabel('Open Settings'); await evaluate(`document.querySelector('input[name="appearance"][value="${theme}"]').click()`); await clickLabel('Return to writing');
    for (const width of [1440, 390]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: false });
      await evaluate(`document.querySelector('${panel}').scrollIntoView({block:'start'})`);
      await new Promise(resolve => setTimeout(resolve, 120));
      const layout = await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})');
      assert.ok(layout.scrollWidth <= width + 1, `${theme} ${width} stays within the window`); report.layout.push({ view: 'relationship-blocks', theme, ...layout });
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const file = `relationship-blocks-${theme}-${width}.png`;
      await fs.writeFile(path.join(run, file), Buffer.from(shot.data, 'base64')); report.screenshots.push(file);
    }
  }
  await clickLabel('Save'); await waitFor("document.querySelector('.save-state')?.textContent.includes('Saved locally')", 'saved project');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  const oldSession = await evaluate('window.__relationshipSession'); await clickLabel('Project menu'); await clickLabel('Open project');
  await waitFor(`window.__relationshipSession!==${JSON.stringify(oldSession)}`, 'reopened project');
  p = await invoke('read_project', { sessionId: await evaluate('window.__relationshipSession') });
  assert.ok(p.relationshipChanges.some(r => r.id === record.id && r.description === revised)); assert.ok(p.relationshipLayout[c]);
  assert.ok(hasBlock(p.scenes.find(s => s.id === sceneId).summaryDocument, record.id));
  report.checks.push('Graph positions, summary blocks and shared records survive Save/reopen; light/dark desktop/narrow layouts pass.');
};
