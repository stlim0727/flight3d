import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Issue #180 browser evidence: mouse look direction, look rate, and the tower
 * zoom ceiling, driven through real DOM events rather than direct state writes.
 *
 * Start it with `npm run test:camera-look`. Overrides: PORT, CDP_PORT,
 * ARTIFACT_DIR, FORCE_GPU=0.
 */
// Ports are claimed from the OS rather than hardcoded: several verification runs
// share this machine, and a fixed port silently attaches to another worktree's
// dev server.
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.once('listening', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
  probe.listen(0, '127.0.0.1');
});

const ARTIFACT_DIR = process.env.ARTIFACT_DIR
  || path.join(process.cwd(), 'review-artifacts', 'issue-180');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach(cdpPort) {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://localhost:${cdpPort}/json`);
      const targets = await res.json();
      target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) {}
  }
  assert.ok(target?.webSocketDebuggerUrl, 'Chrome page target must be reachable');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let id = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = id++;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  const evalCode = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  };
  return { ws, send, evalCode };
}

/** Freeze the aircraft in still air at a known pose so gestures are measurable. */
const RIG = `(() => {
  const s = window.simulator;
  s.demoDirector?.stop?.();
  s.gameFlow?.enterFlight?.();
  s.integratePhysics = () => {};
  s.position.set(-520, 240, 720);
  s.cameraSystem.userLookOverridden = false;
  s.cameraSystem.userModeSelected = false;
  s.cameraSystem.enableCursorTrack = false;
  s.cameraSystem.enableEdgePan = false;
  s.cameraSystem.resetLook();
  return Boolean(s.aircraft?.group);
})()`;

// The renderer writes into an existing Vector3, so no THREE import is needed.
const GAZE = `(() => {
  const c = window.simulator.camera;
  const v = c.position.clone();
  c.getWorldDirection(v);
  return { pitch: v.y, azimuth: Math.atan2(v.x, -v.z) };
})()`;

async function runBrowserChecks({ send, evalCode, capture }) {  await evalCode(`(() => { window.simulator.cameraSystem.setMode(1, true); return 1; })()`);
  const point = await evalCode(`(() => {
    const el = document.getElementById('canvas-container');
    const r = el.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.4], [0.6, 0.55], [0.4, 0.55]]) {
      const x = Math.round(r.left + r.width * fx);
      const y = Math.round(r.top + r.height * fy);
      const top = document.elementFromPoint(x, y);
      if (top && (top.tagName === 'CANVAS' || top.id === 'canvas-container')) return { x, y };
    }
    return null;
  })()`);
  assert.ok(point, 'a pointer position over the canvas must be free of UI panels');

  const drag = async (dx, dy) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1, buttons: 1 });
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left', buttons: 1,
        x: point.x + (dx * i) / steps, y: point.y + (dy * i) / steps
      });
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + dx, y: point.y + dy, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(900); // chase damping
  };

  const results = {};

  // 1. Tail view: a downward drag must lift the gaze, like every other view.
  await evalCode(`window.simulator.cameraSystem.setMode(1, true)`);
  await evalCode(RIG);
  await sleep(400);
  const chaseBefore = await evalCode(GAZE);
  await capture('chase-0-neutral.png');
  await drag(0, 120);
  const chaseDown = await evalCode(GAZE);
  results.chase = {
    downDragGazeLift: +(chaseDown.pitch - chaseBefore.pitch).toFixed(4)
  };
  assert.ok(chaseDown.pitch > chaseBefore.pitch,
    `chase: a 120px down drag must lift the gaze, got ${results.chase.downDragGazeLift}`);
  await capture('chase-1-down-drag.png');

  await evalCode(RIG);
  await sleep(400);
  await drag(120, 0);
  const chaseRight = await evalCode(GAZE);
  results.chase.rightDragAzimuth = +(chaseRight.azimuth - chaseBefore.azimuth).toFixed(4);

  // 2. Cockpit: same gesture direction, and a rate the pointer can keep up with.
  await evalCode(`window.simulator.cameraSystem.setMode(0, true)`);
  await evalCode(RIG);
  await sleep(400);
  const cockpitBefore = await evalCode(GAZE);
  await capture('cockpit-0-neutral.png');
  await drag(0, 120);
  const cockpitDown = await evalCode(GAZE);
  assert.ok(cockpitDown.pitch > cockpitBefore.pitch, 'cockpit: a down drag lifts the gaze');
  await evalCode(RIG);
  await sleep(400);
  await drag(120, 0);
  const cockpitRight = await evalCode(GAZE);
  const sweepDeg = Math.abs(cockpitRight.azimuth - cockpitBefore.azimuth) * 180 / Math.PI;
  results.cockpit = {
    downDragGazeLift: +(cockpitDown.pitch - cockpitBefore.pitch).toFixed(4),
    hundredTwentyPxSweepDeg: +sweepDeg.toFixed(2),
    pixelsPerThirtyDegrees: Math.round(120 * 30 / Math.max(sweepDeg, 1e-6))
  };
  assert.ok(sweepDeg < 20,
    `cockpit: 120px of drag should not sweep more than 20°, swept ${sweepDeg.toFixed(1)}°`);
  await capture('cockpit-1-right-drag.png');

  // 3. Tower: the wheel now climbs to eightfold magnification.
  await evalCode(`window.simulator.cameraSystem.setMode(3, true)`);
  await evalCode(RIG);
  await sleep(400);
  const wheel = (deltaY) => send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY
  });
  const zoomState = `(() => {
    const s = window.simulator;
    return { zoom: s.cameraSystem.opticalZoom, fov: +s.camera.fov.toFixed(3), eye: s.camera.position.toArray().map(n => Math.round(n)) };
  })()`;
  const towerStart = await evalCode(zoomState);
  assert.equal(towerStart.zoom, 1, 'the tower opens unzoomed');
  await capture('tower-1x.png');
  for (let i = 0; i < 25; i++) await wheel(-100);
  await sleep(500);
  const towerMax = await evalCode(zoomState);
  results.tower = { start: towerStart, max: towerMax, notches: 25 };
  assert.equal(towerMax.zoom, 8, `the tower wheel must reach 8x, reached ${towerMax.zoom}x`);
  assert.ok(towerMax.fov < 8 && towerMax.fov > 0, `8x must narrow the tower to under 8°, got ${towerMax.fov}°`);
  assert.deepEqual(towerMax.eye, towerStart.eye, 'tower zoom stays optical, with the eye in the cab');
  await capture('tower-8x.png');

  // The cockpit ceiling is untouched by the tower change.
  await evalCode(`window.simulator.cameraSystem.setMode(0, true)`);
  await sleep(200);
  const cockpitZoomAfterSwitch = await evalCode(`window.simulator.cameraSystem.opticalZoom`);
  assert.equal(cockpitZoomAfterSwitch, 1, 'changing views drops the tower zoom instead of importing it');
  for (let i = 0; i < 25; i++) await wheel(-100);
  await sleep(400);
  const cockpitMax = await evalCode(zoomState);
  results.cockpitMaxZoom = cockpitMax;
  assert.equal(cockpitMax.zoom, 4, `the cockpit must still cap at 4x, got ${cockpitMax.zoom}x`);
  await capture('cockpit-4x.png');

  return results;
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const useGpu = fs.existsSync('/dev/dri/renderD128') && process.env.FORCE_GPU !== '0';

  const port = Number(process.env.PORT) || await freePort();
  const cdpPort = Number(process.env.CDP_PORT) || await freePort();
  const simUrl = `http://localhost:${port}/`;
  const viteLog = fs.openSync(path.join(ARTIFACT_DIR, 'vite.log'), 'w');
  // The vite entry script rather than npx, so killing the child really stops the
  // server instead of leaving a wrapper's process behind on a shared machine.
  const vite = spawn(process.execPath,
    [path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort'],
    { stdio: ['ignore', viteLog, viteLog] });
  let served = false;
  for (let i = 0; i < 80 && !served; i++) {
    await sleep(250);
    try { served = (await fetch(simUrl)).ok; } catch (e) {}
  }
  assert.ok(served, `this worktree's Vite dev server must answer on ${simUrl}`);
  process.stdout.write(`Dev server on ${simUrl}, CDP on ${cdpPort}\n`);

  const chrome = spawn('google-chrome-stable', [
    '--headless=new',
    `--user-data-dir=/tmp/chrome-camera-look-${Date.now()}`,
    `--remote-debugging-port=${cdpPort}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-gl=angle',
    useGpu ? '--use-angle=vulkan' : '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'
  ], { stdio: 'ignore' });

  let session = null;
  try {
    session = await attach(cdpPort);
    const { send, evalCode } = session;
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: simUrl });
    for (let i = 0; i < 100; i++) {
      await sleep(300);
      if (await evalCode('(() => { try { return Boolean(window.simulator?.cameraSystem); } catch (e) { return false; } })()')) break;
    }
    const booted = await evalCode(`(() => ({
      simulator: Boolean(window.simulator),
      url: location.href,
      title: document.title
    }))()`);
    assert.ok(booted.simulator, `the simulator must boot at ${booted.url} (${booted.title})`);
    await sleep(3000);

    const capture = async (name) => {
      await sleep(400);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(ARTIFACT_DIR, name), Buffer.from(shot.data, 'base64'));
      console.log(`Saved: ${name}`);
    };

    const results = await runBrowserChecks({ send, evalCode, capture });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'camera-look.json'),
      JSON.stringify({ results, gpu: useGpu, viewport: '1440x900' }, null, 2));
    console.log('Camera look browser evidence:', results);
    console.log('Browser evidence captured in', ARTIFACT_DIR);
  } finally {
    if (session) session.ws.close();
    chrome.kill();
    vite.kill();
    fs.closeSync(viteLog);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
