import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WindField, WIND_PROFILES, setSimulationWind, advanceSimulationWind } from '../src/physics/WindField.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';

const point = { x: 120, y: 200, z: -900 };

test('same space/time is reproducible despite query order, seed and heading are explicit', () => {
  const options = { profile: 'mild-disturbance-v1', seed: 'environment-2', runwayHeadingDeg: 90 };
  const field = new WindField(options);
  const expected = field.sample(point, 4);
  field.sample({ x: -900, y: 12, z: 90 }, 72);
  assert.deepEqual(field.sample(point, 4), expected);
  assert.deepEqual(new WindField(options).sample(point, 4), expected);
  assert.notDeepEqual(new WindField({ ...options, seed: 'environment-3' }).sample(point, 4), expected);
  assert.notDeepEqual(field.sample({ ...point, x: 1000 }, 4), expected);
  assert.notDeepEqual(field.sample(point, 5), expected);
  assert.deepEqual(new WindField().sample(point, 9000), { x: 0, y: 0, z: 0 });
});

test('runway coordinate transforms preserve bounded along/right/up amplitudes at all headings', () => {
  for (const runwayHeadingDeg of [0, 58, 90, 180, 270]) {
    const a = runwayHeadingDeg * Math.PI / 180;
    for (const crosswindSign of [-1, 1]) {
      const field = new WindField({ profile: 'mild-disturbance-v1', seed: 7, runwayHeadingDeg, crosswindSign });
      const mean = field.mean();
      assert.ok(Math.abs(mean.x * Math.sin(a) - mean.z * Math.cos(a)) < 1e-12);
      assert.ok(Math.abs(mean.x * Math.cos(a) + mean.z * Math.sin(a) - 1.5 * crosswindSign) < 1e-12);
      assert.equal(mean.y, 0);
      for (let time = 0; time < 180; time += .25) {
        const result = field.sample({ x: time * 70, y: time, z: -time * 20 }, time);
        const along = result.x * Math.sin(a) - result.z * Math.cos(a);
        const right = result.x * Math.cos(a) + result.z * Math.sin(a);
        assert.ok(Math.abs(along) <= .3 + 1e-12);
        assert.ok(Math.abs(right - 1.5 * crosswindSign) <= .6 + 1e-12);
        assert.ok(Math.abs(result.y) <= .2 + 1e-12);
      }
    }
  }
  assert.equal(WIND_PROFILES['mild-disturbance-v1'].crosswind, 1.5);
});

test('field is continuous with bounded time and space changes', () => {
  const field = new WindField({ profile: 'mild-disturbance-v1', seed: 3 });
  const a = field.sample(point, 10);
  const b = field.sample({ x: point.x + .001, y: point.y, z: point.z }, 10.00001);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < .0001);
});

test('physics clock and reset are independent of renderer and sensor queries', () => {
  const simulation = () => ({ aero: { windWorld: new THREE.Vector3() }, position: new THREE.Vector3(1, 20, 3) });
  const a = simulation(), b = simulation();
  for (const sim of [a, b]) setSimulationWind(sim, new WindField({ profile: 'mild-disturbance-v1', seed: 1 }));
  for (let tick = 0; tick < 240; tick++) {
    a.totalSimTime = Math.random() * 1000; // Existing visual clock is irrelevant.
    a.windField.sample(point, tick * 3);
    advanceSimulationWind(a, 1 / 120);
    advanceSimulationWind(b, 1 / 120);
    assert.deepEqual(a.aero.windWorld, b.aero.windWorld);
  }
  setSimulationWind(a, new WindField({ profile: 'mild-disturbance-v1', seed: 1 }));
  advanceSimulationWind(a, 1 / 120);
  const initial = a.aero.windWorld.clone();
  setSimulationWind(b, new WindField({ profile: 'mild-disturbance-v1', seed: 1 }));
  advanceSimulationWind(b, 1 / 120);
  assert.deepEqual(initial, b.aero.windWorld);
  setSimulationWind(a);
  assert.equal(a.windTimeSeconds, 0);
  assert.deepEqual(a.aero.windWorld.toArray(), [0, 0, 0]);
  advanceSimulationWind(a, 1 / 120);
  assert.equal(a.windTimeSeconds, 0);
});

test('crosswind changes relative airflow and actual force/moment, not just sensor readings', () => {
  const aircraft = new THREE.Object3D();
  const velocity = new THREE.Vector3(0, -3, -70);
  const rates = new THREE.Vector3();
  const calm = new Aerodynamics();
  const windy = new Aerodynamics();
  windy.windWorld.set(2, 0, 0);
  const reference = calm.computeAero(1 / 120, aircraft, velocity, rates, 100, 100, 0, 0);
  const actual = windy.computeAero(1 / 120, aircraft, velocity, rates, 100, 100, 0, 0);
  assert.ok(actual.betaDeg < 0);
  assert.ok(actual.forceWorld.x > reference.forceWorld.x);
  assert.notEqual(actual.momentBody.y, reference.momentBody.y);
  assert.equal(windy.tas, Math.hypot(-2, -3, -70));
  assert.deepEqual(velocity.toArray(), [0, -3, -70]);
});

test('invalid profiles and nonfinite state fail before contaminating physics', () => {
  assert.throws(() => new WindField({ profile: 'storm' }), RangeError);
  assert.throws(() => new WindField({ runwayHeadingDeg: NaN }), TypeError);
  assert.throws(() => new WindField({ crosswindSign: 0 }), RangeError);
  assert.throws(() => new WindField({ seed: Infinity }), TypeError);
  assert.throws(() => new WindField().sample(point, Infinity), TypeError);
  assert.throws(() => new WindField().sample({ ...point, x: NaN }, 0), TypeError);
});
