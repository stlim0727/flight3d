import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';
import { AIRCRAFT_REGISTRY } from '../src/config/aircraftConfigs.js';

function flight(speed = 570, bank = 0) {
  const sim = createHeadlessSimulation({ aircraftId: 'F16' });
  sim.setPreset('cruise');
  // Exercise the controller independently of pilot blackout attenuation.
  sim.demoDirector = { isActive: true, getActiveScenario: () => null, stop() {} };
  sim.position.set(0, 6000, 0);
  sim.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), bank * Math.PI / 180);
  const density = Atmosphere.getConditions(6000).densityRatio;
  sim.linearVelocity.set(0, 0, -Atmosphere.knotsToMs(speed) / Math.sqrt(density));
  sim.angularVelocity.set(0, 0, 0);
  sim.controls.pitchTrim = 0.6;
  sim.controls.throttle = .85;
  return sim;
}

function step(sim, seconds, elevator, aileron = 0) {
  sim.controls.setVirtualInput('elevator', elevator);
  sim.controls.setVirtualInput('aileron', aileron);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < seconds * 120; i++) {
    sim.integratePhysics(1 / 120);
    const g = sim.telemetry.rawGForce;
    assert.ok(Number.isFinite(g));
    min = Math.min(min, g); max = Math.max(max, g);
  }
  return { min, max };
}

test('high-speed full pull reproduces excessive physical G without protection', () => {
  const baseline = flight(650);
  baseline.aero.gLimiterLimits = null;
  assert.ok(step(baseline, 2, 1).max > 20);
  const protectedFlight = flight(650);
  const peak = step(protectedFlight, 2, 1).max;
  assert.ok(peak > 7 && peak <= 9, `actual load ${peak}`);
  // No clamping of sensor output: the integrated accelerometer still agrees
  // with the force model, to the midpoint-axis integration tolerance.
  assert.ok(Math.abs(protectedFlight.telemetry.rawGForce - protectedFlight.aero.gForce) < .1);
});

for (const speed of [200, 350, 570, 650]) for (const bank of [0, 110, 180]) {
  test(`F16 ${speed} KIAS / ${bank}° bank: hold, release, push and reversal stay inside -3/+9g`, () => {
    const sim = flight(speed, bank);
    for (const [seconds, elevator, aileron] of [[3, 1, .4], [2, 0, 0], [3, -1, 0], [2, 1, 0], [2, 0, 0]]) {
      const load = step(sim, seconds, elevator, aileron);
      assert.ok(load.max <= 9, `maximum ${load.max}`);
      assert.ok(load.min >= -3, `minimum ${load.min}`);
      assert.equal(sim.isCrashed, false);
      if (elevator === 0) assert.ok(Math.abs(sim.telemetry.rawGForce) < 6,
        'release must unload rather than retain the limiting command');
    }
  });
}

test('protection cannot be bypassed by trim or autopilot surface commands', () => {
  for (const trim of [-5, 12]) {
    const sim = flight(650);
    sim.controls.pitchTrim = trim;
    sim.demoDirector.isActive = false;
    sim.autopilot.master = true;
    sim.autopilot.targets = { headingDeg: 0, altitudeFt: 20000, iasKnots: 650 };
    sim._apEuler = new THREE.Euler();
    sim._apForward = new THREE.Vector3();
    sim._apState = {};
    sim.autopilot.update = () => ({ elevator: Math.sign(trim), aileron: 0 });
    const load = step(sim, 4, 0);
    assert.ok(load.max <= 9 && load.min >= -3, JSON.stringify(load));
  }
});

test('reset drops no stored correction into the next flight; other aircraft retain their surfaces', () => {
  const sim = flight();
  step(sim, 2, 1);
  sim.setPreset('cruise');
  assert.equal(sim.aero.gLimiterLimits.max, 9);
  const fresh = createHeadlessSimulation({ aircraftId: 'F16' });
  fresh.setPreset('cruise');
  fresh.demoDirector = sim.demoDirector;
  assert.deepEqual(step(sim, 1, 0), step(fresh, 1, 0));
  for (const aircraftId of ['B738', 'C172']) {
    const aero = new Aerodynamics(AIRCRAFT_REGISTRY[aircraftId]);
    assert.equal(aero.gLimiterLimits, null);
    aero.elevator = .7;
    const result = aero.computeAero(1 / 120, new THREE.Object3D(), new THREE.Vector3(0, 0, -300),
      new THREE.Vector3(), 3000, 3000, 0, 0);
    assert.ok(Math.abs(result.elevatorEffective - .7 * 20 * Math.PI / 180) < 1e-12);
  }
});
