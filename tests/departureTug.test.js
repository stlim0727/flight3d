import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TUG, createDepartureTug, updateDepartureTug } from '../src/environment/DepartureTug.js';
import { departurePushbackPose } from '../src/config/incheonDeparture.js';

test('tow pin stays connected through reverse turns, then tractor clears smoothly and stays parked', () => {
  const tug = createDepartureTug();
  const sim = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), gear: { cgGroundHeightM: 3.5 }, currentTerrain: { getHeight: () => 7 } };
  const dt = 1 / 120;
  let previous, maxArticulation = 0;
  for (let step = 0; step <= 7200; step++) {
    const pose = departurePushbackPose(step / 7200);
    sim.position.set(pose.x, 10.5, pose.z); sim.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0), -pose.heading);
    updateDepartureTug(tug, sim, step ? dt : 0, false);
    tug.updateMatrixWorld(true);
    const pin = tug.localToWorld(new THREE.Vector3(0, .5, TUG.hitchZ + TUG.towbarLength));
    const nose = new THREE.Vector3(0, 0, TUG.noseGearZ).applyQuaternion(sim.quaternion).add(sim.position);
    assert.ok(Math.hypot(pin.x - nose.x, pin.z - nose.z) < 1e-8, 'fixed towbar ends at the actual nose gear');
    assert.equal(tug.position.y, 7, 'wheels stay on the ground');
    if (previous) assert.ok(previous.distanceTo(tug.position) < .04, 'no attached pose jump');
    previous = tug.position.clone();
    maxArticulation = Math.max(maxArticulation, Math.abs(Math.atan2(Math.sin(tug.userData.animation.yaw + pose.heading), Math.cos(tug.userData.animation.yaw + pose.heading))));
  }
  assert.ok(maxArticulation > .1 && maxArticulation < Math.PI / 2, 'tractor articulates instead of copying aircraft yaw');
  let previousSpeed = 0;
  for (let step = 0; step < 3600; step++) {
    updateDepartureTug(tug, sim, dt, true);
    const s = tug.userData.animation;
    assert.ok(previous.distanceTo(tug.position) <= 1.81 * dt, 'drive-away speed is bounded');
    assert.ok(Math.abs(s.speed - previousSpeed) <= .66 * dt, 'acceleration and braking remain gradual');
    previousSpeed = s.speed; previous.copy(tug.position);
  }
  assert.equal(tug.userData.animation.clear, true);
  assert.equal(tug.userData.animation.pinReleased, true);
  assert.equal(tug.userData.animation.towbar.scale.z, 1);
  const parked = tug.position.clone();
  updateDepartureTug(tug, sim, 1, false);
  assert.ok(tug.position.distanceTo(parked) < 1e-8, 'later stages do not reattach or teleport the tractor');
});
