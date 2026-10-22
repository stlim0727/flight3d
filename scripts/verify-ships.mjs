// Start Vite on 5173 first. CHROME_PATH may point to a Windows Chrome executable.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir, platform, cpus } from 'node:os';
import assert from 'node:assert/strict';

const directory = resolve(process.env.ARTIFACT_DIR || '.tmp/ships');
await mkdir(directory, { recursive: true });
const baseline = process.env.BASELINE_REF || '31bede9206f28fbe9201c4ad9589bd3f13580e82';
const source = execFileSync('git', ['show', `${baseline}:src/environment/Ships.js`], {
  encoding: 'utf8'
});
await mkdir('.tmp/ships', { recursive: true });
await writeFile('.tmp/ships/Ships-before.js', source.replaceAll("'./", "'/src/environment/"));
await writeFile(
  '.tmp/ships/review.html',
  `<!doctype html><html><head><title>Ship acceptance</title></head><body style="margin:0">
<script type="module">
import * as T from 'three';
import { Ships as Before } from './Ships-before.js';
import { Ships as After } from '/src/environment/Ships.js';
import { WaterOcean } from '/src/environment/WaterOcean.js';
window.reviewModules = { T, Before, After, WaterOcean };
</script></body></html>`
);
const profile = await mkdtemp(join(tmpdir(), 'flight3d-ships-'));
const port = Number(process.env.CDP_PORT || 9474);
const chrome = spawn(
  process.env.CHROME_PATH || 'google-chrome-stable',
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--window-size=1440,1000',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-gl=angle',
    `--use-angle=${process.env.GPU_ANGLE || 'swiftshader'}`,
    '--enable-unsafe-swiftshader',
    'about:blank'
  ],
  { stdio: 'ignore', windowsHide: true }
);
let socket,
  seq = 0;
const pending = new Map(),
  exceptions = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(Error(`${method} timeout`));
    }, 60000);
    pending.set(id, (m) => {
      clearTimeout(timeout);
      m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (fn, argument) => {
  const result = await send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${JSON.stringify(argument) ?? ''})`,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails)
    throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
try {
  chrome.on('error', (error) => console.error(error));
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
        (p) => p.type === 'page'
      );
    } catch {
      /* starting */
    }
    if (target) break;
    await delay(100);
  }
  assert.ok(target, 'Chrome CDP target required');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, reject) => {
    socket.addEventListener('open', r);
    socket.addEventListener('error', reject);
  });
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false
  });
  const origin = process.env.SIM_URL || 'http://127.0.0.1:5173';
  await send('Page.navigate', { url: `${origin}/.tmp/ships/review.html` });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      ready = await evaluate(() => Boolean(window.reviewModules));
    } catch {
      /* Vite optimizer reload */
    }
    if (ready) break;
    await delay(200);
  }
  assert.ok(ready, 'Review modules must finish loading');
  const setup = await evaluate(async () => {
    const { T, Before, After, WaterOcean } = window.reviewModules;
    const water = new WaterOcean();
    water.material.uniforms.uTime.value = 12;
    const originalRandom = Math.random;
    let seed = 14;
    Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    let before;
    try {
      before = new Before(water);
    } finally {
      Math.random = originalRandom;
    }
    const after = new After(water, { random: () => 0.125 });
    await after.ready;
    if (after.assetErrors.length) throw Error(JSON.stringify(after.assetErrors));
    before.speedboats.forEach((b, i) => {
      b.angle = after.speedboats[i].angle;
    });
    before.update(0, 12);
    after.update(0, 12);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1440, 1000);
    renderer.setPixelRatio(1);
    document.body.appendChild(renderer.domElement);
    const scene = new T.Scene();
    scene.background = new T.Color(0xc8def4);
    scene.add(new T.HemisphereLight(0xeaf4ff, 0x526477, 2));
    const sun = new T.DirectionalLight(0xffebca, 3);
    sun.position.set(-60, 100, 40);
    scene.add(sun);
    scene.add(water.mesh, before.group, after.group);
    const camera = new T.PerspectiveCamera(45, 1.44, 0.1, 30000);
    const gl = renderer.getContext(),
      debug = gl.getExtension('WEBGL_debug_renderer_info');
    window.review = { T, water, before, after, renderer, scene, camera };
    const a = after.speedboats[0].visual.children[0],
      b = after.speedboats[1].visual.children[0];
    const requests = performance
      .getEntriesByType('resource')
      .filter((r) => /models\/ships\/.*\.glb/.test(r.name));
    return {
      userAgent: navigator.userAgent,
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      sharedBoatGeometry: a.geometry === b.geometry,
      sharedBoatMaterial: a.material === b.material,
      assetRequests: requests.map((r) => ({
        url: r.name,
        encodedBytes: r.encodedBodySize,
        decodedBytes: r.decodedBodySize,
        transferBytes: r.transferSize
      })),
      textureBytesBefore: 0,
      textureBytesAfter: 87380
    };
  });
  assert.ok(setup.sharedBoatGeometry && setup.sharedBoatMaterial);
  assert.equal(setup.assetRequests.length, 4, 'one fetch per type, including two speedboats');
  const metrics = [];
  for (const view of ['cargo', 'cruise', 'tanker', 'speedboat', 'waterline'])
    for (const version of ['before', 'after']) {
      const result = await evaluate(
        async ({ view, version }) => {
          const { T, before, after, renderer, scene, camera } = review;
          before.group.visible = version === 'before';
          after.group.visible = version === 'after';
          const type = view === 'waterline' ? 'speedboat' : view;
          const target =
            type === 'speedboat' ? after.speedboats[0] : after.vessels.find((v) => v.type === type);
          const yaw = target.mesh.rotation.y;
          const offset =
            view === 'waterline'
              ? [40, 3, 35]
              : type === 'speedboat'
                ? [43, 24, 55]
                : [210, 115, 240];
          const p = new T.Vector3(...offset)
            .applyAxisAngle(new T.Vector3(0, 1, 0), yaw)
            .add(target.mesh.position);
          camera.position.copy(p);
          camera.lookAt(
            target.mesh.position.clone().add(new T.Vector3(0, type === 'speedboat' ? 0 : 14, 0))
          );
          camera.updateMatrixWorld();
          const gl = renderer.getContext();
          const finish = async () => {
            const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            gl.flush();
            for (let i = 0; i < 10000; i++) {
              const status = gl.clientWaitSync(fence, 0, 0);
              if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
                gl.deleteSync(fence);
                return;
              }
              if (status === gl.WAIT_FAILED) throw Error('GPU fence failed');
              await new Promise((r) => setTimeout(r, 1));
            }
            throw Error('GPU fence timeout');
          };
          for (let i = 0; i < 3; i++) {
            renderer.render(scene, camera);
            await finish();
          }
          const samples = [];
          for (let i = 0; i < 12; i++) {
            const start = performance.now();
            renderer.render(scene, camera);
            await finish();
            samples.push(performance.now() - start);
          }
          samples.sort((a, b) => a - b);
          return {
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            frameMsMedian: samples[6],
            frameMsP95: samples[11],
            camera: camera.position.toArray(),
            target: target.mesh.position.toArray(),
            time: 12
          };
        },
        { view, version }
      );
      metrics.push({ view, version, ...result });
      const capture = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
      await writeFile(
        join(directory, `${view}-${version}.jpg`),
        Buffer.from(capture.data, 'base64')
      );
      console.log(view, version, JSON.stringify(result));
    }
  const sequence = await evaluate(() => {
    const { after, water, renderer, scene, camera } = review;
    for (let i = 0; i < 360; i++) {
      after.update(1 / 60, 12 + i / 60);
      water.material.uniforms.uTime.value = 12 + i / 60;
    }
    renderer.render(scene, camera);
    return {
      loaded: [...after.vessels, ...after.speedboats].every((v) => v.assetStatus === 'loaded'),
      shaderErrors: renderer.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable)
        .length
    };
  });
  assert.ok(sequence.loaded);
  assert.equal(sequence.shaderErrors, 0);
  assert.deepEqual(exceptions, []);
  for (const m of metrics.filter((m) => m.version === 'after'))
    assert.ok(m.drawCalls <= 37, 'ship and ocean draw budget');
  for (const time of [18, 24]) {
    await evaluate((time) => {
      const { T, after, water, camera, scene, renderer } = review;
      after.update(1, time);
      water.material.uniforms.uTime.value = time;
      const b = after.speedboats[0];
      camera.position.copy(
        new T.Vector3(40, 3, 35)
          .applyAxisAngle(new T.Vector3(0, 1, 0), b.mesh.rotation.y)
          .add(b.mesh.position)
      );
      camera.lookAt(b.mesh.position);
      renderer.render(scene, camera);
    }, time);
    const capture = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    await writeFile(
      join(directory, `waterline-time-${time}.jpg`),
      Buffer.from(capture.data, 'base64')
    );
  }
  let integration;
  if (process.env.FULL_APP === '1') {
    await send('Page.navigate', { url: origin });
    let started = false;
    for (let i = 0; i < 150; i++) {
      try {
        started = await evaluate(() => Boolean(window.sim?.ships));
      } catch {
        /* navigation */
      }
      if (started) break;
      await delay(200);
    }
    assert.ok(started, 'Full simulator starts');
    integration = await evaluate(async () => {
      await window.sim.ships.ready;
      return {
        statuses: [...sim.ships.vessels, ...sim.ships.speedboats].map((v) => v.assetStatus),
        errors: sim.ships.assetErrors
      };
    });
    assert.deepEqual(integration.statuses, Array(5).fill('loaded'));
    assert.deepEqual(integration.errors, []);
    assert.deepEqual(exceptions, []);
  }
  await writeFile(
    join(directory, 'browser-results.json'),
    JSON.stringify(
      {
        baseline,
        host: { platform: platform(), cpu: cpus()[0].model },
        ...setup,
        metrics,
        sequence,
        integration,
        exceptions,
        note: 'Isolated ships plus actual WaterOcean, 1440x1000, fixed daylight/time=12, seeded baseline, no shadows on either version. Twelve fence-completed samples after three warmups; timer polling, not full-flight FPS. See gpu for hardware/software backend. Texture bytes are exact RGBA8 128x128 mip-chain allocation for the shared wake; no model textures. Asset transfer includes local HTTP overhead.'
      },
      null,
      2
    )
  );
} finally {
  socket?.close();
  if (process.platform === 'win32' && chrome.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 10000
      });
    } catch {
      chrome.kill();
    }
  } else chrome.kill();
  await delay(500);
  try {
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.warn(`Temporary Chrome profile retained: ${profile}: ${error.message}`);
  }
}
