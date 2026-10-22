/** Local WebGL acceptance: SIM_URL=http://127.0.0.1:5185 node scripts/verify-effect-flipbooks.mjs
 * Uses installed Chrome and native CDP; no browser automation dependency.
 * Output defaults to .tmp/effect-review. Animation is paused for repeatable poses.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const port = Number(process.env.CDP_PORT || 9465);
const directory = resolve(process.env.ARTIFACT_DIR || '.tmp/effect-review');
const profile = await mkdtemp(join(tmpdir(), 'flight3d-effects-'));
const gpu = process.argv.includes('--gpu');
const chrome = spawn(process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome-stable'), [
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
  await once(socket, 'open');
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') exceptions.push(JSON.stringify(message.params.args));
    if (!pending.has(message.id)) return;
    const request = pending.get(message.id); pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  await mkdir(directory, { recursive: true });
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/effect-review.html', '<html><body style="margin:0"></body></html>');
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${process.env.SIM_URL || 'http://127.0.0.1:5185'}/.tmp/effect-review.html` });
  await delay(500);
  const setup = await evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 800); renderer.setPixelRatio(1); renderer.toneMapping = T.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);
    const gl = renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
    window.review = { T, renderer };
    return { browser: navigator.userAgent, gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable' };
  });
  const report = { setup, scenarios: [] };
  const modes = process.argv.includes('--baseline') ? ['before', 'after'] : ['after'];
  for (const mode of modes) {
    await evaluate(async mode => {
      const { T, renderer } = window.review;
      const prefix = mode === 'before' ? '/.tmp/effect-baseline' : '/src/effects';
      const { ExplosionSystem } = await import(`${prefix}/ExplosionSystem.js`);
      const { TireSmokeSystem } = await import(`${prefix}/TireSmokeSystem.js`);
      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(45, 1.5, 0.1, 1000);
      const explosion = new ExplosionSystem(scene), tire = new TireSmokeSystem(scene);
      Object.assign(window.review, { scene, camera, explosion, tire });
    }, mode);
    for (const kind of ['tire', 'land', 'water', 'smoke']) for (const night of [false, true]) {
      const result = await evaluate(({ kind, night }) => {
        const { T, renderer, scene, camera, explosion, tire } = window.review;
        let seed = 12345;
        const random = Math.random;
        Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        try {
          explosion.clear(); tire.clear();
          scene.background = new T.Color(night ? '#080d19' : '#88a9be');
          camera.position.set(...(kind === 'tire' ? [0, 6, 22] : [65, 42, 85]));
          camera.lookAt(kind === 'tire' ? -5 : 0, kind === 'tire' ? 2 : 15, 0);
          if (kind === 'tire') tire.spawnTouchdownSmoke([{ id: 'left', worldPos: new T.Vector3(), groundSpeed: 70, sinkRate: 2 }], new T.Vector3(70, 0, 0));
          else if (kind === 'smoke') explosion.spawnSmokePlume(new T.Vector3(), 20, false);
          else explosion.spawnExplosion({ type: kind === 'water' ? 'WATER' : 'GROUND', point: new T.Vector3() });
          for (let i = 0; i < (kind === 'smoke' ? 180 : 36); i++) { explosion.update(1 / 60); tire.update(1 / 60); }
          renderer.render(scene, camera);
          const samples = [];
          for (let i = 0; i < 30; i++) {
            const start = performance.now(); renderer.render(scene, camera); renderer.getContext().finish(); samples.push(performance.now() - start);
          }
          samples.sort((a, b) => a - b);
          const textures = [explosion.fireTexture, explosion.smokeTexture, explosion.waterTexture, explosion.sparkTexture, tire.smokeTexture];
          return { kind, night, drawCalls: renderer.info.render.calls, textures: renderer.info.memory.textures,
            textureBytes: textures.reduce((sum, t) => sum + t.image.width * t.image.height * 4 * (t.generateMipmaps ? 4 / 3 : 1), 0),
            medianMs: samples[15], p95Ms: samples[28], particles: explosion.fireballs.length + explosion.smokePuffs.length + explosion.debrisParticles.length + explosion.waterPlumes.length + tire.particles.length };
        } finally { Math.random = random; }
      }, { kind, night });
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const filename = `${mode}-${kind}-${night ? 'night' : 'day'}.png`;
      await writeFile(join(directory, filename), Buffer.from(shot.data, 'base64'));
      assert.ok(Number.isFinite(result.medianMs) && result.drawCalls > 0);
      assert.ok(result.textureBytes <= 1.1 * 1024 * 1024, 'effect textures fit 1.1 MiB');
      assert.ok(result.particles <= 540 && result.drawCalls <= 544, 'particle and draw budgets');
      report.scenarios.push({ mode, ...result, screenshot: filename });
    }
    const lifecycle = await evaluate(() => {
      const { T, renderer, scene, camera, explosion, tire } = window.review;
      const samples = [];
      for (let cycle = 0; cycle < 20; cycle++) {
        explosion.clear(); tire.clear();
        explosion.spawnExplosion({ type: cycle % 2 ? 'WATER' : 'GROUND', point: new T.Vector3() });
        tire.spawnTouchdownSmoke([{ id: 'left', worldPos: new T.Vector3(), groundSpeed: 70 }], new T.Vector3(70, 0, 0));
        explosion.update(0.2); tire.update(0.2); renderer.render(scene, camera);
        explosion.clear(); tire.clear(); renderer.render(scene, camera);
        samples.push({ ...renderer.info.memory, programs: renderer.info.programs.length, children: explosion.group.children.length + tire.group.children.length });
      }
      if (explosion.dispose) explosion.dispose();
      else { for (const texture of [explosion.fireTexture, explosion.smokeTexture, explosion.waterTexture, explosion.sparkTexture]) texture.dispose(); scene.remove(explosion.group); }
      if (tire.dispose) tire.dispose(); else { tire.smokeTexture.dispose(); scene.remove(tire.group); }
      renderer.render(scene, camera);
      return { samples, disposedTextures: renderer.info.memory.textures };
    });
    assert.deepEqual(lifecycle.samples.at(-1), lifecycle.samples[0], 'reset must not accumulate GPU resources');
    assert.equal(lifecycle.disposedTextures, 0);
    report[`${mode}Lifecycle`] = lifecycle;
  }
  assert.deepEqual(exceptions, [], 'no browser or shader errors');
  await writeFile(join(directory, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket?.close();
  chrome.kill();
  await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once('exit', resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
