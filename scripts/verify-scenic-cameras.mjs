import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run under chrome-session --project flight3d; reuse its browser and close only our tab.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5193/';
const dir = process.env.ARTIFACT_DIR || '.cache/scenic-cameras';
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 60000);
  pending.set(id, result => { clearTimeout(timer); result.error ? reject(new Error(JSON.stringify(result.error))) : resolve(result.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const capture = async name => {
  await evaluate(`(() => {
    const sim = window.simulator;
    sim.aircraft.group.updateMatrixWorld(true);
    for (let i = 0; i < 30; i++) sim.cameraSystem.update(1/60, sim.aircraft.group, sim.telemetry, (x,z) => sim.currentTerrain.getHeight(x,z));
    sim.camera.updateProjectionMatrix();
    sim.renderer.render(sim.scene, sim.camera);
  })()`);
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
};
try {
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 120; i++) {
    if (await evaluate('Boolean(window.simulator?.lobbyScreen)')) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await evaluate(`(() => {
    const s = window.simulator;
    s.demoDirector.stop();
    s.gameFlow.enterFlight();
    s.integratePhysics = () => {};
    s.position.set(-520, 500, 720);
    s.aircraft.group.position.copy(s.position);
    s.aircraft.group.updateMatrixWorld(true);
    s.cameraSystem.setMode(0, true);
  })()`);
  await new Promise(resolve => setTimeout(resolve, 3500));
  for (const mode of [8, 1, 6, 4, 2, 0]) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC' });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC' });
    assert.equal(await evaluate('window.simulator.cameraSystem.mode'), mode);
    await capture(`quick-cycle-${mode}`);
  }
  // Use the native select's change path, including specialist views on mobile.
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`window.simulator.gameFlow.returnToLobby(true)`);
  await evaluate(`document.getElementById('lobby-tab-settings').click()`);
  for (const mode of [3, 5, 7]) {
    await evaluate(`(() => {
      const select = document.getElementById('camera-select');
      select.value = '${mode}';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const selected = await evaluate('window.simulator.cameraSystem.autoSwitch ? 7 : window.simulator.cameraSystem.mode');
    assert.equal(selected, mode);
  }
  await capture('mobile-camera-settings');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no mobile horizontal overflow');
  await evaluate(`(() => {
    const s = window.simulator;
    s.cameraSystem.setMode(7, true);
    s.cameraSystem.update(10, s.aircraft.group, { onGround: false });
  })()`);
  assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 6);
  // Also verify the HUD's touch-accessible exit from automatic viewing.
  await evaluate(`window.simulator.gameFlow.enterFlight()`);
  await evaluate(`document.getElementById('open-camera').click()`);
  assert.equal(await evaluate('window.simulator.cameraSystem.autoSwitch'), false);
  assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 1);
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await evaluate(`(() => {
    const s = window.simulator;
    const update = s.cameraSystem.update.bind(s.cameraSystem);
    window.stepScenicCamera = dt => update(dt, s.aircraft.group, s.telemetry,
      (x,z) => s.currentTerrain.getHeight(x,z));
    // Render the real scene while advancing camera timers explicitly below.
    s.cameraSystem.update = (_dt, ...args) => update(0, ...args);
  })()`);
  const tap = async id => {
    const point = await evaluate(`(() => {
      const r = document.getElementById('${id}').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
    })()`);
    assert.ok(point.x > 0 && point.x < 390 && point.width >= 44 && point.height >= 44,
      `${id} must be visible and touch-sized`);
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const dragStart = async () => {
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 420 }] });
    await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 230, y: 440 }] });
  };
  await tap('btn-auto-camera');
  assert.equal(await evaluate('window.simulator.cameraSystem.autoSwitch'), true);
  await tap('btn-auto-camera');
  assert.equal(await evaluate('window.simulator.cameraSystem.autoPaused'), true);
  await capture('mobile-auto-paused');
  await dragStart();
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await evaluate('window.stepScenicCamera(20)');
  assert.equal(await evaluate('window.simulator.cameraSystem.autoPaused'), true, 'explicit pause survives touch');
  await tap('btn-auto-camera');
  assert.equal(await evaluate('window.simulator.cameraSystem.autoPaused'), false);
  await evaluate('window.stepScenicCamera(9.9)');
  await dragStart();
  await evaluate('window.stepScenicCamera(20)');
  assert.equal(await evaluate('window.simulator.cameraSystem.touchAutoResumeTimer'), 4, 'timer waits for release');
  await capture('mobile-auto-looking');
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await evaluate('window.stepScenicCamera(3)');
  assert.equal(await evaluate('window.simulator.cameraSystem.userLookOverridden'), true);
  await evaluate('window.stepScenicCamera(1.1)');
  assert.equal(await evaluate('window.simulator.cameraSystem.userLookOverridden'), false);
  assert.equal(await evaluate('window.simulator.cameraSystem.autoSwitchTimer'), 0, 'fresh shot after resume');
  await capture('mobile-auto-playing');
  await evaluate('window.stepScenicCamera(10)');
  assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 6);
  await dragStart();
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await tap('btn-auto-camera');
  assert.equal(await evaluate('window.simulator.cameraSystem.userLookOverridden'), false, 'tap resumes immediately');
  await tap('open-camera');
  await evaluate('window.stepScenicCamera(20)');
  assert.equal(await evaluate('window.simulator.cameraSystem.autoSwitch'), false, 'manual selection cancels resume');
  assert.deepEqual(errors, [], 'no runtime exceptions');
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ passed: true, errors, quickCycle: [8, 1, 6, 4, 2, 0], specialistSelections: [3, 5, 7], mobileAutoPauseResume: true }, null, 2));
  console.log('Scenic camera browser checks passed:', dir);
} finally {
  ws.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
