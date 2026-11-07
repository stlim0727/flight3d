import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { normalLoadFactor } from '../src/physics/loadFactor.js';
import { constrainBodyContact } from '../src/physics/bodyContactConstraint.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';
const q = new THREE.Quaternion();
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test('CG accelerometer gives 1g at rest, 0g in free fall, and signed manoeuvre loads', () => {
  const v = new THREE.Vector3(50, 0, 0), dt = 1 / 120;
  for (const g of [0, 1, 2.5, -1]) {
    const after = v.clone().add(new THREE.Vector3(0, (g - 1) * Atmosphere.G0 * dt, 0));
    near(normalLoadFactor(v, after, q, q, dt), g);
  }
});
test('rotating measurement axis uses the interval midpoint, not the final pose', () => {
  const v = new THREE.Vector3(), dt = 1 / 120;
  const end = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 3);
  near(normalLoadFactor(v, v, q, end, dt), Math.cos(Math.PI / 6));
});
test('includes actual normal constraint impulse in the measured delta velocity', () => {
  const v = new THREE.Vector3(0, -2, 0), before = v.clone(), omega = new THREE.Vector3();
  const p = new THREE.Vector3(0, -0.1, 0), dt = 1 / 120;
  constrainBodyContact(p, q, v, omega, 100, { x: .01, y: .01, z: .01 }, () => 0, null,
    [{ id: 'center', position: [0, 0, 0] }]);
  near(v.y, 0);
  near(normalLoadFactor(before, v, q, q, dt), 1 + 2 / (dt * Atmosphere.G0));
});
test('integrated specific force recovers the same impulse across sample rates', () => {
  for (const hz of [60, 120, 240]) {
    const dt = 1 / hz; let impulsePerMass = 0, v = new THREE.Vector3();
    for (let i = 0; i < hz; i++) {
      const next = v.clone().add(new THREE.Vector3(0, 3 * dt, 0));
      impulsePerMass += (normalLoadFactor(v, next, q, q, dt) - 1) * Atmosphere.G0 * dt;
      v = next;
    }
    near(impulsePerMass, 3);
  }
});
