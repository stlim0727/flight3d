import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const competingGpu = () => process.env.EXCLUSIVE_GPU === '1' && execFileSync('ps', ['-eo', 'args'], {encoding:'utf8'}).split('\n').filter(line => line.includes('--type=gpu-process') && line.includes('--use-angle=vulkan')).length > 1;
const waitForGpu = async () => {
  while (competingGpu()) {
    console.log('Waiting for exclusive Vulkan GPU access...');
    await new Promise(r => setTimeout(r, 10000));
  }
};
const dir = process.env.ARTIFACT_DIR || 'review-artifacts/issue97';
fs.mkdirSync(dir, { recursive: true });
const pages = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9497}/json`)).json();
const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', ({data}) => { const m = JSON.parse(data); pending.get(m.id)?.(m); pending.delete(m.id); });
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timeout = setTimeout(() => reject(Error(`Timeout: ${method}`)), 180000);
  pending.set(id, m => { clearTimeout(timeout); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
  ws.send(JSON.stringify({id, method, params}));
});
const ev = async expression => {
  const r = await call('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', {width:780, height:437, deviceScaleFactor:2, mobile:false});
await call('Page.addScriptToEvaluateOnNewDocument', {source:`window.__nativeRAF=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;let seed=12345;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);`});
const results = [];
// Reversed second pass reduces order/thermal bias; baseline is an untouched checkout.
for (let repeat=0;repeat<2;repeat++) {
  const variants = ['baseline','high','balanced','performance'];
  if(repeat) variants.reverse();
  for (const variant of variants) {
    await waitForGpu();
    await call('Page.navigate', {url:variant==='baseline' ? (process.env.BASELINE_URL || 'http://127.0.0.1:5198/') : (process.env.APP_URL || 'http://127.0.0.1:5197/')});
    await new Promise(r=>setTimeout(r,1500));
    let ready=false;
    for(let i=0;i<120;i++) {
      ready=await ev('!!window.simulator?.aircraft?.modelLoaded && !!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded && !!window.simulator?.airport?.buildings');
      if(ready) break;
      await new Promise(r=>setTimeout(r,500));
    }
    assert.ok(ready,'all models loaded');
    await ev(`(async()=>{const s=window.simulator;await s.aircraft.cockpit.shaderWarmup;s.demoDirector.stop();s.setAirport('coastal');${variant==='baseline' ? '' : `s.setRenderQuality('${variant}');`}return true;})()`);
    // At DPR 1 isolates lighting/terrain. DPR 2 compares resolution presets.
    for (const deviceDpr of [1,2]) {
      await call('Emulation.setDeviceMetricsOverride', {width:780,height:437,deviceScaleFactor:deviceDpr,mobile:false});
      for (const time of [12]) for(const view of ['runway']) {
        let row;
        do {
        await waitForGpu();
        row=await ev(`(async()=>{
          const s=window.simulator,r=s.renderer;
          ${variant==='baseline' ? 'r.setPixelRatio(Math.min(devicePixelRatio,2));' : `s.setRenderQuality('${variant}');`}
          s.setPreset('${view}');s.cameraSystem.setMode(0,true);s.stepSimulation(0);
          s.sky.setTimeOfDay(${time},s.position,s.camera.position);s.foliage.setTimeOfDay(${time});s.water.syncWithAtmosphere(s.sky);
          const intervals=[];let previous=null,frame=0;
          await new Promise(resolve=>{const run=t=>{s.animate();if(frame>=12)intervals.push(t-previous);previous=t;if(++frame<48)window.__nativeRAF(run);else resolve()};window.__nativeRAF(run)});
          const g=r.getContext(),ext=g.getExtension('WEBGL_debug_renderer_info');
          const sorted=[...intervals].sort((a,b)=>a-b);
          let lights=0;s.airport.group.traverseVisible(o=>{if(o.isPointLight)lights++});
          return {fps:1000*intervals.length/intervals.reduce((a,b)=>a+b,0),medianMs:sorted[18],p95Ms:sorted[34],intervals,lights,programs:r.info.programs.length,calls:r.info.render.calls,triangles:r.info.render.triangles,dpr:r.getPixelRatio(),buffer:[r.domElement.width,r.domElement.height],terrain:s.terrain.getQuality(),gpu:g.getParameter(ext.UNMASKED_RENDERER_WEBGL),shaderErrors:r.info.programs.filter(p=>p.diagnostics?.runnable===false).length};
        })()`);
        } while (competingGpu()); // Discard a sample if another GPU task started.
        Object.assign(row,{variant,repeat,deviceDpr,time,view});
        assert.equal(row.shaderErrors,0);
        assert.equal(row.dpr,Math.min(deviceDpr, {baseline:2,high:2,balanced:1.5,performance:1}[variant]));
        assert.equal(row.lights, variant==='baseline'?20:6);
        results.push(row);
        console.log(JSON.stringify({...row,intervals:undefined}));
        fs.writeFileSync(path.join(dir,'performance.json'),JSON.stringify(results,null,2));
        if(repeat===0 && deviceDpr===2) {
          for (const hour of [12,0]) for (const preset of ['runway','approach','cruise']) {
            await ev(`(()=>{const s=window.simulator;s.setPreset('${preset}');s.cameraSystem.setMode(0,true);s.stepSimulation(0);s.sky.setTimeOfDay(${hour},s.position,s.camera.position);s.foliage.setTimeOfDay(${hour});s.water.syncWithAtmosphere(s.sky);s.renderer.render(s.scene,s.camera);})()`);
            const shot=await call('Page.captureScreenshot',{format:'png'});
            fs.writeFileSync(path.join(dir,`${variant}-${preset}-${hour}.png`),Buffer.from(shot.data,'base64'));
          }
        }
      }
    }
  }
}
ws.close();
