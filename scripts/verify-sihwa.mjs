import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run inside chrome-session --project flight3d. Reuse the project daemon;
// create/close only this script's own tab, never the shared browser.
if (process.env.CHROME_PROJECT !== 'flight3d') throw new Error('Run with chrome-session --project flight3d');
const port = process.env.CHROME_DEBUG_PORT ?? '9225';
const url = process.env.APP_URL ?? 'http://127.0.0.1:5288/';
const artifacts = process.env.ARTIFACT_DIR ?? path.join(process.cwd(), 'review-artifacts/sihwa');
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
try {
  await mkdir(artifacts,{recursive:true});
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
  await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Page.setWebLifecycleState',{state:'active'});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:new URL('/scripts/verify-sihwa.html',url).href});
  console.log('Loading regional scene');
  await send('Page.bringToFront');
  let ready=false;
  for(let i=0;i<200;i++){ready=await evaluate('Boolean(window.review)');if(errors.length)throw new Error(errors.join('\n'));if(ready)break;await new Promise(r=>setTimeout(r,200));}
  assert.ok(ready,'regional scene loaded');
  const stats=[];
  for(const name of ['plant','tower','beach','seawall','bridge']){
    console.log(`Rendering ${name}`);
    await send('Page.bringToFront');
    stats.push({name,...await evaluate(`review.view('${name}')`)});
    await settle();await capture(name);
  }
  const contacts=await evaluate(`(()=>{
    const a=review.airport,r=a.terrain.region,lm=review.scene.getObjectByName('Sihwa regional scenery').userData.landmarks;
    const t=lm.tower;
    const hit=(x,y,z)=>Boolean(a.checkBuildingCollision([{pos:review.camera.position.clone().set(x,y,z),radius:.5,desc:'test'}]));
    let deckError=0,deckSamples=0;
    for(const s of r.additionalSurfaces)for(let i=0;i<s.positions.length;i+=9){const p=s.positions;
      const x=(p[i]+p[i+3]+p[i+6])/3,y=(p[i+1]+p[i+4]+p[i+7])/3,z=(p[i+2]+p[i+5]+p[i+8])/3;
      deckError=Math.max(deckError,Math.abs(s.getHeight(x,z)-y));deckSamples++;
    }
    const approaches=review.scene.getObjectByName('Sihwa regional scenery').userData.bridgeApproaches;
    let maxAbutmentJump=0,maxBankJump=0;
    for(const approach of approaches)for(const path of approach.paths) {
      const first=path[0],second=path[1],last=path.at(-1),beforeLast=path.at(-2);
      const near=Math.hypot(second[0]-first[0],second[1]-first[1]),far=Math.hypot(last[0]-beforeLast[0],last[1]-beforeLast[1]);
      const h=(p,q,d,t)=>r.getHeight(p[0]+(q[0]-p[0])/d*t,p[1]+(q[1]-p[1])/d*t);
      maxAbutmentJump=Math.max(maxAbutmentJump,Math.abs(h(first,second,near,.01)-h(first,second,near,-.01)));
      maxBankJump=Math.max(maxBankJump,Math.abs(h(last,beforeLast,far,.01)-h(last,beforeLast,far,-.01)));
    }
    return {approachCount:approaches.length*2,maxAbutmentJump,maxBankJump,landmarks:lm,triangles:r.metadata.triangleCount,bridges:r.additionalSurfaces.length,deckSamples,deckError,towerShaftCollision:hit(t.x,t.y-30,t.z),towerCabCollision:hit(t.x+9,t.y-5,t.z),clearBesideShaft:!hit(t.x+9,t.y-30,t.z),clearAboveTower:!hit(t.x,t.y+10,t.z)};
  })()`);
  assert.equal(contacts.bridges,1);
  assert.equal(contacts.approachCount,8);assert.ok(contacts.maxAbutmentJump<.01);assert.ok(contacts.maxBankJump<.02);
  assert.ok(contacts.deckSamples>0 && contacts.deckError<.01);
  for(const key of ['towerShaftCollision','towerCabCollision','clearBesideShaft','clearAboveTower'])assert.equal(contacts[key],true,key);
  console.log(JSON.stringify({stage:'scenery',stats,contacts,errors,extensionErrors}));
  await writeFile(path.join(artifacts,'review.json'),JSON.stringify({complete:false,stats,contacts,errors,extensionErrors},null,2)+'\n');
  // Check the actual simulator loads the extension and keeps existing gate
  // contacts intact. Only the review page uses an independent inspection camera.
  await send('Page.navigate',{url});
  await send('Page.bringToFront');
  console.log('Checking main simulator startup');
  let gameReady=false;
  for(let i=0;i<300;i++){gameReady=await evaluate('Boolean(window.sim?.gameFlow)');if(errors.length)throw new Error(errors.join('\n'));if(gameReady)break;await new Promise(r=>setTimeout(r,200));}
  assert.ok(gameReady,'main simulator ready');
  console.log('Main simulator ready; checking airport and contacts');
  const integration=await evaluate(`(async()=>{
    await sim.setAirport('incheon');sim.fly();sim.gameFlow.pause();sim.setPreset('runway');
    for(let i=0;i<200;i++)sim.stepSimulation(.05);
    const r=sim.currentTerrain.region;
    return {airport:sim.activeAirport,regionLoaded:Boolean(r),meshVisible:sim.incheonAirport.terrain.mesh.visible,crashed:sim.isCrashed,grounded:sim.telemetry.onGround,position:{...sim.position},height:sim.currentTerrain.getHeight(sim.position.x,sim.position.z)};
  })()`);
  assert.equal(integration.airport,'incheon');assert.equal(integration.regionLoaded,true);assert.equal(integration.meshVisible,true);assert.equal(integration.crashed,false);assert.equal(integration.grounded,true);assert.equal(integration.height,7);
  assert.deepEqual(errors,[],'application/shader errors');
  await writeFile(path.join(artifacts,'review.json'),JSON.stringify({complete:true,stats,contacts,integration,errors,extensionErrors},null,2)+'\n');
  console.log(JSON.stringify({stats,contacts,integration,errors,extensionErrors,artifacts}));
} finally {
  ws.close();
  try{await browserCall('Target.disposeBrowserContext',{browserContextId});}finally{root.close();}
}
