import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Cockpit interior sunlight acceptance for issue #90.
// Start the dev server and a headless Chrome on the page first, see docs/development/ci.md
// (use any free port for Vite; the script only needs a Chrome already sitting on the page):
//   npm run dev -- --host 127.0.0.1 --port 5196 --strictPort
//   google-chrome-stable --headless=new --user-data-dir=/tmp/flight3d-deck-sun \
//     --remote-debugging-port=9471 --window-size=1280,720 \
//     --use-gl=angle --use-angle=vulkan --no-first-run http://127.0.0.1:5196/
const cdpPort = process.env.CDP_PORT || 9471;
const dir = process.env.ARTIFACT_DIR || path.resolve('review-artifacts/issue90');
fs.mkdirSync(dir, { recursive: true });

const pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let seq = 0;
const pending = new Map();
const pageErrors = [];
const resourceErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  // Record which asset 404s instead of failing on it: a missing optional texture is a
  // packaging question, not a lighting regression.
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') resourceErrors.push(`${m.params.entry.text} <- ${m.params.entry.url}`);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timeout = setTimeout(() => reject(new Error(`timeout ${method}`)), 120000);
  pending.set(id, (m) => {
    clearTimeout(timeout);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

await call('Runtime.enable');
await call('Log.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
// Reload so the page under test is the source on disk, then wait for the interior GLB.
await call('Page.enable');
await call('Page.reload', { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 3000));
for (let attempt = 0; attempt < 120; attempt++) {
  if (await evaluate('Boolean(window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded)')) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const gpu = await evaluate(`(() => {
  const gl = window.simulator.renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
})()`);

// Freeze the loop, enter the 3D cockpit and hold a pose we choose, so every captured
// frame is a deterministic function of time of day, heading, bank and cloud cover.
await evaluate(`(() => {
  const sim = window.simulator;
  sim.demoDirector.stop();
  sim.gameFlow.enterFlight();
  const savedAnimate = sim.animate;
  window.deckSunReview = { savedAnimate, calls: 0 };
  sim.animate = () => {};
  sim.cameraSystem.photoCockpit = false;
  sim.cameraSystem.lookYaw = 0;
  sim.cameraSystem.lookPitch = 0;
  sim.cameraSystem.setMode(0);
  return true;
})()`);

// A single staged frame: pose, sky, physics-free display update, then read the deck.
const stage = async ({ hour, heading, bank = 0, cloud = 0, frames = 4 }) => await evaluate(`(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const sim = window.simulator;
  const sky = sim.sky;
  sim.position.set(0, 900, 0);
  sim.aircraft.group.position.copy(sim.position);
  const euler = new THREE.Euler(THREE.MathUtils.degToRad(${bank}), THREE.MathUtils.degToRad(${heading}), 0, 'YXZ');
  sim.quaternion.setFromEuler(euler);
  sim.aircraft.group.quaternion.copy(sim.quaternion);
  sky.setCloudCover(${cloud});
  sky.setTimeOfDay(${hour}, sim.position, sim.camera.position);
  for (let i = 0; i < ${frames}; i++) {
    sim.aircraft.setCockpitMode(true, true);
    sim.aircraft.group.updateMatrixWorld(true);
    sim.cameraSystem.update(1 / 60, sim.aircraft.group, sim.telemetry,
      (x, z) => sim.currentTerrain.getHeight(x, z));
    const daylight = sim.sky.updateCockpitSun({
      position: sim.aircraft.group.position,
      quaternion: sim.aircraft.group.quaternion,
      cockpitActive: true,
      dt: i === 0 ? 1 : 1 / 60, // Settle camera-entry lighting before the static capture.
      casterState: 'static-review',
    });
    sim.aircraft.cockpit.syncDaylight(daylight);
    sim.renderScene();
  }
  const rig = sky.cockpitSun;
  const stats = (() => {
    const gl = sim.renderer.getContext();
    const w = 360, h = 220;
    const x = Math.floor((gl.drawingBufferWidth - w) / 2);
    const y = Math.floor((gl.drawingBufferHeight - h) / 2) - 40;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0, sum2 = 0, n = w * h;
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
      sum += l; sum2 += l * l;
    }
    const mean = sum / n;
    return { mean: +mean.toFixed(2), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2) };
  })();
  const cookie = (() => {
    if (!rig.canvas) return null;
    const size = rig.canvas.width;
    const data = rig.canvas.getContext('2d').getImageData(0, 0, size, size).data;
    let lit = 0, u = 0, v = 0;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const p = (py * size + px) * 4;
        const level = data[p] / 255;
        if (level > 0.5) { lit++; u += px; v += py; }
      }
    }
    return lit ? { lit: lit / (size * size), cx: u / lit / size, cy: v / lit / size } : { lit: 0, cx: 0, cy: 0 };
  })();
  return {
    stats,
    cookie,
    sunLocal: {
      elevDeg: +(Math.asin(Math.min(1, Math.max(-1, rig.pose.sunDirLocal.y))) * 180 / Math.PI).toFixed(1),
      bearingDeg: +(Math.atan2(rig.pose.sunDirLocal.x, -rig.pose.sunDirLocal.z) * 180 / Math.PI).toFixed(1),
    },
    intensity: rig.light.intensity,
    daylight: rig.daylight,
    facing: rig.pose.facing,
    modeFactor: rig.modeFactor,
    sunIntensity: sky.sunLight.intensity,
    sunAttenuation: sky.sunAttenuation,
    shadowIntensity: rig.light.shadow.intensity,
    floods: sim.aircraft.cockpit.floods.map((f) => +f.intensity.toFixed(4)),
    mapDirty: rig.light.shadow.needsUpdate,
    angleDeg: +(rig.light.angle * 180 / Math.PI).toFixed(3),
    deckSunOverSun: rig.light.intensity / Math.max(sky.sunLight.intensity, 1e-6),
  };
})()`);

const snapshot = async (name) => {
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  fs.writeFileSync(path.join(dir, `${name}.png`), buf);
  return `${(buf.length / 1024).toFixed(0)}KB`;
};

const rigFacts = await evaluate(`(() => {
  const rig = window.simulator.sky.cockpitSun;
  return {
    isSpot: !!rig.light.isSpotLight,
    decay: rig.light.decay,
    distance: rig.light.distance,
    castShadow: rig.light.castShadow,
    autoUpdate: rig.light.shadow.autoUpdate,
    mapSize: rig.light.shadow.mapSize.toArray(),
    hasCookie: !!rig.light.map,
    cookieClass: rig.light.map?.constructor?.name,
    cookieSize: rig.canvas?.width ?? null,
    cookieMipmaps: rig.light.map?.generateMipmaps ?? null,
    shadowMapSize: rig.light.shadow.mapSize.toArray(),
    mainSunMapSize: window.simulator.sky.sunLight.shadow.mapSize.toArray(),
    mainSunCasts: window.simulator.sky.sunLight.castShadow,
    exteriorShadowProxy: window.simulator.aircraft.gltfShadowProxy?.castShadow ?? null,
    sceneChildren: window.simulator.scene.children.length,
    exteriorVisible: window.simulator.aircraft.group.visible,
  };
})()`);

// The sun bearing in the deck frame is what drives the pattern. SkyAtmosphere puts the sun
// at azimuth theta = 180 + 45 cos((hour - 6)/24 turns) and elevation 65 sin of the same
// angle, with theta 180 pointing down the -Z axis; a heading of theta - 180 therefore means
// sun dead ahead, theta means sun dead astern, and theta - 270 / theta - 90 mean sun abeam
// left / right. 09:00 -> theta 211.8 elevation 46; 12:30 -> theta 174 elevation 65;
// 17:00 -> theta 136.5 elevation 17.

await stage({hour:9,heading:302,frames:4});
const parts=await evaluate(`(async()=>{const T=await import('/node_modules/three/build/three.module.js');const sim=window.simulator,frame=sim.aircraft.cockpit.gltfCockpitModel.getObjectByName('Body020_Material008_0'),g=frame.geometry;
const inv=sim.aircraft.group.matrixWorld.clone().invert(),matrix=new T.Matrix4().multiplyMatrices(inv,frame.matrixWorld);const original=g.index;const pos=g.attributes.position;const points=Array.from({length:pos.count},(_,i)=>new T.Vector3().fromBufferAttribute(pos,i).applyMatrix4(matrix));const groups={near:[],forward:[],other:[]};
for(let i=0;i<original.count;i+=3){const ids=[original.getX(i),original.getX(i+1),original.getX(i+2)],p=new T.Vector3();ids.forEach(j=>p.add(points[j]));p.divideScalar(3);let part='other';if(p.y>.74&&p.y<.94){if(p.x>-.61&&p.x<-.42&&p.z>-12.82&&p.z<-12.38)part='near';else if(p.x>-.39&&p.x<-.27&&p.z>-13.08&&p.z<-12.64)part='forward';}groups[part].push(...ids);}
window.pillarDiagnostic={frame,original,groups,points,T,disabled:[],before:frame.onBeforeShadow,after:frame.onAfterShadow};
frame.onBeforeShadow=function(...args){window.pillarDiagnostic.before.apply(this,args);if(args[3].userData.cockpitSun){g.setDrawRange(0,window.pillarDiagnostic.kept??original.count);}};
frame.onAfterShadow=function(...args){g.setDrawRange(0,Infinity);window.pillarDiagnostic.after.apply(this,args);};
window.pillarDiagnostic.disable=(names)=>{const kept=[],off=[];for(const [name,indices]of Object.entries(groups))(names.includes(name)?off:kept).push(...indices);window.pillarDiagnostic.kept=kept.length;g.setIndex([...kept,...off]);sim.sky.cockpitSun.light.shadow.needsUpdate=true;};
return Object.fromEntries(Object.entries(groups).map(([name,indices])=>[name,{triangles:indices.length/3}]));})()`);
console.log('parts',JSON.stringify(parts));
await evaluate(`(()=>{const {frame,groups,T}=window.pillarDiagnostic;const g=frame.geometry.clone();g.setIndex([...groups.near,...groups.forward]);window.pillarDiagnostic.fullGeometry=frame.geometry;window.pillarDiagnostic.fullMaterial=frame.material;frame.geometry=g;frame.material=new T.MeshBasicMaterial({color:0xff00dd,side:T.DoubleSide});window.simulator.renderScene();})()`);
await snapshot('selected-pillar-segments');
await evaluate(`(()=>{const d=window.pillarDiagnostic;d.frame.geometry.dispose();d.frame.material.dispose();d.frame.geometry=d.fullGeometry;d.frame.material=d.fullMaterial;window.simulator.renderScene();})()`);
const results={};for(const[name,cell]of Object.entries({left:{hour:9,heading:302},golden:{hour:16.8,heading:0},front:{hour:7,heading:43},noon:{hour:12.5,heading:-6}})){
await evaluate('window.pillarDiagnostic.disable([])');await stage({...cell,frames:4});await snapshot(name+'-baseline');
results[name]=await evaluate(`(()=>{const sim=window.simulator,d=window.pillarDiagnostic,gl=sim.renderer.getContext(),W=gl.drawingBufferWidth,H=gl.drawingBufferHeight;const grab=()=>{sim.renderScene();const b=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b);return b};const base=grab();const out={};for(const part of ['near','forward','both']){d.disable(part==='both'?['near','forward']:[part]);const b=grab();let moved=0,sx=0,sy=0,minx=W,miny=H,maxx=0,maxy=0,peak=0,sum=0;const zones={top:0,panel:0,bottom:0};for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=((H-1-y)*W+x)*4;const delta=(Math.abs(b[i]-base[i])+Math.abs(b[i+1]-base[i+1])+Math.abs(b[i+2]-base[i+2]))/3;peak=Math.max(peak,delta);sum+=delta;if(delta>3){moved++;sx+=x;sy+=y;minx=Math.min(minx,x);miny=Math.min(miny,y);maxx=Math.max(maxx,x);maxy=Math.max(maxy,y);zones[y<H*.45?'top':y<H*.8?'panel':'bottom']++;}}out[part]={moved,peak,mean:sum/(W*H),centroid:moved?[sx/moved/W,sy/moved/H]:null,bounds:moved?[minx,miny,maxx,maxy]:null,zones};}d.disable([]);grab();return out;})()`);
console.log(name,JSON.stringify(results[name]));
}
await evaluate(`(()=>{const d=window.pillarDiagnostic;d.frame.geometry.setIndex(d.original);d.frame.onBeforeShadow=d.before;d.frame.onAfterShadow=d.after;window.simulator.sky.cockpitSun.light.shadow.needsUpdate=true;window.simulator.renderScene();})()`);
fs.writeFileSync(path.join(dir,'segment-ablation.json'),JSON.stringify({parts,results,pageErrors},null,2));ws.close();
