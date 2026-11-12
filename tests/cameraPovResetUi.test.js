import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { updateControlState } from '../src/ui/FlightPanels.js';

test('updateControlState synchronizes btn-reset-pov visibility with isPovModified()', () => {
  const previousDocument = globalThis.document;
  const mockElements = new Map();
  const resetBtn = {
    hidden: true,
    textContent: '',
    setAttribute: () => {},
  };
  const arrowIcon = {
    style: { transform: '' },
  };
  mockElements.set('btn-reset-pov', resetBtn);
  mockElements.set('pov-arrow-icon', arrowIcon);

  globalThis.document = {
    getElementById: (id) => mockElements.get(id) || null,
    body: { classList: { contains: () => false } }
  };

  try {
    const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
    cam.setMode(CameraSystem.MODES.COCKPIT, true);

    const telemetry = { flapIndex: 0, flapDegree: 0, gearState: 1, spoilers: 0 };

    // Initially unmodified -> hidden
    updateControlState(telemetry, cam);
    assert.equal(resetBtn.hidden, true);

    // After drag -> modified -> shown with rotated arrow
    cam.isDragging = true;
    cam.applyDragDelta(80, 40, false);
    cam.isDragging = false;

    updateControlState(telemetry, cam);
    assert.equal(resetBtn.hidden, false);
    assert.ok(arrowIcon.style.transform.startsWith('rotate('));

    // Reset POV -> hidden again
    cam.resetPov();
    updateControlState(telemetry, cam);
    assert.equal(resetBtn.hidden, true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('CameraSystem getPovIndicatorAngle accurately computes default direction', () => {
  const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
  cam.setMode(CameraSystem.MODES.COCKPIT, true);
  const defaultPitch = cam.aircraftLookPitch ?? -0.25;

  // 1. Center / default -> 0
  assert.equal(cam.getPovIndicatorAngle(), 0);

  // 2. Looking Right (yaw < 0) -> default is Left (-90 deg)
  cam.lookYaw = -0.5;
  cam.lookPitch = defaultPitch;
  assert.equal(Math.round(cam.getPovIndicatorAngle()), -90);

  // 3. Looking Left (yaw > 0) -> default is Right (+90 deg)
  cam.lookYaw = 0.5;
  cam.lookPitch = defaultPitch;
  assert.equal(Math.round(cam.getPovIndicatorAngle()), 90);

  // 4. Looking Up (pitch > defaultPitch) -> default is Down (180 deg)
  cam.lookYaw = 0;
  cam.lookPitch = defaultPitch + 0.3;
  assert.equal(Math.abs(Math.round(cam.getPovIndicatorAngle())), 180);

  // 5. Looking Down (pitch < defaultPitch) -> default is Up (0 deg)
  cam.lookYaw = 0;
  cam.lookPitch = defaultPitch - 0.3;
  assert.equal(Math.round(cam.getPovIndicatorAngle()), 0);

  // 6. Diagonal: Looking Up & Right -> default is Down & Left (-135 deg)
  cam.lookYaw = -0.3;
  cam.lookPitch = defaultPitch + 0.3;
  assert.equal(Math.round(cam.getPovIndicatorAngle()), -135);
});

test('CameraSystem applyHatLook pans camera view and returns to default when released', () => {
  const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
  cam.setMode(CameraSystem.MODES.COCKPIT, true);
  const aircraft = new THREE.Object3D();
  const defaultPitch = cam.aircraftLookPitch ?? -0.25;

  // 1. Hat Left (dirX = -1): lookYaw should increase (look left)
  cam.applyHatLook(-1, 0, 0.1);
  assert.ok(cam.lookYaw > 0, `lookYaw should be > 0, got ${cam.lookYaw}`);
  assert.equal(cam.isPovModified(), true);
  assert.equal(cam.povChangedByDrag, true);
  assert.equal(cam.isHatLooking, true);

  const yawAfterHatLeft = cam.lookYaw;

  // 2. While hat look is active, update does NOT decay POV
  cam.update(0.1, aircraft);
  assert.equal(cam.lookYaw, yawAfterHatLeft);
  assert.equal(cam.isHatLooking, false); // Resets flag for subsequent frame

  // 3. When released (no applyHatLook called), update smoothly returns to default
  cam.update(0.5, aircraft);
  assert.ok(cam.lookYaw < yawAfterHatLeft);
  assert.ok(cam.lookYaw > 0);

  // 4. Hat Up (dirY = -1): lookPitch should increase (look up)
  cam.resetPov();
  cam.applyHatLook(0, -1, 0.1);
  assert.ok(cam.lookPitch > defaultPitch, `lookPitch should be > defaultPitch, got ${cam.lookPitch}`);

  // 5. Reset immediately snaps back
  cam.resetPov();
  assert.equal(cam.lookPitch, defaultPitch);
  assert.equal(cam.isPovModified(), false);
});

test('CameraSystem applyHatLook glances to fixed target angle without spinning past and springs back quickly on release', () => {
  const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
  cam.setMode(CameraSystem.MODES.COCKPIT, true);
  const aircraft = new THREE.Object3D();
  const defaultPitch = cam.aircraftLookPitch ?? -0.25;

  // Hold Hat Left for 2 seconds (120 frames at 60Hz): must settle at hatGlanceYaw (~1.35 rad) instead of spinning indefinitely
  for (let i = 0; i < 120; i++) {
    cam.applyHatLook(-1, 0, 1 / 60);
    cam.update(1 / 60, aircraft);
  }
  assert.ok(Math.abs(cam.lookYaw - cam.hatGlanceYaw) < 0.005, `Expected lookYaw near ${cam.hatGlanceYaw}, got ${cam.lookYaw}`);
  assert.equal(cam.lookPitch, defaultPitch);
  assert.equal(cam.userLookOverridden, true);

  // Switch directly to diagonal Up-Right (dirX = +1, dirY = -1): settles at 45° diagonal target
  for (let i = 0; i < 120; i++) {
    cam.applyHatLook(1, -1, 1 / 60);
    cam.update(1 / 60, aircraft);
  }
  const expectedDiagYaw = -cam.hatGlanceYaw * Math.SQRT1_2;
  const expectedDiagPitch = defaultPitch + cam.hatGlancePitchUp * Math.SQRT1_2;
  assert.ok(Math.abs(cam.lookYaw - expectedDiagYaw) < 0.005, `Expected diagonal yaw ${expectedDiagYaw}, got ${cam.lookYaw}`);
  assert.ok(Math.abs(cam.lookPitch - expectedDiagPitch) < 0.005, `Expected diagonal pitch ${expectedDiagPitch}, got ${cam.lookPitch}`);

  // Release hat switch: returns to center within ~1.0s (60 frames at 60Hz) and clears userLookOverridden
  for (let i = 0; i < 60; i++) {
    cam.update(1 / 60, aircraft);
  }
  assert.equal(cam.isPovModified(), false);
  assert.equal(cam.lookYaw, 0);
  assert.equal(cam.lookPitch, defaultPitch);
  assert.equal(cam.povChangedByHat, false);
  assert.equal(cam.userLookOverridden, false);
});

test('CameraSystem normalizes yaw across multiple revolutions and eases along shortest arc', () => {
  const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
  cam.setMode(CameraSystem.MODES.CHASE, true);
  const aircraft = new THREE.Object3D();

  // 1. Full 360 degree orbit (2 * Math.PI) is equivalent to 0:
  cam.chaseYaw = 2 * Math.PI;
  cam.chasePitch = 0;
  assert.equal(cam.isPovModified(), false);
  assert.equal(cam.getPovIndicatorAngle(), 0);

  // 2. Dragging 360 + 0.3 rad -> returns along the 0.3 rad arc instead of a full revolution
  cam.povChangedByDrag = true;
  cam.chaseYaw = 2 * Math.PI + 0.3;
  assert.equal(cam.isPovModified(), true);
  assert.equal(Math.round(cam.getPovIndicatorAngle()), 90);

  cam.update(0.5, aircraft);
  // Should step toward 0 along shortest path, remaining in small positive range
  assert.ok(cam.chaseYaw < 0.3, `chaseYaw should be < 0.3, got ${cam.chaseYaw}`);
  assert.ok(cam.chaseYaw > 0, `chaseYaw should be > 0, got ${cam.chaseYaw}`);

  // Negative revolution: -2 * Math.PI - 0.3 rad -> returns toward 0 along positive direction
  cam.chaseYaw = -2 * Math.PI - 0.3;
  cam.povChangedByDrag = true;
  assert.equal(cam.isPovModified(), true);
  assert.equal(Math.round(cam.getPovIndicatorAngle()), -90);

  cam.update(0.5, aircraft);
  assert.ok(cam.chaseYaw > -0.3, `chaseYaw should be > -0.3, got ${cam.chaseYaw}`);
  assert.ok(cam.chaseYaw < 0, `chaseYaw should be < 0, got ${cam.chaseYaw}`);
});

test('CameraSystem updatePovReturn smoothly returns POV after drag, preserving POV during drag', () => {
  const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
  cam.setMode(CameraSystem.MODES.COCKPIT, true);
  const aircraft = new THREE.Object3D();
  const defaultPitch = cam.aircraftLookPitch ?? -0.25;

  // 1. Dragging
  cam.isDragging = true;
  cam.applyDragDelta(100, 50, false);
  const initialYaw = cam.lookYaw;
  const initialPitch = cam.lookPitch;
  assert.equal(cam.isPovModified(), true);

  // During drag: update should NOT return POV
  cam.update(0.2, aircraft);
  assert.equal(cam.lookYaw, initialYaw);
  assert.equal(cam.lookPitch, initialPitch);

  // 2. Release drag
  cam.isDragging = false;

  // After release: moves back slowly towards default
  cam.update(0.5, aircraft);
  assert.ok(Math.abs(cam.lookYaw) < Math.abs(initialYaw));
  assert.ok(Math.abs(cam.lookYaw) > 0);
  assert.ok(Math.abs(cam.lookPitch - defaultPitch) < Math.abs(initialPitch - defaultPitch));

  // Calling resetPov immediately resets to default
  cam.resetPov();
  assert.equal(cam.lookYaw, 0);
  assert.equal(cam.lookPitch, defaultPitch);
  assert.equal(cam.isPovModified(), false);
});

test('CameraSystem autoResetGaze false holds the released POV until the option is turned back on', () => {
  const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
  cam.setMode(CameraSystem.MODES.COCKPIT, true);
  cam.autoResetGaze = false;
  const aircraft = new THREE.Object3D();
  const defaultPitch = cam.aircraftLookPitch ?? -0.25;

  cam.isDragging = true;
  cam.applyDragDelta(100, 50, false);
  const heldYaw = cam.lookYaw;
  const heldPitch = cam.lookPitch;
  assert.equal(cam.isPovModified(), true);
  assert.equal(cam.userLookOverridden, true);

  cam.isDragging = false;
  cam.update(0.5, aircraft);
  assert.equal(cam.lookYaw, heldYaw);
  assert.equal(cam.lookPitch, heldPitch);
  assert.equal(cam.userLookOverridden, true);

  cam.autoResetGaze = true;
  cam.update(0.5, aircraft);
  assert.ok(Math.abs(cam.lookYaw) < Math.abs(heldYaw));
  assert.ok(Math.abs(cam.lookPitch - defaultPitch) < Math.abs(heldPitch - defaultPitch));
});
