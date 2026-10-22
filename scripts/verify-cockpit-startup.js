import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Browser acceptance for the cockpit interior swap (follow-up to issue #112).
// The GLTF interior is an asynchronous asset and the only cockpit geometry, so
// the evidence needed is: (1) the demo never frames an interior that is not
// there, and (2) when the interior can never arrive, cockpit mode is explicitly
// left for the exterior view. Artifacts land in ARTIFACT_DIR.

const PORT = Number(process.env.PORT || 5196);
const CDP_PORT = Number(process.env.CDP_PORT || 9466);
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ||
  path.join(process.cwd(), 'review-artifacts', 'cockpit-startup');
const MODES = { COCKPIT: 0, CHASE: 1 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs before any page script so the first animation frames are sampled; a
// mid-load interior swap cannot slip between CDP round-trips.
const SAMPLER = `
  window.__cockpitProbe = { start: performance.now(), samples: [] };
  const sample = () => {
    const cockpit = window.simulator?.aircraft?.cockpit;
    if (cockpit) {
      window.__cockpitProbe.samples.push({
        t: Math.round(performance.now() - window.__cockpitProbe.start),
        mode: window.simulator.cameraSystem.mode,
        loaded: cockpit.gltfCockpitLoaded === true,
        failed: cockpit.cockpitModelFailed === true,
        mountedDisplays: cockpit.gltfDisplays?.parent ? 1 : 0
      });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
`;

function openSession(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  const handlers = new Map();
  const pending = new Map();
  let msgId = 1;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    handlers.get(msg.method)?.forEach((fn) => fn(msg.params));
  };
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('CDP socket failed'));
  });
  const on = (method, fn) => {
    if (!handlers.has(method)) handlers.set(method, []);
    handlers.get(method).push(fn);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, ready, send, on, handlers };
}

async function attach() {
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(250);
    try {
      const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return openSession(page.webSocketDebuggerUrl);
    } catch (e) {}
  }
  throw new Error('No Chrome page target found');
}

async function evaluate({ send }, expression) {
  const res = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  if (res.exceptionDetails) {
    throw new Error(`Eval error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
  }
  return res.result?.value;
}

async function waitForCondition(session, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(session, `(function () { try { return Boolean(${expression}); } catch (e) { return false; } })()`)) {
        return true;
      }
    } catch (e) {}
    await sleep(200);
  }
  return false;
}

async function capture(session, name) {
  const shot = await session.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ARTIFACT_DIR, name), Buffer.from(shot.data, 'base64'));
  console.log(`Saved: ${name}`);
}

async function coldLoad(session) {
  await session.send('Page.navigate', { url: `${SIM_URL}?probe=cold` });
  const reachedCockpit = await waitForCondition(
    session, 'window.__cockpitProbe.samples.some(s => s.mode === 0)', 90000);
  await sleep(1500);
  const samples = await evaluate(session, 'window.__cockpitProbe.samples');
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'cold-load-frames.json'), JSON.stringify(samples, null, 2));
  if (!reachedCockpit) {
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'cold-load-stall.json'),
      JSON.stringify({ sampleCount: samples.length, last: samples.slice(-5) }, null, 2));
  }
  await capture(session, '1_cold_load_view.png');

  assert.ok(samples.length > 15, `Expected per-frame samples, got ${samples.length}`);
  assert.equal(samples[0].mode, MODES.CHASE,
    `The first rendered frame must be the exterior view, got mode ${samples[0].mode}`);

  const blindFrames = samples.filter((s) => s.mode === MODES.COCKPIT && !s.loaded && !s.failed);
  assert.equal(blindFrames.length, 0,
    `Cockpit view held ${blindFrames.length} frames with no interior, first: ${JSON.stringify(blindFrames[0])}`);
  // The live displays are mounted with the interior, so the camera is never
  // pointed at a half-built panel.
  const displaysBeforeLoad = samples.filter((s) => s.mountedDisplays && !s.loaded);
  assert.equal(displaysBeforeLoad.length, 0,
    `Live displays mounted in ${displaysBeforeLoad.length} frames before the GLB resolved`);

  console.log(`Cold load: ${samples.length} frames, interior loaded at ` +
    `${samples.find((s) => s.loaded)?.t ?? 'n/a'} ms, cockpit reached: ${reachedCockpit}`);
  assert.ok(reachedCockpit, 'The demo should cut into the cockpit once the interior loads');
}

async function unavailableInterior(session) {
  let blocked = 0;
  session.on('Fetch.requestPaused', ({ requestId, request }) => {
    blocked++;
    console.log(`Blocked interior asset request: ${request.url}`);
    session.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {});
  });
  await session.send('Fetch.enable', {
    patterns: [{ urlPattern: '*b737-cockpit*.glb', requestStage: 'Request' }]
  });
  await session.send('Page.navigate', { url: `${SIM_URL}?probe=fail` });

  assert.ok(await waitForCondition(session,
    'window.simulator?.aircraft?.cockpit?.cockpitModelFailed === true', 45000),
    'Blocking every interior asset must report the failure');
  assert.ok(blocked >= 2,
    `Both the medium and the lite asset should be requested; blocked ${blocked}`);

  // Read the mode back in the same task: the animation loop is allowed to
  // redirect it on the next frame, which is exactly what is being verified.
  const entered = await evaluate(session, `(() => {
    const sim = window.simulator;
    sim.demoDirector?.stop?.();
    sim.cameraSystem.setMode(${MODES.COCKPIT}, true);
    return sim.cameraSystem.mode;
  })()`);
  assert.equal(entered, MODES.COCKPIT, 'The harness must be able to request cockpit mode');

  const redirected = await waitForCondition(session,
    `window.simulator.cameraSystem.mode === ${MODES.CHASE}`, 5000);
  const toast = await evaluate(session, `(() => {
    const el = document.getElementById('toast-msg');
    return { visible: Boolean(el?.classList.contains('visible')), text: el?.textContent || '' };
  })()`);
  const state = await evaluate(session, `(() => {
    const cockpit = window.simulator.aircraft.cockpit;
    return {
      loading: cockpit.cockpitModelLoading,
      loaded: cockpit.gltfCockpitLoaded,
      failed: cockpit.cockpitModelFailed
    };
  })()`);
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'failed-asset-run.json'),
    JSON.stringify({ blocked, redirected, toast, state }, null, 2));
  await capture(session, '2_interior_unavailable_exterior.png');

  assert.ok(redirected, 'A cockpit view with no interior asset must fall back to the exterior');
  assert.match(toast.text, /cockpit interior unavailable/i, 'The view change should be explained');
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const useGpu = fs.existsSync('/dev/dri/renderD128') && process.env.FORCE_GPU !== '0';

  console.log(`Starting Vite dev server on port ${PORT}`);
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { if ((await fetch(SIM_URL)).ok) break; } catch (e) {}
  }

  const chrome = spawn('google-chrome-stable', [
    '--headless=new',
    `--user-data-dir=/tmp/chrome-cockpit-startup-${Date.now()}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-gl=angle',
    useGpu ? '--use-angle=vulkan' : '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'
  ], { stdio: 'ignore' });

  const session = await attach();
  try {
    await session.ready;
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: SAMPLER });
    await coldLoad(session);
    await unavailableInterior(session);
    console.log('Browser evidence captured in', ARTIFACT_DIR);
  } finally {
    session.ws.close();
    chrome.kill();
    vite.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
