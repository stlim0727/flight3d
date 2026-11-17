import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CESSNA_172 } from '../src/config/aircraftConfigs.js';
import { applyDeflection, applyDeflectionPair, getControlInput } from '../src/aircraft/common/ControlSurfaceRig.js';
import {
  clampGearExtension,
  calculateGearFold,
  isGearCollapsed,
  computeGearContactOffset
} from '../src/aircraft/common/GearKinematicsRig.js';

test('ControlSurfaceRig: getControlInput correctly clamps and falls back', () => {
  assert.equal(getControlInput({ aileron: 0.5 }, 'aileron'), 0.5);
  assert.equal(getControlInput({ aileron: 1.5 }, 'aileron'), 1.0);
  assert.equal(getControlInput({ aileron: -2.0 }, 'aileron'), -1.0);
  assert.equal(getControlInput({}, 'aileron'), 0);
  assert.equal(getControlInput(null, 'aileron'), 0);
  assert.equal(getControlInput({ aileron: NaN }, 'aileron', 0.2), 0.2);
  assert.equal(getControlInput({ flap: 30 }, 'flap', 0, 0, 40), 30);
  assert.equal(getControlInput({ flap: 50 }, 'flap', 0, 0, 40), 40);
});

test('ControlSurfaceRig: applyDeflection and applyDeflectionPair rotate objects', () => {
  const meshL = new THREE.Object3D();
  const meshR = new THREE.Object3D();

  applyDeflection(meshL, 'x', 0.25);
  assert.equal(meshL.rotation.x, 0.25);

  // Null target is safe no-op
  applyDeflection(null, 'x', 0.25);

  // Differential pair (e.g. ailerons)
  applyDeflectionPair(meshL, meshR, 'x', 0.35, true);
  assert.equal(meshL.rotation.x, 0.35);
  assert.equal(meshR.rotation.x, -0.35);

  // Symmetric pair (e.g. elevators)
  applyDeflectionPair(meshL, meshR, 'x', 0.45, false);
  assert.equal(meshL.rotation.x, 0.45);
  assert.equal(meshR.rotation.x, 0.45);
});

test('GearKinematicsRig: clampGearExtension and calculateGearFold', () => {
  assert.equal(clampGearExtension(undefined), 1.0);
  assert.equal(clampGearExtension(0.5), 0.5);
  assert.equal(clampGearExtension(-0.2), 0);
  assert.equal(clampGearExtension(1.5), 1.0);

  assert.equal(calculateGearFold(1.0), 0);
  assert.equal(calculateGearFold(0.0), Math.PI * 0.5);
  assert.equal(calculateGearFold(0.5), Math.PI * 0.25);
});

test('GearKinematicsRig: isGearCollapsed correctly evaluates damage state', () => {
  assert.equal(isGearCollapsed({ nose: 'collapsed' }, 'nose'), true);
  assert.equal(isGearCollapsed({ nose: 'normal' }, 'nose'), false);
  assert.equal(isGearCollapsed(undefined, 'nose'), false);
  assert.equal(isGearCollapsed({}, 'mainLeft'), false);
});

test('GearKinematicsRig: computeGearContactOffset returns contact displacement', () => {
  const contact = { x: 0, y: -1.0, z: -1.5 };
  const offset = computeGearContactOffset(CESSNA_172.landingGear.contacts, {}, contact);
  assert.equal(typeof offset, 'number');
  assert.ok(Number.isFinite(offset));
});
