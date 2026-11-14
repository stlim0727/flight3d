import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { pickGazeTarget } from '../src/cameras/gazeTargetPicker.js';
import { updateControlState } from '../src/ui/FlightPanels.js';

function createCameraLookingAt(origin, lookAt) {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 10000);
  camera.position.copy(origin);
  camera.lookAt(lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

test('pickGazeTarget picks a bandit by direct raycast and screen-space proximity', () => {
  const camera = createCameraLookingAt(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, 100, -500));
  const rect = { left: 0, top: 0, width: 1280, height: 720 };

  const banditMesh = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 10), new THREE.MeshBasicMaterial());
  banditMesh.position.set(0, 100, -200);
  banditMesh.updateMatrixWorld(true);

  // Direct center click
  const directHit = pickGazeTarget({
    clientX: 640,
    clientY: 360,
    rect,
    camera,
    sources: {
      bandits: [{ id: 'b1', label: 'Bandit 1', mesh: banditMesh, getPosition: () => banditMesh.position }],
    },
  });
  assert.equal(directHit?.kind, 'bandit');
  assert.equal(directHit?.label, 'Bandit 1');

  // Slight offset click (within 28px screen radius) on distant bandit without mesh hit
  banditMesh.position.set(0, 100, -1500);
  banditMesh.updateMatrixWorld(true);
  const nearHit = pickGazeTarget({
    clientX: 652,
    clientY: 365,
    rect,
    camera,
    sources: {
      bandits: [{ id: 'b1', label: 'Bandit 1', mesh: banditMesh, getPosition: () => banditMesh.position }],
    },
  });
  assert.equal(nearHit?.kind, 'bandit');
  assert.equal(nearHit?.id, 'b1');

  // Far miss in empty sky returns null
  const miss = pickGazeTarget({
    clientX: 100,
    clientY: 100,
    rect,
    camera,
    sources: {
      bandits: [{ id: 'b1', label: 'Bandit 1', mesh: banditMesh, getPosition: () => banditMesh.position }],
    },
  });
  assert.equal(miss, null);
});

test('pickGazeTarget picks other aircraft and airport buildings, ignoring hidden objects', () => {
  const camera = createCameraLookingAt(new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, 20, -100));
  const rect = { left: 0, top: 0, width: 800, height: 600 };

  const remoteMesh = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 12), new THREE.MeshBasicMaterial());
  remoteMesh.position.set(0, 20, -80);
  remoteMesh.updateMatrixWorld(true);

  const towerMesh = new THREE.Mesh(new THREE.BoxGeometry(12, 40, 12), new THREE.MeshBasicMaterial());
  towerMesh.position.set(0, 20, -140);
  towerMesh.updateMatrixWorld(true);

  const aircraftHit = pickGazeTarget({
    clientX: 400,
    clientY: 300,
    rect,
    camera,
    sources: {
      aircraft: [{ id: 'p2', label: 'Pilot 2', mesh: remoteMesh, getPosition: () => remoteMesh.position }],
      buildings: [{ object: towerMesh, kind: 'tower', label: 'Control Tower' }],
    },
  });
  assert.equal(aircraftHit?.kind, 'aircraft');
  assert.equal(aircraftHit?.label, 'Pilot 2');

  // Hide remote aircraft -> click hits the airport tower behind it
  remoteMesh.visible = false;
  const towerHit = pickGazeTarget({
    clientX: 400,
    clientY: 300,
    rect,
    camera,
    sources: {
      aircraft: [{ id: 'p2', label: 'Pilot 2', mesh: remoteMesh, getPosition: () => remoteMesh.position }],
      buildings: [{ object: towerMesh, kind: 'tower', label: 'Control Tower' }],
    },
  });
  assert.equal(towerHit?.kind, 'tower');
  assert.equal(towerHit?.label, 'Control Tower');
  assert.ok(towerHit?.position instanceof THREE.Vector3);
});

test('CameraSystem triggers onGazeClick on click without drag, tracks target, and exits on resetLook', () => {
  const listeners = {};
  const winListeners = {};
  const prevWin = globalThis.window;
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: (type, fn) => { winListeners[type] = fn; },
  };
  try {
    const dom = {
      style: {},
      addEventListener: (type, fn) => { listeners[type] = fn; },
    };
    const cam = new CameraSystem(new THREE.PerspectiveCamera(), dom);
    cam.setMode(CameraSystem.MODES.COCKPIT, true);

    const clicks = [];
    cam.onGazeClick = (x, y) => clicks.push({ x, y });

    // Short click triggers onGazeClick
    listeners.mousedown({ button: 0, clientX: 500, clientY: 300, target: dom });
    winListeners.mouseup({ button: 0, clientX: 502, clientY: 301, target: dom });
    assert.deepEqual(clicks, [{ x: 502, y: 301 }]);

    // Drag (>6px) does not trigger onGazeClick
    listeners.mousedown({ button: 0, clientX: 500, clientY: 300, target: dom });
    winListeners.mouseup({ button: 0, clientX: 540, clientY: 300, target: dom });
    assert.equal(clicks.length, 1);

    // Gaze target tracking in update()
    let alive = true;
    const targetPos = new THREE.Vector3(120, 40, -300);
    cam.setGazeTarget({
      kind: 'tower',
      label: 'Control Tower',
      getPosition: () => (alive ? targetPos : null),
    });
    assert.equal(cam.isGazeActive(), true);
    assert.equal(cam.getGazeTargetLabel(), 'Control Tower');

    const aircraft = new THREE.Object3D();
    aircraft.updateMatrixWorld(true);
    const state = { speed: 60, velocity: new THREE.Vector3(0, 0, -60) };
    cam.update(1 / 60, aircraft, state);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.camera.quaternion);
    const toTarget = targetPos.clone().sub(cam.camera.position).normalize();
    assert.ok(forward.dot(toTarget) > 0.999, 'camera looks at clicked gaze target');

    // Switching camera mode preserves active gaze
    cam.setMode(CameraSystem.MODES.CHASE, true);
    assert.equal(cam.isGazeActive(), true);

    // Explicit resetLook() exits gaze
    cam.resetLook();
    assert.equal(cam.isGazeActive(), false);

    // Target disappearing releases gaze automatically
    cam.setGazeTarget({
      kind: 'bandit',
      label: 'Bandit 1',
      getPosition: () => (alive ? targetPos : null),
    });
    alive = false;
    cam.update(1 / 60, aircraft, state);
    assert.equal(cam.isGazeActive(), false);
  } finally {
    if (prevWin === undefined) delete globalThis.window;
    else globalThis.window = prevWin;
  }
});

test('updateControlState synchronizes btn-gaze-exit visibility and label', () => {
  const prevDoc = globalThis.document;
  const resetBtn = { hidden: true, setAttribute: () => {} };
  const arrowIcon = { style: { transform: '' } };
  const gazeExitBtn = { hidden: true };
  const gazeExitLabel = { textContent: '' };
  const map = new Map([
    ['btn-reset-pov', resetBtn],
    ['pov-arrow-icon', arrowIcon],
    ['btn-gaze-exit', gazeExitBtn],
    ['gaze-exit-label', gazeExitLabel],
  ]);
  globalThis.document = {
    getElementById: (id) => map.get(id) || null,
    body: { classList: { contains: () => false } },
  };
  try {
    const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
    const telemetry = { flapIndex: 0, flapDegree: 0, gearState: 1, spoilers: 0 };

    updateControlState(telemetry, cam);
    assert.equal(gazeExitBtn.hidden, true);

    cam.setGazeTarget({ kind: 'tower', label: 'Control Tower', position: new THREE.Vector3(0, 10, 0) });
    updateControlState(telemetry, cam);
    assert.equal(gazeExitBtn.hidden, false);
    assert.ok(gazeExitLabel.textContent.includes('Control Tower'));

    cam.clearGaze();
    updateControlState(telemetry, cam);
    assert.equal(gazeExitBtn.hidden, true);
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});
