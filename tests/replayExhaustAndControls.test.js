import test from 'node:test';
import assert from 'node:assert/strict';
import { JetExhaust } from '../src/effects/JetExhaust.js';
import { F16 } from '../src/aircraft/F16.js';
import { sampleTrack } from '../src/replay/TrackSampler.js';
import { getControlInput } from '../src/aircraft/common/ControlSurfaceRig.js';
import { updateGltfControlSurfaces } from '../src/aircraft/GltfControlSurfaces.js';
import { BanditAircraftView } from '../src/weapons/BanditAircraftView.js';
import { RemoteAircraft } from '../src/multiplayer/RemoteAircraft.js';
import { Scene, Group } from 'three';

test('JetExhaust powers up and remains visible in replay without explicit thrust field', () => {
  const exhaust = new JetExhaust();
  assert.equal(exhaust.power, 0);

  // Initial update with engine idle / off
  exhaust.update(0, { engine1: { n1: 0, failed: false }, throttle: 0 });
  assert.equal(exhaust.power, 0);
  assert.equal(exhaust.group.visible, false);

  // 1. Replay sample with N1 only (no thrust property)
  exhaust.update(0.1, { engine1: { n1: 95, failed: false }, throttle: 0.95 });
  assert.ok(exhaust.power > 0.3, `power should increase towards 0.95, got ${exhaust.power}`);
  assert.equal(exhaust.group.visible, true);

  // 2. dt <= 0 (instant seek or pause)
  exhaust.update(0, { engine1: { n1: 95, failed: false }, throttle: 0.95 });
  assert.equal(exhaust.power, 0.95);
  assert.equal(exhaust.group.visible, true);
  assert.ok(exhaust.material.uniforms.burner.value > 0.5, 'burner uniform activates above 82%');

  // 3. Engine shutdown or failure turns exhaust off
  exhaust.update(0, { engine1: { n1: 0, failed: true }, throttle: 0 });
  assert.equal(exhaust.power, 0);
  assert.equal(exhaust.group.visible, false);
});

test('TrackSampler populates synthetic thrust so engine observers stay alive in playback', () => {
  const track = {
    samples: [
      { timeSec: 0, x: 0, y: 100, z: 0, quat: [0, 0, 0, 1], throttle: 0.8, engine1: { n1: 85 } },
      { timeSec: 1, x: 10, y: 100, z: 10, quat: [0, 0, 0, 1], throttle: 0.9, engine1: { n1: 95 } },
    ]
  };
  const sampled = sampleTrack(track, 0.5);
  assert.ok(sampled);
  assert.ok(sampled.engine1.thrust > 0, 'synthetic thrust should be positive');
  assert.equal(sampled.engine1.failed, false);
});

test('F16 creates exhaust even with exteriorOnly option', () => {
  const exteriorF16 = new F16({ exteriorOnly: true });
  assert.ok(exteriorF16.exhaust instanceof JetExhaust, 'exterior F16 must possess JetExhaust plume');
  assert.ok(exteriorF16.group.children.includes(exteriorF16.exhaust.group));
});

test('getControlInput and updateGltfControlSurfaces support raw fallback fields', () => {
  // getControlInput fallback
  assert.equal(getControlInput({ rawElevator: 0.75 }, 'elevator'), 0.75);
  assert.equal(getControlInput({ elevator: -0.5, rawElevator: 0.75 }, 'elevator'), -0.5);

  // updateGltfControlSurfaces with raw inputs
  const pivot = new Group();
  const mockControl = { input: 'elevator', gain: 0.5, axis: { x: 1, y: 0, z: 0 }, pivot };
  updateGltfControlSurfaces([mockControl], { rawElevator: 0.8 });
  assert.ok(pivot.quaternion.x > 0, 'pivot rotated using rawElevator input');
});

test('BanditAircraftView supplies throttle and engine parameters to airframe', () => {
  const bandit = new BanditAircraftView('BANDIT-TEST');
  let receivedState = null;
  bandit.airframe = {
    update(dt, state) {
      receivedState = state;
    }
  };
  bandit.update(0.016, { aero: { elevator: 0.5, aileron: -0.2, rudder: 0.1 }, throttle: 0.9 });
  assert.ok(receivedState);
  assert.equal(receivedState.elevator, 0.5);
  assert.equal(receivedState.aileron, -0.2);
  assert.equal(receivedState.rudder, 0.1);
  assert.equal(receivedState.throttle, 0.9);
  assert.ok(receivedState.engine1.thrust > 0);
  assert.equal(receivedState.engine1.n1, 90);
});

test('RemoteAircraft animate propagates control surfaces and engine states', () => {
  let receivedState = null;
  const mockModel = {
    update(dt, state) {
      receivedState = state;
    },
    setCockpitMode() {},
    group: new Group(),
  };
  const remote = Object.create(RemoteAircraft.prototype);
  remote.model = mockModel;
  remote.lights = [];
  remote.animate({ gear: 1, flaps: 20, elevator: 0.4, aileron: -0.3, rudder: 0.2, throttle: 0.8 }, 0.016);
  assert.ok(receivedState);
  assert.equal(receivedState.gearState, 1);
  assert.equal(receivedState.flapDegree, 20);
  assert.equal(receivedState.elevator, 0.4);
  assert.equal(receivedState.aileron, -0.3);
  assert.equal(receivedState.rudder, 0.2);
  assert.equal(receivedState.throttle, 0.8);
});
