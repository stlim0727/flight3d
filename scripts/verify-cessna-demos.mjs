/** Flight quality for these routes is gated by scripts/demo-sweep.mjs; this harness owns the DOM, audio and camera-framing checks the sweep deliberately does not. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run under chrome-session --project flight3d; reuse its browser and close only our tab.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5186/';
const dir = process.env.ARTIFACT_DIR || '.cache/cessna-demos';
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [], results = [];
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
    for (let i = 0; i < 120; i++) sim.cameraSystem.update(1/60, sim.aircraft.group, sim.telemetry, (x,z) => sim.currentTerrain.getHeight(x,z));
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
  assert.ok(await evaluate('Boolean(window.simulator?.lobbyScreen)'), 'simulator ready');
  await evaluate(`(() => {
    const sim = window.simulator;
    sim.demoDirector.stop();
    sim.gameFlow.isPhysicsFrozen = () => true;
    document.getElementById('lobby-aircraft-c172').click();
    document.getElementById('lobby-preset-demo').click();
    sim.gameFlow.enterFlight(); sim.gameFlow.returnToLobby(true);
  })()`);
  await new Promise(resolve => setTimeout(resolve, 2500));
  await capture('menu-desktop');
  assert.equal(await evaluate(`document.getElementById('lobby-demo-select').options.length`), 3);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await new Promise(resolve => setTimeout(resolve, 250));
  await evaluate(`document.getElementById('lobby-demo-options').scrollIntoView({block:'nearest'})`);
  await capture('menu-mobile');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no horizontal overflow');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const [airport, profile] of [['coastal', 'scenic'], ['coastal', 'maneuvers'], ['coastal', 'proximity'], ['lukla', 'scenic'], ['lukla', 'maneuvers']]) {
    if (process.env.ONLY && `${airport}-${profile}` !== process.env.ONLY) continue;
    console.log('Starting', airport, profile);
    await evaluate(`(() => {
      const sim = window.simulator;
      sim.demoDirector.stop();
      sim.setAirport(${JSON.stringify(airport)});
      sim.lobby.preset = 'demo'; sim.lobby.demoProfile = ${JSON.stringify(profile)};
      sim.gameFlow.enterFlight();
      document.getElementById('btn-fly').click();
    })()`);
    for (let i = 0; i < 120; i++) {
      if (!(await evaluate('window.simulator.demoDirector.waitingForTerrain'))) break;
      await evaluate('window.simulator.demoDirector.update(0)');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const samples = [], stages = new Set(), cameras = new Set();
    for (let seconds = 0; seconds < 200; seconds++) {
      const sample = await evaluate(`(() => {
        const sim = window.simulator;
        sim.stepSimulation(1);
        return { active: sim.demoDirector.isActive, stage: sim.demoDirector.currentStage,
          aircraft: sim.currentAircraftId, camera: sim.cameraSystem.mode, crashed: sim.isCrashed,
          result: sim.demoDirector.getActiveScenario().result, position: sim.position.toArray(),
          ias: sim.telemetry.iasKnots, roll: sim.telemetry.rollDeg, pitch: sim.telemetry.pitchDeg,
          stalled: sim.telemetry.isStalled, throttle: sim.controls.throttle, alpha: sim.aero.alpha, beta: sim.aero.beta,
          angular: sim.angularVelocity.toArray(), vz: sim.linearVelocity.y, elevator: sim.controls.elevator, command: sim.controls.virtualElevator, route: sim.demoDirector.cessnaScenario.route };
      })()`);
      samples.push(sample);
      if (!cameras.has(sample.camera)) {
        cameras.add(sample.camera);
        await capture(`${airport}-${profile}-camera-${sample.camera}`);
      }
      if (!stages.has(sample.stage)) {
        stages.add(sample.stage); console.log(seconds, JSON.stringify(sample));
        await capture(`${airport}-${profile}-stage-${sample.stage}`);
      }
      if (sample.stage === 21 && seconds === 18) await capture(`${airport}-${profile}-low-pass`);
      if (!sample.active) break;
    }
    const last = samples.at(-1);
    results.push({ airport, profile, samples, cameras: [...cameras] });
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ errors, results }, null, 2));
    assert.equal(last.result.status, 'completed', `${airport} ${profile} completed`);
    assert.ok(samples.every(s => !s.crashed && !s.stalled && s.position.every(Number.isFinite) && s.aircraft === 'C172'), 'physical flight without crashes, stalls or aircraft substitution');
    if (profile === 'proximity') {
      // The montage's lake skim is intentionally metres above the water, and its
      // cinematic shots come from the custom view updater, not camera mode cuts.
      assert.equal(last.result.stagesCompleted, 5, 'all five proximity scenes flown');
      assert.ok(last.result.minClearanceM > 0, 'terrain clearance');
    } else {
      assert.ok(last.result.minClearanceM > 25, 'terrain clearance');
      assert.ok(cameras.size >= 2, 'cinematic shots');
    }
    assert.ok(last.throttle > 0, 'powered handoff');
    if (profile === 'maneuvers') assert.ok(last.result.maxBankDeg > 35 && last.result.maxBankDeg < 65, 'demonstrated steep turns');
  }
  // Exercise real keyboard camera override, cancellation and restart after a
  // stage boundary, then verify the original Boeing demo still starts intact.
  await evaluate(`(() => {
    const sim = window.simulator;
    sim.setAirport('coastal'); sim.lobby.demoProfile = 'maneuvers';
    sim.demoDirector.start(); sim.stepSimulation(8);
  })()`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: '7', code: 'Digit7' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: '7', code: 'Digit7' });
  await evaluate('window.simulator.stepSimulation(20)');
  assert.equal(await evaluate('window.simulator.cameraSystem.mode'), 6, 'manual drone camera survives stage transition');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  assert.ok(await evaluate(`!window.simulator.demoDirector.isActive && !window.simulator.controls.aircraftControlsDisabled && window.simulator.controls.virtualElevator === null`), 'Esc releases controls');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'p', code: 'KeyP' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP' });
  assert.equal(await evaluate('window.simulator.demoDirector.profile'), 'maneuvers', 'P restarts selected route');
  await evaluate(`(() => {
    const sim = window.simulator; sim.setAircraft('B738'); sim.demoDirector.start();
  })()`);
  assert.ok(await evaluate(`window.simulator.currentAircraftId === 'B738' && window.simulator.demoDirector.getActiveScenario() === window.simulator.demoDirector.coastalScenario && window.simulator.engines.numEngines === 2`), 'Boeing classic routing retained');
  assert.equal(errors.length, 0, 'no browser exceptions');
  console.log('PASS', results.map(({airport,profile,samples}) => ({airport,profile,...samples.at(-1).result})));
} finally {
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ errors, results }, null, 2));
  ws.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
