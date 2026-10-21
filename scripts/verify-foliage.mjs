// Start Vite on 5173 first. CHROME_PATH may point to a Windows Chrome executable.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir, platform, cpus } from 'node:os';
import assert from 'node:assert/strict';

const directory = resolve(process.env.ARTIFACT_DIR || '.tmp/foliage');
await mkdir(directory, { recursive: true });
const baseline = process.env.BASELINE_REF || '184ec96';
const source = execFileSync('git', ['show', `${baseline}:src/environment/FoliageAndCities.js`], { encoding: 'utf8' });
await mkdir('.tmp/foliage', { recursive: true });
await writeFile('.tmp/foliage/Foliage-before.js', source.replaceAll("'./", "'/src/environment/"));
await writeFile('.tmp/foliage/review.html', `<!doctype html><html><head><title>Foliage acceptance</title></head><body style="margin:0">
<script type="module">
import * as T from 'three';
import { FoliageAndCities as Before } from './Foliage-before.js';
import { FoliageAndCities as After } from '/src/environment/FoliageAndCities.js';
window.reviewModules = { T, Before, After };
</script></body></html>`);
const profile = await mkdtemp(join(tmpdir(), 'flight3d-foliage-'));
const port = Number(process.env.CDP_PORT || 9468);
const chrome = spawn(process.env.CHROME_PATH || 'google-chrome-stable', [
  '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--window-size=1440,1000', '--no-first-run', '--no-default-browser-check',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'
], { stdio: 'ignore', windowsHide: true });
let socket, seq = 0;
const pending = new Map(), exceptions = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timeout = setTimeout(() => { pending.delete(id); reject(Error(`${method} timeout`)); }, 60000);
  pending.set(id, m => { clearTimeout(timeout); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (fn, argument) => {
  const result = await send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(argument) ?? ''})`, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
try {
  chrome.on('error', error => console.error(error));
  let target;
  for (let i = 0; i < 100; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p => p.type === 'page'); } catch { /* starting */ }
    if (target) break; await delay(100);
  }
  assert.ok(target, 'Chrome CDP target required');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, reject) => { socket.addEventListener('open', r); socket.addEventListener('error', reject); });
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const origin = process.env.SIM_URL || 'http://127.0.0.1:5173';
  await send('Page.navigate', { url: `${origin}/.tmp/foliage/review.html` });
  let ready = false;
  for (let i=0;i<150;i++) {
    try { ready = await evaluate(() => Boolean(window.reviewModules)); } catch { /* Vite optimizer reload */ }
    if (ready) break;
    await delay(200);
  }
  assert.ok(ready,'Review modules must finish loading');
  const setup = await evaluate(async () => {
    const { T, Before, After } = window.reviewModules;
    const seeded = () => { let s = 10; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };
    const terrain = { getHeight: () => 12 };
    const before = new Before(terrain, seeded()), after = new After(terrain, seeded());
    const beforeTrees = before.group.children.slice(0, 2);
    for (const m of [...before.group.children]) if (!beforeTrees.includes(m)) before.group.remove(m);
    for (const m of [...after.group.children]) if (!m.name.startsWith('tree-')) after.group.remove(m);
    const positionsMatch = before.treeData.every((t, i) => ['x','y','z'].every(k => t[k] === after.treeData[i][k]));
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1440, 1000); renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
    document.body.appendChild(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0xa4bfd0);
    scene.add(new T.HemisphereLight(0xeaf4ff, 0x6d6846, 2));
    const sun = new T.DirectionalLight(0xffebca, 3); sun.position.set(-60, 100, 40);
    sun.castShadow = true; sun.shadow.mapSize.set(1024,1024);
    Object.assign(sun.shadow.camera, { left:-70, right:70, top:70, bottom:-70, near:1, far:300 });
    scene.add(sun, sun.target);
    const ground = new T.Mesh(new T.PlaneGeometry(25000,25000), new T.MeshStandardMaterial({ color:0x87965a, roughness:1 }));
    ground.rotation.x = -Math.PI/2; ground.position.y = 12; ground.receiveShadow = true; scene.add(ground);
    scene.add(before.group, after.group);
    const showcase = {};
    for (const [version, model] of Object.entries({ before, after })) {
      const group = new T.Group();
      if (version === 'before') {
        for (const original of beforeTrees) {
          const mesh = new T.InstancedMesh(original.geometry, original.material, 3);
          for (let i=0;i<3;i++) mesh.setMatrixAt(i,new T.Matrix4().makeTranslation((i-1)*13,12,0));
          group.add(mesh);
        }
      } else {
        for (let i=0;i<3;i++) {
          const mesh = new T.InstancedMesh(model.treeBatches[i].meshes[0].geometry, model.treeBatches[i].meshes[0].material,1);
          mesh.setMatrixAt(0,new T.Matrix4().makeTranslation((i-1)*13,12,0)); mesh.castShadow=true; mesh.receiveShadow=true;
          group.add(mesh);
        }
      }
      scene.add(group); showcase[version]=group;
    }
    window.review = { T, before, after, renderer, scene, sun, showcase, camera: new T.PerspectiveCamera(48,1.44,0.1,30000) };
    const gl=renderer.getContext(), debug=gl.getExtension('WEBGL_debug_renderer_info');
    return { positionsMatch, trees: after.treeData.length, userAgent:navigator.userAgent,
      gpu:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      textureBytes:0, assetRequests:0 };
  });
  assert.equal(setup.positionsMatch,true,'Identical seeded placement');
  assert.equal(setup.trees,3500);
  const metrics=[];
  for (const view of ['species','forest','approach','aerial']) {
    for (const version of ['before','after']) {
      const result=await evaluate(async ({view,version}) => {
        const {before,after,renderer,scene,camera,showcase,sun}=review;
        const focus=after.treeInstances[0].position;
        const species=view==='species';
        before.group.visible=!species && version==='before'; after.group.visible=!species && version==='after';
        for(const key of ['before','after']) showcase[key].visible=species && key===version;
        const target = species ? [0,17,0] : view==='forest' ? [focus.x,focus.y+6,focus.z] : [0,12,0];
        const position=species ? [29,28,49] : view==='forest' ? [focus.x+38,focus.y+18,focus.z+48] : view==='approach' ? [3300,130,0] : [0,2800,1800];
        camera.position.set(...position); camera.lookAt(...target); camera.updateMatrixWorld();
        sun.position.set(target[0]-60,target[1]+100,target[2]+40);sun.target.position.set(...target);
        if(version==='after' && !species) after.update(camera.position);
        const gl=renderer.getContext();
        const finish = async () => {
          const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0); gl.flush();
          for(let i=0;i<10000;i++) {
            const status=gl.clientWaitSync(sync,0,0);
            if(status===gl.ALREADY_SIGNALED || status===gl.CONDITION_SATISFIED) { gl.deleteSync(sync); return; }
            if(status===gl.WAIT_FAILED) throw Error('GPU fence failed');
            await new Promise(r=>setTimeout(r,1));
          }
          throw Error('GPU fence timeout');
        };
        for(let i=0;i<5;i++){renderer.render(scene,camera);await finish();}
        const samples=[];
        for(let i=0;i<20;i++) {
          const start=performance.now();renderer.render(scene,camera);await finish();samples.push(performance.now()-start);
        }
        samples.sort((a,b)=>a-b);
        let updateMs=0;
        if(version==='after' && !species) {
          const start=performance.now();after.lastTreeCamera.set(Infinity,Infinity,Infinity);after.update(camera.position);updateMs=performance.now()-start;
        }
        return { calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frameMsMedian:samples[10],frameMsP95:samples[18],
          updateMs, near:after.treeBatches.reduce((n,b)=>n+b.meshes[0].count,0),
          far:after.treeBatches.reduce((n,b)=>n+b.meshes[1].count,0) };
      },{view,version});
      metrics.push({view,version,...result});
      const capture=await send('Page.captureScreenshot',{format:'jpeg',quality:90});
      await writeFile(join(directory,`${view}-${version}.jpg`),Buffer.from(capture.data,'base64'));
      console.log(view,version,JSON.stringify(result));
    }
  }
  // Same camera, only LOD geometry changes: inspect silhouette at the switching distance.
  for(const level of [0,1]) {
    await evaluate(({level})=>{
      const {before,after,showcase,camera,renderer,scene}=review;
      before.group.visible=after.group.visible=false;showcase.before.visible=false;showcase.after.visible=true;
      showcase.after.children.forEach((mesh,i)=>{mesh.geometry=after.treeBatches[i].meshes[level].geometry;});
      camera.position.set(0,24,650);camera.lookAt(0,18,0);camera.updateMatrixWorld();renderer.render(scene,camera);
    },{level});
    const capture=await send('Page.captureScreenshot',{format:'jpeg',quality:95});
    await writeFile(join(directory,`transition-${level}.jpg`),Buffer.from(capture.data,'base64'));
  }
  assert.ok(metrics.find(m=>m.view==='aerial' && m.version==='after').near===0);
  assert.ok(metrics.find(m=>m.view==='forest' && m.version==='after').near>0);
  for(const m of metrics.filter(m=>m.version==='after' && m.view!=='species')) {
    assert.equal(m.near+m.far,3500); assert.ok(m.calls<=10,'Bounded tree and shadow draws');
  }
  assert.deepEqual(exceptions,[]);
  await writeFile(join(directory,'browser-results.json'),JSON.stringify({baseline,host:{platform:platform(),cpu:cpus()[0].model},...setup,metrics,exceptions,
    note:'Isolated seeded foliage scene, 1440x1000, fixed daylight, 1024 shadow map. CPU wall time waits for a GPU fence, with 1ms polling subject to timer clamping; software GPU timing is not a full-flight FPS claim. TextureBytes and assetRequests cover vegetation assets only.'},null,2));
} finally {
  socket?.close();
  if (process.platform === 'win32' && chrome.pid) {
    try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 }); } catch { chrome.kill(); }
  } else chrome.kill();
  await delay(500);
  try { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch (error) { console.warn(`Temporary Chrome profile retained: ${profile}: ${error.message}`); }
}
