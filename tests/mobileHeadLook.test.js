import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { MobileHeadTracking } from '../src/cameras/MobileHeadTracking.js';

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
});
