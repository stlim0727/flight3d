import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = Number(process.env.PORT || 5173);
const cdpPort = Number(process.env.CDP_PORT || 9468);
const artifactDir = path.resolve(process.env.ARTIFACT_DIR || 'review-artifacts/landing-damage');
mkdirSync(artifactDir, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), 'flight3d-landing-'));
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome-stable', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
  '--use-gl=angle', process.env.FORCE_GPU === '1' ? '--use-angle=vulkan' : '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--window-size=1280,720',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`, `http://127.0.0.1:${port}/`,
], { stdio: 'ignore' });
let ws;
let launchError;
chrome.on('error', error => { launchError = error; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let target;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    try {
      target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json())
        .find(t => t.type === 'page' && t.url.includes(`:${port}`));
    } catch { /* Chrome is starting. */ }
    if (target) break;
    await pause(200);
  }
  assert.ok(target, 'Chrome CDP page must become available');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const exceptions = [];
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
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
    return result.result?.value;
  };
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await evaluate('Boolean(window.simulator?.aircraft?.modelLoaded && window.THREE)');
    if (ready) break;
    await pause(250);
  }
  assert.ok(ready, 'Simulator and loaded aircraft must initialize');
  await evaluate(`(() => {
    const sim = window.simulator;
    sim.demoDirector.stop();
    sim.gameFlow.enterFlight();
    sim.setAirport('coastal');
    sim.clock.getDelta = () => 0;
    sim.physicsAccumulator = 0;
    window.requestAnimationFrame = () => 0;
    window.landingSetup = (gear, y, sink, roll = 0, failed = [], speed = 60, pitch = 0) => {
      sim.setPreset('runway');
      sim.controls.throttle = 0;
      sim.engines.n1.fill(22); sim.engines.n2.fill(62); sim.engines.egt.fill(420); sim.engines.fuelFlow.fill(350);
      sim.controls.setParkingBrake(false);
      sim.controls.virtualBrakes = 1;
      sim.autopilot.disengage();
      sim.gear.gearState = gear;
      sim.gear.targetGearState = gear > 0 ? 1 : 0;
      const ground = sim.currentTerrain.getHeight(-1000, 0);
      sim.position.set(-1000, ground + y, 0);
      for (const c of sim.gear.contacts) if (failed.includes(c.id)) { c.damage = 1; c.damageState = "collapsed"; }
      sim.quaternion.setFromEuler(new THREE.Euler(pitch, -Math.PI / 2, roll, 'YXZ'));
      sim.linearVelocity.set(speed, -sink, 0);
      sim.angularVelocity.set(0, 0, 0);
      sim.aircraft.group.position.copy(sim.position);
      sim.aircraft.group.quaternion.copy(sim.quaternion);
      sim.aircraft.group.updateMatrixWorld(true);
      sim.cameraSystem.setMode(1);
      sim.cameraSystem.snapToTarget(sim.aircraft.group);
    };
    window.landingSample = seconds => {
      sim.stepSimulation(seconds);
      return { position: sim.position.toArray(), speed: sim.linearVelocity.length(),
        angularSpeed: sim.angularVelocity.length(), gear: sim.telemetry.gearDamage,
        body: sim.telemetry.bodyContacts, bodyDamage: { ...sim.gear.bodyDamage },
        engines: [sim.telemetry.engine1, sim.telemetry.engine2],
        minClearance: Math.min(...sim.gear.bodySupportPoints.map(p => {
          const v = new THREE.Vector3(...p.position).applyQuaternion(sim.quaternion).add(sim.position);
          return v.y - sim.currentTerrain.getHeight(v.x, v.z);
        })), crashed: sim.isCrashed, crash: sim.crashResult?.name,
        damage: sim.gear.structuralDamage, stopped: sim.landingStopped,
        gearLabel: document.getElementById('hud-gear').textContent,
        ground: sim.currentTerrain.getHeight(sim.position.x, sim.position.z) };
    };
  })()`);
  const results = {};
  for (const [name, setup, seconds] of [
    ['normal', [1, 4, 1], 10], ['hard', [1, 3.9, 11], 3],
    ['asymmetric', [1, 3.9, 11, 0.1], 1 / 120], ['unlocked', [0.8, 3, 2], 3],
    ['left-collapse', [1, 3.5, 0, 0, ['mainLeft'], 40], 35],
    ['right-collapse', [1, 3.5, 0, 0, ['mainRight'], 40], 35],
    ['both-collapse', [1, 3.5, 0, 0, ['mainLeft', 'mainRight']], 40],
    ['nose-collapse', [1, 3.5, 0, 0, ['nose'], 30], 30],
    ['belly', [0, 3.3, 1], 40], ['catastrophic', [0, 3, 20], 1],
  ]) {
    await evaluate(`window.landingSetup(...${JSON.stringify(setup)})`);
    const samples = await evaluate(`(() => {
      const samples = [];
      for (let t = 0; t < ${seconds}; t += 0.1) {
        const sample = window.landingSample(Math.min(0.1, ${seconds} - t));
        samples.push(sample);
        if (sample.crashed) break;
      }
      return samples;
    })()`);
    // Hold the final state for ten more simulated seconds: parked damage must
    // stay parked, and the wreckage must retain its clearance too.
    const hold = await evaluate('window.landingSample(10)');
    const meshClearance = await evaluate(`(() => {
      const sim = window.simulator;
      sim.aircraft.group.updateMatrixWorld(true);
      let minimum = Infinity;
      const v = new THREE.Vector3();
      sim.aircraft.gltfModel.traverse(mesh => {
        if (!mesh.isMesh) return;
        const positions = mesh.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          v.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
          minimum = Math.min(minimum, v.y - sim.currentTerrain.getHeight(v.x, v.z));
        }
      });
      return minimum;
    })()`);
    results[name] = { samples, hold, meshClearance };
    if (process.argv.includes('--screenshots')) {
      await evaluate(`(() => {
        const sim = window.simulator;
        sim.cameraSystem.setMode(1);
        sim.cameraSystem.snapToTarget(sim.aircraft.group);
        sim.cameraSystem.update(1, sim.aircraft.group, sim.telemetry, (x,z) => sim.currentTerrain.getHeight(x,z));
        sim.camera.position.copy(sim.position).add(new THREE.Vector3(32, 8, 30).applyQuaternion(sim.quaternion));
        sim.camera.lookAt(sim.position);
        sim.updateHUD();
        sim.renderer.render(sim.scene, sim.camera);
      })()`);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path.join(artifactDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
      if (name === 'left-collapse') {
        await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
        await evaluate(`(() => {
          const sim = window.simulator;
          sim.renderer.setSize(412, 915); sim.camera.aspect = 412 / 915; sim.camera.updateProjectionMatrix();
          sim.camera.position.copy(sim.position).add(new THREE.Vector3(65, 18, 65).applyQuaternion(sim.quaternion));
          sim.camera.lookAt(sim.position); sim.renderer.render(sim.scene, sim.camera);
        })()`);
        const mobile = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(path.join(artifactDir, 'left-collapse-mobile.png'), Buffer.from(mobile.data, 'base64'));
        await send('Emulation.clearDeviceMetricsOverride');
        await evaluate('window.simulator.renderer.setSize(1280,720); window.simulator.camera.aspect=1280/720; window.simulator.camera.updateProjectionMatrix()');
      }
    }
    console.log(name, JSON.stringify(samples.at(-1)));
  }
  writeFileSync(path.join(artifactDir, 'scenarios.json'), JSON.stringify(results, null, 2));
  for (const { samples, hold, meshClearance } of Object.values(results)) {
    assert.ok(Number.isFinite(meshClearance) && meshClearance >= -0.10, `Visible airframe clearance: ${meshClearance}`);
    assert.ok(samples.length > 0);
    for (const s of [...samples, hold]) {
      assert.ok([...s.position, s.speed, s.angularSpeed].every(Number.isFinite), 'No NaN/Infinity');
      assert.ok(Number.isFinite(s.minClearance) && s.minClearance >= -0.04001, 'Every body patch stays above penetration limit');
    }
  }
  assert.ok(results.normal.samples.every(s => !s.crashed && Object.values(s.gear).every(g => g === 'normal')), 'Normal landing must remain intact');
  assert.ok(results.hard.samples.some(s => Object.values(s.gear).includes('collapsed')), 'Hard touchdown must collapse a leg');
  assert.equal(Object.values(results.asymmetric.samples.at(-1).gear).filter(s => s === 'collapsed').length, 1, 'Initial asymmetric impact must fail one leg');
  assert.equal(results.asymmetric.samples.at(-1).gearLabel, 'FAIL', 'HUD must indicate collapsed gear');
  assert.ok(results.unlocked.samples.some(s => Object.values(s.gear).includes('collapsed')), 'Unlocked gear must lose support');
  assert.ok(results.belly.samples.every(s => !s.crashed), 'Controlled belly landing must not explode');
  assert.ok(results.belly.samples.some(s => s.body.length > 0), 'Body must contact runway');
  assert.ok(results.belly.samples.at(-1).speed < 0.5, 'Body friction must stop aircraft');
  assert.ok(results.catastrophic.samples.some(s => s.crashed), 'Extreme body impact must remain fatal');
  for (const name of ['left-collapse', 'right-collapse', 'both-collapse', 'nose-collapse', 'belly']) {
    const { samples, hold } = results[name];
    const last = samples.at(-1);
    assert.ok(samples.some(s => s.body.length > 0), `${name}: body contact required`);
    assert.ok(samples.some(s => Object.values(s.bodyDamage).some(d => d > 0.01)), `${name}: secondary damage required`);
    assert.ok(last.stopped && last.speed < 0.5 && !last.crashed, `${name}: controlled stop required`);
    assert.ok(hold.stopped && hold.speed < 0.5, `${name}: stable ten-second rest`);
    for (const [id, damage] of Object.entries(last.bodyDamage)) {
      assert.ok(Math.abs(hold.bodyDamage[id] - damage) < 0.0001, `${name}: no abrasion at rest (${id})`);
    }
  }
  for (const [name, index] of [['left-collapse', 0], ['right-collapse', 1]]) {
    const { hold } = results[name];
    assert.ok(hold.engines[index].thrust < hold.engines[1-index].thrust, `${name}: damaged engine loses thrust`);
  }
  await evaluate('window.simulator.setPreset("runway")');
  assert.ok(await evaluate('window.simulator.gear.contacts.every(c => c.damage === 0) && window.simulator.gear.structuralDamage === 0 && Object.values(window.simulator.gear.bodyDamage).every(d => d === 0) && window.simulator.engines.contactDamage.every(d => d === 0)'), 'Preset must repair all damage');
  assert.equal(exceptions.length, 0, 'No uncaught browser exceptions');
  console.log('Landing damage browser scenarios passed.');
} finally {
  ws?.close();
  chrome.kill();
  await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), pause(2000)]);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`Chrome profile cleanup deferred: ${error.code}`);
  }
}
