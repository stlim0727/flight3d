import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { F16LuklaScenario } from '../src/director/scenarios/F16LuklaScenario.js';

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
    stop(message, parking, options) { this.isActive = false; this.options = options; },
  };
  const scenario = new F16LuklaScenario(director, sim);
  scenario.start = new THREE.Vector3();
  scenario.direction = new THREE.Vector3(-0.848048, 0, 0.529919);
  scenario.heading = 238;
  scenario.baseAltitude = 2964;
  scenario.result = { status: 'running', minClearanceM: Infinity, maxBankDeg: 0 };
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
  assert.equal(f.director.currentStage, F16LuklaScenario.STAGES.COMPLETED);
  assert.ok(f.inputs.throttle > 0 && f.inputs.throttle < 1);
});

test('completion preserves the flown motion and powered handoff without resetting pose', () => {
  const { sim, scenario, director } = flight();
  const vectors = ['position', 'linearVelocity', 'angularVelocity', 'quaternion'];
  const before = vectors.map(key => sim[key].toArray());
  scenario.enterStage(F16LuklaScenario.STAGES.COMPLETED);
  assert.deepEqual(vectors.map(key => sim[key].toArray()), before);
  assert.equal(sim.controls.throttle, 0.25);
  assert.equal(scenario.result.status, 'completed');
  assert.equal(director.isActive, false);
  assert.deepEqual(director.options, { preserveThrottle: true });
});
