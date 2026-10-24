import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Aerodynamics, createAeroResult } from '../src/physics/Aerodynamics.js';

test('reused output matches snapshots across stall, recovery, flap and control transitions', () => {
  const reusable = new Aerodynamics();
  const snapshots = new Aerodynamics();
  const unrelated = new Aerodynamics();
  const result = createAeroResult();
  const force = result.forceWorld;
  const moment = result.momentBody;
  const aircraft = new THREE.Object3D();
  aircraft.quaternion.setFromEuler(new THREE.Euler(0.15, 0.8, -0.3));
  const attitude = aircraft.quaternion.clone();
  const velocity = new THREE.Vector3();
  const rates = new THREE.Vector3(0.01, -0.02, 0.03);
  const originalRates = rates.clone();
  let saved;
  let savedForce;
  for (let tick = 0; tick < 720; tick++) {
    velocity.set(2, tick < 240 ? -32 : -5, -80).applyQuaternion(attitude);
    const originalVelocity = velocity.clone();
    for (const aero of [reusable, snapshots]) {
      aero.elevator = tick < 360 ? 0.2 : 0;
      aero.setFlapPosition(tick < 400 ? 3 : 0);
      aero.windWorld.set(1, 0, -2);
    }
    const actual = reusable.computeAero(1 / 120, aircraft, velocity, rates, 1000, 20, 100000, 1, result);
    unrelated.computeAero(1 / 120, aircraft, rates, velocity, 0, 1, 0, 0);
    const expected = snapshots.computeAero(1 / 120, aircraft, velocity, rates, 1000, 20, 100000, 1);
    assert.strictEqual(actual, result);
    assert.strictEqual(actual.forceWorld, force);
    assert.strictEqual(actual.momentBody, moment);
    assert.deepEqual(actual, expected);
    assert.deepEqual(velocity, originalVelocity);
    assert.deepEqual(rates, originalRates);
    assert.deepEqual(aircraft.quaternion.toArray(), attitude.toArray());
    if (tick === 0) {
      saved = expected;
      savedForce = expected.forceWorld.clone();
    }
    actual.momentBody.y += 12345;
  }
  assert.deepEqual(saved.forceWorld, savedForce);
});

test('world forces rotate with aircraft while body moments retain local axes', () => {
  const level = new THREE.Object3D();
  const rotated = new THREE.Object3D();
  rotated.quaternion.setFromEuler(new THREE.Euler(0.4, 0.8, -0.6));
  const velocity = new THREE.Vector3(0, -4, -80);
  const rates = new THREE.Vector3();
  const reference = new Aerodynamics().computeAero(1 / 120, level, velocity, rates, 500, 500, 0, 0);
  const actual = new Aerodynamics().computeAero(1 / 120, rotated,
    velocity.clone().applyQuaternion(rotated.quaternion), rates, 500, 500, 0, 0);
  assert.ok(actual.forceWorld.distanceTo(reference.forceWorld.applyQuaternion(rotated.quaternion)) < 1e-8);
  assert.ok(actual.momentBody.distanceTo(reference.momentBody) < 1e-8);
  for (const [control, axis, sign] of [['elevator', 'x', 1], ['rudder', 'y', -1], ['aileron', 'z', -1]]) {
    const aero = new Aerodynamics();
    for (const input of [-1, 1]) {
      aero[control] = input;
      const controlled = aero.computeAero(1 / 120, level, velocity, rates, 500, 500, 0, 0);
      assert.ok((controlled.momentBody[axis] - reference.momentBody[axis]) * sign * input > 0);
    }
  }
});
