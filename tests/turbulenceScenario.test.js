import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilotMissionSimulation } from './helpers/pilotMissionFlight.js';
import { DevScenarioRunner } from '../src/dev/DevScenarioRunner.js';
import { DeveloperModeController } from '../src/dev/DeveloperModeController.js';
import { GameFlowController } from '../src/ui/GameFlowController.js';
import { WindField, setSimulationWind } from '../src/physics/WindField.js';
import { advancePhysicsFrame, stepPhysics } from '../src/core/physicsTiming.js';
import { AIRCRAFT_REGISTRY } from '../src/config/aircraftConfigs.js';

function flight(profile = 'light-turbulence-v1', scenario = 'turbulence', aircraftId = 'B738') {
  const sim = createPilotMissionSimulation({ aircraftId });
  sim.aircraft.modelLoaded = true;
  sim.aircraft.cockpit = {};
  sim.shadowDemo = { stop() {} };
  sim.cameraSystem.setMode = () => {};
  sim.gameFlow = new GameFlowController();
  sim.syncFlowUi = () => { sim.controls.inputBlocked = sim.gameFlow.blocksFlightInput() || sim.devRunner.blocksInput; };
  const mode = new DeveloperModeController(); mode.enable();
  sim.devRunner = new DevScenarioRunner(sim, mode);
  assert.equal(sim.devRunner.start(scenario), true);
  sim.devRunner.updatePreparation(0);
  assert.equal(sim.devRunner.status, 'running');
  if (profile !== 'light-turbulence-v1') {
    setSimulationWind(sim, profile ? new WindField({ profile, seed: sim.windField.seed, runwayHeadingDeg: 63 }) : null);
  }
  return sim;
}

const state = s => [s.position.toArray(), s.quaternion.toArray(), s.linearVelocity.toArray(), s.angularVelocity.toArray()];

const levels = [
  ['turbulence', 'light-turbulence-v1'],
  ['turbulence-moderate', 'moderate-turbulence-v1'],
  ['turbulence-strong', 'strong-turbulence-v1'],
];

test('all three menu scenarios share initial conditions and fly 60 s with increasing response', () => {
  let initial, previousRollRange = 0;
  for (const [id, profile] of levels) {
    const sim = flight(undefined, id);
    const setup = { state: state(sim), throttle: sim.controls.throttle, trim: sim.controls.pitchTrim,
      mass: sim.aero.mass, seed: sim.windField.seed, heading: sim.windField.runwayHeadingDeg };
    initial ??= setup;
    assert.deepEqual(setup, initial);
    assert.equal(sim.windField.profile, profile);
    let minRoll = Infinity, maxRoll = -Infinity;
    for (let tick = 0; tick < 7200; tick++) {
      stepPhysics(sim);
      if (tick === 0 && id !== 'turbulence') {
        assert.ok(Math.abs(sim._aeroResult.wingGustRollMoment) > 1000, `${id}: gust acts from the first tick`);
        assert.notDeepEqual(sim.aero.windLeftWorld, sim.aero.windRightWorld);
      }
      minRoll = Math.min(minRoll, sim.telemetry.rollDeg);
      maxRoll = Math.max(maxRoll, sim.telemetry.rollDeg);
    }
    assert.equal(sim.devRunner.result.status, 'passed', id);
    assert.equal(sim.devRunner.result.observation.samples, 7200);
    assert.ok(maxRoll - minRoll > previousRollRange, id);
    if (id !== 'turbulence') {
      assert.ok(minRoll < -1.5 && maxRoll > 2, `${id}: visible banks in both directions`);
    }
    previousRollRange = maxRoll - minRoll;
    assert.equal(sim.autopilot.master, false);
  }
});

test('60 s production cruise: wind changes airflow, forces, moments and motion without failures', () => {
  const windy = flight(), calm = flight(null);
  const throttle = windy.controls.throttle;
  stepPhysics(windy); stepPhysics(calm);
  assert.notDeepEqual(windy._aeroResult.forceWorld, calm._aeroResult.forceWorld);
  assert.notDeepEqual(windy._aeroResult.momentBody, calm._aeroResult.momentBody);
  assert.notEqual(windy.telemetry.tasKnots, calm.telemetry.tasKnots);
  for (let tick = 1; tick < 7200; tick++) { stepPhysics(windy); stepPhysics(calm); }
  assert.equal(windy.devRunner.result.status, 'passed');
  assert.equal(calm.devRunner.result.status, 'passed');
  assert.equal(windy.devRunner.result.observation.samples, 7200);
  assert.ok(windy.position.distanceTo(calm.position) > .1);
  assert.ok(windy.quaternion.angleTo(calm.quaternion) > 1e-5);
  for (const axis of ['x', 'y', 'z']) assert.notEqual(windy.angularVelocity[axis], calm.angularVelocity[axis]);
  assert.equal(windy.controls.throttle, throttle);
  assert.equal(windy.autopilot.master, false);
  assert.equal(windy.demoDirector.isActive, false);
});

test('zero profile equals no field; grouping and extra diagnostic samples preserve motion', () => {
  const calm = flight(null), zero = flight('calm-debug-v1'), reference = flight(), grouped = flight();
  for (let tick = 0; tick < 240; tick++) {
    stepPhysics(calm); stepPhysics(zero); stepPhysics(reference);
  }
  for (let frame = 0; frame < 60; frame++) {
    grouped.windField.sample({ x: frame * 100, y: 99, z: -100 }, 700 + frame);
    advancePhysicsFrame(grouped, 4 * grouped.physicsDt);
  }
  assert.deepEqual(state(zero), state(calm));
  assert.deepEqual(state(grouped), state(reference));
  assert.equal(grouped.windTimeSeconds, reference.windTimeSeconds);
});

for (const [id, profile] of levels) test(`${id}: manual ownership, restart and preset cleanup`, () => {
  const sim = flight(undefined, id);
  const initial = state(sim), seed = sim.windField.seed;
  assert.equal(sim.controls.inputBlocked, false);
  assert.equal(sim.controls.aircraftControlsDisabled, false);
  sim.controls.setVirtualInput('aileron', .3);
  for (let tick = 0; tick < 24; tick++) stepPhysics(sim);
  assert.ok(sim.controls.aileron > 0);
  assert.equal(sim.controls.virtualAileron, .3);
  sim.devRunner.restart(); sim.devRunner.updatePreparation(0);
  assert.deepEqual(state(sim), initial);
  assert.equal(sim.windField.seed, seed);
  assert.equal(sim.windField.profile, profile);
  assert.equal(sim.windTimeSeconds, 0);
  assert.equal(sim.controls.virtualAileron, null);
  for (let tick = 0; tick < 12; tick++) stepPhysics(sim);
  const replay = state(sim);
  sim.devRunner.restart(); sim.devRunner.updatePreparation(0);
  for (let tick = 0; tick < 12; tick++) stepPhysics(sim);
  assert.deepEqual(state(sim), replay);
  sim.setPreset('approach');
  assert.equal(sim.devRunner.active, null);
  assert.equal(sim.windField, null);
  assert.equal(sim.windTimeSeconds, 0);
  assert.deepEqual(sim.aero.windWorld.toArray(), [0, 0, 0]);
  assert.deepEqual(sim.aero.windLeftWorld.toArray(), [0, 0, 0]);
  assert.deepEqual(sim.aero.windRightWorld.toArray(), [0, 0, 0]);
});

test('switching strengths resets the wind clock and restores the shared cruise start', () => {
  const sim = flight();
  const initial = state(sim);
  for (const [id, profile] of [...levels.slice(1), levels[0]]) {
    for (let tick = 0; tick < 120; tick++) stepPhysics(sim);
    assert.equal(sim.devRunner.start(id), true);
    sim.devRunner.updatePreparation(0);
    assert.deepEqual(state(sim), initial);
    assert.equal(sim.windField.profile, profile);
    assert.equal(sim.windTimeSeconds, 0);
    assert.deepEqual(sim.aero.windWorld.toArray(), [0, 0, 0]);
  }
});

test('transient stall, G-LOC, damage and engine failure cannot earn a safe-cruise pass', () => {
  for (const inject of [s => { s.telemetry.isStalled = true; },
    s => { s.telemetry.pilot.isGLOC = true; }, s => { s.engines.failed[0] = true; },
    s => { s.gear.bodyDamage.belly = .1; }]) {
    const sim = flight();
    stepPhysics(sim); inject(sim); sim.devRunner.afterPhysics(1 / 120);
    sim.telemetry.isStalled = false; sim.telemetry.pilot.isGLOC = false;
    sim.engines.failed.fill(false); sim.gear.bodyDamage.belly = 0;
    sim.devRunner.afterPhysics(60);
    assert.equal(sim.devRunner.result.status, 'failed');
  }
});

for (const aircraftId of Object.keys(AIRCRAFT_REGISTRY)) test(`${aircraftId}: all three levels fly 60 s, spatial wind gradients at every level`, () => {
  let previousRollRange = 0;
  for (const [id] of levels) {
    const sim = flight(undefined, id, aircraftId);
    assert.equal(sim.currentAircraftId, aircraftId);
    let minRoll = Infinity, maxRoll = -Infinity, maxWingDifference = 0;
    for (let tick = 0; tick < 7200; tick++) {
      stepPhysics(sim);
      minRoll = Math.min(minRoll, sim.telemetry.rollDeg);
      maxRoll = Math.max(maxRoll, sim.telemetry.rollDeg);
      maxWingDifference = Math.max(maxWingDifference, sim.aero.windRightWorld.distanceTo(sim.aero.windLeftWorld));
    }
    assert.equal(sim.devRunner.result.status, 'passed', `${aircraftId} ${id}`);
    assert.ok(maxWingDifference > 0, `${aircraftId} ${id}: spatial wind sampled at both wings`);
    assert.ok(maxRoll - minRoll > previousRollRange, `${aircraftId} ${id}`);
    previousRollRange = maxRoll - minRoll;
  }
});
