import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DepartureRadio } from '../src/audio/DepartureRadio.js';
import { DEPARTURE_RADIO } from '../src/config/departureRadio.js';
import { TUG, createDepartureTug, updateDepartureTug, disposeDepartureTug } from '../src/environment/DepartureTug.js';
import * as THREE from 'three';

function fixture(fetcher = async () => ({ok:true,arrayBuffer:async()=>new ArrayBuffer(2)})) {
  const sources = [];
  const ctx = {currentTime:0, decodeAudioData:async()=>({duration:10}), createBufferSource() {
    const source = { connect() {}, disconnect() {}, stop() {this.stopped=true;}, start(_,offset) {this.offset=offset;} };
    sources.push(source);return source;
  }};
  let muted=false;
  const radio=new DepartureRadio({context:()=>ctx,output:()=>({}),muted:()=>muted,fetcher});
  return {radio,ctx,sources,mute(){muted=true;radio.stop();}};
}

test('pause resumes at its offset and mute invalidates pending speech without replay', async()=>{
  const {radio,ctx,sources,mute}=fixture();
  await radio.play('gate');assert.equal(radio.status,'playing');
  ctx.currentTime=3;radio.setPaused(true);
  assert.equal(radio.status,'paused');assert.equal(sources[0].stopped,true);
  ctx.currentTime=20;radio.setPaused(false);
  assert.equal(sources[1].offset,3,'menu time is excluded');
  mute();assert.equal(radio.busy,false);assert.equal(sources[1].stopped,true);
  assert.equal(await radio.play('hold'),false);
});

test('late decode cannot resurrect a stopped or superseded radio call', async()=>{
  let finish;
  const {radio,sources}=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  const playing=radio.play('gate');assert.equal(radio.busy,true);
  radio.stop();finish({ok:true,arrayBuffer:async()=>new ArrayBuffer(2)});
  assert.equal(await playing,false);assert.equal(sources.length,0);assert.equal(radio.busy,false);
});

test('missing audio falls back without blocking the flight; successful calls release on end', async()=>{
  const failed=fixture(async()=>({ok:false,status:404}));
  assert.equal(await failed.radio.play('taxi'),false);
  assert.equal(failed.radio.busy,false);assert.match(failed.radio.lastError,/404/);
  const {radio,sources}=fixture();
  await radio.play('clearance');sources[0].onended();
  assert.equal(radio.status,'idle');assert.equal(radio.busy,false);
});

test('every scripted stage ships a non-silent PCM voice clip with matching transcript',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../public/audio/departure/manifest.json',import.meta.url)));
  assert.deepEqual(Object.keys(manifest),Object.keys(DEPARTURE_RADIO));
  for(const [stage,lines] of Object.entries(DEPARTURE_RADIO)) {
    assert.deepEqual(manifest[stage].lines.map(l=>[l.speaker,l.text]),lines);
    const wav=fs.readFileSync(new URL('../public/audio/departure/'+manifest[stage].file,import.meta.url));
    assert.equal(wav.toString('ascii',0,4),'RIFF');
    let offset=12,samples;
    while(offset+8<wav.length) {
      const size=wav.readUInt32LE(offset+4);
      if(wav.toString('ascii',offset,offset+4)==='data'){samples=wav.subarray(offset+8,offset+8+size);break;}
      offset+=8+size+(size%2);
    }
    assert.ok(samples?.length>22050,'substantial speech data');
    let energy=0;
    for(let i=0;i<samples.length;i+=2)energy+=(samples.readInt16LE(i)/32768)**2;
    assert.ok(Math.sqrt(energy/(samples.length/2))>.015,'audible signal');
  }
});

test('737 tractor wheels animate; fixed towbar stays on its dolly as tractor drives clear',()=>{
  const tug=createDepartureTug();
  const sim={position:new THREE.Vector3(0,10.5,0),quaternion:new THREE.Quaternion(),gear:{cgGroundHeightM:3.5}};
  updateDepartureTug(tug,sim,0,false,0);
  assert.equal(tug.position.z,TUG.noseGearZ-TUG.hitchZ-TUG.towbarLength);
  sim.position.z+=2;updateDepartureTug(tug,sim,1,false,1);
  const state=tug.userData.animation;
  assert.ok(Math.abs(state.wheels[0].rotation.x)>.01);
  const wheelError=state.wheels[0].rotation.x+2/TUG.wheelRadius;
  assert.ok(Math.abs(Math.atan2(Math.sin(wheelError),Math.cos(wheelError)))<1e-8,'reverse push rolls the wheels backward');
  const position=tug.position.clone();
  for(let t=0;t<30;t+=.1)updateDepartureTug(tug,sim,.1,true,t);
  assert.equal(state.pinReleased,true);
  assert.equal(state.towbar.visible,true,'rigid towbar is carried on its dolly, not shrunk away');
  assert.equal(state.towbar.scale.z,1);
  assert.ok(tug.position.distanceTo(position)>12,'vehicle departs instead of disappearing');
  disposeDepartureTug(tug);
});

test('parallel preload and playback share one fetch per stage',async()=>{
  let fetches=0;
  const {radio}=fixture(async()=>{fetches++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(2)};});
  await Promise.all([radio.preload(),radio.play('gate')]);
  assert.equal(fetches,8);
  await radio.play('gate');assert.equal(fetches,8);
  radio.stop();
});
