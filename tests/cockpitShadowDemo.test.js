import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CockpitShadowDemo, SHADOW_VIEWS, shadowSunPose } from '../src/director/CockpitShadowDemo.js';

function fixture() {
  const sim = {
    sky: { cloudCover: .7, timeOfDay: 17, sunDirectionOverride: null,
      setCloudCover(v) { this.cloudCover = v; }, setTimeOfDay(v) { this.timeOfDay = v; } },
    cameraSystem: { mode: 2, photoCockpit: true, lookYaw: .2, lookPitch: -.1,
      setMode(v) { this.mode = v; }, snapToTarget() {} },
    position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    linearVelocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
    renderPose: { reset() {} }, aircraft: { group: new THREE.Group() }, camera: {},
    telemetry: {}, physicsDt: 1 / 120, integratePhysics() {}, setPreset() {},
    foliage: { setTimeOfDay() {} }, water: { syncWithAtmosphere() {} },
  };
  return { sim, demo: new CockpitShadowDemo(sim) };
}

test('sun holds, transitions continuously and loops through all six directions', () => {
  assert.equal(shadowSunPose(4).bearing, SHADOW_VIEWS[0].bearing);
  for (let i = 1; i <= SHADOW_VIEWS.length; i++) {
    const before = shadowSunPose(i * 6 - .00001), after = shadowSunPose(i * 6);
    assert.ok(Math.abs(before.bearing - after.bearing) < .001);
    assert.ok(Math.abs(before.elevation - after.elevation) < .001);
    assert.equal(after.index, i % SHADOW_VIEWS.length);
  }
});

test('pause, manual previous/next, restart and exit preserve environment and camera', () => {
  const { sim, demo } = fixture();
  demo.start();
  assert.equal(sim.sky.cloudCover, 0);
  assert.equal(sim.cameraSystem.photoCockpit, false);
  assert.equal(sim.cameraSystem.mode, 0);
  assert.ok(Math.abs(sim.sky.sunDirectionOverride.length() - 1) < 1e-10);
  demo.update(6);
  assert.equal(demo.index, 1);
  demo.togglePause();
  const direction = demo.direction.clone();
  demo.update(30);
  assert.ok(direction.equals(demo.direction));
  demo.next(-1);
  assert.equal(demo.index, 0);
  demo.next(-1);
  assert.equal(demo.index, 5);
  sim.cameraSystem.mode = 3;
  demo.update(1);
  assert.equal(sim.cameraSystem.mode, 0);
  demo.stop();
  assert.equal(sim.sky.sunDirectionOverride, null);
  assert.equal(sim.sky.cloudCover, .7);
  assert.equal(sim.sky.timeOfDay, 17);
  assert.equal(sim.cameraSystem.mode, 2);
  assert.equal(sim.cameraSystem.photoCockpit, true);
  assert.equal(sim.cameraSystem.lookYaw, .2);
  assert.equal(sim.cameraSystem.lookPitch, -.1);
  demo.start();
  assert.equal(demo.index, 0);
  assert.equal(demo.paused, false);
  demo.stop();
  demo.stop();
  assert.equal(sim.sky.cloudCover, .7);
});

test('artificial sun stays relative to the stationary aircraft heading', () => {
  const { sim, demo } = fixture();
  sim.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  demo.start();
  const body = demo.direction.clone().applyQuaternion(sim.quaternion.clone().invert());
  const expected = SHADOW_VIEWS[0];
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(Math.atan2(body.x, -body.z)) - expected.bearing) < 1e-9);
  demo.stop();
});
