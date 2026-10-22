import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const dir = process.env.ARTIFACT_DIR || path.resolve("review-artifacts/issue101");
fs.mkdirSync(dir, { recursive: true });
// Start Vite and open it in headless Chrome with CDP on 9451; see ci.md.
const cdpPort = process.env.CDP_PORT || 9451;
const fallback = process.env.FALLBACK === "1";
const pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const ws = new WebSocket(
  pages.find((p) => p.type === "page").webSocketDebuggerUrl,
);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map(),
  errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown")
    errors.push(m.params.exceptionDetails.text);
});
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    const timeout = setTimeout(
      () => reject(new Error(`timeout ${method}`)),
      60000,
    );
    pending.set(id, (m) => {
      clearTimeout(timeout);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
await call("Runtime.enable");
await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await call('Network.enable');
await call('Network.setBlockedURLs', { urls: fallback ? ['*b737-cockpit-medium.glb*'] : [] });
await call("Page.reload", { ignoreCache: true });
await new Promise(r=>setTimeout(r,2500));
for (let i=0;i<120;i++) {
  if(await evaluate('!!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded')) break;
  await new Promise(r=>setTimeout(r,500));
}
const results = await evaluate(`(async()=>{
 const s=window.simulator,c=s.aircraft.cockpit;
 await c.shaderWarmup;
 s.demoDirector.stop(); s.gameFlow.enterFlight(); s.setPreset('runway'); s.cameraSystem.photoCockpit=false;
 s.cameraSystem.setMode(0); s.stepSimulation(0);
 const meshes=[]; c.gltfCockpitModel.traverse(n=>{if(n.isMesh && n.geometry.attributes.position?.count)meshes.push(n)});
 let visible=0;c.gltfCockpitModel.traverseVisible(n=>{if(n.isMesh&&n.geometry.attributes.position?.count)visible++});
 const result={loaded:c.gltfCockpitLoaded,saved:c.staticDrawCallsSaved,meshes:meshes.length,visible,
 controls:[...c.gltfYokes,...c.gltfEngineControls.throttles,...c.gltfEngineControls.pedals].map(p=>({name:p.name,children:p.children.length}))};
 const counts={}; const original={};
 for(const name of ['pfd','nd','eicas','mcp','isfd','cdu']){const d=s[name+'Canvas'];counts[name]=0;original[name]=d.render;d.render=function(...args){counts[name]++;return original[name].apply(this,args)}}
 for(let i=0;i<10;i++)s.updateFlightDisplays();
 result.displayRenders={...counts};
 const oldSpeed=s.telemetry.selectedSpeed;
 s.telemetry.selectedSpeed=(oldSpeed??160)+10;s.updateFlightDisplays();
 result.mcpChangedRenders=counts.mcp;
 s.telemetry.selectedSpeed=oldSpeed;
 const beforeForce={...counts};
 s.stepSimulation(0);
 result.forcedDisplayRefresh=counts.nd===beforeForce.nd+1 && counts.eicas===beforeForce.eicas+1;
 for(const name of Object.keys(original))s[name+'Canvas'].render=original[name];
 const controls=[...c.gltfYokes,...c.gltfEngineControls.throttles,...c.gltfEngineControls.pedals];
 const neutral=controls.map(p=>[...p.position.toArray(),...p.quaternion.toArray()]);
 for(const input of [1,1,-1,0])c.updateControls({aileron:input,elevator:input,throttle:Math.max(0,input),rudder:input});
 result.controlsReset=controls.every((p,i)=>[...p.position.toArray(),...p.quaternion.toArray()].every((v,j)=>Math.abs(v-neutral[i][j])<1e-6));
 c.toggleYokes(); result.yokesHide=c.gltfYokes.every(p=>!p.visible);
 c.toggleYokes(); result.yokesShow=c.gltfYokes.every(p=>p.visible);
 s.renderer.render(s.scene,s.camera);result.cockpitDrawCalls=s.renderer.info.render.calls;
 return result;
})()`);
assert.ok(results.loaded);
assert.ok(fallback ? results.saved >= 0 : results.saved > 2300);
assert.ok(results.meshes > 0);
assert.ok(results.visible<150);
assert.equal(results.displayRenders.pfd,10);
assert.equal(results.displayRenders.nd,5);
assert.equal(results.displayRenders.eicas,5);
assert.equal(results.displayRenders.mcp,0);
assert.equal(results.mcpChangedRenders,1);
assert.equal(results.displayRenders.cdu,0);
assert.ok(results.controlsReset);
assert.ok(results.yokesHide && results.yokesShow);
assert.ok(results.forcedDisplayRefresh);
const shot=await call('Page.captureScreenshot',{format:'png'});
fs.writeFileSync(path.join(dir,'cockpit.png'),Buffer.from(shot.data,'base64'));
await evaluate('window.simulator.cameraSystem.setMode(5);window.simulator.stepSimulation(0);window.simulator.renderer.render(window.simulator.scene,window.simulator.camera)');
const gear=await call('Page.captureScreenshot',{format:'png'});
fs.writeFileSync(path.join(dir,'gear.png'),Buffer.from(gear.data,'base64'));
results.gear=await evaluate('({near:sim.camera.near,y:sim.camera.position.y,offset:sim.cameraSystem.gearCamOffset.y})');
results.errors=errors;
assert.deepEqual(errors, []);
assert.ok(results.gear.near >= 0.15);
fs.writeFileSync(path.join(dir,'browser-results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
ws.close();
