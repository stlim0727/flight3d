/** Local WebGL acceptance: SIM_URL=http://127.0.0.1:5173 node scripts/test-gear-retraction.mjs
 * Uses installed Chrome and native CDP; no browser automation dependency.
 * Output defaults to .tmp/gear-retraction. Animation is paused for repeatable poses.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const port = Number(process.env.CDP_PORT || 9458);
const directory = resolve(process.env.ARTIFACT_DIR || '.tmp/gear-retraction');
const profile = await mkdtemp(join(tmpdir(), 'flight3d-gear-'));
const gpu = process.argv.includes('--gpu');
const chrome = spawn(process.env.CHROME_PATH || 'google-chrome-stable', [
  '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--window-size=1440,1000', '--no-first-run', '--no-default-browser-check',
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame = () => 0;' });
  await send('Page.navigate', { url: process.env.SIM_URL || 'http://127.0.0.1:5173' });
  let ready = false;
  for (let i = 0; i < 360; i++) {
    ready = await evaluate(() => Boolean(window.simulator?.aircraft?.modelLoaded));
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, 'Loaded GLB must be ready; a missing asset must not pass this check');
  const setup = await evaluate(async () => {
    const s = simulator, T = THREE;
    const scene = new T.Scene(); scene.background = new T.Color('#263545');
    scene.add(new T.HemisphereLight(0xffffff, 0x9cabbc, 3));
    for (const [position, intensity] of [[[-15, -20, -25], 4], [[15, 10, 5], 2]]) {
      const light = new T.DirectionalLight(0xffffff, intensity); light.position.set(...position); scene.add(light);
    }
    const models = { loaded: s.aircraft };
    for (const model of Object.values(models)) {
      model.group.position.set(0, 0, 0); model.group.quaternion.identity(); model.setCockpitMode(false); scene.add(model.group);
    }
    document.body.innerHTML = ''; document.body.style.margin = '0';
    document.body.appendChild(s.renderer.domElement); s.renderer.setPixelRatio(1); s.renderer.setSize(1440, 1000);
    const label = document.createElement('div');
    label.style = 'position:fixed;top:25px;left:30px;color:white;font:22px sans-serif;background:#15202dcc;padding:14px 20px;border-radius:8px';
    document.body.appendChild(label);
    window.gearReview = { models, scene, label, camera: new T.PerspectiveCamera(40, 1.44, 0.1, 200) };
    return { loaded: s.aircraft.modelLoaded };
  });
  assert.equal(setup.loaded, true, 'Loaded GLB must be ready');
  await mkdir(directory, { recursive: true });
  const views = [
    ['overview', [-24, -15, -30], [0, -1, -3]], ['main', [-10, -8, -10], [0, -1, 1.8]],
    ['nose', [-5, -6, -17], [0, -2, -13]], ['above', [-12, 9, -8], [0, -1, 1.8]],
    ['side', [-19, 0, -1], [0, -1, 0]], ['belly', [0, -13, 1.8], [0, -1, 1.8]]
  ];
  const results = [];
  for (const model of ['loaded']) {
    const cycle = await evaluate(model => {
      const a = gearReview.models[model], T = THREE;
      for (const candidate of Object.values(gearReview.models)) candidate.group.visible = candidate === a;
      let maxMainY = -Infinity;
      // Full retract, reversal, and full extension; assert every one-percent pose.
      for (const state of [...Array.from({ length: 101 }, (_, i) => 1 - i / 100), 0.3, 0.6, 0.4,
        ...Array.from({ length: 101 }, (_, i) => i / 100)]) {
        a.update(1 / 120, { gearState: state }); a.group.updateMatrixWorld(true);
        for (const leg of [a.mainGearLGroup, a.mainGearRGroup]) {
          maxMainY = Math.max(maxMainY, new T.Box3().setFromObject(leg).max.y);
          if (leg.scale.distanceTo(new T.Vector3(1, 1, 1)) > 1e-9) throw new Error('Gear dimensions changed');
        }
      }
      if (maxMainY >= -0.90) throw new Error(`Wing clearance failed: ${maxMainY}`);
      return { model, poses: 205, maxMainY };
    }, model);
    results.push(cycle);
    for (const [view, position, target] of views) for (const state of [1, 0.75, 0.5, 0.25, 0]) {
      await evaluate(({ model, view, position, target, state }) => {
        const r = gearReview, a = r.models[model];
        a.update(0, { gearState: state }); a.group.updateMatrixWorld(true);
        r.camera.position.set(...position); r.camera.lookAt(...target); r.camera.updateProjectionMatrix();
        simulator.renderer.render(r.scene, r.camera);
        r.label.textContent = `${model.toUpperCase()} · ${view.toUpperCase()} · ${Math.round((1 - state) * 100)}% retracted`;
      }, { model, view, position, target, state });
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(directory, `${model}-${view}-${Math.round((1 - state) * 100)}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    cycle.suspension = [];
    for (const [step, compression] of [0, 0.25, 0.7, 0.9, 0.3, 0].entries()) {
      const alignment = await evaluate(({ model, compression }) => {
        const r = gearReview, a = r.models[model], T = THREE;
        a.update(1 / 120, { gearState: 1, compressions: { mainLeft: compression, mainRight: compression } });
        a.group.updateMatrixWorld(true);
        let maxSeparation = 0, maxAxisError = 0;
        for (const truck of [a.mainTruckL, a.mainTruckR]) {
          const { housing, piston } = truck.userData;
          const axis = new T.Vector3(0, 1, 0).transformDirection(housing.matrixWorld);
          const other = new T.Vector3(0, 1, 0).transformDirection(piston.matrixWorld);
          const offset = piston.getWorldPosition(new T.Vector3()).sub(housing.getWorldPosition(new T.Vector3()));
          maxSeparation = Math.max(maxSeparation, offset.cross(axis).length());
          maxAxisError = Math.max(maxAxisError, axis.distanceTo(other));
        }
        if (maxSeparation > 1e-7 || maxAxisError > 1e-7) throw new Error(`Detached piston at ${compression}m`);
        r.camera.position.set(-6, -3, -1); r.camera.lookAt(-3, -1.8, 0.9); r.camera.updateProjectionMatrix();
        simulator.renderer.render(r.scene, r.camera);
        r.label.textContent = `${model.toUpperCase()} · SUSPENSION · ${compression.toFixed(2)} m compression`;
        return { compression, maxSeparation, maxAxisError };
      }, { model, compression });
      cycle.suspension.push(alignment);
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(directory, `${model}-compression-${step}-${Math.round(compression * 100)}.png`), Buffer.from(screenshot.data, 'base64'));
    }
  }
  if (process.argv.includes('--animation')) {
    // JPEG frames stream directly into VP9; no temporary frame collection.
    const encoder = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-f', 'image2pipe', '-vcodec', 'mjpeg', '-r', '12', '-i', 'pipe:0',
      '-c:v', 'libvpx-vp9', '-b:v', '1200k', '-y', join(directory, 'full-cycle.webm')
    ], { stdio: ['pipe', 'ignore', 'inherit'] });
    const encoded = once(encoder, 'exit');
    encoder.stdin.on('error', error => console.error(error.message));
    for (let frame = 0; frame <= 200; frame++) {
      const state = frame <= 100 ? 1 - frame / 100 : (frame - 100) / 100;
      await evaluate(({ state, frame }) => {
        const r = gearReview, a = r.models.loaded, renderer = simulator.renderer;
        for (const model of Object.values(r.models)) model.group.visible = model === a;
        a.update(1 / 12, { gearState: state }); a.group.updateMatrixWorld(true);
        renderer.setScissorTest(true);
        const views = [[[-10, -8, -10], [0, -1, 1.8]], [[-12, 9, -8], [0, -1, 1.8]]];
        r.camera.aspect = 0.72; r.camera.updateProjectionMatrix();
        views.forEach(([position, target], i) => {
          renderer.setViewport(i * 720, 0, 720, 1000); renderer.setScissor(i * 720, 0, 720, 1000);
          r.camera.position.set(...position); r.camera.lookAt(...target); renderer.render(r.scene, r.camera);
        });
        renderer.setScissorTest(false); renderer.setViewport(0, 0, 1440, 1000);
        r.label.textContent = `UNDERSIDE / ABOVE · ${frame <= 100 ? 'RETRACTING' : 'EXTENDING'} · ${Math.round((1 - state) * 100)}% retracted`;
      }, { state, frame });
      const screenshot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
      if (!encoder.stdin.write(Buffer.from(screenshot.data, 'base64'))) await once(encoder.stdin, 'drain');
      if (frame % 50 === 0) console.log(`Animation frame ${frame}/200`);
    }
    encoder.stdin.end();
    const [code] = await encoded; assert.equal(code, 0, 'Animation encoder must succeed');
  }
  assert.deepEqual(exceptions, [], 'No uncaught browser exceptions');
  await writeFile(join(directory, 'results.json'), JSON.stringify({ setup, results, exceptions }, null, 2));
  console.log(JSON.stringify({ directory, results, screenshots: 72 }));
} finally {
  socket?.close(); chrome.kill();
  await new Promise(resolve => chrome.once('exit', resolve));
  // Renderer/GPU child processes may finish writing just after the browser exits.
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
