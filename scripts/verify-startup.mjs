import assert from 'node:assert/strict';
import fs from 'node:fs';
// Run through chrome-session --project flight3d with a Vite server already running.
const port=process.env.CHROME_DEBUG_PORT || 9225;
const url=process.env.SIM_URL || 'http://127.0.0.1:5273/';
const artifacts=process.env.ARTIFACT_DIR || '/tmp/startup-progress';
fs.mkdirSync(artifacts, { recursive: true });
const tab=await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pending=new Map(); const errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
try {
await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.stages=[];addEventListener('DOMContentLoaded',()=>{const p=document.getElementById('startup-progress'); new MutationObserver(()=>window.stages.push({value:p.value,time:performance.now(),booting:document.body.classList.contains('booting')})).observe(p,{attributes:true});});`});
await send('Page.navigate',{url});
let captured=false;
let ready=false;for(let n=0;n<180;n++){await new Promise(r=>setTimeout(r,500));const state=await ev(`({ready:!!window.simulator?.startupReady,error:document.getElementById('startup-retry')?.hidden===false,stages:window.stages})`);if (!captured && state.stages?.some(s => s.value >= 2) && !state.ready) {
if (await ev(`document.getElementById('startup-overlay').classList.contains('scene-ready')`)) {
assert.notEqual(await ev(`getComputedStyle(document.getElementById('startup-overlay')).backgroundColor`),'rgb(9, 17, 31)','airport background is visible during loading');
const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${artifacts}/loading.png`,Buffer.from(shot.data,'base64'));captured=true;
}
}
if(state.error)throw Error(JSON.stringify(state));if(state.ready){ready=true;break;}}
assert.ok(ready,'startup completes');
assert.ok(captured,'airport background captured while loading');
const report=await ev(`({stages:window.stages,hidden:document.getElementById('startup-overlay').hidden,booting:document.body.classList.contains('booting'),inert:document.getElementById('hud-overlay').inert,aircraft:[...sim.aircraftInstances.keys()],frame:sim.renderer.info.render.frame})`);
assert.equal(report.hidden,true);assert.equal(report.booting,false);assert.equal(report.inert,false);assert.ok(report.stages.every(s=>s.booting),'loading screen covers every startup stage');assert.ok(report.stages.some(s=>s.value===5));assert.equal(errors.length,0);
const before=await ev('sim.cameraSystem.chaseYaw');
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:600,y:350,button:'left',buttons:1,clickCount:1});
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:720,y:350,button:'left',buttons:1});
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:720,y:350,button:'left',buttons:0,clickCount:1});
assert.notEqual(await ev('sim.cameraSystem.chaseYaw'),before,'camera drag responds after loading');
report.camera=await ev('({mode:sim.cameraSystem.mode,yaw:sim.cameraSystem.chaseYaw,dragging:sim.cameraSystem.isDragging})');
fs.writeFileSync(`${artifacts}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${artifacts}/ready.png`,Buffer.from(shot.data,'base64'));
// Both loading and menu surfaces identify the exact build, without developer mode.
const builds=await ev(`Array.from(document.querySelectorAll('[data-build-info]'), element => ({branch:element.querySelector('[data-build-branch]').textContent, revision:element.querySelector('[data-build-commit]').textContent, href:element.querySelector('[data-build-commit]').getAttribute('href'), age:element.querySelector('[data-build-age]').textContent}))`);
assert.equal(builds.length,2);
assert.deepEqual(builds[0],builds[1]);
assert.notEqual(builds[0].branch,'unknown');
assert.match(builds[0].revision,/^[a-f0-9]{12}$/);
assert.match(builds[0].href,/^https:\/\/github\.com\/stlim0727\/flight3d\/commit\/[a-f0-9]{40}$/);
assert.equal(builds[0].revision,builds[0].href.split('/').at(-1).slice(0,12));
// The merge age is localized, so only its presence and resolved value are asserted here.
assert.notEqual(builds[0].age,'unknown');
assert.ok(builds[0].age.trim().length, 'commit age renders');
if(process.env.EXPECTED_COMMIT) assert.equal(builds[0].href,`https://github.com/stlim0727/flight3d/commit/${process.env.EXPECTED_COMMIT}`);
if(process.env.EXPECTED_BRANCH) assert.equal(builds[0].branch,process.env.EXPECTED_BRANCH);
await ev('sim.toggleMainMenu()');
assert.equal(await ev(`getComputedStyle(document.getElementById('lobby-screen')).display === 'none'`),false);
const menuShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${artifacts}/menu.png`,Buffer.from(menuShot.data,'base64'));
console.log('Build identity:',JSON.stringify(builds[0]));
// Force renderer initialization to fail and verify a usable recovery screen.
const injected=await send('Page.addScriptToEvaluateOnNewDocument',{source:`const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:original.call(this,type,...args)};`});
await send('Page.navigate',{url});
let failed=false;
for(let n=0;n<40;n++) {
  await new Promise(r=>setTimeout(r,250));
  if(await ev(`document.getElementById('startup-retry')?.hidden===false`)) { failed=true; break; }
}
assert.ok(failed,'renderer failure offers retry');
assert.equal(await ev(`document.getElementById('startup-overlay').hidden`),false);
await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injected.identifier});
console.log('Startup failure recovery screen passed');
} finally {ws.close();await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);}
