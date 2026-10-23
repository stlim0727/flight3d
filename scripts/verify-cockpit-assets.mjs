// Start Vite and Chrome with CDP first. See docs/development/cockpit-assets.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus, totalmem } from 'node:os';

const dir = path.resolve(process.env.ARTIFACT_DIR || 'review-artifacts/cockpit-assets');
const scratch = '.tmp/cockpit-assets';
const baseline = process.env.BASELINE_REF || 'caab0a7';
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(scratch, { recursive: true });
for (const file of ['Cockpit', 'GltfCockpitControls']) {
  let source = execFileSync('git', ['show', `${baseline}:src/aircraft/${file}.js`], { encoding: 'utf8' });
  source = source.replaceAll("'./GltfCockpitControls.js'", "'./GltfCockpitControls-before.js'")
    .replace(/'\.\/(?!GltfCockpitControls-before)([^']+)'/g, "'/src/aircraft/$1'");
  fs.writeFileSync(`${scratch}/${file}-before.js`, source);
}
const names = ['PFD', 'ND', 'EICAS', 'MCP', 'ISFD', 'CDU'];
fs.writeFileSync(`${scratch}/review.html`, `<!doctype html><html><body style="margin:0"><script type="module">
import * as T from 'three';
import { Cockpit as Before } from './Cockpit-before.js';
import { Cockpit as After } from '/src/aircraft/Cockpit.js';
${names.map(n => `import { ${n}Canvas } from '/src/aircraft/${n}Canvas.js';`).join('\n')}
window.modules = {T,Before,After,canvases:[${names.map(n => `${n}Canvas`).join(',')}]};
</script></body></html>`);
const pages = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9499}/json`)).json();
const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map(), exceptions = [];
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
  pending.get(m.id)?.(m); pending.delete(m.id);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timeout`)); }, 60000);
  pending.set(id, m => { clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
  ws.send(JSON.stringify({id,method,params}));
});
const evaluate = async (fn, arg) => {
  const r = await call('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(arg) ?? ''})`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async name => fs.writeFileSync(path.join(dir, `${name}.png`),
  Buffer.from((await call('Page.captureScreenshot', {format:'png'})).data, 'base64'));
const results = { baseline, platform: process.platform, cpu:cpus()[0]?.model, ramBytes:totalmem(), resolution:[1440,1000], scenarios:[] };
try {
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate', {url:`${process.env.SIM_URL || 'http://127.0.0.1:5209'}/${scratch}/review.html`});
  for (let i=0; i<100; i++) {
    if (await evaluate(() => Boolean(window.modules))) break;
    await new Promise(r => setTimeout(r,100));
  }
  assert.ok(await evaluate(() => Boolean(window.modules)), 'Review modules loaded');
  for (const variant of ['before','after','lite']) {
    await call('Network.setBlockedURLs', {urls:variant === 'lite' ? ['*b737-cockpit-medium.glb'] : []});
    const report = await evaluate(async variant => {
      const {T,Before,After,canvases:Types} = window.modules;
      document.body.replaceChildren();
      const canvases = Types.map((Type,i) => new Type(...(i===3 ? [1024,128] : i===4 ? [256,256] : [512,512])));
      const cockpit = new (variant === 'before' ? Before : After)(...canvases);
      for (let i=0; i<300 && !cockpit.gltfCockpitLoaded && !cockpit.cockpitModelFailed; i++) await new Promise(r=>setTimeout(r,50));
      if (!cockpit.gltfCockpitLoaded) throw Error('Cockpit GLB failed to load');
      const scene=new T.Scene(); scene.background=new T.Color(0x7ca8cf);
      scene.add(cockpit.group, new T.HemisphereLight(0xffffff,0x8899aa,2));
      const sun=new T.DirectionalLight(0xffffff,2); sun.position.set(-3,5,-14);scene.add(sun);
      const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(1440,1000);
      document.body.append(renderer.domElement);
      const camera=new T.PerspectiveCamera(58,1.44,.08,100);
      const state={iasKnots:150,altitudeFt:5000,headingDeg:90,gearState:1,flapIndex:0,pitchTrim:0};
      const draw=state=>{
        cockpit.updateControls(state);
        canvases.forEach((c,i)=>{if(i===5)c.setAirport(state.iasKnots===150?'coastal':'lukla'); c.updateData(state);c.render();});
        renderer.render(scene,camera);
      };
      window.review={T,cockpit,scene,renderer,camera,canvases,state,draw,sun};
      // Match CameraSystem's desktop captain eye, near plane and resting pitch.
      camera.position.set(-.39,.85,-12.35);
      camera.lookAt(-.39,.85-Math.sin(.25),-12.35-Math.cos(.25));draw(state);
      const controls=cockpit.gltfAirframeControls;
      const parts=controls ? [controls.gear,controls.flaps,controls.spoilers,...controls.trimWheels] : [];
      const counts=parts.map(p=>{let triangles=0;p.traverse(n=>{if(n.isMesh)triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;});return {name:p.name,triangles};});
      const snapshot=()=>parts.map(p=>[...p.position.toArray(),p.rotation.x]);
      const neutral=snapshot();
      const active={...state,gearState:0,flapIndex:6,spoilers:1,pitchTrim:6,throttle:1,aileron:1,elevator:1};
      cockpit.updateControls(active);const changed=snapshot();
      for(let i=0;i<100;i++)cockpit.updateControls(active);
      const stable=JSON.stringify(changed)===JSON.stringify(snapshot());
      cockpit.updateControls({...state,pitchTrim:-5});const reversed=controls?.trimWheels.every(p=>p.rotation.x<0);
      cockpit.updateControls(state);const restored=snapshot().every((r,i)=>r.every((v,k)=>Math.abs(v-neutral[i][k])<1e-10));
      const versions=canvases.map(c=>c.texture.version);
      const pixels=canvases.map(c=>c.canvas.toDataURL());
      draw({...active,iasKnots:220,altitudeFt:12000,pitchDeg:10,rollDeg:20,headingDeg:180,selectedSpeed:240,selectedAltitude:15000});
      const live=canvases.map((c,i)=>c.texture.version>versions[i]&&c.canvas.toDataURL()!==pixels[i]);
      const displayMaps=[];cockpit.gltfDisplays.traverse(n=>{if(n.isMesh)displayMaps.push(n.material.map.uuid);});
      const mapped=canvases.every(c=>displayMaps.includes(c.texture.uuid));
      const gl=renderer.getContext(), debug=gl.getExtension('WEBGL_debug_renderer_info');
      const gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
      const browser=navigator.userAgent;
      const samples=[];
      for(let i=0;i<35;i++){const start=performance.now();draw(active);gl.finish();if(i>=5)samples.push(performance.now()-start);}
      samples.sort((a,b)=>a-b);
      const memory={...renderer.info.memory};const drawCalls=renderer.info.render.calls;
      // RGB/RGBA allocations and driver overhead vary; this is an RGBA8+mipmap estimate.
      const textureBytes=canvases.reduce((sum,c)=>sum+c.width*c.height*4*(c.texture.generateMipmaps?4/3:1),0);
      draw(state);
      return {variant,gpu,browser,counts,stable,restored,reversed,live,mapped,drawCalls,memory,textureBytesEstimate:textureBytes,
        frameMs:{p50:samples[15],p95:samples[28]},different:JSON.stringify(neutral)!==JSON.stringify(changed)};
    }, variant);
    assert.ok(report.mapped && report.live.every(Boolean), `${variant}: six live CanvasTextures remain mapped: ${JSON.stringify(report)}`);
    if (variant !== 'before') {
      assert.equal(report.counts.length,5);
      assert.ok(report.counts.every(p=>p.triangles>4), `${variant}: five nonempty GLB controls`);
      assert.ok(report.stable && report.restored && report.reversed && report.different, `${variant}: hold/reverse/reset`);
    }
    for (const view of ['forward','instruments','pedestal','night']) {
      await evaluate(view=>{
        const {camera,draw,state,sun,cockpit}=window.review;
        if(view==='forward'||view==='night'){camera.fov=58;camera.position.set(-.39,.85,-12.35);camera.lookAt(-.39,.85-Math.sin(.25),-12.35-Math.cos(.25));}
        if(view==='instruments'){camera.fov=70;camera.position.set(0,.75,-12.40);camera.lookAt(0,.61,-12.89);cockpit.toggleYokes();}
        if(view==='pedestal'){camera.position.set(-.17,.82,-12.40);camera.lookAt(0,.44,-12.70);}
        if(view==='night'){sun.intensity=0;cockpit.syncDaylight(0);}
        camera.updateProjectionMatrix();
        draw({...state,gearState:0,flapIndex:6,spoilers:1,pitchTrim:6,throttle:.7});
      }, view);
      await shot(`${variant}-${view}`);
    }
    results.scenarios.push(report);
    await evaluate(()=>{const {renderer,scene}=window.review;const geometries=new Set(),materials=new Set();scene.traverse(n=>{if(n.isMesh){geometries.add(n.geometry);(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>materials.add(m));}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer.dispose();renderer.forceContextLoss();});
  }
  assert.deepEqual(exceptions,[], 'No page exceptions');
  results.pageErrors=exceptions;
  results.assets=['medium','draco'].map(name=>{const bytes=fs.readFileSync(`public/models/b737-cockpit-${name}.glb`);return {name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
} finally { ws.close(); }
