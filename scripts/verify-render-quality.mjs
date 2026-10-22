import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir=process.env.ARTIFACT_DIR || 'review-artifacts/issue97';
fs.mkdirSync(dir,{recursive:true});
const pages=await(await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9497}/json`)).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map();
ws.addEventListener('message',({data})=>{const m=JSON.parse(data);pending.get(m.id)?.(m);pending.delete(m.id)});
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(Error(method)),60000);pending.set(id,m=>{clearTimeout(timer);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result)});ws.send(JSON.stringify({id,method,params}))});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
const wait=async()=>{await new Promise(r=>setTimeout(r,1000));for(let i=0;i<120;i++){if(await ev('!!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded && !!window.simulator?.airport?.buildings'))return;await new Promise(r=>setTimeout(r,500))}throw Error('Models not ready')};
await call('Page.navigate',{url:process.env.APP_URL || 'http://127.0.0.1:5197/'});await wait();
const results=await ev(`(async()=>{
 const s=window.simulator;s.demoDirector.stop();s.gameFlow.enterFlight();s.setAirport('coastal');s.setPreset('approach');s.stepSimulation(0);
 const select=document.getElementById('render-quality');const rows=[];
 for(const quality of ['high','balanced','performance','high']){select.value=quality;select.dispatchEvent(new Event('change'));s.renderer.render(s.scene,s.camera);rows.push({quality:s.renderQuality,terrain:s.terrain.getQuality(),dpr:s.renderer.getPixelRatio(),stored:localStorage.getItem('flight3d.renderQuality')})}
 const programs=[];const phases=[];
 // Advance the rabbit at every station and across wraps, using the real update.
 const nativeNow=performance.now.bind(performance);performance.now=()=>window.testTime;
 try{for(let i=0;i<45;i++){window.testTime=((i+.5)/15/1.6)*1000;s.airport.update(0,s.position);s.renderer.render(s.scene,s.camera);programs.push(s.renderer.info.programs.length);phases.push(s.airport.approachLight.position.x)}}finally{performance.now=nativeNow}
 select.value='performance';select.dispatchEvent(new Event('change'));
 return {rows,programs,phases,glError:s.renderer.getContext().getError(),shaderErrors:s.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length};
})()`);
assert.deepEqual(results.rows.map(r=>r.terrain),['high','low','low','high']);
assert.deepEqual(results.rows.map(r=>r.stored),['high','balanced','performance','high']);
assert.equal(new Set(results.programs).size,1,'no program growth during rabbit flashes');
assert.equal(new Set(results.phases).size,15);
assert.equal(results.glError,0);assert.equal(results.shaderErrors,0);
await call('Page.reload',{ignoreCache:true});await wait();
results.reloaded=await ev('({quality:sim.renderQuality,terrain:sim.terrain.getQuality(),dpr:sim.renderer.getPixelRatio(),selected:document.getElementById("render-quality").value})');
assert.equal(results.reloaded.quality,'performance');assert.equal(results.reloaded.selected,'performance');assert.equal(results.reloaded.dpr,1);
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await ev(`sim.handleResize();document.querySelector('.mobile-menu-toggle')?.click();sim.renderer.render(sim.scene,sim.camera)`);
const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${dir}/mobile-quality.png`,Buffer.from(shot.data,'base64'));
fs.writeFileSync(`${dir}/quality-controls.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));ws.close();
