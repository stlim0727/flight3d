import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { F16_FALCON } from '../src/config/aircraftConfigs.js';
import { F16LuklaScenario, f16FinalCrossTrack } from '../src/director/scenarios/F16LuklaScenario.js';

function flight() {
  const inputs = {};
  const sim = {
    position: new THREE.Vector3(0, 3400, 0),
    linearVelocity: new THREE.Vector3(-40, 25, 170),
    angularVelocity: new THREE.Vector3(0.01, 0.02, 0.03),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 2.8, 0.1)),
    currentTerrain: { getHeight: () => 2800 },
    telemetry: { headingDeg: 198, rollDeg: -5, iasKnots: 300 },
    aero: { beta: 0 },
    controls: { throttle: 0.25, setVirtualInput(axis, value) { inputs[axis] = value; } },
  };
  const director = {
    stageTimer: 31, totalTimer: 42, currentStage: F16LuklaScenario.STAGES.CLIMB,
    userCameraOverridden: true, isActive: true,
    setStage(stage) { this.currentStage = stage; },
    stop(message, parking, options) { this.isActive = false; this.options = options; this.parking = parking; },
  };
  const scenario = new F16LuklaScenario(director, sim);
  scenario.start = new THREE.Vector3();
  scenario.direction = new THREE.Vector3(-0.848048, 0, 0.529919);
  scenario.heading = 238;
  scenario.baseAltitude = 2964;
  scenario.result = { status: 'running', minClearanceM: Infinity, minPassClearanceM: Infinity, maxBankDeg: 0 };
  // Isolate the route/handoff decisions from aerodynamic inversion, which needs
  // the browser's live force state and is exercised by the demo sweep.
  scenario.holdHeading = () => {};
  scenario.flyVertical = () => {};
  return { sim, director, scenario, inputs };
}

test('Lukla escape retains automation until the turn and climb are established', () => {
  for (const change of [
    ({ director }) => { director.stageTimer = 16; },
    ({ sim }) => { sim.telemetry.headingDeg = 220; },
    ({ sim }) => { sim.telemetry.rollDeg = -25; },
    ({ sim }) => { sim.position.y = 2900; },
    ({ sim }) => { sim.linearVelocity.y = -1; },
  ]) {
    const f = flight(); change(f); f.scenario.update();
    assert.equal(f.director.currentStage, F16LuklaScenario.STAGES.CLIMB);
  }
  const f = flight(); f.scenario.update();
  assert.equal(f.director.currentStage, F16LuklaScenario.STAGES.RETURN);
  assert.ok(f.inputs.throttle > 0 && f.inputs.throttle < 1);
});

test('parked completion preserves the physical pose and asks to retain parking brakes', () => {
  const { sim, scenario, director } = flight();
  const vectors = ['position', 'linearVelocity', 'angularVelocity', 'quaternion'];
  const before = vectors.map(key => sim[key].toArray());
  scenario.enterStage(F16LuklaScenario.STAGES.COMPLETED);
  assert.deepEqual(vectors.map(key => sim[key].toArray()), before);
  assert.equal(sim.controls.throttle, 0.25);
  assert.equal(scenario.result.status, 'completed');
  assert.equal(director.isActive, false);
  assert.equal(director.parking, true);
  assert.equal(director.options, undefined);
  assert.deepEqual(scenario.result.stopPosition, sim.position.toArray());
});


test('landing completion needs a recorded touchdown and two uninterrupted seconds of healthy runway support', () => {
  const f = flight(), { sim, scenario, director } = f;
  sim.aero = new Aerodynamics(F16_FALCON);
  sim.aero.qDyn = 100;
  sim.aero.tas = 10;
  sim.position.set(0, 2838, 0);
  sim.linearVelocity.set(0, 0, 0);
  sim.angularVelocity.set(0, 0, 0);
  Object.assign(sim.telemetry, { onGround: true, iasKnots: 0, headingDeg: 58, rollDeg: 0 });
  sim.gear = { onGround: true, failure: false, contacts: Array.from({ length: 3 }, () => ({
    isGrounded: true, damageState: 'normal', damage: 0,
  })) };
  scenario.flyLanding = () => {};
  scenario.rolloutPitch = 7;
  scenario.stopHold = 0;
  director.currentStage = F16LuklaScenario.STAGES.ROLLOUT;
  scenario.updateLanding(3, director.currentStage);
  assert.equal(scenario.stopHold, 0, 'a ground spawn is not a landed route');
  scenario.result.touchdown = { alongRunwayM: -240, crossTrackM: 0, iasKnots: 125 };
  scenario.updateLanding(1, director.currentStage);
  assert.equal(scenario.stopHold, 1);
  sim.linearVelocity.x = 1;
  scenario.updateLanding(1, director.currentStage);
  assert.equal(scenario.stopHold, 0, 'rolling restarts the hold');
  sim.linearVelocity.x = 0;
  for (const invalidate of [
    () => { sim.gear.contacts[0].isGrounded = false; },
    () => { sim.gear.contacts[0].damage = .01; },
    () => { sim.landingIncident = true; },
    () => { sim.position.x = 1000; },
  ]) {
    scenario.stopHold = 1;
    invalidate();
    scenario.updateLanding(.5, director.currentStage);
    assert.equal(scenario.stopHold, 0);
    sim.gear.contacts[0].isGrounded = true;
    sim.gear.contacts[0].damage = 0;
    sim.landingIncident = false;
    sim.position.x = 0;
  }
  scenario.updateLanding(1, director.currentStage);
  assert.equal(director.currentStage, F16LuklaScenario.STAGES.ROLLOUT);
  scenario.updateLanding(1, director.currentStage);
  assert.equal(director.currentStage, F16LuklaScenario.STAGES.COMPLETED);
  assert.equal(f.inputs.brakes, 1);
  assert.equal(f.inputs.throttle, 0);
});


test('the final curve joins the valley and runway centerline with continuous heading', () => {
  assert.deepEqual(f16FinalCrossTrack(-8000), { cross: 3000, slope: 0 });
  assert.deepEqual(f16FinalCrossTrack(-3000), { cross: 0, slope: 0 });
  assert.equal(f16FinalCrossTrack(-5500).cross, 1500);
  for (const s of [-7500, -6500, -5500, -4500, -3500]) {
    const path = f16FinalCrossTrack(s), eps = .01;
    const derivative = (f16FinalCrossTrack(s + eps).cross - f16FinalCrossTrack(s - eps).cross) / (2 * eps);
    assert.ok(Math.abs(derivative - path.slope) < 1e-5);
    assert.ok(path.cross >= 0 && path.cross <= 3000 && path.slope <= 0);
  }
});
