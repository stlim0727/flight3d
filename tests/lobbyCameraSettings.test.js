import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { LobbyCameraModal } from '../src/ui/LobbyCameraModal.js';

test('CameraSystem preferred start mode loads and saves to localStorage', () => {
  const previousLocalStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
  };

  try {
    const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
    // Default should be COCKPIT (0)
    assert.equal(cam.getPreferredStartMode(), CameraSystem.MODES.COCKPIT);

    // Save CHASE (1)
    let notifiedMode = null;
    cam.onPreferredStartModeChange = (mode) => { notifiedMode = mode; };
    cam.setPreferredStartMode(CameraSystem.MODES.CHASE);

    assert.equal(store.get('flight3d.startCameraMode'), '1');
    assert.equal(cam.getPreferredStartMode(), CameraSystem.MODES.CHASE);
    assert.equal(notifiedMode, CameraSystem.MODES.CHASE);

    // Save WING (2)
    cam.setPreferredStartMode(CameraSystem.MODES.WING);
    assert.equal(store.get('flight3d.startCameraMode'), '2');
    assert.equal(cam.getPreferredStartMode(), CameraSystem.MODES.WING);
  } finally {
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  }
});

test('CameraSystem saves and resets cockpit user offset per aircraft', () => {
  const previousLocalStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
  };

  try {
    const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
    
    // Test C172
    cam.aircraftConfig = { id: 'C172' };
    cam.setCockpitUserOffset(0.02, 0.05, -0.03);
    assert.equal(cam.isCockpitUserOffsetModified(), true);
    assert.deepEqual(store.get('flight3d.cockpitUserOffset.C172'), JSON.stringify({ x: 0.02, y: 0.05, z: -0.03 }));

    // Reset C172
    cam.resetCockpitUserOffset();
    assert.equal(cam.isCockpitUserOffsetModified(), false);
    assert.deepEqual(store.get('flight3d.cockpitUserOffset.C172'), JSON.stringify({ x: 0, y: 0, z: 0 }));

    // Test F16 independently
    cam.aircraftConfig = { id: 'F16' };
    cam.loadCockpitUserOffset();
    assert.equal(cam.isCockpitUserOffsetModified(), false);

    cam.setCockpitUserOffset(0, 0.08, 0);
    assert.equal(cam.isCockpitUserOffsetModified(), true);
    assert.deepEqual(store.get('flight3d.cockpitUserOffset.F16'), JSON.stringify({ x: 0, y: 0.08, z: 0 }));
    // C172 should remain 0
    assert.deepEqual(store.get('flight3d.cockpitUserOffset.C172'), JSON.stringify({ x: 0, y: 0, z: 0 }));
  } finally {
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  }
});

test('LobbyCameraModal syncs with CameraSystem and controls', () => {
  const previousDocument = globalThis.document;
  const previousLocalStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
  };

  const elements = new Map();
  function createMockElement(id) {
    const listeners = {};
    const el = {
      id,
      hidden: true,
      value: '0',
      textContent: '',
      attributes: {},
      setAttribute: (k, v) => { el.attributes[k] = v; },
      getAttribute: (k) => el.attributes[k] ?? null,
      removeAttribute: (k) => { delete el.attributes[k]; },
      addEventListener: (evt, fn) => {
        listeners[evt] = listeners[evt] || [];
        listeners[evt].push(fn);
      },
      dispatchEvent: (evt) => {
        (listeners[evt.type] || []).forEach(fn => fn(evt));
      },
      querySelectorAll: () => [],
      showModal: () => { el.open = true; },
      close: () => { el.open = false; },
      open: false,
    };
    elements.set(id, el);
    return el;
  }

  const ids = [
    'lobby-camera-modal', 'btn-lobby-camera', 'lobby-camera-btn-label',
    'lobby-camera-title', 'lobby-camera-start-mode', 'btn-lobby-camera-close',
    'btn-lobby-camera-done', 'btn-lobby-camera-reset',
    'lobby-pov-y', 'lobby-pov-y-val', 'lobby-pov-z', 'lobby-pov-z-val',
    'lobby-pov-x', 'lobby-pov-x-val',
  ];
  for (const id of ids) createMockElement(id);

  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
  };

  try {
    const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
    cam.aircraftConfig = { id: 'C172' };

    const sim = {
      cameraSystem: cam,
      lobby: { aircraft: 'C172' },
      currentAircraftId: 'C172',
    };

    const modal = new LobbyCameraModal(sim);

    // Initial label check
    assert.match(elements.get('lobby-camera-btn-label').textContent, /조종석|Cockpit/);

    // Open modal
    modal.open();
    assert.equal(elements.get('lobby-camera-modal').open, true);
    assert.equal(elements.get('lobby-camera-title').textContent, '카메라 설정 · C172');
    assert.equal(cam.mode, CameraSystem.MODES.COCKPIT);

    // Slider adjustment (simulate user changing slider Y)
    const sliderY = elements.get('lobby-pov-y');
    sliderY.value = '0.05';
    sliderY.dispatchEvent({ type: 'input' });

    assert.equal(cam.cockpitUserOffset.y, 0.05);
    assert.match(elements.get('lobby-pov-y-val').textContent, /\+5 cm/);

    // Reset to defaults
    elements.get('btn-lobby-camera-reset').dispatchEvent({ type: 'click' });
    assert.equal(cam.cockpitUserOffset.y, 0);
    assert.equal(elements.get('lobby-pov-y-val').textContent, '0 cm');

    // Change start mode to Chase (1)
    const startModeSelect = elements.get('lobby-camera-start-mode');
    startModeSelect.value = '1';
    startModeSelect.dispatchEvent({ type: 'change' });

    assert.equal(cam.getPreferredStartMode(), CameraSystem.MODES.CHASE);
    assert.match(elements.get('lobby-camera-btn-label').textContent, /추적|Chase/);

    // Close modal
    modal.close();
    assert.equal(elements.get('lobby-camera-modal').open, false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  }
});
