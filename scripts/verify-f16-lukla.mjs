import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run under chrome-session --project flight3d; reuse its browser and close only our tab.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5186/';
const profile = process.env.PROFILE || 'low-pass';
const dir = process.env.ARTIFACT_DIR || `.cache/f16-${profile}`;
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [], results = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
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
  await evaluate(`(() => {
    const sim = window.simulator;
    sim.aircraft.group.updateMatrixWorld(true);
    for (let i = 0; i < 120; i++) sim.cameraSystem.update(1/60, sim.aircraft.group, sim.telemetry, (x,z) => sim.currentTerrain.getHeight(x,z));
    sim.camera.updateProjectionMatrix();
    sim.renderer.render(sim.scene, sim.camera);
  })()`);
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
};
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false});
  for (let i=0;i<120;i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(await evaluate('Boolean(window.simulator?.startupReady)'), 'startup ready');
  await evaluate(`(() => {
    const s=window.simulator; s.demoDirector.stop(); s.gameFlow.isPhysicsFrozen=()=>true;
    document.getElementById('lobby-airport-lukla')?.click();
    s.setAirport('lukla'); s.setAircraft('F16'); s.lobby.aircraft='F16';
    s.lobby.preset='demo'; s.lobby.demoProfile=${JSON.stringify(profile)}; s.gameFlow.enterFlight();
  })()`);
  for (let i=0;i<120;i++) {
    if(await evaluate('window.simulator.currentTerrain.isLoaded')) break;
    await new Promise(r=>setTimeout(r,500));
  }
  await evaluate(`window.simulator.demoDirector.start('lukla',${JSON.stringify(profile)})`);
  for(let i=0;i<100;i++) {
    const sample=await evaluate(`(() => {const s=window.simulator; s.stepSimulation(1); return {
      active:s.demoDirector.isActive,stage:s.demoDirector.currentStage, aircraft:s.currentAircraftId,
      crashed:s.isCrashed,stalled:s.telemetry.isStalled,position:s.position.toArray(),
      ias:s.telemetry.iasKnots,pitch:s.telemetry.pitchDeg,roll:s.telemetry.rollDeg,
      gForce:s.telemetry.gForce,throttle:s.controls.throttle,
      result:s.demoDirector.getActiveScenario().result,
      programs:s.renderer.info.programs.map(p=>({name:p.name,runnable:p.diagnostics?.runnable}))
    }})()`);
    results.push(sample);
    if(i%10===0 || (profile === 'canyon-chase' && (i === 34 || i === 35))) { console.log(i,JSON.stringify(sample)); await capture('flight-'+i); }
    if(!sample.active) break;
  }
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({errors,results},null,2));
  assert.equal(results.at(-1).result.status,'completed');
  assert.ok(results.every(s=>!s.crashed&&!s.stalled&&s.aircraft==='F16'&&s.position.every(Number.isFinite)));
  assert.ok(results.at(-1).result.minClearanceM>50);
  if (profile === 'canyon-chase') {
    assert.ok(results.at(-1).result.maxG >= 7.5, 'measured high-G pull-up');
    assert.ok(results.at(-1).result.invertedSeconds >= 2, 'sustained inverted flight');
    assert.ok(results.at(-1).result.rollTravelDeg >= 700, 'roll and inverted crossing');
  }
  assert.equal(errors.length,0);
  assert.ok(results.every(s=>s.programs.every(p=>p.runnable!==false)), 'shaders compile');
  await evaluate(`(() => {const s=window.simulator; s.demoDirector.start(); s.stepSimulation(3); s.demoDirector.stop();})()`);
  assert.ok(await evaluate('!window.simulator.controls.aircraftControlsDisabled && window.simulator.controls.virtualElevator === null'));
  await evaluate(`(() => {
    const s=window.simulator; s.demoDirector.stop();
    const t=s.currentTerrain;
    s.cameraSystem.update=()=>{};
    s.aircraft.group.visible=false;
    s.camera.position.set(-1800,t.getHeight(-1800,1800)+25,1800);
    s.camera.lookAt(-1950,t.getHeight(-1950,1700)+8,1700);
    s.camera.updateMatrixWorld(true); s.renderer.render(s.scene,s.camera);
  })()`);
  const close = await call('Page.captureScreenshot', {format:'png'});
  fs.writeFileSync(path.join(dir,'terrain-close.png'),Buffer.from(close.data,'base64'));
  console.log('PASS',JSON.stringify(results.at(-1)));
} finally {
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({errors,results},null,2));
  ws.close(); await fetch(`${endpoint}/json/close/${target.id}`);
}
