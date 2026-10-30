import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

// Run inside chrome-session --project flight3d. Reuse the project daemon;
// create/close only this script's own tab, never the shared browser.
if (process.env.CHROME_PROJECT !== 'flight3d') throw new Error('Run with chrome-session --project flight3d');
const port = process.env.CHROME_DEBUG_PORT ?? '9225';
const url = process.env.APP_URL ?? 'http://127.0.0.1:5195/flight3d/';
const artifacts = process.env.ARTIFACT_DIR ?? path.join(process.cwd(), 'review-artifacts/incheon-stage4');
const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map();
const errors = [];
let id = 0;
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && !message.params.entry.url?.endsWith('/favicon.ico')) errors.push(`${message.params.entry.text} ${message.params.entry.url ?? ''}`.trim());
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
const settle = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
async function click(selector) {
  const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await settle();
}
// A Fly that changes airport or aircraft rebuilds behind the loading card and resolves
// asynchronously (#322), so the checks that follow a click have to wait for that start.
async function waitApplied(tries = 240) {
  for (let i = 0; i < tries; i++) {
    if (await evaluate('!sim.startingFlight && document.getElementById("startup-overlay").hidden')) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('the pending flight start never settled');
}
async function capture(name) {
  await evaluate("document.querySelector('#pause-menu')?.style.setProperty('display','none','important');true");
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64'));
  await evaluate("document.querySelector('#pause-menu')?.style.removeProperty('display');true");
}
const field=JSON.parse(await readFile('src/config/incheonAirfield.json','utf8'));
const results={url,checks:[],flights:[]};
const snapshot=`({position:sim.position,crashed:sim.isCrashed,incident:sim.landingIncident,gear:sim.telemetry.gearDamage,speed:sim.telemetry.groundSpeedKnots,grounded:sim.telemetry.onGround,airport:sim.activeAirport})`;
async function check(name, expression, verify) {
  const value=await evaluate(expression);verify(value);results.checks.push({name,value});return value;
}
async function frozenSpawn(type) {
  await evaluate(`(()=>{sim.fly();sim.gameFlow.pause();sim.setPreset(${JSON.stringify(type)});sim.setTimeOfDay(12.5);sim.stepSimulation(.01);return true;})()`);
  await settle();
}
try {
  await mkdir(artifacts,{recursive:true});
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url});
  let ready=false;
  for(let i=0;i<150;i++) {ready=await evaluate('Boolean(window.sim?.gameFlow)');if(ready)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,'simulator ready');
  // Exercise the real failed-load path, then retry and cancel a pending selection.
  await send('Network.setBlockedURLs',{urls:['*scenery/incheon/patch.json*']});
  await check('failed load keeps the previous airport playable',`(async()=>{await sim.setAirport('incheon');return {airport:sim.activeAirport,loading:sim.airportLoading,disabled:document.querySelector('#btn-fly').disabled};})()`,v=>{assert.equal(v.airport,'coastal');assert.equal(v.loading,false);assert.equal(v.disabled,false);});
  results.expectedLoadErrors=errors.splice(0);
  await send('Network.setBlockedURLs',{urls:[]});
  await check('cancel pending selection',`(async()=>{const p=sim.setAirport('incheon');await sim.setAirport('coastal');await p;return {airport:sim.activeAirport,incheonVisible:sim.incheonAirport.group.visible};})()`,v=>{assert.equal(v.airport,'coastal');assert.equal(v.incheonVisible,false);});
  await evaluate("sim.gameFlow.enterLobby();true");
  await click('#lobby-airport-incheon');
  // Picking an airport is a wish, not a rebuild (#322): the live scene and the
  // persisted selection both stay on what was actually flown last.
  await check('airport pick stays pending',`({want:sim.lobby.airport,airport:sim.activeAirport,city:sim.incheonAirport.group.visible,terrain:sim.incheonAirport.terrain.mesh.visible,coastal:sim.airport.group.visible,lukla:sim.luklaAirport?.group.visible ?? false,starting:sim.startingFlight,stored:localStorage.getItem('flight3d.airport')})`,v=>{assert.equal(v.want,'incheon');assert.equal(v.airport,'coastal');assert.equal(v.city,false);assert.equal(v.terrain,false);assert.equal(v.coastal,true);assert.equal(v.lukla,false);assert.equal(v.starting,false);assert.notEqual(v.stored,'incheon');});
  await capture('lobby');
  await click('#btn-fly');
  await waitApplied();
  await check('Fly applies it: incheon scenery and manual scenarios only',`({airport:sim.activeAirport,city:sim.incheonAirport.group.visible,terrain:sim.incheonAirport.terrain.mesh.visible,coastal:sim.airport.group.visible,lukla:sim.luklaAirport?.group.visible ?? false,demo:getComputedStyle(document.querySelector('#lobby-preset-demo')).display,attribution:!document.querySelector('#incheon-attribution').hidden,stored:localStorage.getItem('flight3d.airport')})`,v=>{assert.equal(v.airport,'incheon');assert.ok(v.city&&v.terrain&&v.attribution);assert.equal(v.coastal,false);assert.equal(v.lukla,false);assert.equal(v.demo,'none');assert.equal(v.stored,'incheon');});
  await evaluate("sim.gameFlow.pause();sim.setPreset('runway');sim.setTimeOfDay(12.5);sim.cameraSystem.setMode(1,true);true");
  // The pilot laws run as an injected source string, so their import lines are
  // dropped: splice in the same declarations the app's modules would resolve.
  const lawDeps=(await readFile('src/physics/trimWheel.js','utf8')).replace(/^export /gm,'');
  const laws=(await readFile('src/director/PilotControlLaws.js','utf8')).replace(/^import .*;$/gm,'').replaceAll('export function','function');
  await evaluate(`(()=>{const THREE=window.THREE;${lawDeps}${laws};window.flightPilot={flyBank,flyVerticalPath};window.incheonField=${JSON.stringify(field)};return true;})()`);
  await check('10 second ground hold',`(()=>{sim.stepSimulation(10);return ${snapshot};})()`,v=>{assert.equal(v.crashed,false);assert.equal(v.grounded,true);assert.ok(v.speed<.5);assert.ok(Object.values(v.gear).every(s=>s==='normal'));});
  await evaluate('sim.stepSimulation(.01);true');await settle();await capture('runway');
  results.gpu=await evaluate(`(()=>{const gl=sim.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown';})()`);
  assert.doesNotMatch(results.gpu,/SwiftShader|llvmpipe|unknown/i);
  await check('navigation and camera environment',`({nd:sim.ndCanvas.airportId,cdu:sim.cduCanvas.activeWpt,camera:Math.abs(sim.cameraSystem.getTerrainHeight(sim.position.x,sim.position.z)-sim.currentTerrain.getHeight(sim.position.x,sim.position.z))<1e-9,demo:sim.demoDirector.start()})`,v=>{assert.equal(v.nd,'incheon');assert.equal(v.cdu,'RW15R');assert.equal(v.camera,true);assert.equal(v.demo,false);});
  await check('taxiway ground roll',`(()=>{sim.setPreset('runway');const a=[-1151.65,-4144.73],b=[-1561.8,-4727.6],length=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length;const x=a[0]+dx*100,z=a[1]+dz*100;sim.position.set(x,7+sim.gear.cgGroundHeightM,z);sim.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.atan2(dx,-dz));sim.linearVelocity.set(dx*8,0,dz*8);sim.stepSimulation(5);return {distance:Math.hypot(sim.position.x-x,sim.position.z-z),paved:sim.gear.contacts.every(c=>sim.currentAirport.isOnRunway(c.worldPos.x,c.worldPos.z)),state:${snapshot}};})()`,v=>{assert.ok(v.distance>10);assert.ok(v.paved);assert.equal(v.state.crashed,false);assert.equal(v.state.grounded,true);});
  // Native 120Hz physics, controls only; no state replacement after each spawn.
  for(const aircraft of ['B738','C172']) {
    await evaluate(`sim.setAircraft('${aircraft}');true`);
    await frozenSpawn('runway');
    const takeoff=await evaluate(`(()=>{let lifted=false,maxY=0;const rotate=sim.currentAircraftId==='C172'?55:133;for(let t=0;t<80;t+=.05){const tel=sim.telemetry;sim.controls.setVirtualInput('throttle',1);sim.controls.setVirtualInput('brakes',0);sim.controls.setVirtualInput('elevator',tel.iasKnots>rotate?Math.max(-.2,Math.min(.65,.12+(10-tel.pitchDeg)*.04-sim.angularVelocity.x*.8)):0);flightPilot.flyBank(sim,0,tel);sim.stepSimulation(.05);maxY=Math.max(maxY,sim.position.y);if(sim.position.y>50&&!tel.onGround){lifted=true;break;}if(sim.isCrashed)break;}return {lifted,maxY,state:${snapshot}};})()`);
    assert.ok(takeoff.lifted,`${aircraft} takeoff`);assert.equal(takeoff.state.crashed,false);
    await frozenSpawn('approach');
    if(aircraft==='B738'){await settle();await capture('approach');}
    // The preset has to fly itself from the lobby until the pilot's first input:
    // no control law, no state replacement, only what setPreset installed.
    const handsOff=await evaluate(`(()=>{const a=incheonField.approach,h=a.headingDeg*Math.PI/180,dx=Math.sin(h),dz=-Math.cos(h);const along=()=>(sim.position.x-a.threshold.x)*dx+(sim.position.z-a.threshold.z)*dz;const glide=()=>sim.position.y-sim.gear.cgGroundHeightM-7+along()*Math.tan(Math.PI/60);const qSc=sim.aero.qDyn*sim.aero.wingArea,weight=sim.aero.mass*9.80665,gamma=Math.asin(sim.linearVelocity.y/sim.linearVelocity.length());const spawnMoment=sim._aeroResult.momentBody.x/qSc,spawnLiftExcess=(sim._aeroResult.forceWorld.y-weight*Math.cos(gamma))/weight;const flapAtSpawn=sim.aero.currentFlapAngle,flapTarget=sim.aero.flapAngles[sim.aero.flapsIndex],start=sim.linearVelocity.length();let worstSink=0,worstPathErr=0,glideHigh=glide(),glideLow=glide(),t=0;while(t<60&&along()<0&&!sim.isCrashed){sim.stepSimulation(.05);t+=.05;const speed=Math.hypot(sim.linearVelocity.x,sim.linearVelocity.z),err=glide();glideHigh=Math.max(glideHigh,err);glideLow=Math.min(glideLow,err);worstPathErr=Math.max(worstPathErr,Math.abs(Math.atan2(sim.linearVelocity.y,speed)*180/Math.PI+3));worstSink=Math.max(worstSink,-sim.linearVelocity.y);}return {crashed:sim.isCrashed,reachedThreshold:along()>=0,time:+t.toFixed(1),wheel:sim.aero.pitchTrim,flapAtSpawn,flapTarget,spawnMoment,spawnLiftExcess,start,end:sim.linearVelocity.length(),worstSink,worstPathErr,glideHigh,glideLow};})()`);
    assert.equal(handsOff.flapAtSpawn,handsOff.flapTarget,`${aircraft} spawn flaps still in transit`);
    assert.ok(Math.abs(handsOff.spawnMoment)<.005,`${aircraft} spawn ships ${handsOff.spawnMoment} of qSc in pitch moment: not an equilibrium`);
    assert.ok(Math.abs(handsOff.spawnLiftExcess)<.03,`${aircraft} spawn lift misses the declared path by ${handsOff.spawnLiftExcess} of weight`);
    assert.ok(Math.abs(handsOff.wheel+5)>1e-9&&Math.abs(handsOff.wheel-12)>1e-9,`${aircraft} spawn trim ${handsOff.wheel}° sits on the wheel limit`);
    assert.equal(handsOff.crashed,false,`${aircraft} cannot fly its own approach spawn`);
    assert.ok(handsOff.reachedThreshold,`${aircraft} never reached the threshold unattended (${handsOff.time}s)`);
    assert.ok(handsOff.glideLow>-5,`${aircraft} fell ${-handsOff.glideLow} m below the published glideslope`);
    assert.ok(handsOff.glideHigh<30,`${aircraft} floated ${handsOff.glideHigh} m above the glideslope`);
    assert.ok(handsOff.worstPathErr<1.5,`${aircraft} path ${handsOff.worstPathErr}° off the published 3° glidepath`);
    assert.ok(handsOff.worstSink<5,`${aircraft} sank ${handsOff.worstSink} m/s`);
    assert.ok(Math.abs(handsOff.end-handsOff.start)<handsOff.start*.05,`${aircraft} approach speed moved ${handsOff.start}→${handsOff.end} m/s`);
    await frozenSpawn('approach');
    const landing=await evaluate(`(()=>{let touched=false,rolloutPitch=0,stopTime=0,touchdownSink=null,touchdownPosition=null;const a=incheonField.approach,h=a.headingDeg*Math.PI/180,dx=Math.sin(h),dz=-Math.cos(h);for(let t=0;t<150;t+=.05){const tel=sim.telemetry;const along=(sim.position.x-a.threshold.x)*dx+(sim.position.z-a.threshold.z)*dz;const cross=(sim.position.x-a.threshold.x)*(-dz)+(sim.position.z-a.threshold.z)*dx;const height=sim.position.y-7-sim.gear.cgGroundHeightM;const speed=sim.linearVelocity.x*dx+sim.linearVelocity.z*dz;flightPilot.flyBank(sim,0,tel);sim.controls.setVirtualInput('rudder',Math.max(-.2,Math.min(.2,-cross*.02)));if(sim.gear.contacts.slice(1).every(c=>c.isGrounded)&&!touched){touched=true;rolloutPitch=tel.pitchDeg;touchdownSink=sim.linearVelocity.y;touchdownPosition={...sim.position};}if(!touched){const path=-Math.tan(Math.PI/60)*speed-.3*(height-Math.tan(Math.PI/60)*(200-along));const flare=-.25*Math.max(0,height);flightPilot.flyVerticalPath(sim,Math.max(flare,path),sim.currentAircraftId==='C172'?64:142,tel,0,null,Math.max(0,Math.min(1,height/12)));}else{rolloutPitch=Math.max(0,rolloutPitch-.1);flightPilot.flyVerticalPath(sim,0,0,tel,0,rolloutPitch);const nose=sim.gear.contacts[0].isGrounded;sim.controls.setVirtualInput('brakes',nose?1:0);sim.aero.spoilers=nose?1:0;sim.controls.setVirtualInput('throttle',0);if(speed<.5)stopTime+=.05;}sim.stepSimulation(.05);if(sim.isCrashed||stopTime>=5)break;}return {touched,touchdownSink,touchdownPosition,stopTime,paved:sim.currentAirport.isOnRunway(sim.position.x,sim.position.z),state:${snapshot}};})()`);
    assert.ok(landing.touched,`${aircraft} touchdown`);assert.ok(landing.stopTime>=5,`${aircraft} stopped and held`);assert.ok(landing.paved);assert.equal(landing.state.crashed,false);assert.equal(landing.state.incident,false);assert.ok(Object.values(landing.state.gear).every(s=>s==='normal'));
    if(aircraft==='B738'){await settle();await capture('stopped');}
    results.flights.push({aircraft,takeoff,handsOff,landing});
  }
  await evaluate("sim.setAircraft('B738');true");await frozenSpawn('runway');
  await check('building footprint collision and reset',`(async()=>{const response=await fetch(new URL('scenery/incheon/patch.json',location.href)),patch=await response.json();const f=patch.features.find(f=>f.kind==='building'),p=f.parts[0][0],y=sim.currentTerrain.getHeight(...p)+2;const hit=sim.collisionDetector.checkAirportBuildings(sim.position,[{pos:new THREE.Vector3(p[0],y,p[1]),radius:1,desc:'acceptance probe'}]);sim.position.set(p[0],y,p[1]);sim.stepSimulation(.1);const crashed=sim.isCrashed;sim.setPreset('runway');sim.stepSimulation(10);return {hit:!!hit,crashed,reset:${snapshot}};})()`,v=>{assert.ok(v.hit);assert.ok(v.crashed);assert.equal(v.reset.crashed,false);assert.ok(v.reset.grounded);assert.ok(v.reset.speed<.5);});
  await check('switch away and back preserves environment ownership',`(async()=>{const counts=()=>({geometries:sim.renderer.info.memory.geometries,textures:sim.renderer.info.memory.textures});await sim.setAirport('lukla');const lukla=sim.currentTerrain===sim.luklaTerrain&&!sim.incheonAirport.group.visible;await sim.setAirport('coastal');const coastal=sim.currentTerrain===sim.terrain&&sim.foliage.group.visible;await sim.setAirport('incheon');sim.setPreset('runway');return {lukla,coastal,incheon:sim.currentTerrain===sim.incheonAirport.terrain,counts:counts(),state:${snapshot}};})()`,v=>{assert.ok(v.lukla&&v.coastal&&v.incheon);assert.equal(v.state.crashed,false);});
  await check('all camera modes remain finite above terrain',`(()=>{const out=[];for(let mode=0;mode<8;mode++){sim.cameraSystem.setMode(mode,true);sim.cameraSystem.update(.2,sim.aircraft.group,sim.telemetry,(x,z)=>sim.currentTerrain.getHeight(x,z));out.push({mode,finite:sim.camera.position.toArray().every(Number.isFinite),height:sim.camera.position.y,ground:sim.currentTerrain.getHeight(sim.camera.position.x,sim.camera.position.z)});}sim.cameraSystem.setMode(1,true);return out;})()`,v=>{assert.ok(v.every(p=>p.finite&&p.height>p.ground));});
  await evaluate("sim.cameraSystem.setMode(6,true);sim.cameraSystem.resetDroneOrbit(1.8,2300,1600);sim.cameraSystem.snapToTarget(sim.aircraft.group);sim.stepSimulation(.01);true");await settle();await capture('overview');
  await evaluate("sim.gameFlow.returnToLobby();true");await settle();
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await settle();
  await check('390px lobby layout and selectable airport',`(()=>{const b=document.querySelector('#lobby-airport-incheon').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,buttonVisible:b.width>0&&b.left>=0&&b.right<=innerWidth,briefing:document.querySelector('#lobby-briefing').textContent};})()`,v=>{assert.equal(v.overflow,false);assert.ok(v.buttonVisible);assert.match(v.briefing,/145/);});
  await capture('mobile');
  assert.deepEqual(errors,[],'unexpected browser runtime/resource errors');
  results.errors=errors;results.completedAt=new Date().toISOString();
  await writeFile(path.join(artifacts,'results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({checks:results.checks.length,flights:results.flights.map(f=>({aircraft:f.aircraft,touchdownSink:f.landing.touchdownSink,stopped:f.landing.stopTime})),gpu:results.gpu,artifacts}));
} catch(error) {
  await capture('failure');console.error('browser errors',errors);throw error;
} finally {
  ws.close();await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
}
