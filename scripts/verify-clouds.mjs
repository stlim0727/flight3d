import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Start Vite and a dedicated Chrome first; see docs/development/clouds.md.
const output = 'review-artifacts/clouds';
const baselineRef = process.env.BASELINE_REF || 'a1cc4b8';
const baselinePath = 'src/environment/.cloud-baseline.js';
const baselineLayerPath = 'src/environment/.cloud-baseline-layer.js';
if ([baselinePath, baselineLayerPath].some(path => fs.existsSync(path))) {
  throw new Error('A temporary cloud baseline already exists');
}
const baselineLayer = execFileSync('git', ['show', `${baselineRef}:src/environment/CloudLayer.js`]);
const baselineSky = execFileSync('git', ['show', `${baselineRef}:src/environment/SkyAtmosphere.js`]);
process.on('exit', () => {
  fs.rmSync(baselinePath, { force: true });
  fs.rmSync(baselineLayerPath, { force: true });
});
fs.writeFileSync(baselineLayerPath, baselineLayer);
fs.writeFileSync(baselinePath, baselineSky.toString().replace('./CloudLayer.js', './.cloud-baseline-layer.js'));
fs.mkdirSync(output, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9458}/json`)).json();
const target = targets.find(target => target.type === 'page' && target.url.startsWith('http://127.0.0.1:'));
if (!target) throw new Error('No local simulator tab found');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  } else if (message.method === 'Runtime.exceptionThrown' ||
      (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')) {
    errors.push(message);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  const timeout = setTimeout(() => {
    pending.delete(requestId);
    reject(new Error(`CDP timeout: ${method}`));
  }, 30000);
  pending.set(requestId, message => {
    clearTimeout(timeout);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message);
  });
  ws.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async expression => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result.result.value;
};
const screenshot = async name => {
  const response = await send('Page.captureScreenshot', { format: 'png' });
  if (!response.result?.data) throw new Error(`Missing screenshot: ${name}`);
  fs.writeFileSync(`${output}/${name}.png`, Buffer.from(response.result.data, 'base64'));
};

await send('Runtime.enable');
// Baseline creation or a recent source edit may trigger a Vite page reload.
await new Promise(resolve => setTimeout(resolve, 1000));
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    ready = await evaluate('!!window.simulator');
  } catch (error) {
    if (!/navigated|context|closed/i.test(error.message)) throw error;
  }
  if (ready) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) throw new Error('Simulator is not ready');

const metadata = await evaluate(`(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { SkyAtmosphere } = await import('/src/environment/SkyAtmosphere.js');
  const { SkyAtmosphere: Baseline } = await import('/src/environment/.cloud-baseline.js');
  const sim = window.simulator;
  sim.demoDirector.stop();
  sim.gameFlow.enterFlight();
  // Let the one already queued frame schedule a no-op, then stop the main loop.
  const savedAnimate = sim.animate;
  sim.animate = () => {};
  await new Promise(resolve => setTimeout(resolve, 100));
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1280, 720);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style = 'position:fixed;inset:0;z-index:99999';
  document.body.appendChild(renderer.domElement);
  const sky = new SkyAtmosphere(new THREE.Scene(), renderer);
  const old = new Baseline(new THREE.Scene(), renderer);
  const camera = new THREE.PerspectiveCamera(60, 1280 / 720, 1, 60000);
  window.cloudReview = { renderer, sky, old, camera, savedAnimate };
  const gl = renderer.getContext();
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    gpu: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    browser: navigator.userAgent,
    width: innerWidth, height: innerHeight,
    gpuTimerAvailable: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    clouds: sky.cloudLayer.count,
    textureBytes: sky.cloudLayer.densityTexture.image.data.byteLength,
  };
})()`);
const views = [
  ['overview', 12, [0, 1800, 0], [10000, 3200, -8000]],
  ['near', 12, [8000, 3000, -5000], [8000, 3200, -10000]],
  ['rolled', 12, [0, 1800, 0], [10000, 3200, -8000]],
  ['zenith', 12, null, null],
  ['above', 12, [0, 6500, 0], [8000, 3200, -8000]],
  ['inside', 12, null, null],
  ['sunset', 18, [0, 1800, 0], [10000, 3200, -8000]],
  ['night', 0, [0, 1800, 0], [10000, 3200, -8000]],
];
const results = [];
for (const mode of ['baseline', 'volume']) {
  for (const [view, hour, position, look] of views) {
    if (process.env.CLOUD_VIEWS && !process.env.CLOUD_VIEWS.split(',').includes(view)) continue;
    const metrics = await evaluate(`(async () => {
      const { renderer, sky, old, camera } = cloudReview;
      const atmosphere = ${JSON.stringify(mode)} === 'volume' ? sky : old;
      const focus = sky.cloudLayer.clouds[0].position;
      if (${JSON.stringify(view)} === 'zenith') {
        camera.position.copy(focus).add({ x: 0, y: -2000, z: 0 });
        camera.lookAt(focus);
      } else if (${JSON.stringify(view)} === 'inside') {
        camera.position.copy(focus);
        camera.lookAt(focus.x, focus.y, focus.z - 1000);
      } else {
        camera.position.set(...${JSON.stringify(position)});
        camera.lookAt(...${JSON.stringify(look)});
      }
      if (${JSON.stringify(view)} === 'rolled') camera.rotateZ(Math.PI / 3);
      camera.updateMatrixWorld(true);
      atmosphere.setTimeOfDay(${hour}, null, camera.position);
      const render = () => {
        atmosphere.prepareRender(camera);
        renderer.render(atmosphere.scene, camera);
      };
      const gl = renderer.getContext();
      for (let i = 0; i < 5; i++) render();
      if (gl.isContextLost()) throw new Error('WebGL context lost');
      const cpu = [];
      for (let i = 0; i < 10; i++) {
        const start = performance.now(); render(); cpu.push(performance.now() - start);
      }
      const gpu = [];
      const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (extension) {
        for (let i = 0; i < 5; i++) {
          const query = gl.createQuery();
          gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
          render();
          gl.endQuery(extension.TIME_ELAPSED_EXT);
          gl.flush();
          for (let attempts = 0; !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE); attempts++) {
            if (attempts > 1000) throw new Error('GPU query did not complete');
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          if (gl.getParameter(extension.GPU_DISJOINT_EXT)) throw new Error('Invalid GPU timer result');
          gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(query);
        }
      }
      cpu.sort((a, b) => a - b); gpu.sort((a, b) => a - b);
      return {
        cpuSubmitMedianMs: cpu[5],
        gpuMedianMs: gpu.length ? gpu[2] : null,
        gpuMaxMs: gpu.length ? gpu[4] : null,
        gpuSamplesMs: gpu,
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        texturesCumulative: renderer.info.memory.textures,
      };
    })()`);
    await screenshot(`${mode}-${view}`);
    results.push({ mode, view, ...metrics });
    console.log(results.at(-1));
  }
}
await evaluate(`(() => {
  const { renderer, sky, old, savedAnimate } = cloudReview;
  renderer.domElement.remove();
  sky.cloudLayer.dispose(); old.cloudLayer.dispose();
  for (const atmosphere of [sky, old]) {
    atmosphere.sky.geometry.dispose(); atmosphere.sky.material.dispose();
    atmosphere.scene.environment?.dispose();
  }
  renderer.dispose();
  window.simulator.animate = savedAnimate;
  requestAnimationFrame(savedAnimate);
  delete window.cloudReview;
})()`);
for (const [name, mode] of [['cockpit', 0], ['wing', 2], ['chase', 1]]) {
  await evaluate(`(async () => {
    const sim = window.simulator;
    sim.setAirport('coastal'); sim.setPreset('cruise');
    sim.sky.setTimeOfDay(12); sim.cameraSystem.setMode(${mode}, true);
    await new Promise(resolve => setTimeout(resolve, 500));
  })()`);
  await screenshot(`app-${name}`);
}
const expectedViews = process.env.CLOUD_VIEWS ? process.env.CLOUD_VIEWS.split(',').length * 2 : views.length * 2;
if (results.length !== expectedViews || !results.length) throw new Error('Incomplete comparison');
fs.writeFileSync(`${output}/metrics.json`, JSON.stringify({ complete: errors.length === 0, baselineRef, metadata, results, errors }, null, 2));
console.log({ views: results.length, errors: errors.length, metadata });
ws.close();
if (errors.length) throw new Error('Browser errors occurred; inspect metrics.json');
