import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

test('Auto uses flight context, ignores brief bank spikes, and retains a manually chosen view', () => {
  const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
  const aircraft = new THREE.Object3D();
  aircraft.position.y = 500;
  system.setTerrain(() => 0);
  system.setMode(CameraSystem.MODES.AUTO, true);
  system.update(8, aircraft, { iasKnots: 250, rollDeg: 0 });
  assert.equal(system.mode, CameraSystem.MODES.DRONE);
  system.update(.1, aircraft, { rollDeg: 50 });
  assert.equal(system.mode, CameraSystem.MODES.DRONE, 'transient bank does not cut');
  system.update(8, aircraft, { rollDeg: 50 });
  assert.equal(system.mode, CameraSystem.MODES.CHASE);
  system.update(8, aircraft, { rollDeg: 0, gearState: 1, vsiFpm: -500 });
  assert.equal(system.mode, CameraSystem.MODES.COCKPIT);
  aircraft.position.y = 100;
  system.update(8, aircraft, { rollDeg: 0, iasKnots: 300, gearState: 0 });
  assert.equal(system.mode, CameraSystem.MODES.FLYBY);
  system.update(120, aircraft, { rollDeg: 0, iasKnots: 300, gearState: 0 });
  assert.equal(system.mode, CameraSystem.MODES.FLYBY, 'steady low pass stays in its shot');
  system.setMode(CameraSystem.MODES.WING, true);
  system.update(30, aircraft, { onGround: true });
  assert.equal(system.mode, CameraSystem.MODES.WING);
});
