import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { MobileHeadTracking } from '../src/cameras/MobileHeadTracking.js';
import { CockpitCameraMode } from '../src/cameras/modes/CockpitCameraMode.js';

const fakeCameraSystem = () => ({
  setHeadTrackingEnabled() {},
  setHeadLook() {},
  resetHeadLook() {},
});

describe('mobile head look', () => {
  it('includes active head look in photo-cockpit look-away detection', () => {
    const cs = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener() {}, style: {} });
    cs.mode = CameraSystem.MODES.COCKPIT;
    cs.setHeadTrackingEnabled(true);
    cs.setHeadLook(0.6, 0);
    cs.headLookYaw = 0.6;
    cs.headLookActive = true;

    assert.equal(cs.isLookingAwayFromCenter(), true);
    assert.equal(cs.zoomGazeBlend(), 0);
  });

  it('notifies the UI when detection or calibration samples change', () => {
    const updates = [];
    const controller = new MobileHeadTracking(fakeCameraSystem(), {
      onStatusChange: (status) => updates.push(status),
    });
    controller.state = 'active';
    controller.detector = {
      detect: () => ({ detected: true, yaw: 0.1, pitch: 0, confidence: 0.9, bbox: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 } }),
      getCalibration: () => ({ neutral: { x: 0.5, y: 0.5 }, range: { x: 0.5, y: 0.5 }, samples: 3 }),
      dispose() {},
    };
    controller.video = { readyState: 4, videoWidth: 640 };

    controller.update(1000);

    assert.ok(updates.length > 0, 'status callback must fire after detection changes');
    const latest = updates.at(-1);
    assert.equal(latest.detected, true);
    assert.equal(latest.calibration.samples, 3);
  });

  it('ignores camera permission results after disable', async () => {
    const previousNavigator = globalThis.navigator;
    const previousWindow = globalThis.window;
    let resolveStream;
    let stopped = false;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: () => new Promise((resolve) => { resolveStream = resolve; }),
        },
      },
    });
    globalThis.window = { isSecureContext: true, addEventListener() {} };

    try {
      const controller = new MobileHeadTracking(fakeCameraSystem());
      const pending = controller.enable();
      await Promise.resolve();
      controller.disable();
      resolveStream({ getTracks: () => [{ stop() { stopped = true; } }] });
      await pending;

      assert.equal(stopped, true, 'late stream must be released');
      assert.equal(controller.state, 'idle');
      assert.equal(controller.video, null);
      assert.equal(controller.detector, null);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });
      globalThis.window = previousWindow;
    }
  });

  it('clamps combined cockpit pitch before the vertical flip', () => {
    const cam = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000);
    const cs = new CameraSystem(cam, { addEventListener() {}, style: {} });
    const aircraft = new THREE.Object3D();
    aircraft.updateMatrixWorld(true);
    cs.mode = CameraSystem.MODES.COCKPIT;
    cs.setHeadTrackingEnabled(true);
    cs.setHeadLook(0, -1.4);
    cs.headLookYaw = 0;
    cs.headLookPitch = -1.4;
    cs.headLookActive = true;
    cs._frameDt = 1 / 60;

    CockpitCameraMode.update(cam, aircraft, {}, cs);

    const direction = cam.getWorldDirection(new THREE.Vector3());
    assert.ok(direction.z < 0, 'view must stay forward of vertical');
  });

  it('releases local camera resources when detector loading fails', async () => {
    const previousNavigator = globalThis.navigator;
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let stopped = false;
    let removed = false;
    const stream = { getTracks: () => [{ stop() { stopped = true; } }] };
    const video = {
      style: {},
      setAttribute() {},
      play: async () => {},
      remove() { removed = true; },
    };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia: async () => stream } },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => video, body: { appendChild() {} } },
    });
    globalThis.window = { isSecureContext: true, addEventListener() {} };

    try {
      const controller = new MobileHeadTracking(fakeCameraSystem());
      await controller.enable();

      assert.equal(controller.state, 'error');
      assert.equal(stopped, true, 'stream track must stop on detector failure');
      assert.equal(removed, true, 'hidden video must be removed on detector failure');
      assert.equal(controller.video, null);
      assert.equal(controller.detector, null);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });
      Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument });
      globalThis.window = previousWindow;
    }
  });
});
