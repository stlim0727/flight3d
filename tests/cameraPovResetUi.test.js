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
  mockElements.set('btn-reset-pov', resetBtn);

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

    // After drag -> modified -> shown
    cam.isDragging = true;
    cam.applyDragDelta(80, 40, false);
    cam.isDragging = false;

    updateControlState(telemetry, cam);
    assert.equal(resetBtn.hidden, false);

    // Reset POV -> hidden again
    cam.resetPov();
    updateControlState(telemetry, cam);
    assert.equal(resetBtn.hidden, true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
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
