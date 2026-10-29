/** Start Vite separately. SIM_URL / CDP_PORT / CHROME_PATH / ARTIFACT_DIR override. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

const port = Number(process.env.CDP_PORT || 9477);
const directory = resolve(process.env.ARTIFACT_DIR || 'review-artifacts/hangang');
const profile = await mkdtemp(join(tmpdir(), 'flight3d-hangang-'));
const chrome = spawn(process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome-stable'), [
  '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--window-size=1440,1000', '--no-first-run', '--no-default-browser-check',
  '--use-gl=angle', `--use-angle=${process.platform === 'win32' ? 'd3d11' : 'vulkan'}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
let socket, nextId = 1;
const pending = new Map(), exceptions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 120000);
  pending.set(id, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (fn, arg) => {
  const r = await send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg) ?? ''})`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const capture = async name => {
  const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  await writeFile(join(directory, `${name}.jpg`), Buffer.from(result.data, 'base64'));
};
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { /* startup */ }
    if (!target) await delay(100);
  }
  assert.ok(target, 'Chrome started');
  socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, 'open');
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails);
    const request = pending.get(m.id);
    if (!request) return;
    pending.delete(m.id);
    if (m.error) request.reject(new Error(m.error.message)); else request.resolve(m.result);
  });
  await mkdir(directory, { recursive: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: process.env.SIM_URL || 'http://127.0.0.1:5197' });
  let ready = false;
  for (let i = 0; i < 240 && !ready; i++) {
    ready = await evaluate(() => Boolean(window.simulator?.startupReady));
    if (!ready) await delay(500);
  }
  assert.ok(ready, 'B738 exterior and cockpit loaded');
  const result = await evaluate(async () => {
    const s=window.simulator;
    s.clock.getDelta=()=>0; s.demoDirector.stop(); s.gameFlow.returnToLobby(true);
    document.getElementById('lobby-airport-hangang').click();
    while(s.lobbySelectionPending) await new Promise(resolve=>setTimeout(resolve,50));
    document.getElementById('btn-fly').click();
    const initial = { region:s.activeAirport, preset:s.lastPresetType, aircraft:s.currentAircraftId, mass:s.aero.mass, throttle:s.controls.throttle, trim:s.controls.pitchTrim, position:s.position.toArray() };
    s.stepSimulation(5);
    return {initial,status:s.hangang.run.status,reason:s.hangang.run.reason,position:s.position.toArray(),speed:s.linearVelocity.length(),pitch:s.telemetry.pitchDeg,crashed:s.isCrashed};
  });
  await delay(500); await capture('approach');
  const flight = await evaluate(async () => {
    const {flyBank,flyVerticalPath}=await import('/src/director/PilotControlLaws.js');
    const {riverCenter}=await import('/src/config/hangangCourse.js');
    const s=window.simulator;
    // Test pilot drives only ordinary control inputs. No state teleport or force override.
    for(let i=0;i<2400 && s.hangang.run.status==='running';i++) {
      const tel=s.telemetry;
      const lookZ=s.position.z-180;
      const heading=Math.atan2(riverCenter(lookZ)-s.position.x,180)*180/Math.PI;
      const error=((heading-tel.headingDeg+540)%360)-180;
      flyBank(s,Math.max(-18,Math.min(18,error*1.2)),tel);
      flyVerticalPath(s,Math.max(-1.5,Math.min(1.5,(19-s.position.y)*0.5)),89,tel);
      s.controls.setVirtualInput('rudder',Math.max(-0.2,Math.min(0.2,-s.aero.beta*2)));
      s.stepSimulation(0.05);
    }
    s.controls.clearVirtualInputs();
    return {status:s.hangang.run.status,reason:s.hangang.run.reason,index:s.hangang.run.index,position:s.position.toArray(),gaps:s.hangang.run.clearances,maintenance:s.hangang.run.maintenancePercent,elapsed:s.hangang.run.elapsed};
  });
  await delay(300);await capture('finish');
  const lifecycle=await evaluate(async()=>{
    const s=window.simulator;
    s.gameFlow.pause();document.getElementById('btn-pause-restart').click();
    const reset=s.hangang.run.index===0 && s.hangang.run.status==='running';
    s.autopilot.master=true;s.stepSimulation(0.1);
    const manual=!s.autopilot.master;
    const noDemo=s.demoDirector.start()===false && !s.demoDirector.isActive;
    const commonHud=!document.getElementById('hangang-hud') && !document.getElementById('hangang-retry')
      && document.getElementById('hud-overlay').getClientRects().length>0;
    s.gameFlow.returnToLobby(true);
    s.gameFlow.enterFlight();await s.setAirport('coastal');s.setPreset('runway');
    const restore=!s.hangang.active && s.currentTerrain===s.terrain && !s.hangang.scene.group.visible;
    await s.setAirport('hangang');await s.setAirport('lukla');
    const airport=!s.hangang.active && s.currentTerrain===s.luklaTerrain;
    await s.setAirport('hangang');
    return {reset,manual,noDemo,commonHud,restore,airport};
  });
  await evaluate(async()=>{
    const s=window.simulator;
    const {CameraSystem}=await import('/src/cameras/CameraSystem.js');
    s.cameraSystem.setMode(CameraSystem.MODES.COCKPIT,true);
    s.stepSimulation(16.5);
  });
  await delay(500);await capture('cockpit-entry');
  const failure=await evaluate(()=>{
    const s=window.simulator;s.controls.setVirtualInput('elevator',-0.8);
    s.stepSimulation(6);
    return {crashed:s.isCrashed,status:s.hangang.run.status,reason:s.hangang.run.reason,contact:s.hangang.run.contact};
  });
  await delay(300);await capture('failure');
  const retry = await evaluate(()=>{
    const s=window.simulator;
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' '}));
    const crashToMenu=s.gameFlow.state==='lobby' && !s.isCrashed;
    document.getElementById('btn-fly').click();
    s.stepSimulation(0.1);
    return {crashToMenu,healthy:!s.isCrashed && !s.aero.isStalled, trauma:s.cameraSystem.trauma,
      reset:s.hangang.run.index===0, altitude:s.telemetry.radioAltFt};
  });
  await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:1,mobile:true});
  await delay(3500);await capture('mobile');
  const menu = await evaluate(()=>{
    const s=window.simulator;s.gameFlow.returnToLobby(true);s.lobbyScreen.refresh();
    return {region:s.activeAirport, selected:document.getElementById('lobby-airport-hangang').classList.contains('active'),
      onlyChallenge:[...document.querySelectorAll('.lobby-scenarios .btn-preset')].filter(b=>b.style.display!=='none').map(b=>b.id),
      aircraftLocked:document.getElementById('lobby-aircraft-b738').disabled,timeLocked:document.getElementById('lobby-time-select').disabled};
  });
  await delay(300);await capture('region-menu');
  await send('Page.reload');
  let restored;
  for(let i=0;i<240;i++) {
    restored=await evaluate(()=>window.simulator?.startupReady ? {region:window.simulator.activeAirport,preset:window.simulator.lastPresetType,aircraft:window.simulator.currentAircraftId,active:window.simulator.hangang?.active}:null);
    if(restored) break;await delay(500);
  }
  assert.deepEqual(restored,{region:'hangang',preset:'hangang',aircraft:'C172',active:true});
  assert.ok(menu.selected && menu.aircraftLocked && menu.timeLocked);
  assert.deepEqual(menu.onlyChallenge,['lobby-preset-hangang']);
  await writeFile(join(directory,'results.json'),JSON.stringify({result,flight,lifecycle,failure,retry,menu,restored,exceptions},null,2));
  console.log(JSON.stringify({result,flight,lifecycle,failure,retry,menu,restored,exceptions}));
  assert.equal(result.initial.aircraft,'C172');assert.equal(result.initial.preset,'hangang');
  assert.equal(failure.status,'failed');assert.equal(failure.crashed,true);assert.equal(flight.status,'complete');assert.equal(flight.index,3);
  assert.ok(Object.values(lifecycle).every(Boolean));assert.equal(exceptions.length,0);
  assert.ok(retry.crashToMenu && retry.healthy && retry.reset);assert.equal(retry.trauma,0);assert.ok(retry.altitude>50);
} finally {
  socket?.close();chrome.kill();
  await delay(1500);
  // This exact mkdtemp directory belongs to this harness alone.
  await rm(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
