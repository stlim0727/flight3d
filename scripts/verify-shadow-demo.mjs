import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Run under chrome-session, or an already-held persistent Chrome lease.
// APP_URL=http://127.0.0.1:5292 CDP_PORT=9222 chrome-session node scripts/verify-shadow-demo.mjs
const port = process.env.CDP_PORT || 9222;
const dir = process.env.ARTIFACT_DIR || 'review-artifacts/shadow-demo';
fs.mkdirSync(dir, { recursive: true });
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(process.env.APP_URL || 'http://127.0.0.1:5173')}`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map(), errors = [];
ws.addEventListener('message', event => {
  const m = JSON.parse(event.data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const next = ++id;
  const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 120000);
  pending.set(next, m => { clearTimeout(timeout); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); });
  ws.send(JSON.stringify({ id: next, method, params }));
});
const evaluate = async expression => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async name => {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(r.data, 'base64'));
};
try {
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 180; i++) {
    if (await evaluate('Boolean(window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded)')) break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(await evaluate('Boolean(window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded)'), 'Cockpit must load');
  await evaluate(`(()=>{const s=window.simulator;s.sky.setCloudCover(.6);s.setTimeOfDay(17);document.getElementById('menu-toggle').click();document.getElementById('lobby-preset-shadow').click();})()`);
  await shot('scenario-menu');
  await evaluate(`document.getElementById('btn-fly').click()`);
  await evaluate(`window.simulator.animate = () => {}`);
  await new Promise(r => setTimeout(r, 200));
  const facts = await evaluate(`(()=>{const s=window.simulator;return {active:s.shadowDemo.active,mode:s.cameraSystem.mode,photo:s.cameraSystem.photoCockpit,cloud:s.sky.cloudCover,blocked:s.controls.inputBlocked,visible:!document.getElementById('shadow-demo').hidden,position:s.position.toArray()};})()`);
  assert.deepEqual([facts.active,facts.mode,facts.photo,facts.cloud,facts.blocked,facts.visible], [true,0,false,0,true,true]);
  const frames = [];
  for (let i = 0; i < 6; i++) {
    const frame = await evaluate(`(()=>{const s=window.simulator;s.shadowDemo.elapsed=${i * 6};s.stepSimulation(0);s.renderScene();const gl=s.renderer.getContext(),p=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,p);let changed=0;const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;if(window.shadowBasePixels)for(let y=Math.floor(h*.45);y<h;y++)for(let x=Math.floor(w*.25);x<Math.floor(w*.95);x++){const j=((h-1-y)*w+x)*4;if(Math.abs(p[j]-window.shadowBasePixels[j])+Math.abs(p[j+1]-window.shadowBasePixels[j+1])+Math.abs(p[j+2]-window.shadowBasePixels[j+2])>18)changed++;}window.shadowBasePixels??=p;return {index:s.shadowDemo.index,sun:s.sky.sunPosition.toArray(),position:s.position.toArray(),changed,sunIntensity:s.sky.cockpitSun.light.intensity,status:document.getElementById('shadow-status').textContent};})()`);
    assert.equal(frame.index, i);
    assert.deepEqual(frame.position, facts.position);
    if (i) assert.ok(frame.changed > 1000, 'Sun directions must visibly change the cockpit region');
    frames.push(frame);
    await shot(`sun-${i + 1}`);
  }
  const controls = await evaluate(`(()=>{const s=window.simulator,d=s.shadowDemo;document.getElementById('shadow-pause').click();const before=d.elapsed;s.stepSimulation(10);const held=d.elapsed===before;document.getElementById('shadow-next').click();const next=d.index;document.getElementById('shadow-prev').click();const previous=d.index;document.getElementById('shadow-pause').click();s.stepSimulation(6);const automatic=d.index;return {held,next,previous,automatic};})()`);
  assert.deepEqual(controls, { held: true, next: 0, previous: 5, automatic: 0 });
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await new Promise(r => setTimeout(r, 200));
  await evaluate('window.simulator.stepSimulation(0);window.simulator.renderScene()');
  const portrait = await evaluate(`(()=>{const r=document.getElementById('shadow-demo').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert.ok(portrait.left >= 0 && portrait.right <= portrait.width && !portrait.overflow);
  await shot('portrait');
  const restored = await evaluate(`(()=>{const s=window.simulator;document.getElementById('shadow-exit').click();return {active:s.shadowDemo.active,override:s.sky.sunDirectionOverride,cloud:s.sky.cloudCover,time:s.sky.timeOfDay,flow:s.gameFlow.state,held:s.gameFlow.canResumeFromLobby()};})()`);
  assert.deepEqual(restored, { active:false,override:null,cloud:.6,time:17,flow:'lobby',held:true });
  assert.equal(errors.length, 0, errors.join('\n'));
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({facts,frames,controls,portrait,restored,errors}, null, 2));
  console.log('PASS: scenario entry, six sun directions, stationary aircraft, pause/next/previous/loop, portrait and environment restoration');
} finally {
  ws.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
}
