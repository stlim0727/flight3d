import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run under chrome-session --project flight3d; reuse its browser and close only our tab.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5286/';
const dir = process.env.ARTIFACT_DIR || '.cache/touch-stick';
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [], contexts = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.executionContextCreated') {
    const context = message.params.context;
    contexts.set(context.id, { name: context.name, isDefault: context.auxData?.isDefault });
  }
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

const report = [];
try {
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  for (let i = 0; i < 240; i++) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(await evaluate('Boolean(window.simulator?.startupReady)'), true, 'startup must finish before touch input');
  console.log('Startup ready');
  await evaluate(`(() => {
    const s = window.simulator;
    s.demoDirector.stop();
    s.setAircraft('F16');
    s.gameFlow.enterFlight();
    s.integratePhysics = () => {};
    s.touchControls.enable();
    s.controls.setAircraftControlsDisabled(false);
    s.controls.clearVirtualInputs();
    s.controls.releaseAllKeys();
  })()`);
  const touch = (type, points) => call('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 1, radiusY: 1, force: 1 })),
  });
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await new Promise(resolve => setTimeout(resolve, 700));
    const geometry = await evaluate(`(() => {
      const t = window.simulator.touchControls;
      t.updateStickGeometry();
      const r = t.stickZone.getBoundingClientRect();
      return { x: t.stickCenterX, y: t.stickCenterY, radius: t.stickRadius, width: r.width };
    })()`);
    const { x, y, radius } = geometry;
    const startX = x - 6, startY = y - 4;
    await touch('touchStart', [[1, startX, startY]]);
    assert.equal(await evaluate('window.simulator.touchControls.stickActive'), true);
    assert.deepEqual(await evaluate('[window.simulator.controls.touchElevator, window.simulator.controls.touchAileron]'), [0, 0]);
    await touch('touchMove', [[1, startX + 5, startY]]);
    const fine = await evaluate('window.simulator.controls.touchAileron');
    assert.ok(fine > 0 && fine < 5 / radius * 0.5, `fine input ${fine}`);
    await touch('touchMove', [[1, startX + radius, startY]]);
    const full = await evaluate('window.simulator.controls.touchAileron');
    assert.ok(Math.abs(full - 1) < 0.001, `full input ${full}`);
    await evaluate(`(() => {
      const c = window.simulator.controls;
      for(let i=0;i<240;i++) c.update(1/120, 250);
    })()`);
    await touch('touchEnd', []);
    const released = await evaluate(`(() => {
      const c = window.simulator.controls;
      for(let i=0;i<31;i++) c.update(1/120, 250);
      return { pitch: c.touchElevator, roll: c.touchAileron, elevator: c.elevator, aileron: c.aileron };
    })()`);
    assert.deepEqual(released, { pitch: 0, roll: 0, elevator: 0, aileron: 0 });
    // Exercise the real pointercancel/lost-capture path as well as normal release.
    await touch('touchStart', [[1, x, y]]);
    await touch('touchMove', [[1, x, y + radius]]);
    await touch('touchCancel', []);
    assert.deepEqual(await evaluate('[window.simulator.controls.touchElevator, window.simulator.controls.touchAileron]'), [0, 0]);
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(dir, `${width}x${height}.png`), Buffer.from(data, 'base64'));
    report.push({ width, height, geometry, fine, full, released });
  }
  // The shared browser has extensions in isolated worlds. Keep their errors in
  // evidence, but only fail for page errors (including unknown contexts).
  const pageErrors = errors.filter(error => contexts.get(error.executionContextId)?.isDefault !== false);
  const isolatedErrors = errors.filter(error => contexts.get(error.executionContextId)?.isDefault === false)
    .map(error => ({ context: contexts.get(error.executionContextId), description: error.exception?.description }));
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ report, pageErrors, isolatedErrors }, null, 2));
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  ws.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
