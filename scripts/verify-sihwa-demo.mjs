import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run inside chrome-session --project flight3d. Reuse the project daemon;
// create/close only this script's own tab, never the shared browser.
if (process.env.CHROME_PROJECT !== 'flight3d') throw new Error('Run with chrome-session --project flight3d');
const port = process.env.CHROME_DEBUG_PORT ?? '9225';
const url = process.env.APP_URL ?? 'http://127.0.0.1:5289/';
const artifacts = process.env.ARTIFACT_DIR ?? path.join(process.cwd(), 'review-artifacts/sihwa-demo');
// A private context in the SAME admitted browser avoids extension injection
// and inherited lobby settings without launching another Chrome process.
const version=await fetch(`http://127.0.0.1:${port}/json/version`).then(r=>r.json());
const root=new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{root.onopen=resolve;root.onerror=reject;});
let rootId=0;const rootPending=new Map();
root.onmessage=event=>{const m=JSON.parse(event.data),r=rootPending.get(m.id);if(!r)return;rootPending.delete(m.id);clearTimeout(r.timer);if(m.error)r.reject(new Error(m.error.message));else r.resolve(m.result);};
function browserCall(method,params={}){return new Promise((resolve,reject)=>{const id=++rootId;const timer=setTimeout(()=>{rootPending.delete(id);reject(new Error(`Browser timeout: ${method}`));},30000);rootPending.set(id,{resolve,reject,timer});root.send(JSON.stringify({id,method,params}));});}
console.log('Creating isolated review context');
const {browserContextId}=await browserCall('Target.createBrowserContext',{disposeOnDetach:true});
const {targetId}=await browserCall('Target.createTarget',{url:'about:blank',browserContextId});
const target=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(t=>t.id===targetId);
assert.ok(target,'private review target');
console.log('Connecting review target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map();
const errors = [];
const isolatedContexts=new Set();
const extensionErrors=[];
let id = 0;
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if(message.method==='Runtime.executionContextCreated' && message.params.context.auxData?.isDefault===false)isolatedContexts.add(message.params.context.id);
  if(message.method==='Runtime.exceptionThrown'){const d=message.params.exceptionDetails;const description=d.exception?.description??d.text;if(isolatedContexts.has(d.executionContextId)||d.url?.startsWith('chrome-extension://')||JSON.stringify(d.stackTrace??{}).includes('chrome-extension://'))extensionErrors.push(description);else errors.push(description);}
  if(message.method==='Log.entryAdded') {
    const e=message.params.entry;
    // Chromium emits extension messaging errors under the page URL too. This
    // exact browser-only API error is kept in the report, separate from app JS.
    if(e.text.startsWith('Unchecked runtime.lastError:'))extensionErrors.push(e);
    else if(e.level==='error' && !e.url?.endsWith('/favicon.ico'))errors.push(`${e.text} ${e.url??''}`.trim());
  }
  if(message.method==='Runtime.consoleAPICalled' && message.params.type==='error')errors.push(message.params.args.map(a=>a.value??a.description).join(' '));
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timeout);
  if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 90000);
    pending.set(requestId, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const settle=()=>evaluate('review.renderer.getContext().finish();true');
async function capture(name) {
  await evaluate("document.querySelector('#pause-menu')?.style.setProperty('display','none','important');true");
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64'));
  await evaluate("document.querySelector('#pause-menu')?.style.removeProperty('display');true");
}
const flights=[];
try {
  await mkdir(artifacts,{recursive:true});
  await writeFile(path.join(artifacts,'flights.json'),JSON.stringify({complete:false,flights,errors,extensionErrors},null,2)+'\n');
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url});await send('Page.bringToFront');
  let ready=false;
  for(let i=0;i<150;i++){
    await send('Page.bringToFront');
    const boot=await evaluate(`({ready:Boolean(window.sim?.gameFlow),visibility:document.visibilityState,text:document.querySelector('#startup-overlay')?.innerText})`);
    ready=boot.ready;if(i%10===0)console.log(JSON.stringify({boot}));
    if(errors.length)throw new Error(errors.join('\n'));if(ready)break;
    // Pump real compositor frames while startup waits for requestAnimationFrame.
    await send('Page.captureScreenshot',{format:'jpeg',quality:10});
    await new Promise(r=>setTimeout(r,200));
  }
  assert.ok(ready,'simulator ready');
  for(const aircraft of (process.env.AIRCRAFTS??'B738,C172,F16').split(',')) {
    const selection=await evaluate(`(async()=>{const s=sim;s.demoDirector.stop();s.setAircraft('${aircraft}');await s.setAirport('incheon');s.lobby.aircraft='${aircraft}';s.lobby.airport='incheon';s.lobby.preset='demo';s.lobby.demoProfile='sihwa-tour';s.gameFlow.enterLobby();s.lobbyScreen.refresh();return {selected:document.querySelector('#lobby-demo-select').value,offered:[...document.querySelector('#lobby-demo-select').options].map(o=>o.value),demoVisible:document.querySelector('#lobby-preset-demo').style.display!=='none'};})()`);
    assert.equal(selection.selected,'sihwa-tour');assert.equal(selection.demoVisible,true);
    await capture(`${aircraft}-menu`);
    if(aircraft==='F16'){
      await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await evaluate(`document.querySelector('#lobby-demo-options').scrollIntoView({block:'nearest'});true`);
      await capture('F16-menu-mobile');
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    }
    await evaluate(`(()=>{sim.gameFlow.isPhysicsFrozen=()=>true;sim.fly();return true;})()`);
    assert.equal(await evaluate('sim.demoDirector.isActive && sim.demoDirector.profile'), 'sihwa-tour');
    const samples=[];let lastStage=-1;
    for(let elapsed=0;elapsed<1200;elapsed+=5) {
      const sample=await evaluate(`(()=>{sim.stepSimulation(5);const d=sim.demoDirector,s=d.sihwaTourScenario;return {simulationTime:sim.totalSimTime,time:d.totalTimer,stage:d.currentStage,active:d.isActive,progress:s.progress,result:s.result,position:sim.position.toArray(),ias:sim.telemetry.iasKnots,roll:sim.telemetry.rollDeg,crashed:sim.isCrashed,incident:sim.landingIncident,aircraft:sim.currentAircraftId};})()`);
      samples.push(sample);
      if(sample.stage!==lastStage){console.log(JSON.stringify({aircraft,...sample}));lastStage=sample.stage;
        await evaluate('sim.renderer.render(sim.scene,sim.camera);true');
        await capture(`${aircraft}-${sample.stage}`);
      }
      if(!sample.active || sample.crashed)break;
    }
    const last=samples.at(-1);flights.push({aircraft,selection,samples});
    await writeFile(path.join(artifacts,'flights.json'),JSON.stringify({complete:false,flights,errors,extensionErrors},null,2)+'\n');
    assert.equal(last.result.status,'completed',`${aircraft}: ${JSON.stringify(last)}`);
    assert.ok(samples.every(s=>!s.crashed&&!s.incident&&s.aircraft===aircraft&&s.position.every(Number.isFinite)));
    assert.deepEqual([...last.result.landmarks].sort(),['beach','plant','seawall','tower']);
    assert.ok(last.result.minClearanceM>150);assert.ok(last.result.maxBankDeg<40);
    assert.ok(Math.abs(last.result.handoffBankDeg)<8);assert.ok(Math.abs(last.result.handoffVerticalSpeed)<2.5);
    for(let i=1;i<samples.length;i++){
      const a=samples[i-1],b=samples[i],distance=Math.hypot(...b.position.map((v,j)=>v-a.position[j]));
      assert.ok(distance<Math.max(.01,b.simulationTime-a.simulationTime)*350,`${aircraft}: discontinuous motion`);
    }
    const handoff=await evaluate('({disabled:sim.controls.aircraftControlsDisabled,throttle:sim.controls.throttle,virtual:sim.controls.virtualElevator})');
    assert.equal(handoff.disabled,false);assert.ok(handoff.throttle>0);
    await evaluate(`sim.demoDirector.start('incheon','sihwa-tour');sim.stepSimulation(5);sim.demoDirector.userCameraOverridden=true;sim.cameraSystem.setMode(6);sim.stepSimulation(140);true`);
    assert.equal(await evaluate('sim.cameraSystem.mode'),6,'camera override retained');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    assert.equal(await evaluate("!sim.demoDirector.isActive && sim.demoDirector.sihwaTourScenario.result.status==='cancelled' && !sim.controls.aircraftControlsDisabled"),true,'Escape cancels');
  }
  assert.deepEqual(errors,[]);
  await writeFile(path.join(artifacts,'flights.json'),JSON.stringify({complete:true,flights,errors,extensionErrors},null,2)+'\n');
  console.log(JSON.stringify({complete:true,flights:flights.map(f=>({aircraft:f.aircraft,result:f.samples.at(-1).result})),errors}));
} finally {
  ws.close();try{await browserCall('Target.disposeBrowserContext',{browserContextId});}finally{root.close();}
}
