import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { WindField, setSimulationWind, advanceSimulationWind } from '../src/physics/WindField.js';

function fixture(quaternion = new THREE.Quaternion()) {
  const aero = new Aerodynamics();
  const aircraft = new THREE.Object3D(); aircraft.quaternion.copy(quaternion);
  return { aero, aircraft, quaternion, position: new THREE.Vector3(100, 750, -900),
    velocity: new THREE.Vector3(0, 0, -100).applyQuaternion(quaternion) };
}

function gradient(sim, slope, uniform = 0) {
  const field = new WindField(); field.sampleWings = true;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(sim.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(sim.quaternion);
  field.sample = (position, time, target) => {
    const speed = uniform + slope * new THREE.Vector3().subVectors(position, sim.position).dot(right);
    return target.copy(up).multiplyScalar(speed);
  };
  setSimulationWind(sim, field); advanceSimulationWind(sim, 1 / 120);
}

const compute = (sim, rate = new THREE.Vector3()) => sim.aero.computeAero(1 / 120,
  sim.aircraft, sim.velocity, rate, 750, 700, 0, 0);

test('opposite vertical gradients reverse roll according to r cross F, without net heave', () => {
  const calm = fixture(), rightUp = fixture(), leftUp = fixture();
  gradient(rightUp, .02); gradient(leftUp, -.02);
  const a = compute(calm), b = compute(rightUp), c = compute(leftUp);
  const span = rightUp.aero.wingspan;
  const deltaWind = .02 * span / 2;
  const expected = span / 4 * b.qDyn * rightUp.aero.wingArea / 2 * rightUp.aero.CLa * deltaWind / 100;
  assert.ok(Math.abs(b.wingGustRollMoment - expected) < 1e-8);
  assert.ok(b.wingGustRollMoment > 0, 'Right wing up -> +Z -> left bank');
  assert.equal(c.wingGustRollMoment, -b.wingGustRollMoment);
  assert.deepEqual(b.forceWorld, a.forceWorld, 'Antisymmetric correction has zero net force');
  assert.deepEqual(c.forceWorld, a.forceWorld);
});

test('uniform wind adds no gradient moment or duplicate angular-rate damping', () => {
  const uniform = fixture(); gradient(uniform, 0, .5);
  for (const rate of [new THREE.Vector3(), new THREE.Vector3(.1, -.2, .3)]) {
    assert.equal(compute(uniform, rate).wingGustRollMoment, 0);
  }
});

test('sampling and body moment are invariant under world rotation and use physical pose', () => {
  const reference = fixture(); gradient(reference, .02);
  const expected = compute(reference).wingGustRollMoment;
  const rotated = fixture(new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, 1.1, -.4)));
  gradient(rotated, .02);
  assert.ok(Math.abs(compute(rotated).wingGustRollMoment - expected) < 1e-7);
  // A stale rendering transform must not select sample positions.
  rotated.aircraft.position.set(90000, -1000, 80000);
  advanceSimulationWind(rotated, 1 / 120);
  assert.ok(Math.abs(compute(rotated).wingGustRollMoment - expected) < 1e-7);
});

test('wing samples match direct field queries at one time and clear on opt-out/reset', () => {
  const sim = fixture(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2));
  const field = new WindField({ profile: 'moderate-turbulence-v1', seed: 9 });
  setSimulationWind(sim, field); sim.windTimeSeconds = 7;
  advanceSimulationWind(sim, 1 / 120);
  for (const [sign, actual] of [[-1, sim.aero.windLeftWorld], [1, sim.aero.windRightWorld]]) {
    const point = new THREE.Vector3(sign * sim.aero.wingspan / 4, 0, 0)
      .applyQuaternion(sim.quaternion).add(sim.position);
    assert.deepEqual(actual, field.sample(point, 7, new THREE.Vector3()));
  }
  assert.equal(sim.windTimeSeconds, 7 + 1 / 120, 'Three samples advance the clock only once');
  for (const profile of ['light-turbulence-v1', 'incheon-crosswind-v1', 'calm-debug-v1']) {
    setSimulationWind(sim, new WindField({ profile })); advanceSimulationWind(sim, 1 / 120);
    assert.deepEqual(sim.aero.windLeftWorld, sim.aero.windWorld);
    assert.deepEqual(sim.aero.windRightWorld, sim.aero.windWorld);
    assert.equal(compute(sim).wingGustRollMoment, 0);
  }
  setSimulationWind(sim);
  assert.equal(sim.aero.windLeftWorld.length() + sim.aero.windRightWorld.length(), 0);
});

test('zero airspeed and separated flow keep the gradient correction finite and attenuated', () => {
  const sim = fixture(); gradient(sim, .02);
  sim.velocity.set(0, 0, 0);
  assert.equal(compute(sim).wingGustRollMoment, 0);
  sim.velocity.set(0, 0, -100);
  const attached = compute(sim).wingGustRollMoment;
  sim.aero.separation = .9;
  const separated = compute(sim).wingGustRollMoment;
  assert.ok(Number.isFinite(separated) && Math.abs(separated) < Math.abs(attached) / 5);
});
