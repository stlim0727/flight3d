import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

const DEG = Math.PI / 180;

/**
 * Wheel events are registered on the canvas element, so the listeners are
 * captured the same way tests/cameraMouseLook.test.js does.
 */
function withMode(mode) {
  const previousWindow = globalThis.window;
  const domListeners = new Map();
  globalThis.window = { innerWidth: 1200, innerHeight: 800, addEventListener: () => {} };
  try {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.08, 1000);
    const dom = { style: {}, addEventListener: (name, fn) => domListeners.set(name, fn) };
    const cam = new CameraSystem(camera, dom);
    cam.setMode(mode, true);
    return {
      cam,
      camera,
      wheel: (deltaY) => domListeners.get('wheel')({ deltaY })
    };
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

function aircraftAt(x, y, z) {
  const aircraft = new THREE.Object3D();
  aircraft.position.set(x, y, z);
  aircraft.updateMatrixWorld(true);
  return aircraft;
}

describe('CameraSystem optical zoom (cockpit & tower)', () => {
  it('magnifies with scroll up and returns to 1x with scroll down, clamped at both ends', () => {
    for (const mode of [CameraSystem.MODES.COCKPIT, CameraSystem.MODES.TOWER]) {
      const { cam, wheel } = withMode(mode);
      assert.equal(cam.opticalZoom, 1, 'views open unzoomed');

      wheel(-100);
      assert.ok(cam.opticalZoom > 1, `${cam.getViewName()}: scroll up magnifies`);
      for (let i = 0; i < 40; i++) wheel(-100);
      assert.equal(cam.opticalZoom, cam.opticalZoomMax, 'zoom-in saturates at the maximum');

      for (let i = 0; i < 60; i++) wheel(100);
      assert.equal(cam.opticalZoom, cam.opticalZoomMin, 'zoom-out saturates at 1x, never wider than the base field of view');
    }
  });

  it('pinch spread magnifies and pinch collapse cancels it in both fixed eye-point views', () => {
    for (const mode of [CameraSystem.MODES.COCKPIT, CameraSystem.MODES.TOWER]) {
      const { cam } = withMode(mode);
      cam.applyPinchZoom(200);
      assert.ok(cam.opticalZoom > 1.5, `${cam.getViewName()}: fingers spreading apart magnifies`);
      cam.applyPinchZoom(-200);
      assert.ok(Math.abs(cam.opticalZoom - 1) < 1e-6, 'the reverse gesture unwinds the zoom');
    }
  });

  it('keeps the tower eye point fixed while the field of view narrows', () => {
    const { cam, camera, wheel } = withMode(CameraSystem.MODES.TOWER);
    const aircraft = aircraftAt(40, 12, 60);
    cam.update(0.1, aircraft, {});
    const before = camera.position.clone();
    wheel(-100);
    wheel(-100);
    cam.update(0.1, aircraft, {});
    assert.ok(cam.opticalZoom > 1);
    assert.ok(before.distanceTo(camera.position) < 1e-6, 'tower zoom is optical, not a dolly');
    const zoomedFov = cam.applyBaseFov(54);
    assert.ok(zoomedFov < 54, 'a narrower field of view enlarges the aircraft');
    assert.ok(Math.abs(camera.fov - zoomedFov) < 1e-9, 'the frame picks up the zoomed field of view');
  });

  it('leaves the base field of view untouched at 1x and scales the half-angle tangent by the magnification', () => {
    const { cam, camera } = withMode(CameraSystem.MODES.COCKPIT);
    assert.ok(Math.abs(cam.applyBaseFov(60) - 60) < 1e-9, '1x reproduces the cockpit base FOV');
    assert.ok(Math.abs(camera.fov - 60) < 1e-9);

    const wideProjection = camera.projectionMatrix.elements[5];
    cam.zoomOpticalBy(2);
    const zoomedFov = cam.applyBaseFov(60);
    const ratio = Math.tan(30 * DEG) / Math.tan((zoomedFov / 2) * DEG);
    assert.ok(Math.abs(ratio - 2) < 1e-9, `2x must double apparent size, got ${ratio}`);
    assert.ok(camera.projectionMatrix.elements[5] > wideProjection, 'the projection matrix is rebuilt for the new field of view');

    // Portrait bases are already widened to protect horizontal coverage; the
    // zoom composes on whatever base the frame chose.
    cam.zoomOpticalBy(2);
    const portraitFov = cam.applyBaseFov(100);
    assert.ok(Math.abs((Math.tan(50 * DEG) / Math.tan((portraitFov / 2) * DEG)) - 4) < 1e-9);
  });

  it('keeps chase and drone wheel zoom on distance and leaves them unzoomed optically', () => {
    for (const [mode, distanceKey] of [[CameraSystem.MODES.CHASE, 'chaseDistance'], [CameraSystem.MODES.DRONE, 'droneDistance']]) {
      const { cam, wheel } = withMode(mode);
      const before = cam[distanceKey];
      wheel(-100);
      assert.ok(cam[distanceKey] < before, `${cam.getViewName()} pulls closer on scroll up`);
      assert.equal(cam.opticalZoom, 1, `${cam.getViewName()} has no optical zoom`);
      assert.equal(cam.usesOpticalZoom(), false);
    }
  });

  it('treats a zoom gesture as manual control and drops magnification on view changes', () => {
    const { cam, wheel } = withMode(CameraSystem.MODES.COCKPIT);
    wheel(-100);
    assert.equal(cam.userLookOverridden, true, 'zooming holds the framing against automatic camera cuts');
    assert.equal(cam.setMode(CameraSystem.MODES.CHASE), false, 'automatic mode switch is blocked');
    assert.equal(cam.mode, CameraSystem.MODES.COCKPIT);

    assert.equal(cam.setMode(CameraSystem.MODES.TOWER, true), true);
    assert.equal(cam.opticalZoom, 1, 'choosing another view starts unzoomed');
    assert.equal(cam.userLookOverridden, false);
  });

  it('clears magnification with the centered-view reset', () => {
    const { cam, camera } = withMode(CameraSystem.MODES.COCKPIT);
    cam.applyBaseFov(60);
    cam.zoomOpticalBy(3);
    cam.applyBaseFov(60);
    assert.ok(camera.fov < 60);
    cam.resetLook();
    assert.equal(cam.opticalZoom, 1);
    assert.ok(Math.abs(cam.applyBaseFov(60) - 60) < 1e-9, 'double-click / double-tap restores the unzoomed field of view');
    assert.ok(Math.abs(camera.fov - 60) < 1e-6);
  });

  it('leans the pilot toward the windscreen as the cockpit magnifies, and straightens up on reset', () => {
    const { cam, camera } = withMode(CameraSystem.MODES.COCKPIT);
    const aircraft = aircraftAt(0, 0, 0);
    cam.update(0.1, aircraft, {});
    const eyeAt1x = camera.position.clone();

    cam.zoomOpticalBy(cam.opticalZoomMax);
    cam.update(0.1, aircraft, {});
    const lean = camera.position.clone().sub(eyeAt1x);
    const expected = (cam.opticalZoomMax - 1) * cam.cockpitZoomLean;
    assert.ok(Math.abs(lean.length() - expected * Math.hypot(1, cam.cockpitZoomLeanRise)) < 1e-6,
      `the eye advances ${expected.toFixed(2)} m along the fuselage axis`);
    assert.ok(lean.dot(new THREE.Vector3(0, 0, -1)) > expected * 0.99, 'the lean is forward, not aft');
    assert.ok(lean.y > 0, 'the head lifts to clear the glareshield');

    cam.resetLook();
    cam.update(0.1, aircraft, {});
    assert.ok(camera.position.distanceTo(eyeAt1x) < 1e-6, 'centering the view seats the pilot again');

    const tower = withMode(CameraSystem.MODES.TOWER);
    tower.cam.update(0.1, aircraft, {});
    const seated = tower.camera.position.clone();
    tower.cam.zoomOpticalBy(3);
    tower.cam.update(0.1, aircraft, {});
    assert.ok(tower.camera.position.equals(seated), 'the tower cab never moves');
  });

  it('ignores non-finite ratios and no-op ratios without touching the view', () => {

    const { cam } = withMode(CameraSystem.MODES.COCKPIT);
    assert.equal(cam.zoomOpticalBy(Number.NaN), false);
    assert.equal(cam.zoomOpticalBy(1), false);
    assert.equal(cam.opticalZoom, 1);
    assert.equal(cam.userLookOverridden, false, 'a rejected gesture does not claim manual control');
  });
});
