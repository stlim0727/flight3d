// Issue #524: a lazy mission must never simulate the outgoing scene's pose.
// Run with the hardware Chrome wrapper described in docs/development/browser-gpu.md.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowserSession } from './lib/browserHarness.mjs';

process.env.GPU_ANGLE = 'vulkan';
process.env.CHROME_PATH ||= '/home/stlim/.local/bin/chrome-headless';
const artifacts = '.tmp/scenario-start';
await mkdir(artifacts, { recursive: true });
await withBrowserSession({}, async b => {
  const gpu = JSON.parse(execFileSync('node', ['scripts/verify-browser-gpu.mjs',
    `http://127.0.0.1:${b.cdpPort}`], { encoding: 'utf8' }));
  const waitFor = async (expression, label) => {
    for (let i = 0; i < 150; i++) {
      if (await b.evaluate(expression)) return;
      await b.delay(200);
    }
    throw new Error(`Timed out: ${label}; ${JSON.stringify(b.exceptions)}`);
  };
  const state = () => b.evaluate(() => ({
    crashed: sim.isCrashed, aircraftCrashed: sim.aircraft.isCrashed,
    visible: sim.aircraft.group.visible, debris: sim.aircraftBreakup.pieces.length,
    explosions: window.startExplosions, mode: sim.cameraSystem.mode,
    starting: sim.startingFlight, status: sim.pilotArena?.record?.status,
    detail: sim.pilotArena?.record?.detail, tick: sim.pilotArena?.record?.tick,
  }));
  await b.send('Page.navigate', { url: `${b.origin}/?aircraft=F16&quality=ultraLow` });
  await b.send('Page.bringToFront');
  await waitFor('Boolean(window.sim?.startupReady)', 'simulator boot');
  await b.send('Network.enable');
  await b.send('Network.emulateNetworkConditions', {
    offline: false, latency: 1500, downloadThroughput: 10000000, uploadThroughput: 10000000,
  });
  await b.evaluate(async () => {
    const s = window.sim;
    s.demoDirector.stop();
    s.gameFlow.returnToLobby(false);
    s.gameFlow.holdForPendingStart();
    await s.setAirport('valley');
    s.setAircraft('F16');
    // Deliberately invalid outgoing pose: any accidental tick must collide.
    s.position.set(0, -100, 0);
    s.setTimeOfDay(12.5, { persist: false, userChoice: true });
    Object.assign(s.lobby, { airport: 'valley', preset: 'valley', aircraft: 'F16', pilotMode: 'human' });
    window.startExplosions = 0;
    const play = s.audio.playExplosion.bind(s.audio);
    s.audio.playExplosion = (...args) => { window.startExplosions++; return play(...args); };
    s.cameraSystem.setMode(5, true); // CameraSystem.MODES.GEAR
    void s.fly();
  });
  await b.delay(600);
  const loading = await state();
  await b.send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  await waitFor('sim.pilotArena?.record?.status === "running"', 'first valley start');
  const started = await state();
  await b.screenshot(`${artifacts}/valley-hud.png`);
  console.log('First start:', JSON.stringify({ loading, started }));
  assert.equal(loading.starting, true, 'lazy import lost start ownership');
  assert.equal(loading.crashed, false, 'outgoing pose collided during loading');
  assert.equal(loading.explosions, 0, 'explosion sound was triggered during loading');
  assert.equal(started.mode, 8, 'mission inherited a cinematic view instead of HUD');
  assert.equal(started.aircraftCrashed, false);
  assert.equal(started.crashed, false);
  assert.equal(started.debris, 0);

  // Real crash -> menu -> fresh mission, including the active runner's cleanup.
  await b.evaluate(async () => {
    sim.pilotArena.stop('verification');
    sim.triggerCrash({ type: 'TERRAIN', name: 'Verification', point: sim.position.clone() });
    sim.gameFlow.returnToLobby(false);
    await sim.fly();
  });
  await waitFor('sim.pilotArena?.record?.status === "running"', 'crash retry');
  const retry = await state();
  assert.equal(retry.crashed, false);
  assert.equal(retry.aircraftCrashed, false);
  assert.equal(retry.visible, true);
  assert.equal(retry.debris, 0);
  assert.equal(retry.mode, 8);
  assert.equal(retry.explosions, 1, 'retry triggered an extra explosion');

  // A cached F16 can be damaged even when a different aircraft has cleared the global flag.
  await b.evaluate(async () => {
    sim.pilotArena.stop('verification');
    sim.clearCrashState();
    sim.aircraft.triggerCrashVisuals('TERRAIN');
    sim.setAircraft('C172');
    sim.clearCrashState();
    sim.gameFlow.returnToLobby(false);
    Object.assign(sim.lobby, { airport: 'valley', aircraft: 'F16', preset: 'valley' });
    await sim.fly();
  });
  await waitFor('sim.pilotArena?.record?.status === "running"', 'cached aircraft start');
  const cached = await state();
  assert.equal(cached.aircraftCrashed, false);
  assert.equal(cached.visible, true);
  assert.equal(cached.crashed, false);
  assert.equal(cached.explosions, 1);
  assert.equal(cached.mode, 8);
  await b.screenshot(`${artifacts}/cached-f16-hud.png`);
  // Exercise the extracted coordinator's real scene-swap and ordinary paths.
  const transitions = await b.evaluate(async () => {
    sim.pilotArena.stop('verification');
    sim.gameFlow.returnToLobby(true);
    Object.assign(sim.lobby, { airport: 'coastal', aircraft: 'C172', preset: 'runway' });
    await sim.fly();
    const rebuilt = { airport: sim.activeAirport, aircraft: sim.currentAircraftId,
      starting: sim.startingFlight, busy: sim.flightStartCoordinator.busy,
      overlayHidden: document.getElementById('startup-overlay').hidden,
      flow: sim.gameFlow.state, crashed: sim.isCrashed };
    sim.lobby.preset = 'cruise';
    const ordinary = sim.fly();
    const synchronousPreset = sim.lastPresetType;
    await ordinary;
    const result = { rebuilt, synchronousPreset, starting: sim.startingFlight,
      busy: sim.flightStartCoordinator.busy, crashed: sim.isCrashed };
    sim.gameFlow.pause();
    return result;
  });
  assert.deepEqual(transitions.rebuilt, { airport: 'coastal', aircraft: 'C172',
    starting: false, busy: false, overlayHidden: true, flow: 'flight', crashed: false });
  assert.equal(transitions.synchronousPreset, 'cruise');
  assert.equal(transitions.starting, false);
  assert.equal(transitions.busy, false);
  assert.equal(transitions.crashed, false);

  // A scene failure must release UI/physics ownership without exposing Resume or Ready.
  const failed = await b.evaluate(async () => {
    sim.gameFlow.returnToLobby(true);
    sim.lobby.airport = 'lukla';
    const setAirport = sim.setAirport;
    sim.setAirport = async () => { throw Error('verification: scene load failure'); };
    try { await sim.fly(); }
    finally { sim.setAirport = setAirport; }
    return { starting: sim.startingFlight, applying: sim.applyingPendingStart,
      busy: sim.flightStartCoordinator.busy, frozen: sim.gameFlow.isPhysicsFrozen(),
      resume: sim.gameFlow.canResumeFromLobby(), flow: sim.gameFlow.state,
      overlayHidden: document.getElementById('startup-overlay').hidden,
      progress: Number(document.getElementById('startup-progress').value) };
  });
  assert.deepEqual(failed, { starting: false, applying: false, busy: false,
    frozen: true, resume: false, flow: 'lobby', overlayHidden: true, progress: 1 });
  const report = { gpu, loading, started, retry, cached, transitions, failed, exceptions: b.exceptions };
  await writeFile(`${artifacts}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(b.exceptions, []);
});
