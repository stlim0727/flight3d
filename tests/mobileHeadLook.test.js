import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { MobileHeadTracking } from '../src/cameras/MobileHeadTracking.js';
import { CockpitCameraMode } from '../src/cameras/modes/CockpitCameraMode.js';
import { GearCameraMode } from '../src/cameras/modes/GearCameraMode.js';
import { HeadPoseDetector } from '../src/cameras/HeadPoseDetector.js';
import { HeadTrackingUi } from '../src/cameras/HeadTrackingUi.js';

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

  it('releases in-flight camera resources when disabled during detector loading', async () => {
    const previousNavigator = globalThis.navigator;
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const originalCreate = HeadPoseDetector.create;
    let resolveCreate;
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
    HeadPoseDetector.create = () => new Promise((resolve) => { resolveCreate = resolve; });

    try {
      const controller = new MobileHeadTracking(fakeCameraSystem());
      const pending = controller.enable();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      controller.disable();
      resolveCreate({ dispose() {} });
      await pending;

      assert.equal(controller.state, 'idle');
      assert.equal(stopped, true, 'stream track must stop before detector loading finishes');
      assert.equal(removed, true, 'hidden video must be removed before detector loading finishes');
    } finally {
      HeadPoseDetector.create = originalCreate;
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });
      Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument });
      globalThis.window = previousWindow;
    }
  });

  it('applies head yaw in GearCameraMode matching CockpitCameraMode lateral direction', () => {
    const camGear = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000);
    const aircraft = new THREE.Object3D();
    aircraft.updateMatrixWorld(true);

    const cs = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener() {}, style: {} });
    cs.mode = CameraSystem.MODES.GEAR;
    cs.setHeadTrackingEnabled(true);
    cs._frameDt = 1 / 60;

    // Neutral baseline
    cs.setHeadLook(0, 0);
    cs.headLookYaw = 0;
    cs.headLookPitch = 0;
    cs.headLookActive = false;
    GearCameraMode.update(camGear, aircraft, cs);
    const neutralDir = camGear.getWorldDirection(new THREE.Vector3());

    // Head yaw positive (turned left)
    cs.headLookActive = true;
    cs.setHeadLook(0.4, 0);
    cs.headLookYaw = 0.4;
    GearCameraMode.update(camGear, aircraft, cs);
    const turnedDir = camGear.getWorldDirection(new THREE.Vector3());

    // Turned left means x component moves in the -X direction (left) relative to neutral
    assert.ok(turnedDir.x < neutralDir.x, 'positive head yaw must turn gear gaze to the left (-X)');
  });

  it('creates HeadTrackingUi away from bottom throttle area and supports collapse', () => {
    const elements = [];
    const previousDocument = globalThis.document;
    const mockDocument = {
      createElement: (tag) => {
        const el = {
          tagName: tag.toUpperCase(),
          style: {},
          attributes: {},
          children: [],
          textContent: '',
          setAttribute: (k, v) => { el.attributes[k] = v; },
          appendChild: (c) => { el.children.push(c); },
          append: (...items) => { el.children.push(...items); },
          addEventListener: (evt, handler) => { el[`on_${evt}`] = handler; },
          remove: () => {},
        };
        elements.push(el);
        return el;
      },
      body: {
        appendChild: () => {},
      },
    };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDocument });

    try {
      const controller = {
        getStatus: () => ({ state: 'idle', message: 'Head tracking off' }),
        toggle: () => {},
        reset: () => {},
        calibrate: () => {},
      };
      const ui = new HeadTrackingUi(controller);

      assert.ok(ui.root.style.cssText.includes('top:'), 'UI must be positioned at top');
      assert.ok(!ui.root.style.cssText.includes('bottom:12px'), 'UI must not sit at bottom-left throttle area');

      // Test collapse toggle
      assert.equal(ui.collapsed, false);
      ui.toggleCollapse();
      assert.equal(ui.collapsed, true);
      assert.equal(ui.body.style.display, 'none');
      ui.toggleCollapse();
      assert.equal(ui.collapsed, false);
      assert.equal(ui.body.style.display, 'flex');
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument });
    }
  });
});
