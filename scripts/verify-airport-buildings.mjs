// Start Vite on 5173 first. CHROME_PATH may point to a Windows Chrome executable.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir, platform, cpus } from 'node:os';
import assert from 'node:assert/strict';

const directory = resolve(process.env.ARTIFACT_DIR || '.tmp/airport-assets');
await mkdir(directory, { recursive: true });
const baseline = process.env.BASELINE_REF || 'f46c426';
const source = execFileSync('git', ['show', `${baseline}:src/environment/Airport.js`], { encoding: 'utf8' });
await mkdir('.tmp/airport-assets', { recursive: true });
await writeFile('.tmp/airport-assets/Airport-before.js', source.replaceAll("'./", "'/src/environment/"));
await writeFile('.tmp/airport-assets/review.html', '<!doctype html><html><head><title>Airport GLB acceptance</title></head><body style="margin:0"></body></html>');
const profile = await mkdtemp(join(tmpdir(), 'flight3d-airport-'));
const port = Number(process.env.CDP_PORT || 9463);
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
  await send('Page.navigate', { url: `${origin}/.tmp/airport-assets/review.html` });
  await delay(1000);
  const setup = await evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { Airport } = await import('/src/environment/Airport.js');
    const { Airport: Before } = await import('/.tmp/airport-assets/Airport-before.js');
    const before = new Before(), after = new Airport();
    if (!await after.buildingsReady) throw Error('Real GLB must load');
    const scene = new T.Scene(); scene.background = new T.Color('#b5cedc');
    const ground = new T.Mesh(new T.PlaneGeometry(10000, 10000), new T.MeshStandardMaterial({ color: '#78856d' }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 11.9; scene.add(ground);
    scene.add(new T.HemisphereLight(0xffffff, 0x697575, 2));
    const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(-500, 900, -400); scene.add(sun);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(1440, 1000); document.body.appendChild(renderer.domElement);
    const camera = new T.PerspectiveCamera(45, 1.44, .1, 15000);
    scene.add(before.group, after.group);
    window.review = { T, before, after, scene, renderer, camera };
    const gl = renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
    return { browser: navigator.userAgent, gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), resolution: [1440, 1000], glb: performance.getEntriesByType('resource').filter(e => e.name.endsWith('airport-kit.glb')).map(e => ({ encodedBodySize: e.encodedBodySize, transferSize: e.transferSize })) };
  });
  const metrics = [];
  for (const [view, position, target] of [
    ['overview', [-850, 420, -360], [-170, 30, 300]],
    ['terminal', [-150, 55, 205], [-80, 23, 325]],
    ['tower', [165, 95, 215], [120, 65, 280]],
    ['hangar', [-525, 60, 200], [-505, 30, 310]],
    ['tower-camera', [120, 78, 280], [-1250, 12, 0]],
    ['distant', [-2400, 1100, -2500], [-170, 30, 300]]
  ]) {
    for (const version of ['before', 'after']) {
      const result = await evaluate(async ({ version, position, target }) => {
        const { renderer, camera, scene, before, after } = review;
        before.group.visible = version === 'before'; after.group.visible = version === 'after';
        // Identical daylight, animation phase, camera, and resolution.
        for (const airport of [before, after]) { airport.radarDish.rotation.y = .7; airport.beaconLights.forEach(b => { b.intensity = 3.5; }); }
        camera.position.set(...position); camera.lookAt(...target); camera.updateMatrixWorld();
        for (let i = 0; i < 5; i++) renderer.render(scene, camera);
        const gl = renderer.getContext(), samples = [];
        for (let i = 0; i < 20; i++) {
          const start = performance.now(); renderer.render(scene, camera); gl.finish(); samples.push(performance.now() - start);
          await new Promise(r => setTimeout(r, 0));
        }
        samples.sort((a,b) => a-b);
        const textures = new Set();
        (version === 'before' ? before : after).group.traverse(n => {
          if (!n.isMesh) return;
          for (const material of [n.material].flat()) for (const value of Object.values(material)) {
            if (value?.isTexture) textures.add(value);
          }
        });
        const textureBytesRGBA8 = [...textures].reduce((sum, t) => sum + (t.image?.width || 0) * (t.image?.height || 0) * 4 * (t.generateMipmaps ? 4/3 : 1), 0);
        return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          textureCount: textures.size, textureBytesRGBA8, frameMsMedian: samples[10], frameMsP95: samples[18],
          lod: version === 'after' ? after.buildings.lods.map(l => l.getCurrentLevel()) : [] };
      }, { version, position, target });
      metrics.push({ view, version, ...result });
      const screenshot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
      await writeFile(join(directory, `${view}-${version}.jpg`), Buffer.from(screenshot.data, 'base64'));
      console.log(view, version, JSON.stringify(result));
    }
  }
  assert.ok(metrics.find(m => m.view === 'distant' && m.version === 'after').lod.every(l => l === 1));
  assert.ok(metrics.find(m => m.view === 'terminal' && m.version === 'after').lod.includes(0));
  assert.equal(metrics.length, 12, 'All six before/after views required');
  assert.equal(setup.glb.length, 1, 'One shared GLB transfer');
  assert.ok(setup.glb[0].encodedBodySize > 0 && setup.glb[0].encodedBodySize <= 200000, 'GLB payload budget');
  for (const after of metrics.filter(m => m.version === 'after')) {
    const before = metrics.find(m => m.view === after.view && m.version === 'before');
    assert.ok(after.calls - before.calls <= 40, 'Additional draw call budget');
    assert.ok(after.triangles - before.triangles <= (after.view === 'distant' ? 500 : 5000), 'Additional triangle budget');
    assert.equal(after.textureBytesRGBA8, before.textureBytesRGBA8, 'No additional texture memory');
  }
  // A real failed HTTP request must leave the airport without any buildings.
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*airport-kit.glb'] });
  await send('Page.reload', { ignoreCache: true }); await delay(500);
  const fallback = await evaluate(async () => {
    const { Airport } = await import('/src/environment/Airport.js'); const a = new Airport();
    const loaded = await a.buildingsReady;
    return { loaded, error: Boolean(a.buildingsError), tower: Boolean(a.towerGroup),
      terminal: Boolean(a.terminalGroup), buildings: Boolean(a.buildings),
      beacons: a.beaconLights.length,
      group: Boolean(a.group.getObjectByName('airport-buildings-glb')) };
  });
  assert.deepEqual(fallback, { loaded: false, error: true, tower: false, terminal: false,
    buildings: false, beacons: 0, group: false });
  assert.deepEqual(exceptions, []);
  await writeFile(join(directory, 'browser-results.json'), JSON.stringify({ baseline, host: { platform: platform(), cpu: cpus()[0].model }, ...setup, metrics, fallback, exceptions, note: 'Isolated airport scene; gl.finish wall times, not a full-flight or hardware-GPU FPS claim. Texture memory estimates assume RGBA8 plus generated mipmaps; building kit has no textures.' }, null, 2));
} finally {
  socket?.close();
  if (process.platform === 'win32' && chrome.pid) {
    try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* already exited */ }
  } else chrome.kill();
  await delay(500);
  try { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch (error) { console.warn(`Temporary Chrome profile retained: ${profile}: ${error.message}`); }
}
