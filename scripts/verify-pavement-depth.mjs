// Run under chrome-session with a GPU Chrome already listening on CDP_URL.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin = process.env.SIM_URL || 'http://127.0.0.1:5261';
const cdp = process.env.CDP_URL || `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const dir = process.env.ARTIFACT_DIR || '.cache/pavement-depth';
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync('.cache', { recursive: true });
fs.writeFileSync('.cache/pavement-depth.html', '<!doctype html><title>Pavement depth verification</title>');
const target = await (await fetch(`${cdp}/json/new?${encodeURIComponent(`${origin}/.cache/pavement-depth.html`)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map(), errors = [];
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args);
};
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 60000);
    pending.set(id, message => {
      clearTimeout(timer);
      message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
try {
  await call('Runtime.enable');
  const response = await call('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(${async function verify() {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { Airport } = await import('/src/environment/Airport.js');
      const { Terrain } = await import('/src/environment/Terrain.js');
      class Coastal extends Airport { async loadBuildings() { return false; } }
      const airport = new Coastal(), terrain = new Terrain(20000,256,{quality:'low'});
      const renderer = new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true,preserveDrawingBuffer:true});
      renderer.setSize(540,1000);
      const scene=new THREE.Scene(); scene.background=new THREE.Color(0xabcdef);
      scene.add(airport.group,terrain.mesh,new THREE.AmbientLight(0xffffff,3));
      const camera=new THREE.PerspectiveCamera(58,540/1000,.08,45000);
      camera.position.set(-1397,35.5,-27);camera.lookAt(-1305,12.5,0);
      await new Promise(r=>setTimeout(r,3000));
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      const images={}, rows=[];
      const runway=airport.group.getObjectByName('runway-pavement');
      const ray=new THREE.Raycaster();
      terrain.mesh.renderOrder=10; // Stress: later equal-depth fragments win.
      const original=terrain.material.onBeforeCompile;
      let stress=false;
      terrain.material.onBeforeCompile=shader=>{
        original(shader);
        if(stress) shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
          'outgoingLight = vec3(1.0,0.0,1.0);\n#include <opaque_fragment>');
        if(stress) shader.fragmentShader=shader.fragmentShader.replace('#include <logdepthbuf_fragment>',
          '#include <logdepthbuf_fragment>\ngl_FragDepth = floor(gl_FragDepth * 4096.0) / 4096.0;');
      };
      terrain.material.customProgramCacheKey=()=>"terrain-probe-"+stress;
      const materials=new Set();airport.group.traverse(o=>{if(o.material) materials.add(o.material)});
      for(const m of materials) {
        m.customProgramCacheKey=()=>"pavement-probe-"+stress+"-"+m.id;
        const hook=m.onBeforeCompile;
        m.onBeforeCompile=shader=>{hook.call(m,shader);if(stress && m.depthWrite) shader.fragmentShader=shader.fragmentShader.replace(
          '#include <logdepthbuf_fragment>', '#include <logdepthbuf_fragment>\ngl_FragDepth = floor(gl_FragDepth * 4096.0) / 4096.0;');};
      }
      for(const quality of ['low','high']) for(stress of [false,true]) for(const excluded of [false,true]) {
        terrain.setQuality(quality);
        if(excluded) terrain.excludePavement(airport.group);
        else {terrain.material.defines.PAVEMENT_BOUNDS_COUNT=0; terrain.material.needsUpdate=true;}
        for(const m of materials) m.needsUpdate=true;
        let lost=0,samples=0;
        for(let frame=0;frame<4;frame++) {
          camera.position.x=-1397+frame*.17;camera.lookAt(-1305,12.5,0);camera.updateMatrixWorld();
          renderer.render(scene,camera);
          const pixels=new Uint8Array(540*1000*4);gl.readPixels(0,0,540,1000,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          for(let y=100;y<900;y+=2) for(let x=10;x<530;x+=2) {
            ray.setFromCamera(new THREE.Vector2((x+.5)/540*2-1,(y+.5)/1000*2-1),camera);
            const hit=ray.intersectObject(runway)[0];
            if(!hit || Math.abs(hit.point.z)>29 || Math.abs(hit.point.x)>1599) continue;
            samples++;
            const i=(y*540+x)*4;
            if(pixels[i]>200 && pixels[i+1]<20 && pixels[i+2]>200) lost++;
          }
          if(frame===0) images[quality+'-'+(stress?'stress':'normal')+'-'+(excluded?'after':'before')]=renderer.domElement.toDataURL();
        }
        rows.push({quality,stress,excluded,samples,lost});
      }
      return {images,rows,gpu,shaderErrors:renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length};
    }.toString()})()`
  });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  const report = response.result.value;
  for (const [name, data] of Object.entries(report.images)) fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
  delete report.images;
  report.errors = errors;
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  assert.equal(errors.length, 0, 'browser errors');
  assert.equal(report.shaderErrors, 0);
  assert.equal(report.rows.length, 8);
  assert.ok(report.rows.every(r=>r.samples>1000));
  for (const quality of ['low','high']) {
    assert.ok(report.rows.find(r=>r.quality===quality&&r.stress&&!r.excluded).lost>100);
    assert.equal(report.rows.find(r=>r.quality===quality&&r.stress&&r.excluded).lost,0);
  }
  console.log(JSON.stringify(report));

} finally {
  ws.close();
  await fetch(`${cdp}/json/close/${target.id}`);
}
