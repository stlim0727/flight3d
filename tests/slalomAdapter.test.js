import { test } from 'node:test';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import assert from 'node:assert/strict';
import { SlalomMissionAdapter } from '../src/arena/SlalomMissionAdapter.js';
import { SlalomMission } from '../src/arena/SlalomMission.js';
import { createSlalomSimulation } from './helpers/slalomFlight.js';
import { PilotPerception } from '../src/pilot/PilotPerception.js';
import { createBriefing, validatePlainData } from '../src/pilot/PilotProtocol.js';
import { VALLEY_SLALOM_RULES } from '../src/arena/generatedValley.js';

/** The bridge from a generated valley to production physics. These flights are
 * deliberately short: what is proved here is that the real airframe, the real
 * sensor model and the real judging path run together, not that any pilot can
 * finish a course. */

async function prepared(seed = 1, options = {}) {
  const sim = createSlalomSimulation(seed);
  const adapter = new SlalomMissionAdapter(sim);
  const preparedManifest = await adapter.prepare({ seed, ...options });
  return { sim, adapter, ...preparedManifest };
}

function keysOf(value, keys = []) {
  if (value === null || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    keysOf(child, keys);
  }
  return keys;
}

test('a generated valley installs as a mission with the shared sensor model', async () => {
  const { adapter, manifest } = await prepared(2);
  assert.equal(manifest.missionId, 'valley-slalom-v1');
  assert.equal(manifest.decisionPeriodTicks, 24);
  assert.equal(manifest.commandDelayTicks, 24);
  assert.equal(manifest.envelope.version, 'f16-slalom-envelope-v1');
  assert.deepEqual(manifest.fixedConfiguration, { gearDown: false, flapIndex: 0, spoilers: 0,
    reverser: false, parkingBrake: false, pitchTrimDeg: manifest.fixedConfiguration.pitchTrimDeg });
  assert.equal(manifest.sensorProfile.id, 'valley-navigation-v2');
  assert.equal(manifest.navigationProfile, 'gate-finish-bearing-range-v2');
  assert.equal(manifest.course.gates.length, VALLEY_SLALOM_RULES.gates);
  assert.equal(manifest.terrain.kind, 'generated-valley');
  // The seed regenerates the ground, so it belongs to the host, not the chart.
  // A sensor *spec* may be briefed (it says what the pilot can measure); the
  // terrain itself and the generator that produced it may not.
  const briefing = createBriefing(manifest);
  assert.deepEqual(keysOf(briefing).filter(key => key === 'seed' || key === 'terrain'), []);
  assert.ok(!Object.hasOwn(briefing, 'terrain'), 'the briefing carries terrain truth');
  assert.equal(briefing.capabilities.terrainRange, true);
  adapter.release();
});

test('a short wings-level hold stays a running slalom mission on real physics', async () => {
  const { adapter, manifest } = await prepared(1);
  const evaluator = new SlalomMission(manifest);
  adapter.acquire();
  adapter.apply({ elevator: 0, aileron: 0, rudder: 0, throttle: manifest.configuration.trimThrottle,
    brakes: 0 });
  let result;
  for (let tick = 0; tick < 240; tick++) {
    adapter.step();
    result = evaluator.update(adapter.snapshot(tick + 1));
    if (result.status !== 'running') break;
  }
  assert.equal(result.status, 'running', `ended as ${result.reason}`);
  const metrics = result.metrics;
  assert.ok(metrics.progressM > 400, `only ${metrics.progressM.toFixed(0)} m of course flown`);
  assert.ok(metrics.minAglM > manifest.course.clearanceFloorM);
  assert.ok(metrics.meanIasKnots >= manifest.minimumIasKnots && metrics.meanIasKnots <= manifest.maximumIasKnots);
  adapter.release();
});

test('the observation gives human and machine the same next-waypoint and destination', async () => {
  const { adapter, manifest } = await prepared(3);
  const evaluator = new SlalomMission(manifest);
  const perception = new PilotPerception({ sensorSeed: 3, noise: true, mission: manifest.id,
    runway: { headingDeg: manifest.runwayHeadingDeg, elevationM: manifest.runwayThreshold.y } });
  adapter.acquire();
  adapter.apply({ elevator: 0, aileron: 0, rudder: 0, throttle: 0.2, brakes: 0 });
  adapter.step();
  const snapshot = adapter.snapshot(1);
  const noisy = adapter.observe(perception, snapshot, 1, evaluator);
  assert.equal(noisy.navigation.currentGateIndex, 1);
  assert.equal(noisy.navigation.totalGates, manifest.course.gates.length - 1);
  for (const key of ['goalBearingDeg', 'goalRangeM', 'finishBearingDeg', 'finishRangeM']) {
    assert.ok(Number.isFinite(noisy.navigation[key].mean), `${key} has no measurement`);
    assert.ok(noisy.navigation[key].std > 0, `${key} is offered as truth, not a sensor reading`);
  }
  assert.ok(validatePlainData(noisy).ok, 'the observation does not fit the payload budget');
  // The waypoint is the middle of the passage space, not the centreline beside it.
  const gate = manifest.course.gates[1];
  const anchor = { x: gate.x + Math.cos(gate.headingDeg * Math.PI / 180) * gate.crossOffsetM,
    z: gate.z + Math.sin(gate.headingDeg * Math.PI / 180) * gate.crossOffsetM };
  assert.ok(Math.hypot(anchor.x - gate.x, anchor.z - gate.z) > 1,
    'gate 1 asks nothing of the line');
  const truthRange = Math.hypot(anchor.x - snapshot.position.x, anchor.z - snapshot.position.z);
  assert.ok(Math.abs(noisy.navigation.goalRangeM.mean - truthRange) < 3 + truthRange * 0.02,
    'the noisy waypoint range is not the same measurement the chart describes');
  adapter.release();
  // The same keys with the sensor model off are the truth the host computes, so
  // the HUD and an AI are reading one navigation model, not two.
  const quiet = await prepared(3, { noise: false });
  const quietEvaluator = new SlalomMission(quiet.manifest);
  quiet.adapter.acquire();
  quiet.adapter.apply({ elevator: 0, aileron: 0, rudder: 0, throttle: 0.2, brakes: 0 });
  quiet.adapter.step();
  const quietSnapshot = quiet.adapter.snapshot(1);
  const quietPerception = new PilotPerception({ sensorSeed: 3, noise: false, mission: quiet.manifest.id,
    runway: { headingDeg: quiet.manifest.runwayHeadingDeg, elevationM: quiet.manifest.runwayThreshold.y } });
  const clean = quiet.adapter.observe(quietPerception, quietSnapshot, 1, quietEvaluator);
  assert.equal(clean.navigation.goalRangeM.std, 0);
  assert.equal(clean.navigation.goalRangeM.mean, quietSnapshot.navigation?.goalRangeM?.mean
    ?? Math.hypot(anchor.x - quietSnapshot.position.x, anchor.z - quietSnapshot.position.z));
  quiet.adapter.release();
});

test('the bridge refuses a host that is not flying a generated valley', async () => {
  const sim = createSlalomSimulation(4);
  sim.currentTerrain = { ...sim.currentTerrain, region: 'copernicus-lukla' };
  const adapter = new SlalomMissionAdapter(sim);
  await assert.rejects(adapter.prepare({ seed: 4 }), /generated valley\/F16\/120Hz required/);
});

test('an un-flyable valley never reaches a pilot', async () => {
  const sim = createSlalomSimulation(5);
  const adapter = new SlalomMissionAdapter(sim);
  await assert.rejects(adapter.prepare({ seed: 5,
    rules: { ...VALLEY_SLALOM_RULES, floorStepDownM: 800 } }), /unflyable-course/);
});

test('adapter preparation clears crashed state so retries after crash fly rather than immediately failing', async () => {
  const sim = createSlalomSimulation(1);
  const adapter = new SlalomMissionAdapter(sim);
  await adapter.prepare({ seed: 1 });
  sim.triggerCrash({ type: 'TERRAIN', name: '지형 충돌' });
  assert.equal(sim.isCrashed, true);

  const { initialSnapshot } = await adapter.prepare({ seed: 1 });
  assert.equal(sim.isCrashed, false);
  assert.equal(initialSnapshot.crashed, false);
  assert.equal(adapter.snapshot(0).crashed, false);
});

test('adapter preparation resets aero separation, warnings, and physics accumulator for clean retry', async () => {
  const sim = createSlalomSimulation(1);
  const adapter = new SlalomMissionAdapter(sim);
  await adapter.prepare({ seed: 1 });
  sim.aero.separation = 0.85;
  sim.aero.stallSeverity = 0.85;
  sim.physicsAccumulator = 0.05;
  sim.telemetry.warnings = ['STALL'];

  await adapter.prepare({ seed: 1 });
  assert.equal(sim.aero.separation, 0.0);
  assert.equal(sim.aero.stallSeverity, 0.0);
  assert.equal(sim.physicsAccumulator, 0);
  assert.deepEqual(sim.telemetry.warnings, []);
  assert.ok(adapter.command.throttle > 0);
});

test('mission-owned physics ticks record a playable track and freeze it on release', async () => {
  const { ReplayRecorder } = await import('../src/core/ReplayRecorder.js');
  const { FlightRecorder } = await import('../src/core/FlightRecorder.js');
  const { SimulatorClass } = await import('./helpers/simulatorClass.js');
  const sim = createSlalomSimulation(1);
  sim.gameFlow = { state: 'flight' };
  sim.flightRecorder = new FlightRecorder(); sim.flightRecorder.start({ airport: 'valley', aircraft: 'F16' });
  sim.replayRecorder = new ReplayRecorder(); sim.replayRecorder.start({ airport: 'valley', aircraft: 'F16' });
  sim.updateFlightRecording = SimulatorClass.prototype.updateFlightRecording;
  sim.endFlight = () => { throw new Error('mission ticks must leave completion to the runner'); };
  const adapter = new SlalomMissionAdapter(sim);
  await adapter.prepare({ seed: 1 });
  adapter.acquire();
  adapter.apply({ elevator: 0, aileron: 0, rudder: 0, throttle: adapter.manifest.configuration.trimThrottle, brakes: 0 });
  for (let tick = 0; tick < 720; tick++) adapter.step();
  assert.ok(Math.abs(sim.replayRecorder.elapsed - 6) < 1e-8, 'one update per mission tick');
  assert.ok(Math.abs(sim.flightRecorder.elapsed - 6) < 1e-8);
  adapter.release();
  assert.ok(sim.debriefReplay.samples.length >= 30);
  assert.equal(sim.debriefReplay.metadata.airport, 'valley');
  assert.equal(sim.debriefReplay.metadata.seed, 1);
  assert.equal(sim.replayRecorder.active, false);
  // A retry can be armed before the old adapter is released again.
  sim.replayRecorder.start({ airport: 'valley', aircraft: 'F16' });
  adapter.release();
  assert.equal(sim.replayRecorder.active, true);
});

test('starting a mission repairs the selected cached F16 and replaces the inherited belly view', async () => {
  const sim = createSlalomSimulation(1);
  const outgoing = sim.aircraft;
  const cached = { ...outgoing, damaged: true,
    resetCrashVisuals() { this.damaged = false; } };
  outgoing.damaged = false;
  sim.setAircraft = () => { sim.aircraft = cached; };
  sim.cameraSystem = new CameraSystem(new THREE.PerspectiveCamera(), null);
  sim.cameraSystem.setMode(CameraSystem.MODES.GEAR, true);
  const adapter = new SlalomMissionAdapter(sim);
  // The global flag was already cleared when the pilot left the previous wreck.
  sim.isCrashed = false;
  await adapter.prepare({ seed: 1, pilotKind: 'human' });
  assert.equal(cached.damaged, false);
  assert.equal(sim.cameraSystem.mode, CameraSystem.MODES.HUD);
  assert.equal(sim.cameraSystem.userLookOverridden, false);
});

test('coordinated mission starts arm each recording once and preserve prepared seed on retry', async () => {
  const { PilotMissionAdapter } = await import('../src/arena/PilotMissionAdapter.js');
  const { ReplayRecorder } = await import('../src/core/ReplayRecorder.js');
  const { FlightRecorder } = await import('../src/core/FlightRecorder.js');
  const { SimulatorClass } = await import('./helpers/simulatorClass.js');
  const { createSimulatorScenarioStart } = await import('../src/core/simulatorScenarioStart.js');
  const { GameFlowController } = await import('../src/ui/GameFlowController.js');
  const sim = createSlalomSimulation(1);
  let recordingStarts = 0;
  Object.assign(sim, {
    devRunner: { stop() {} }, shadowDemo: { stop() {} }, replayDirector: { stop() {} },
    demoDirector: { userTimeOfDayOverridden: true, stop() {} },
    gameFlow: new GameFlowController(), sky: { timeOfDay: 12 },
    lobby: { airport: 'valley', aircraft: 'F16', preset: 'valley' }, lastPresetType: 'valley',
    flightRecorder: new FlightRecorder(), replayRecorder: new ReplayRecorder(),
    beginFlightRecording() { recordingStarts++; SimulatorClass.prototype.beginFlightRecording.call(this); },
    updateFlightRecording: SimulatorClass.prototype.updateFlightRecording,
  });
  const adapter = new PilotMissionAdapter(sim);
  sim.startValleyMission = ({ pilotKind }) => adapter.prepare({ missionId: 'valley-slalom-v1', seed: 1, pilotKind });
  const start = createSimulatorScenarioStart(sim);
  let previous;
  for (let attempt = 0; attempt < 2; attempt++) {
    await start.start();
    assert.equal(recordingStarts, attempt + 1);
    assert.equal(sim.replayRecorder.active, true);
    assert.equal(sim.flightRecorder.active, true);
    assert.equal(sim.replayRecorder.elapsed, 0);
    assert.equal(sim.debriefReplay, null);
    assert.equal(sim.replayRecorder.metadata.airport, 'valley');
    assert.equal(sim.replayRecorder.metadata.seed, 1);
    adapter.acquire();
    for (let tick = 0; tick < 720; tick++) adapter.step();
    adapter.release();
    assert.ok(sim.debriefReplay.samples.length >= 30);
    assert.notEqual(sim.debriefReplay, previous);
    previous = sim.debriefReplay;
  }
});
