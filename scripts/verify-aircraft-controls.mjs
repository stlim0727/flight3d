import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run under chrome-session --project flight3d; reuse its browser and close only our tab.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5287/';
const dir = process.env.ARTIFACT_DIR || '.cache/aircraft-controls';
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
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const startupDeadline = Date.now() + 120000;
  while (Date.now() < startupDeadline) {
    if (await evaluate('Boolean(window.simulator?.startupReady)')) break;
    if (await evaluate('document.getElementById("startup-retry")?.hidden === false')) {
      throw new Error('Simulator startup failed: ' + await evaluate('document.getElementById("startup-status")?.textContent'));
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(await evaluate('Boolean(window.simulator?.startupReady)'), true);
  console.log('Startup ready');
  await evaluate(`(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { solveTrim } = await import('/src/physics/TrimSolver.js');
    const { Atmosphere } = await import('/src/physics/Atmosphere.js');
    const { CONTROL_AUDIT_CASES, measureControlResponse } = await import('/scripts/lib/aircraft-control-audit.mjs');
    const s = window.simulator;
    s.demoDirector.stop();
    s.gameFlow.enterFlight();
    s.gameFlow.isPhysicsFrozen = () => true; // freeze only wall-clock integration
    s.touchControls.enable();
    s.autopilot.master = false;
    window.auditCases = CONTROL_AUDIT_CASES.filter(c => c.id !== 'F16');
    window.staticAudit = CONTROL_AUDIT_CASES.map(measureControlResponse);
    window.prepareAudit = state => {
      s.setAircraft(state.id);
      s.setPreset('cruise');
      s.demoDirector.stop();
      s.controls.setAircraftControlsDisabled(false);
      s.controls.releaseAllKeys();
      s.controls.clearVirtualInputs();
      s.controls.mouseControl = false;
      s.controls.setTouchStick(0, 0);
      s.controls.setTouchRudder(0);
      s.controls.elevator = s.controls.aileron = s.controls.rudder = 0;
      s.aero.spoilers = 0;
      s.aero.setFlapPosition(state.flapsIndex);
      s.aero.currentFlapAngle = s.aero.flapAngles[state.flapsIndex];
      s.gear.setGearTarget(state.gearState > 0);
      s.gear.gearState = state.gearState;
      s.aero.massProperties.setConfiguration(state.gearState, s.aero.currentFlapAngle / s.aero.flapAngles.at(-1));
      s.aero.syncMassProperties();
      const trim = solveTrim(s.aero, s.engines, state);
      if (!trim.feasible || !trim.handsOffFeasible) throw new Error('fixture trim: '+JSON.stringify(trim));
      s.position.set(-600, state.altitudeMeters, 3200);
      s.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0), trim.alphaDeg * Math.PI/180);
      s.linearVelocity.set(0,0,-trim.tas);
      s.angularVelocity.set(0,0,0);
      s.controls.pitchTrim = trim.handsOffTrimDeg;
      s.controls.throttle = trim.throttle;
      s.engines.setThrottle(trim.throttle);
      s.engines.settleSpool();
      s.telemetry.iasKnots = state.iasKnots;
      s.aircraft.group.position.copy(s.position);
      s.aircraft.group.quaternion.copy(s.quaternion);
      s.renderPose.reset(s.position, s.quaternion);
      s.isCrashed = false;
      s.cameraSystem.setMode(1, true);
      return { massKg: s.aero.mass, alphaDeg: trim.alphaDeg, trimDeg: trim.handsOffTrimDeg };
    };
    window.stepAudit = seconds => {
      const samples = [];
      for (let i=0; i<Math.round(seconds*120); i++) {
        s.integratePhysics(1/120);
        const rates = { pitch: s.angularVelocity.x*180/Math.PI, roll: -s.angularVelocity.z*180/Math.PI, yaw: -s.angularVelocity.y*180/Math.PI };
        if (!Object.values(rates).every(Number.isFinite) || s.isCrashed) throw new Error('invalid/crashed response');
        samples.push(rates);
      }
      return { end: samples.at(-1), peak: Object.fromEntries(['pitch','roll','yaw'].map(k => [k, Math.max(...samples.map(v=>Math.abs(v[k])))])),
        elevator: s.controls.elevator, aileron: s.controls.aileron, rudder: s.controls.rudder, iasKnots: s.telemetry.iasKnots };
    };
  })()`);
  const cases = await evaluate('window.auditCases');
  const touch = (type, points) => call('Input.dispatchTouchEvent', { type,
    touchPoints: points.map(([x,y]) => ({ id: 1, x, y, radiusX: 1, radiusY: 1, force: 1 })) });
  for (let index=0;index<cases.length;index++) {
    for (const axis of ['pitch', 'roll', 'yaw']) {
      await evaluate(`window.prepareAudit(window.auditCases[${index}])`);
      const baseline = await evaluate('window.stepAudit(1)');
      assert.ok(Math.abs(baseline.end[axis]) < 0.01, 'fixture must be trimmed');
      const fixture = await evaluate(`window.prepareAudit(window.auditCases[${index}])`);
      const { x, y } = await evaluate(`(() => { const t=window.simulator.touchControls;
        if (${JSON.stringify(axis)} === 'yaw') { const r=t.rudderTrack.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; }
        t.updateStickGeometry(); return {x:t.stickCenterX,y:t.stickCenterY}; })()`);
      await touch('touchStart', [[x,y]]);
      await touch('touchMove', [[x + (axis!=='pitch'?5:0), y + (axis==='pitch'?5:0)]]);
      const commanded = await evaluate('[window.simulator.controls.touchElevator, window.simulator.controls.touchAileron, window.simulator.controls.touchRudder]');
      assert.ok(commanded[axis==='pitch'?0:axis==='roll'?1:2] > 0);
      const hold = await evaluate('window.stepAudit(1)');
      assert.ok(hold.end[axis] > baseline.end[axis], `${cases[index].id} ${axis} direction`);
      await touch('touchEnd', []);
      const release = await evaluate('window.stepAudit(0.3)');
      assert.equal(release.elevator, 0);
      assert.equal(release.aileron, 0);
      assert.equal(release.rudder, 0);
      const recovery = await evaluate('window.stepAudit(2)');
      // Reverse using a new native gesture; do not assume neutral means wings level.
      await touch('touchStart', [[x,y]]);
      await touch('touchMove', [[x - (axis!=='pitch'?5:0), y - (axis==='pitch'?5:0)]]);
      const reverse = await evaluate('window.stepAudit(1)');
      assert.ok(reverse.end[axis] < 0, `${cases[index].id} ${axis} reversal`);
      await touch('touchEnd', []);
      const final = await evaluate('window.stepAudit(0.3)');
      assert.equal(final.elevator, 0);
      assert.equal(final.aileron, 0);
      assert.equal(final.rudder, 0);
      report.push({ ...cases[index], axis, fixture, commanded, baseline, hold, release, recovery, reverse, final });
    }
    await evaluate('window.simulator.stepSimulation(1/120)');
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(dir, `${cases[index].id}-${cases[index].phase}.png`), Buffer.from(data, 'base64'));
    console.log(`${cases[index].id} ${cases[index].phase} completed`);
  }
  const pageErrors = errors.filter(error => contexts.get(error.executionContextId)?.isDefault !== false);
  const staticAudit = await evaluate('window.staticAudit');
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ report, staticAudit, pageErrors, isolatedErrors: errors.filter(error => contexts.get(error.executionContextId)?.isDefault === false).map(error => ({ context: contexts.get(error.executionContextId), description: error.exception?.description })) }, null, 2));
  assert.deepEqual(pageErrors, []);
  console.log(report.map(r=>({id:r.id,phase:r.phase,axis:r.axis,hold:r.hold.end[r.axis],afterRelease:r.recovery.end[r.axis]})));
} finally {
  ws.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
