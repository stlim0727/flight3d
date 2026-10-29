import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run under chrome-session --project flight3d; reuse its browser and close only our tab.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5287/';
const dir = process.env.ARTIFACT_DIR || '.cache/incheon-parked';
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const isolatedContexts=new Set(),externalErrors=[];
const pending = new Map(), errors = [], results = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault === false) isolatedContexts.add(message.params.context.id);
  if(message.method==='Runtime.consoleAPICalled' && message.params.type==='error' && !isolatedContexts.has(message.params.executionContextId) && !message.params.stackTrace?.callFrames?.[0]?.url?.startsWith('chrome-extension://'))errors.push(message.params.args);
  if (message.method === 'Runtime.exceptionThrown') ((isolatedContexts.has(message.params.exceptionDetails.executionContextId) || message.params.exceptionDetails.url?.startsWith('chrome-extension://')) ? externalErrors : errors).push(message.params.exceptionDetails);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 60000);
  pending.set(id, result => { clearTimeout(timer); result.error ? reject(new Error(JSON.stringify(result.error))) : resolve(result.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const capture = async name => {
  if (process.env.SCREENSHOTS === '0') return;
  await evaluate('window.simulator.renderer.render(window.simulator.scene,window.simulator.camera)');
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
};
try {
  await call('Runtime.enable');await call('Page.enable');await call('Page.bringToFront');
  console.log('Browser admitted; waiting for startup');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  for(let i=0;i<180;i++){if(await evaluate('Boolean(window.simulator?.startupReady)'))break;await new Promise(r=>setTimeout(r,500));}
  assert.ok(await evaluate('Boolean(window.simulator?.startupReady)'));
  console.log('Startup ready; loading airport and parked exterior');
  await evaluate(`(async()=>{const s=window.simulator;s.demoDirector.stop();s.gameFlow.isPhysicsFrozen=()=>true;s.setAircraft('B738');await s.setAirport('incheon');s.audio.setMuted(true);await s.currentAirport.parked.ready;s.cameraSystem.update=()=>{};s.renderQuality='high';})()`);
  assert.equal(await evaluate('window.simulator.currentAirport.parked.loadError'),null);
  assert.equal(await evaluate('window.simulator.currentAirport.parked.loaded'),true);
  console.log('Parked exterior ready');
  const info=await evaluate(`(()=>{const s=window.simulator,p=s.currentAirport.parked,T=window.THREE;
    s.camera.position.set(90,180,-80);s.camera.lookAt(new T.Vector3(-240,7,-440));
    p.update(s.camera.position,'high');s.renderer.render(s.scene,s.camera);
    const gl=s.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {stands:p.stands.length,terminal:p.stands.filter(x=>x.area==='terminal').length,visible:p.visibleCount,meshCount:p.group.children.length,
      sharedBodyGeometries:new Set([...p.batches.values()].map(x=>x.body.geometry.uuid)).size,bodyVertices:p.assets.geometry.attributes.position.count,
      decalVertices:p.assets.decals.attributes.position.count,gpu:gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER)};
  })()`);
  assert.equal(info.stands,48);assert.equal(info.visible,48);assert.equal(info.sharedBodyGeometries,1);assert.equal(info.meshCount,10);assert.ok(info.decalVertices>100);
  await capture('terminal-parked');
  const quality=[];
  for(const mode of ['high','balanced','performance']){
    const row=await evaluate(`(()=>{const s=window.simulator,p=s.currentAirport.parked;s.renderQuality=${JSON.stringify(mode)};p.update(s.camera.position,s.renderQuality);return {quality:s.renderQuality,count:p.visibleCount,ids:p.visibleIds};})()`);
    quality.push(row);assert.equal(row.count,{high:48,balanced:32,performance:16}[mode]);
  }
  await evaluate(`window.simulator.renderQuality='high'`);
  for(const airline of ['korean','jeju','jin','flydubai']){
    const row=await evaluate(`(()=>{const s=window.simulator,p=s.currentAirport.parked,T=window.THREE,stand=p.stands.find(x=>x.airline===${JSON.stringify(airline)});
      const point=v=>new T.Vector3(...v).applyAxisAngle(new T.Vector3(0,1,0),stand.yaw).add(new T.Vector3(stand.x,10.5,stand.z));
      s.camera.position.copy(point([-29,7,-25]));s.camera.lookAt(point([0,1,-2]));p.update(s.camera.position,'high');s.renderer.render(s.scene,s.camera);
      return {airline:stand.airline,id:stand.id,x:stand.x,z:stand.z,visible:p.visibleCount};})()`);
    results.push(row);await capture('737-'+airline);
  }
  const cost=await evaluate(`(()=>{const s=window.simulator,p=s.currentAirport.parked,T=window.THREE;s.camera.position.set(90,180,-80);s.camera.lookAt(new T.Vector3(-240,7,-440));p.update(s.camera.position,'high');
    p.group.visible=false;s.renderer.render(s.scene,s.camera);const before={calls:s.renderer.info.render.calls,triangles:s.renderer.info.render.triangles};
    p.group.visible=true;s.renderer.render(s.scene,s.camera);return {without:before,with:{calls:s.renderer.info.render.calls,triangles:s.renderer.info.render.triangles}};})()`);
  assert.ok(cost.with.calls>cost.without.calls,'parked fleet actually renders');
  let flight=null;
  if(process.env.VISUAL_ONLY!=='1'){
    // Run the existing physical departure while the parked fleet's BVH is active.
    await evaluate(`(()=>{const s=window.simulator;s.demoDirector.start('incheon','incheon-departure');})()`);
    for(let seconds=0;seconds<1600;seconds+=20){
      flight=await evaluate(`(()=>{const s=window.simulator;s.stepSimulation(20);return {active:s.demoDirector.isActive,stage:s.demoDirector.currentStage,result:s.demoDirector.incheonDepartureScenario.result,crashed:s.isCrashed,gear:s.gear.contacts.map(x=>x.damageState)};})()`);
      assert.equal(flight.crashed,false,'parked aircraft do not obstruct the departure');
      if(!flight.active)break;
    }
    assert.equal(flight.result.status,'completed');assert.equal(flight.result.airborne,true);assert.ok(flight.gear.every(x=>x==='normal'));
  }
  assert.equal(errors.length,0,JSON.stringify(errors));
  const report={info,quality,liveries:results,cost,flight,applicationErrors:errors,externalExceptions:externalErrors.length};
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
} finally {ws.close();await fetch(`${endpoint}/json/close/${target.id}`);}
const detail = async (name, offset, target) => {
  if (process.env.SCREENSHOTS === '0') return;
  await evaluate(`(()=>{const s=window.simulator,T=window.THREE;
    window.__cameraUpdate=s.cameraSystem.update;s.cameraSystem.update=()=>{};
    const point=v=>new T.Vector3(...v).applyQuaternion(s.quaternion).add(s.position);
    s.camera.position.copy(point(${JSON.stringify(offset)}));s.camera.lookAt(point(${JSON.stringify(target)}));
    s.camera.updateProjectionMatrix();s.renderer.render(s.scene,s.camera);
  })()`);
  const {data}=await call('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(data,'base64'));
  await evaluate('window.simulator.cameraSystem.update=window.__cameraUpdate');
};
