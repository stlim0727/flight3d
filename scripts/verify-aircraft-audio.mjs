import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Reuse Chrome: chrome-session --project flight3d node scripts/verify-aircraft-audio.mjs
const output = path.resolve(process.env.ARTIFACT_DIR || '.cache/aircraft-audio');
await fs.mkdir(output, { recursive: true }); await fs.mkdir('.tmp/audio-review', { recursive: true });
const baseline = execFileSync('git', ['show', 'origin/main:src/audio/FlightAudio.js'], { encoding: 'utf8' }).replace("'../i18n/index.js'", "'/src/i18n/index.js'");
await fs.writeFile('.tmp/audio-review/FlightAudio-before.js', baseline);
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(process.env.APP_URL || 'http://127.0.0.1:5188/')}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [], clips = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => reject(Error(method)), 60000);
  pending.set(id, message => { clearTimeout(timer); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (fn, arg) => {
  const response = await call('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(arg)})`, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
try {
  await call('Runtime.enable'); await call('Page.enable');
  for (let i = 0; i < 120; i++) {
    if (await evaluate(() => Boolean(window.simulator?.lobbyScreen))) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(await evaluate(() => Boolean(window.simulator?.lobbyScreen)), 'simulator ready');
  await evaluate(() => {
    const sim = window.simulator;
    sim.demoDirector.stop(); sim.gameFlow.enterFlight(); sim.gameFlow.isPhysicsFrozen = () => true;
    // The menu records the wish only (#322), so this audio harness applies it itself.
    document.getElementById('lobby-aircraft-c172').click(); sim.setAircraft('C172'); sim.setPreset('runway');
  });
  // Two real pointer clicks cover mute/unmute plus AudioContext's gesture gate.
  const button = await evaluate(() => { const r = document.getElementById('btn-mute').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
  for (let i = 0; i < 2; i++) {
    await call('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...button});
    await call('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...button});
  }
  await new Promise(resolve => setTimeout(resolve, 700));
  const live = await evaluate(() => {
    const sim = window.simulator; window.__originalAudioContext = sim.audio.ctx;
    return {aircraft:sim.currentAircraftId,profile:sim.audio.profile.engineType,state:sim.audio.ctx?.state,
      jet:sim.audio.turbineGain?.gain.value,pack:sim.audio.packGain?.gain.value,piston:sim.audio.pistonGain?.gain.value};
  });
  assert.equal(live.aircraft,'C172');assert.equal(live.profile,'piston');assert.equal(live.state,'running');
  assert.equal(live.jet,0);assert.equal(live.pack,0);assert.ok(live.piston>0);
  for (const aircraft of ['B738','C172','B738','C172']) {
    const switched = await evaluate(aircraft => {
      const sim = window.simulator; document.getElementById(aircraft==='C172'?'lobby-aircraft-c172':'lobby-aircraft-b738').click();
      sim.setAircraft(aircraft);
      sim.setPreset('runway'); return {sameContext:sim.audio.ctx===window.__originalAudioContext,piston:sim.audio.isPiston};
    }, aircraft);
    assert.ok(switched.sameContext);assert.equal(switched.piston,aircraft==='C172');
  }
  await evaluate(() => {const sim=window.simulator;sim.engines.setEngineFailure(0,true);sim.stepSimulation(3);});
  await new Promise(resolve=>setTimeout(resolve,900));
  const stopped = await evaluate(() => { const a=window.simulator.audio; return {piston:a.pistonGain.gain.value,prop:a.propGain.gain.value,jet:a.turbineGain.gain.value}; });
  assert.ok(stopped.piston<0.001&&stopped.prop<0.001&&stopped.jet===0,'failed stationary engine settles to silence');

  for (const [name, before, n1, failure] of [
    ['before-idle',true,25,false],['cessna-idle',false,25,false],
    ['before-full-power',true,100,false],['cessna-full-power',false,100,false],['cessna-failure',false,100,true]
  ]) {
    const result = await evaluate(async ({before,n1,failure}) => {
      const {FlightAudio: After}=await import('/src/audio/FlightAudio.js');
      const {FlightAudio: Before}=await import('/.tmp/audio-review/FlightAudio-before.js');
      const {CESSNA_172}=await import('/src/config/aircraftConfigs.js');
      const rate=48000,ctx=new OfflineAudioContext(1,rate*3,rate),a=new (before?Before:After)();
      if(!before) { a.loadAircraftConfig(CESSNA_172);a.init(ctx); }
      else { // Adapt only the constructor for the historical sound graph.
        const Audio=window.AudioContext; window.AudioContext=function(){return ctx;};
        try{a.init();}finally{window.AudioContext=Audio;}
      }
      if(!a.isInitialized) throw Error('Web Audio graph initialization failed');
      ctx.onstatechange=null;
      const state={engine1:{n1,failed:false},iasKnots:0,groundSpeedKnots:0,onGround:true};
      a.update(1/60,state,false);
      let suspension;
      if(failure) suspension=ctx.suspend(1).then(()=>{a.update(1/60,{...state,engine1:{n1:9,failed:true}},false);return ctx.resume();});
      const buffer=await ctx.startRendering();if(suspension)await suspension;
      const samples=buffer.getChannelData(0);
      const rms=(start,end)=>Math.sqrt(samples.slice(start*rate,end*rate).reduce((sum,x)=>sum+x*x,0)/((end-start)*rate));
      const energy=f=>{let r=0,i=0;for(let n=rate;n<2*rate;n++){const phase=2*Math.PI*f*n/rate;r+=samples[n]*Math.cos(phase);i+=samples[n]*Math.sin(phase);}return (r*r+i*i)/(rate*rate);};
      const peak=Math.max(...samples.slice(0,rate).map(Math.abs));
      const data=new ArrayBuffer(44+samples.length*2),view=new DataView(data);
      const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
      text(0,'RIFF');view.setUint32(4,data.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);
      view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true);
      for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
      let binary='';const bytes=new Uint8Array(data);for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      return {wav:btoa(binary),peak,rms:rms(0.5,0.9),tailRms:rms(2.5,3),
        firing23Hz:energy(700/30),firing90Hz:energy(90),jet1800Hz:energy(1800)};
    }, {before,n1,failure});
    await fs.writeFile(path.join(output,`${name}.wav`),Buffer.from(result.wav,'base64'));delete result.wav;
    assert.ok(result.peak<1&&result.rms>0.001,'audible finite signal without clipping');
    if(failure)assert.ok(result.tailRms<0.0001,'failure recording becomes silent');
    clips.push({name,...result});console.log(name,JSON.stringify(result));
  }
  const idle=clips.find(c=>c.name==='cessna-idle'),full=clips.find(c=>c.name==='cessna-full-power');
  assert.ok(idle.firing23Hz>idle.firing90Hz*10,'idle firing pulse present');
  assert.ok(full.firing90Hz>full.jet1800Hz*20,'propeller harmonics dominate turbine whistle band');
  assert.equal(errors.length,0,'no browser exceptions');
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({live,stopped,clips,errors,note:'Real browser OfflineAudioContext rendering and native mute/unmute clicks. Waveform checks do not replace human listening.'},null,2));
  console.log('PASS: aircraft switching, gesture unlock, idle/full-power/failure recordings');
} finally { ws.close();await fetch(`${endpoint}/json/close/${target.id}`); }
