import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run under chrome-session --project flight3d; reuse its browser and close only our tab.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5283/';
const dir = process.env.ARTIFACT_DIR || '.cache/departure-audio';
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const isolatedContexts = new Set(), isolatedErrors = [];
const pending = new Map(), errors = [], results = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault === false) isolatedContexts.add(message.params.context.id);
  if (message.method === 'Runtime.exceptionThrown') ((isolatedContexts.has(message.params.exceptionDetails.executionContextId) || message.params.exceptionDetails.url?.startsWith('chrome-extension://')) ? isolatedErrors : errors).push(message.params.exceptionDetails);
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
  await call('Runtime.enable'); await call('Page.enable');await call('Page.bringToFront');
  for(let i=0;i<160;i++){if(await evaluate('Boolean(window.simulator?.startupReady && window.simulator?.lobbyScreen)'))break;await new Promise(r=>setTimeout(r,500));}
  await evaluate(`(async()=>{const s=window.simulator;s.demoDirector.stop();s.gameFlow.isPhysicsFrozen=()=>true;s.setAircraft('B738');await s.setAirport('incheon');s.gameFlow.enterLobby();s.lobby.preset='demo';s.lobby.demoProfile='incheon-departure';s.audio.setMuted(false);s.lobbyScreen.refresh();})()`);
  const rect=await evaluate(`(()=>{const r=document.getElementById('btn-fly').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});
  for(let i=0;i<50;i++){if(await evaluate(`window.simulator.audio.departureRadio.status==='playing'`))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await evaluate(`window.simulator.audio.departureRadio.status`),'playing','real click starts bundled speech');
  assert.equal(await evaluate(`window.simulator.audio.ctx.state`),'running');
  await evaluate(`(()=>{const s=window.simulator;s.stepSimulation(7);const a=s.audio;window.__radioAnalyser=a.ctx.createAnalyser();window.__radioAnalyser.fftSize=2048;const silence=a.ctx.createGain();silence.gain.value=0;window.__radioAnalyser.connect(silence);silence.connect(a.ctx.destination);a.departureRadio.source.connect(window.__radioAnalyser);})()`);
  assert.equal(await evaluate(`window.simulator.demoDirector.currentStage`),50,'gate waits for actual speech end');
  let liveRms=0;
  for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,200));liveRms=Math.max(liveRms,await evaluate(`(()=>{const x=new Float32Array(2048);window.__radioAnalyser.getFloatTimeDomainData(x);return Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);})()`));}
  assert.ok(liveRms>.01,'live speech signal reaches the audio graph');
  await evaluate(`window.simulator.gameFlow.pause()`);
  const paused=await evaluate(`({status:window.simulator.audio.departureRadio.status,offset:window.simulator.audio.departureRadio.offset})`);
  assert.equal(paused.status,'paused');assert.ok(paused.offset>0);
  await new Promise(r=>setTimeout(r,500));
  assert.equal(await evaluate(`window.simulator.audio.departureRadio.offset`),paused.offset,'menu does not consume speech');
  await evaluate(`window.simulator.gameFlow.resume()`);
  assert.equal(await evaluate(`window.simulator.audio.departureRadio.status`),'playing');
  await evaluate(`window.simulator.audio.setMuted(true)`);
  assert.equal(await evaluate(`window.simulator.audio.departureRadio.busy`),false,'mute stops speech');
  await evaluate(`window.simulator.audio.setMuted(false)`);
  assert.equal(await evaluate(`window.simulator.audio.departureRadio.busy`),false,'unmute does not replay a stale call');
  const clips=await evaluate(`(async()=>{const a=window.simulator.audio;await a.departureRadio.preload();const result=[];for(const [stage,buffer] of a.departureRadio.cache){const c=new OfflineAudioContext(1,Math.ceil(buffer.duration*22050),22050);const out=c.createGain();out.connect(c.destination);const Radio=a.departureRadio.constructor;const radio=new Radio({context:()=>c,output:()=>out,muted:()=>false});radio.cache.set(stage,buffer);await radio.play(stage);const pcm=(await c.startRendering()).getChannelData(0);let energy=0,peak=0;for(const v of pcm){energy+=v*v;peak=Math.max(peak,Math.abs(v));}result.push({stage,duration:buffer.duration,rms:Math.sqrt(energy/pcm.length),peak});}return result;})()`);
  assert.equal(clips.length,8);assert.ok(clips.every(c=>c.rms>.015&&c.peak<1.001),'all eight clips decode and render without silence/clipping');
  await evaluate(`window.simulator.audio.playDepartureRadio('clearance')`);
  assert.equal(await evaluate(`window.simulator.audio.departureRadio.status`),'playing');
  await evaluate(`window.simulator.demoDirector.stop()`);
  assert.equal(await evaluate(`window.simulator.audio.departureRadio.status`),'idle','cancel stops current call');
  assert.equal(errors.length,0);
  const report={liveRms,pausedOffset:paused.offset,clips,browserExceptions:errors.length,isolatedContextExceptions:isolatedErrors.length};
  fs.writeFileSync(path.join(dir,'audio-results.json'),JSON.stringify(report,null,2));
  console.log('PASS',JSON.stringify(report));
} finally {ws.close();await fetch(`${endpoint}/json/close/${target.id}`);}
