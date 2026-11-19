const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

// Local, dependency-free browser check for the design reference.
const previewName = path.basename(process.argv[2] || 'scene-writer-studio.html');
if (!/^[a-z0-9-]+\.html$/.test(previewName)) throw new Error('Expected an HTML preview filename.');
const directory = path.resolve(__dirname, previewName === 'scene-writer-studio.html' ? 'review' : 'review-playful');
fs.mkdirSync(directory, { recursive: true });
const fragment = fs.readFileSync(path.resolve(__dirname, previewName), 'utf8');
for (const block of fragment.matchAll(/<script>([\s\S]*?)<\/script>/g)) new (require('node:vm').Script)(block[1]);
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:light dark}body{margin:0}button,input,select,textarea{font-family:inherit}</style></head><body><script>window.openai={setWidgetState:async s=>{window.__snapshot=JSON.parse(JSON.stringify(s))}};</script>' + fragment + '</body></html>';
const server = http.createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, websocket;
function cleanup(){websocket?.close();browser?.kill();server.close();}
process.on('SIGINT',()=>{cleanup();process.exit(130);});
const report = { checks: [], errors: [], screenshots: [] };

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  console.log('Review server ready.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shorthand-design-review-'));
  browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const debugUrl = await new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not expose its debugging endpoint.')), 15000);
    browser.on('error', reject);
    browser.stderr.on('data', part => { data += part.toString(); const match = data.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const endpoint = new URL(debugUrl);
  console.log('Chrome debugging endpoint ready.');
  const targets = await (await fetch('http://127.0.0.1:' + endpoint.port + '/json/list')).json();
  websocket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { websocket.addEventListener('open', resolve, { once: true }); websocket.addEventListener('error', reject, { once: true }); });
  console.log('Browser connected.');
  let serial = 0;
  const pending = new Map();
  websocket.addEventListener('message', event => {
    const packet = JSON.parse(event.data);
    if (packet.id && pending.has(packet.id)) { const { resolve, reject } = pending.get(packet.id); pending.delete(packet.id); packet.error ? reject(new Error(packet.error.message)) : resolve(packet.result); }
    if (packet.method === 'Runtime.exceptionThrown') report.errors.push(packet.params.exceptionDetails.text + ': ' + (packet.params.exceptionDetails.exception?.description || ''));
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},12000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});websocket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
  console.log('Prototype loaded.');
  for (let i = 0; i < 100; i++) { if (await evaluate('document.querySelectorAll(".scene-item").length===3')) break; await sleep(50); }
  const results = await evaluate(`(() => {
    const r=document.getElementById('hybrid-writer'),q=s=>r.querySelector(s),qa=s=>Array.from(r.querySelectorAll(s));
    const checks=[];function check(ok,label){checks.push({label,pass:!!ok});if(!ok)throw new Error(label);}
    check(!q('[data-view="story"]').hidden&&q('[data-view="scene"]').hidden,'Story and Scene are separate views');
    q('[data-zoom="story"]').click();const initial=JSON.parse(JSON.stringify(window.__snapshot.privateContent));
    const rects=qa('.scene-button').map(x=>x.getBoundingClientRect());check(rects.every((x,i)=>i===0||x.top>rects[i-1].top),'Story scene blocks follow vertical reading order');
    q('[data-scene-id="stitches"]').click();check(q('[data-view="story"]').hidden&&!q('[data-view="scene"]').hidden,'Opening a scene zooms into its writer');
    const bodies=qa('.beat-text');check(bodies[0].querySelectorAll('[data-kind="character"]').length===0,'A beat can contain no character blocks');check(bodies[1].querySelectorAll('[data-kind="character"]').length===2,'A beat can contain multiple character blocks');
    q('[data-summary]').textContent='Review: independent scene summary';q('[data-summary]').dispatchEvent(new Event('input',{bubbles:true}));
    q('[data-back-story]').click();check(q('[data-scene-id="stitches"]').textContent.includes('Review: independent scene summary'),'Summary edits update their overview block');
    q('[data-scene-id="courtyard"]').click();check(!q('[data-summary]').textContent.includes('Review:'),'Other scenes retain independent summaries');
    q('[data-back-story]').click();q('[data-scene-id="stitches"]').click();check(q('[data-summary]').textContent==='Review: independent scene summary','Edits survive scene and view switches');
    q('[data-person]').value='first';q('[data-person]').dispatchEvent(new Event('change'));q('[data-thoughts]').selectedIndex=1;q('[data-thoughts]').dispatchEvent(new Event('change'));q('[data-follow-character]').value='Maya';q('[data-follow-character]').dispatchEvent(new Event('change'));q('[data-back-story]').click();q('[data-scene-id="courtyard"]').click();check(q('[data-person]').value===''&&q('[data-thoughts]').selectedIndex===0,'Narration overrides stay local to their scene');q('[data-back-story]').click();q('[data-scene-id="stitches"]').click();check(q('[data-person]').value==='first'&&q('[data-follow-character]').value==='Maya'&&q('[data-narration-summary]').textContent.includes('Scene override'),'Narration overrides survive switching and disclose their scope');
    const before=qa('.beat').length;q('[data-add]').click();check(qa('.beat').length===before+1,'Add beat creates a freeform empty beat');
    const added=qa('.beat').at(-1),id=added.dataset.id;added.querySelector('.beat-text').textContent='Wind rattles the windows.';added.querySelector('.beat-text').dispatchEvent(new Event('input',{bubbles:true}));added.querySelector('[aria-label*="up"]').click();check(qa('.beat').at(-2).dataset.id===id,'Reordering a beat preserves its identity and content');
    const beat=qa('.beat').find(x=>x.dataset.id===id);beat.querySelector('.beat-label').click();q('.library [data-kind="character"][data-value="Maya"]').click();q('.library [data-kind="character"][data-value="Damian"]').click();check(beat.querySelectorAll('[data-kind="character"]').length===2,'Any number of characters can be inserted into one beat');
    q('.library [data-kind="emotion"][data-value="awe"]').click();check(beat.querySelector('[data-kind="emotion"]').dataset.owner==='Damian','Emotion applies to its explicit local character target');
    q('[data-preview]').click();q('.prose').textContent='Review prose edit';q('.prose').dispatchEvent(new Event('input',{bubbles:true}));q('[data-back-story]').click();q('[data-scene-id="courtyard"]').click();q('[data-back-story]').click();q('[data-scene-id="stitches"]').click();q('[data-preview]').click();check(q('.prose').textContent==='Review prose edit','Independent prose edits survive switching scenes');q('[data-preview]').click();
    q('[data-attach-stage]').click();check(!q('[data-stage-board]').hidden,'Optional stage can be attached');q('[data-remove-stage]').click();check(q('[data-stage-board]').hidden,'Stage can be removed without removing the scene');
    q('[data-back-story]').click();q('[aria-label="Move down: Stitches"]').click();check(qa('.scene-button').at(-1).dataset.sceneId==='stitches','Scene movement preserves the edited scene');
    const first=qa('.scene-button')[0],box=first.getBoundingClientRect(),dt=new DataTransfer();dt.setData('text/plain',JSON.stringify({kind:'scene',id:'stitches'}));first.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:dt,clientY:box.top+2}));check(first.closest('.scene-item').classList.contains('drop-before'),'Scene dragging shows a before/after insertion marker');first.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,clientY:box.top+2}));check(qa('.scene-button')[0].dataset.sceneId==='stitches','Dragging a scene changes vertical reading order');
    q('[data-new-scene]').click();check(qa('.scene-button').length===4&&!q('[data-view="scene"]').hidden,'New scene opens its individual editor');
    window.dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:{widgetState:{privateContent:initial}}}}));
    return checks;
  })()`);
  report.checks.push(...results);
  console.log(results.length+' interaction checks passed.');
  if (previewName === 'scene-writer-playful.html') {
    const additional = await evaluate(`(() => {
      const root=document.getElementById('hybrid-writer'),q=s=>root.querySelector(s),qa=s=>Array.from(root.querySelectorAll(s)),checks=[];
      function check(ok,label){checks.push({label,pass:!!ok});if(!ok)throw new Error(label);}
      q('[data-zoom="story"]').click();
      const cards=qa('.scene-button').map(x=>x.getBoundingClientRect()),axis=q('.scene-sequence').getBoundingClientRect();check(cards[0].right<axis.left+axis.width/2&&cards[1].left>axis.left+axis.width/2&&cards[2].right<axis.left+axis.width/2,'Scenes alternate left and right of a central timeline');
      const markers=qa('.scene-order').map(x=>x.getBoundingClientRect());check(markers.every(x=>Math.abs(x.left+x.width/2-(axis.left+axis.width/2))<2),'Numbered scene markers align on the central spine: '+JSON.stringify({axis:axis.left+axis.width/2,centers:markers.map(x=>x.left+x.width/2),cards:cards.map(x=>[x.left,x.right])}));
      check(cards[2].top>cards[0].bottom&&cards[2].left<cards[1].left,'Staggered cards retain same-side separation and readable order');
      q('[data-calm]').click();check(root.classList.contains('calm')&&qa('.scene-item').every(x=>getComputedStyle(x).getPropertyValue('--offset').trim()==='0px'),'Calm appearance removes decorative offsets');q('[data-calm]').click();
      const source=q('[data-scene-id="stitches"]');source.closest('.scene-item').querySelector('[data-command="duplicate"]').click();
      check(qa('.scene-button').length===4,'Scene actions duplicate scene direction');
      const duplicate=qa('.scene-button').find(x=>x.textContent.includes('Stitches (copy)')),duplicateId=duplicate.dataset.sceneId;
      duplicate.click();q('[data-current-scene-actions] [data-command="move-to-trash"]').click();check(qa('.scene-button').length===3&&q('[data-trash-count]').textContent==='1','Scene deletion is recoverable in Trash');
      q('[data-show-trash]').click();q('[data-trash-list] button').click();check(!!q('[data-scene-id="'+duplicateId+'"]'),'Trash restoration preserves scene identity');
      q('[data-scene-id="stitches"]').click();let beat=qa('.beat')[0];beat.querySelector('[data-command="duplicate"]').click();check(qa('.beat').length===5,'Beat actions duplicate freeform content');
      beat=qa('.beat')[1];const id=beat.dataset.id;beat.querySelector('[data-command="delete"]').click();check(qa('.beat').length===4,'Beat actions remove a selected beat');q('[data-undo]').click();check(qa('.beat').some(x=>x.dataset.id===id),'Undo restores removed beat identity and text');
      q('.new-profile').click();let form=q('[data-profile-form]');form.elements.name.value='Rin';form.elements.voice.value='Quiet and deliberate';form.requestSubmit();check(!!q('.library [data-kind="character"][data-value="Rin"]'),'Library can create a reusable character');
      q('[aria-label="Edit Rin profile"]').click();form=q('[data-profile-form]');check(form.elements.voice.value==='Quiet and deliberate','Character profile details can be inspected');form.elements.voice.value='Warm and direct';form.requestSubmit();q('[aria-label="Edit Rin profile"]').click();check(q('[data-profile-form]').elements.voice.value==='Warm and direct','Character profile changes remain editable');
      q('[data-profile-actions] [data-command="archive"]').click();check(!q('.library [data-kind="character"][data-value="Rin"]'),'Character profiles can be archived');q('[data-undo]').click();check(!!q('.library [data-kind="character"][data-value="Rin"]'),'Undo restores an archived character');
      q('[data-zoom="story"]').click();while(qa('.scene-button').length)qa('.scene-item')[0].querySelector('[data-command="move-to-trash"]').click();check(q('[data-zoom="scene"]').disabled&&!!q('.empty-story'),'An empty story keeps a usable creation state');q('[data-undo]').click();check(qa('.scene-button').length===1,'Undo recovers the final removed scene');
      return checks;
    })()`);
    report.checks.push(...additional);console.log(additional.length+' playful editing checks passed.');
  }
  await call('Page.reload');
  for(let i=0;i<100;i++){if(await evaluate('document.querySelectorAll(".scene-item").length===3'))break;await sleep(50);}
  if(previewName==='scene-writer-playful.html'){
    await call('Emulation.setDeviceMetricsOverride',{width:320,height:900,deviceScaleFactor:1,mobile:false});
    await evaluate('document.querySelector(\'.scene-item .action-menu\').open=true');
    report.checks.push({label:'Story actions fit at 320px',pass:!(await evaluate('document.documentElement.scrollWidth>window.innerWidth'))});
    await evaluate('document.querySelector(\'[data-scene-id="stitches"]\').click();document.querySelector(\'.beat .action-menu\').open=true;document.querySelector(\'.new-profile\').click()');
    report.checks.push({label:'Beat actions and character form fit at 320px',pass:!(await evaluate('document.documentElement.scrollWidth>window.innerWidth'))});
    await call('Page.reload');for(let i=0;i<100;i++){if(await evaluate('document.querySelectorAll(".scene-item").length===3'))break;await sleep(50);}
  }
  async function capture(name, width, view, theme = 'light') {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await evaluate('document.querySelector(\'[data-zoom="' + view + '"]\').click()');
    await sleep(180);
    const overflow = await evaluate('document.documentElement.scrollWidth>window.innerWidth');
    report.checks.push({ label: name + ' has no horizontal overflow', pass: !overflow });
    const metrics = await call('Page.getLayoutMetrics');
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: metrics.cssContentSize.height, scale: 1 } });
    const output = path.join(directory, name + '.png');fs.writeFileSync(output, Buffer.from(result.data, 'base64'));report.screenshots.push(output);
  }
  await capture('desktop-story', 1024, 'story');
  await evaluate('document.querySelector(\'[data-scene-id="stitches"]\').click()');
  await capture('desktop-scene', 1024, 'scene');
  await capture('mobile-story', 390, 'story');
  await capture('mobile-scene', 390, 'scene');
  await capture('dark-scene', 1024, 'scene', 'dark');
  fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length || report.checks.some(check => !check.pass)) process.exitCode = 1;
  await call('Browser.close').catch(() => {});
}
main().catch(error => { report.errors.push(error.stack);fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2));console.error(error);process.exitCode=1; }).finally(cleanup);
