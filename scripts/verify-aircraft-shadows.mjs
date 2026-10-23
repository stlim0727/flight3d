/** Local WebGL acceptance: SIM_URL=http://127.0.0.1:5173 node scripts/verify-aircraft-shadows.mjs
 * Uses installed Chrome and native CDP; no browser automation dependency.
 * Output defaults to .tmp/aircraft-shadows. Animation is paused for repeatable poses.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const port = Number(process.env.CDP_PORT || 9459);
const directory = resolve(process.env.ARTIFACT_DIR || '.tmp/aircraft-shadows');
const profile = await mkdtemp(join(tmpdir(), 'flight3d-airframe-'));
const gpu = process.argv.includes('--gpu');
const chrome = spawn(process.env.CHROME_PATH || 'google-chrome-stable', [
  '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--window-size=1000,750', '--no-first-run', '--no-default-browser-check',
  '--use-gl=angle', `--use-angle=${gpu ? 'vulkan' : 'swiftshader'}`,
  ...(gpu ? [] : ['--enable-unsafe-swiftshader']), 'about:blank'
], { stdio: 'ignore' });
let socket;
const pending = new Map();
const exceptions = [];
let nextId = 1;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
  pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (fn, argument) => {
  const result = await send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${JSON.stringify(argument) ?? ''})`, returnByValue: true, awaitPromise: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
try {
  chrome.on('error', error => console.error(error.message));
  let target;
  for (let i = 0; i < 100; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page'); } catch { /* starting */ }
    if (target) break;
    await delay(100);
  }
  assert.ok(target, 'Chrome must expose a page target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (!pending.has(message.id)) return;
    const request = pending.get(message.id); pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 750, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame = () => 0;' });
  await send('Page.navigate', { url: process.env.SIM_URL || 'http://127.0.0.1:5173' });
  let ready = false;
  for (let i = 0; i < 360; i++) {
    ready = await evaluate(() => Boolean(window.simulator?.aircraft?.modelLoaded));
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, 'Loaded GLB must be ready; fallback alone cannot pass this check');
  const setup = await evaluate(async () => {
    const s = simulator, T = THREE;
    const { RENDER_QUALITY } = await import('/src/config/renderQuality.js');
    const tiers = [];
    // Exercise both startup and live setting paths, including GPU reallocation.
    if (s.sky.sunLight.shadow.mapSize.x !== RENDER_QUALITY[s.renderQuality].shadowMapSize) {
      throw new Error('Startup shadow tier mismatch');
    }
    for (const tier of ['performance', 'high', 'balanced']) {
      s.setRenderQuality(tier);
      s.renderScene();
      const shadow = s.sky.sunLight.shadow;
      if (shadow.map.width !== RENDER_QUALITY[tier].shadowMapSize) throw new Error('GPU map tier mismatch');
      tiers.push({ tier, size: shadow.map.width });
    }
    const { Boeing737 } = await import('/src/aircraft/Boeing737.js');
    const load = Boeing737.prototype.loadGltfModel;
    let fallback;
    try {
      Boeing737.prototype.loadGltfModel = () => {};
      fallback = new Boeing737(s.pfdCanvas, s.ndCanvas, s.eicasCanvas);
    } finally { Boeing737.prototype.loadGltfModel = load; }
    const scene = new T.Scene(); scene.background = new T.Color('#526577');
    scene.environment = s.scene.environment;
    scene.add(s.sky.sunLight, s.sky.sunLight.target, s.sky.ambientLight);
    const models = { loaded: s.aircraft, fallback };
    for (const a of Object.values(models)) {
      a.group.position.set(0, 0, 0); a.group.quaternion.identity();
      a.setCockpitMode(false); scene.add(a.group);
    }
    const ground = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({ color: '#949494', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -4; ground.receiveShadow = true; scene.add(ground);
    s.renderer.setPixelRatio(1); s.renderer.setSize(1000, 750);
    document.body.innerHTML = ''; document.body.style.margin = '0'; document.body.appendChild(s.renderer.domElement);
    window.airframeReview = { scene, models, ground, camera: new T.PerspectiveCamera(40, 4 / 3, 0.1, 2000) };
    const gl = s.renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
    return { tiers, gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  });
  await mkdir(directory, { recursive: true });
  const results = [];
  // Sun-above gear cannot physically shadow the belly in level flight. Invert
  // the aircraft for that view so sunlight reaches the underside through the gear.
  const views = [
    { name: 'wing', eye: [15, 12, -9], target: [3, -0.6, 1], heading: 0, bank: 0 },
    { name: 'tail', eye: [13, 10, 29], target: [0, 1.8, 16], heading: 0, bank: 0 },
    { name: 'belly', eye: [10, -12, -2], target: [0, -1.2, 1.8], heading: 0, bank: 180 },
    { name: 'ground', eye: [30, 26, 38], target: [0, -2, 0], heading: 0, bank: 0 },
    { name: 'ground-cockpit', eye: [30, 26, 38], target: [0, -2, 0], heading: 0, bank: 0 },
  ];
  for (const model of ['loaded', 'fallback']) for (const hour of [8, 12.5, 16.8]) for (const view of views) {
    const cell = { ...view, model, hour };
    const result = await evaluate(cell => {
      const s = simulator, T = THREE, r = airframeReview, a = r.models[cell.model];
      for (const model of Object.values(r.models)) model.group.visible = model === a;
      a.setCockpitMode(cell.name === 'ground-cockpit', true);
      a.group.quaternion.setFromEuler(new T.Euler(0, cell.heading * Math.PI / 180, cell.bank * Math.PI / 180, 'YXZ'));
      a.update(0, { gearDown: true, gearExtension: 1 });
      a.group.updateMatrixWorld(true);
      r.ground.visible = cell.name.startsWith('ground');
      r.camera.position.fromArray(cell.eye).applyQuaternion(a.group.quaternion);
      r.camera.up.set(0, 1, 0).applyQuaternion(a.group.quaternion);
      r.camera.lookAt(new T.Vector3(...cell.target).applyQuaternion(a.group.quaternion));
      r.camera.updateMatrixWorld(true);
      s.sky.setCloudCover(0); s.sky.setTimeOfDay(cell.hour, a.group.position, r.camera.position);
      const shadow = s.sky.sunLight.shadow;
      const draw = () => { s.sky.prepareRender(r.camera, a.group.position); s.renderer.render(r.scene, r.camera); };
      const gl = s.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const grab = () => { draw(); const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
      const png = pixels => {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) img.data.set(pixels.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
        ctx.putImageData(img, 0, 0); return c.toDataURL('image/png').split(',')[1];
      };
      draw();
      const lit = grab(), repeat = grab();
      const intensity = shadow.intensity; shadow.intensity = 0;
      const unshadowed = grab(); shadow.intensity = intensity;
      const lightIntensity = s.sky.sunLight.intensity; s.sky.sunLight.intensity = 0;
      const noSun = grab(); s.sky.sunLight.intensity = lightIntensity;
      draw();
      const diff = new Uint8Array(lit.length);
      let changed = 0, noise = 0, peak = 0, sunChanged = 0;
      for (let i = 0; i < lit.length; i += 4) {
        const delta = (unshadowed[i] + unshadowed[i + 1] + unshadowed[i + 2] - lit[i] - lit[i + 1] - lit[i + 2]) / 3;
        const flicker = Math.max(...[0, 1, 2].map(k => Math.abs(lit[i + k] - repeat[i + k])));
        if (delta > 6 && flicker <= 1) changed++;
        if (flicker > 1) noise++;
        if (Math.abs(lit[i] - noSun[i]) > 6) sunChanged++;
        peak = Math.max(peak, delta);
        diff[i] = diff[i + 1] = diff[i + 2] = Math.max(0, Math.min(255, delta * 8)); diff[i + 3] = 255;
      }
      // Attribute changed samples to actual receiver surfaces. A light-off diff
      // alone would count general illumination and cannot prove self-shadowing.
      const meshes = [];
      r.scene.traverseVisible(o => { if (o.isMesh && o.material.colorWrite !== false) meshes.push(o); });
      const ray = new T.Raycaster(), uv = new T.Vector2();
      let receiverSamples = 0, receiverShadowSamples = 0, sourceSamples = 0;
      const casters = meshes.filter(o => o.castShadow);
      for (let y = 4; y < H; y += 12) for (let x = 4; x < W; x += 12) {
        uv.set(x / W * 2 - 1, y / H * 2 - 1); ray.setFromCamera(uv, r.camera);
        const hit = ray.intersectObjects(meshes, false)[0]; if (!hit) continue;
        const p = a.group.worldToLocal(hit.point.clone());
        const receiver = cell.name.startsWith('ground') ? hit.object === r.ground : hit.object !== r.ground && (
          cell.name === 'wing' ? Math.abs(p.x) > 2 && Math.abs(p.x) < 12 && p.z > -4 && p.z < 10 :
          cell.name === 'tail' ? Math.abs(p.x) > 1 && Math.abs(p.x) < 7 && p.z > 12 && p.y < 4 :
          Math.abs(p.x) < 1.8 && p.y < -0.8 && Math.abs(p.z) < 10);
        if (!receiver) continue;
        receiverSamples++;
        const i = (y * W + x) * 4;
        const d = (unshadowed[i] + unshadowed[i + 1] + unshadowed[i + 2] - lit[i] - lit[i + 1] - lit[i + 2]) / 3;
        if (d > 6) {
          receiverShadowSamples++;
          ray.set(hit.point.clone().addScaledVector(s.sky.sunPosition, 0.1), s.sky.sunPosition);
          const source = ray.intersectObjects(casters, false)[0];
          if (source) {
            const p = a.group.worldToLocal(source.point.clone());
            let gear = false;
            for (let o = source.object; o; o = o.parent) {
              if ([a.noseGearGroup, a.mainGearLGroup, a.mainGearRGroup].includes(o)) gear = true;
            }
            if (cell.name.startsWith('ground') || (cell.name === 'wing' && Math.abs(p.x) < 2.2) ||
              (cell.name === 'tail' && Math.abs(p.x) < 0.8 && p.y > 2.8) || (cell.name === 'belly' && gear)) sourceSamples++;
          }
        }
      }
      return { changed, noise, peak, sunChanged, receiverSamples, receiverShadowSamples, sourceSamples,
        halfSize: shadow.camera.right, png: png(lit), unshadowed: png(unshadowed), diff: png(diff) };
    }, cell);
    const name = `${model}-${hour}-${view.name}`;
    for (const [kind, key] of [['lit', 'png'], ['shadow-off', 'unshadowed'], ['diff', 'diff']]) {
      await writeFile(join(directory, `${name}-${kind}.png`), Buffer.from(result[key], 'base64')); delete result[key];
    }
    results.push({ ...cell, ...result }); console.log(name, JSON.stringify(result));
  }
  assert.deepEqual(exceptions, [], 'No uncaught browser exceptions');
  await writeFile(join(directory, 'results.json'), JSON.stringify({ setup, results, exceptions }, null, 2));
  for (const r of results) {
    assert.ok(r.noise < 10, `Static render noise: ${r.model}/${r.hour}/${r.name}`);
    assert.ok(r.sunChanged > 100, `Sun must illuminate ${r.model}/${r.hour}/${r.name}`);
    assert.ok(r.receiverSamples > 10, `Receiver must be visible: ${r.model}/${r.hour}/${r.name}`);
  }
  // Geometry and sun direction can legitimately leave one surface unshadowed at
  // an individual hour; each requested receiver must be shadowed in the matrix.
  for (const model of ['loaded', 'fallback']) for (const view of views) {
    const cells = results.filter(r => r.model === model && r.name === view.name);
    assert.ok(cells.some(r => r.receiverShadowSamples > 10), `No measured shadow on ${model}/${view.name}`);
    if (!view.name.startsWith('ground')) {
      assert.ok(cells.some(r => r.sourceSamples > 2), `Expected caster must occlude the sun for ${model}/${view.name}`);
    }
  }
  console.log(`Aircraft shadow acceptance passed; evidence: ${directory}`);
} finally {
  socket?.close(); chrome.kill();
  if (chrome.exitCode === null) await once(chrome, 'exit');
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()), 'Only remove the temporary browser profile');
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
