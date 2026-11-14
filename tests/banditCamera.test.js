import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

/** Bandit targets keep the missile system's insertion order, never a distance order. */
function combatState(targets) {
  return () => ({ missiles: [], targets });
}

function playerAt(position) {
  const aircraft = new THREE.Object3D();
  aircraft.position.copy(position);
  aircraft.updateMatrixWorld(true);
  return aircraft;
}

test('BANDIT_POV frames the nearest live bandit instead of the first target listed', () => {
  const camera = new THREE.PerspectiveCamera();
  const system = new CameraSystem(camera, null);
  const aircraft = playerAt(new THREE.Vector3(0, 1000, 0));
  const far = { alive: true, position: new THREE.Vector3(0, 1000, -2000) };
  const near = { alive: true, position: new THREE.Vector3(0, 1000, -120) };
  const dead = { alive: false, position: new THREE.Vector3(0, 1000, -10) };
  system.setCombatStateProvider(combatState([far, dead, near]));

  system.setMode(CameraSystem.MODES.BANDIT_POV, true);
  system.update(0.016, aircraft);

  assert.equal(system.getViewName(), 'BANDIT POV');
  assert.ok(camera.position.distanceTo(near.position) < camera.position.distanceTo(far.position),
    'the framing follows the closest live bandit');
});

test('BANDIT_POV falls back to chase when no live bandit exists', () => {
  const camera = new THREE.PerspectiveCamera();
  const system = new CameraSystem(camera, null);
  const aircraft = playerAt(new THREE.Vector3(0, 500, 0));
  system.setCombatStateProvider(combatState([]));

  system.setMode(CameraSystem.MODES.BANDIT_POV, true);
  system.update(0.016, aircraft);

  assert.equal(system.mode, CameraSystem.MODES.CHASE);
});

test('bandit gaze lock tracks the nearest bandit and releases when every target is gone', () => {
  const camera = new THREE.PerspectiveCamera();
  const system = new CameraSystem(camera, null);
  const aircraft = playerAt(new THREE.Vector3(0, 1000, 0));
  const far = { alive: true, position: new THREE.Vector3(900, 1000, -2000) };
  const near = { alive: true, position: new THREE.Vector3(70, 1000, -140) };
  system.setCombatStateProvider(combatState([far, near]));
  system.setMode(CameraSystem.MODES.CHASE, true);

  assert.equal(system.toggleBanditGaze(), true);
  system.update(0.016, aircraft);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const toNear = near.position.clone().sub(camera.position).normalize();
  const toFar = far.position.clone().sub(camera.position).normalize();
  assert.ok(forward.dot(toNear) > forward.dot(toFar), 'the gaze follows the nearest threat');

  system.setCombatStateProvider(combatState([]));
  system.update(0.016, aircraft);
  assert.equal(system.banditGaze, false, 'losing every target releases the lock');
});

test('a loaded bandit airframe keeps the callsign skin after the proxy is hidden (#722)', async () => {
  const { BanditAircraftView } = await import('../src/weapons/BanditAircraftView.js');
  const view = Object.create(BanditAircraftView.prototype);
  view.callsign = 'BANDIT RED';
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  const group = new THREE.Group();
  group.add(mesh);
  view.airframe = { group };

  view._skinAirframe();
  assert.notEqual(mesh.material, material, 'the loaded airframe gets its own materials');
  assert.equal(mesh.material.color.getHex(), 0xff0000);

  view.callsign = 'BANDIT HEAVY';
  view._skinAirframe();
  assert.deepEqual(group.scale.toArray(), [1.18, 1.08, 1.3], 'heavy variants keep their size');
});
