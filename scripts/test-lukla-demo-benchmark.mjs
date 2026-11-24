/** Run the real browser physics circuit; incomplete flights must fail this gate. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT = Number(process.env.PORT || 5173);
const CDP_PORT = Number(process.env.CDP_PORT || 9488);
const SIM_URL = `http://127.0.0.1:${PORT}/?terrain=lukla&scenario=demo`;
const ARTIFACT_DIR = path.resolve(process.env.ARTIFACT_DIR || '.tmp/lukla-physics');
const screenshots = process.argv.includes('--screenshots');
const rootExecution = process.getuid?.() === 0;
const repetitions = Number(process.env.LUKLA_RUNS || 3);
assert.ok(Number.isInteger(repetitions) && repetitions > 0 && repetitions <= 10);

async function main() {
  assert.ok((await fetch(SIM_URL)).ok, `Start Vite on port ${PORT}`);
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const profile = fs.mkdtempSync('/tmp/chrome-lukla-physics-');
  const chrome = spawn('google-chrome-stable', [
    '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720', '--use-gl=angle', '--use-angle=vulkan',
    '--disable-dev-shm-usage', '--no-first-run',
    ...(rootExecution ? ['--no-sandbox'] : []), 'about:blank'
  ], { stdio: 'ignore' });
  let ws;
  try {
    let page;
    for (let i = 0; i < 60 && !page; i++) {
      await new Promise(r => setTimeout(r, 100));
      try {
        page = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json())
          .find(t => t.type === 'page' && t.url === 'about:blank');
      } catch { /* Chrome may still be starting. */ }
    }
    assert.ok(page, 'Chrome CDP page must be available');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 0;
    const pending = new Map();
    let heldDemRequest;
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Fetch.requestPaused') {
        heldDemRequest = msg.params.requestId;
        return;
      }
      const request = pending.get(msg.id);
      if (!request) return;
      pending.delete(msg.id);
      clearTimeout(request.timer);
      if (msg.error) request.reject(new Error(msg.error.message));
      else request.resolve(msg.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    // Exercise the real constructor auto-start with a deliberately delayed DEM.
    // A test-only second start() after loading would hide a broken startup path.
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/terrain/lukla_dem.bin', requestStage: 'Request' }] });
    await send('Page.navigate', { url: SIM_URL });
    await send('Page.bringToFront');
    let startupPending;
    for (let i = 0; i < 100 && !startupPending; i++) {
      startupPending = await evaluate(`(() => {
        const sim = window.simulator;
        if (!sim?.luklaTerrain || !sim.demoDirector?.luklaScenario) return null;
        return { loaded: sim.luklaTerrain.isLoaded, active: sim.demoDirector.isActive,
          waiting: sim.demoDirector.waitingForTerrain, outcome: sim.demoDirector.luklaScenario.result.status };
      })()`);
      if (!startupPending) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(heldDemRequest, 'The DEM must actually be delayed by request interception');
    assert.deepEqual(startupPending, { loaded: false, active: true, waiting: true, outcome: 'pending' });
    await send('Fetch.continueRequest', { requestId: heldDemRequest });
    await send('Fetch.disable');
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      ready = await evaluate(`!!(window.simulator?.luklaTerrain?.isLoaded &&
        window.simulator.demoDirector.isActive && !window.simulator.demoDirector.waitingForTerrain &&
        window.simulator.demoDirector.luklaScenario.result.status === 'running')`);
      if (!ready) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(ready, 'Constructor auto-start must resume after the measured DEM loads');
    const startup = { pending: startupPending, resumed: ready };
    const renderer = await evaluate(`(() => {
      const gl = window.simulator.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    })()`);
    await evaluate(`(() => {
      const sim = window.simulator;
      sim.clock.getDelta = () => 0;
      sim.physicsAccumulator = 0;
      sim.gameFlow.enterFlight();
      return true;
    })()`);
    const cancellations = [];
    for (const action of ['escape', 'preset', 'airport']) {
      const before = await evaluate(`(() => {
        window.simulator.demoDirector.start('lukla');
        return window.simulator.demoDirector.luklaScenario.result.status;
      })()`);
      await evaluate(`(() => {
        const sim = window.simulator;
        if ('${action}' === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        if ('${action}' === 'preset') sim.setPreset('runway');
        if ('${action}' === 'airport') sim.setAirport('coastal');
        return true;
      })()`);
      let result = null;
      for (let i = 0; i < 30 && !result; i++) {
        result = await evaluate(`(() => {
          const director = window.simulator.demoDirector;
          return director.isActive || director.luklaScenario.result.status === 'pending' ? null
            : { active: director.isActive, outcome: director.luklaScenario.result.status };
        })()`);
        if (!result) await new Promise(resolve => setTimeout(resolve, 100));
      }
      cancellations.push({ action, before, active: result?.active ?? true,
        outcome: result?.outcome ?? 'pending' });
    }
    for (const cancellation of cancellations) {
      assert.equal(cancellation.before, 'running');
      assert.equal(cancellation.active, false);
      assert.equal(cancellation.outcome, 'cancelled');
    }
    const reports = [];
    for (let run = 0; run < repetitions; run++) {
      // Step the circuit in one browser task: interleaving CDP round-trips with
      // the live frame loop lets the lobby restart a finished demo between runs.
      const report = await evaluate(`(async () => {
        const sim = window.simulator;
        sim.clock.getDelta = () => 0;
        sim.physicsAccumulator = 0;
        await sim.setAirport('lukla');
        sim.gameFlow.enterFlight();
        sim.demoDirector.start('lukla');
        const metrics = { stallFrames: 0, maxAlpha: 0, stages: [], touchdowns: [], finite: true };
        const original = sim.integratePhysics.bind(sim);
        sim.integratePhysics = function(dt) {
          original(dt);
          metrics.stallFrames += this.aero.isStalled ? 1 : 0;
          metrics.maxAlpha = Math.max(metrics.maxAlpha, this.aero.alpha * 180 / Math.PI);
          metrics.finite &&= [...this.position, ...this.linearVelocity, ...this.angularVelocity].every(Number.isFinite);
          const stage = this.demoDirector.currentStage;
          if (metrics.stages.at(-1) !== stage) metrics.stages.push(stage);
          if (this.demoDirector.luklaScenario.result.airborne && this.gear.touchdownEvent) {
            metrics.touchdowns.push({ speedKt: this.telemetry.iasKnots,
              contacts: this.gear.contacts.filter(c => c.touchdownThisFrame).map(c => c.id) });
          }
        };
        let slices = 0;
        for (; slices < 960; slices++) {
          sim.stepSimulation(0.25);
          const d = sim.demoDirector;
          if (sim.isCrashed || !d.isActive
            || ['completed', 'cancelled', 'failed'].includes(d.luklaScenario.result.status)) break;
        }
        const result = structuredClone(sim.demoDirector.luklaScenario.result);
        const stop = sim.position.clone();
        sim.stepSimulation(10);
        const s = sim.position.x * 0.848048 - sim.position.z * 0.529919;
        sim.integratePhysics = original;
        return { ...metrics, result, slices, maxImpact: sim.gear.maxImpactSpeed,
          remainingRunwayM: 263.5 - s, holdDriftM: sim.position.distanceTo(stop),
          speedMs: sim.linearVelocity.length(), gearFailure: sim.gear.failure,
          crashed: sim.isCrashed, parkingBrake: sim.controls.parkingBrake,
          gates: { flow: sim.gameFlow.state, starting: sim.startingFlight,
            blocks: sim.devRunner?.blocksPhysics, restart: sim.demoDirector.isRestartConfirmOpen,
            loaded: sim.currentTerrain?.isLoaded, waiting: sim.demoDirector.waitingForTerrain } };
      })()`);
      if (screenshots && run === 0) {
        await evaluate('window.simulator.renderer.render(window.simulator.scene, window.simulator.camera)');
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'final-stage.png'), Buffer.from(shot.data, 'base64'));
      }
      reports.push(report);
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'report.json'), JSON.stringify({ renderer, startup, reports }, null, 2));
      assert.ok(report.slices < 960, 'Circuit timed out; stage changes cannot count as success');
      assert.equal(report.result.status, 'completed', JSON.stringify(report));
      assert.equal(report.crashed, false);
      assert.equal(report.gearFailure, null);
      assert.equal(report.finite, true);
      assert.equal(report.stallFrames, 0);
      assert.ok([0, 1, 2, 3, 4].every(s => report.stages.includes(s)));
      assert.ok(report.touchdowns.length > 0, 'A real touchdown event must be observed');
      assert.ok(report.remainingRunwayM > 50, 'Stop with runway margin');
      assert.ok(report.speedMs < 0.1);
      assert.ok(report.holdDriftM < 0.1, 'Parking brake must hold on the slope for 10s');
      console.log(`Run ${run + 1}: ${report.result.elapsedSeconds.toFixed(1)}s; max impact ${report.maxImpact.toFixed(2)}m/s; runway remaining ${report.remainingRunwayM.toFixed(1)}m; hold drift ${report.holdDriftM.toFixed(3)}m`);
    }
    const crashStop = await evaluate(`(() => {
      const sim = window.simulator;
      sim.demoDirector.start('lukla');
      const description = 'Review regression: actual triggerCrash lifecycle';
      sim.triggerCrash({ collided: true, type: 'TERRAIN', name: 'Lifecycle regression',
        point: sim.position.clone(), speedKnots: 0, description });
      const immediate = structuredClone(sim.demoDirector.luklaScenario.result);
      sim.demoDirector.update(1 / 120);
      return { active: sim.demoDirector.isActive, crashed: sim.isCrashed,
        immediate, afterUpdate: structuredClone(sim.demoDirector.luklaScenario.result) };
    })()`);
    assert.equal(crashStop.active, false);
    assert.equal(crashStop.crashed, true);
    assert.equal(crashStop.immediate.status, 'failed');
    assert.equal(crashStop.immediate.reason, 'Review regression: actual triggerCrash lifecycle');
    assert.deepEqual(crashStop.afterUpdate, crashStop.immediate, 'No extra active scenario update is needed to record failure');
    const rejectedImpacts = await evaluate(`(() => {
      const sim = window.simulator;
      const cases = [];
      for (const uphill of [false, true]) {
        sim.setAirport(uphill ? 'lukla' : 'coastal');
        sim.setPreset('runway');
        sim.controls.setParkingBrake(false);
        const heading = uphill ? 58 * Math.PI / 180 : 0;
        const x = uphill ? -150 * Math.sin(heading) - 5 * Math.cos(heading) : -1000;
        const z = uphill ? 150 * Math.cos(heading) - 5 * Math.sin(heading) : 0;
        const y = sim.currentTerrain.getHeight(x, z) + 3.75;
        sim.position.set(x, y, z);
        sim.quaternion.setFromEuler(new THREE.Euler(uphill ? Math.atan(0.1176) : 0, -heading, 0, 'YXZ'));
        sim.angularVelocity.set(0, 0, 0);
        sim.linearVelocity.set(65 * Math.sin(heading), uphill ? 0 : -20, -65 * Math.cos(heading));
        sim.aircraft.group.position.copy(sim.position);
        sim.aircraft.group.quaternion.copy(sim.quaternion);
        sim.aircraft.group.updateMatrixWorld(true);
        sim.integratePhysics(1 / 120);
        cases.push({ uphill, crashed: sim.isCrashed, failure: sim.gear.failure,
          yChanged: sim.position.y !== y, massKg: sim.aero.mass });
      }
      return cases;
    })()`);
    for (const impact of rejectedImpacts) {
      assert.equal(impact.crashed, true, JSON.stringify(impact));
      assert.equal(impact.failure?.reason, 'impact');
      assert.ok(impact.failure.sinkRate > (impact.uphill ? 7 : 19));
      assert.equal(impact.yChanged, false, 'Impact must be detected before correcting position');
      assert.equal(impact.massKg, 66000, 'Manual presets must restore default aircraft loading');
    }
    const loadFailures = [];
    for (const mode of ['http', 'network']) {
      heldDemRequest = undefined;
      await send('Fetch.enable', { patterns: [{ urlPattern: '*/terrain/lukla_dem.bin', requestStage: 'Request' }] });
      await send('Page.navigate', { url: SIM_URL + '?demFailure=' + mode });
      for (let i = 0; i < 100 && !heldDemRequest; i++) await new Promise(r => setTimeout(r, 100));
      assert.ok(heldDemRequest, 'Failure case must intercept a fresh DEM request');
      if (mode === 'http') await send('Fetch.fulfillRequest', { requestId: heldDemRequest, responseCode: 503, body: '' });
      else await send('Fetch.failRequest', { requestId: heldDemRequest, errorReason: 'Failed' });
      await send('Fetch.disable');
      let state;
      for (let i = 0; i < 100; i++) {
        state = await evaluate(`(() => {
          const sim = window.simulator;
          if (!sim || !sim.luklaTerrain.loadError) return null;
          return { active: sim.demoDirector.isActive, waiting: sim.demoDirector.waitingForTerrain,
            outcome: sim.demoDirector.luklaScenario.result.status,
            reason: sim.demoDirector.luklaScenario.result.reason,
            parkingBrake: sim.controls.parkingBrake, gearBrakes: sim.gear.brakes };
        })()`);
        if (state?.outcome === 'failed' && !state.active) break;
        await new Promise(r => setTimeout(r, 100));
      }
      assert.ok(state, 'DEM failure must be observable');
      assert.equal(state.outcome, 'failed');
      assert.equal(state.active, false);
      assert.equal(state.waiting, false);
      assert.equal(state.parkingBrake, false);
      assert.equal(state.gearBrakes, 0);
      assert.ok(state.reason);
      loadFailures.push({ mode, ...state });
    }
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'report.json'), JSON.stringify({ renderer, rootExecution, startup, cancellations, reports, crashStop, rejectedImpacts, loadFailures }, null, 2));
    console.log(`PASS: ${reports.length} complete circuits. ${path.join(ARTIFACT_DIR, 'report.json')}`);
  } finally {
    ws?.close();
    chrome.kill('SIGTERM');
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
