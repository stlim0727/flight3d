import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { LobbyCameraModal } from '../src/ui/LobbyCameraModal.js';
import { SimulatorClass } from './helpers/simulatorClass.js';

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
    // Default should be CHASE (1)
    assert.equal(cam.getPreferredStartMode(), CameraSystem.MODES.CHASE);

    // Save COCKPIT (0)
    let notifiedMode = null;
    cam.onPreferredStartModeChange = (mode) => { notifiedMode = mode; };
    cam.setPreferredStartMode(CameraSystem.MODES.COCKPIT);

    assert.equal(store.get('flight3d.startCameraMode'), '0');
    assert.equal(cam.getPreferredStartMode(), CameraSystem.MODES.COCKPIT);
    assert.equal(notifiedMode, CameraSystem.MODES.COCKPIT);

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
    'lobby-camera-preview-canvas',
  ];
  for (const id of ids) createMockElement(id);

  const previewCanvas = elements.get('lobby-camera-preview-canvas');
  previewCanvas.width = 380;
  previewCanvas.height = 150;
  let drawnArgs = null;
  previewCanvas.getContext = () => ({
    drawImage: (...args) => { drawnArgs = args; },
  });

  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
  };

  try {
    const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
    cam.aircraftConfig = { id: 'C172' };
    cam.userModeSelected = false;

    let inFlightOffsetNotified = null;
    cam.onCockpitUserOffsetChange = (offset) => {
      inFlightOffsetNotified = offset;
    };

    let setAircraftCalledWith = null;
    const sim = {
      cameraSystem: cam,
      lobby: { aircraft: 'F16' },
      currentAircraftId: 'B738',
      setAircraft: (id) => {
        setAircraftCalledWith = id;
        sim.currentAircraftId = id;
        cam.aircraftConfig = { id };
      },
    };

    const modal = new LobbyCameraModal(sim);

    // Initial label check
    assert.match(elements.get('lobby-camera-btn-label').textContent, /추적|Chase/);

    // Open modal: should sync to chosen lobby aircraft (F16)
    modal.open();
    assert.equal(setAircraftCalledWith, 'F16');
    assert.equal(elements.get('lobby-camera-modal').open, true);
    assert.equal(elements.get('lobby-camera-title').textContent, '카메라 설정 · F-16');
    assert.equal(cam.mode, CameraSystem.MODES.COCKPIT);

    // Verify renderPreview calls drawImage on canvas
    modal.renderPreview({ width: 1920, height: 1080 });
    assert.ok(drawnArgs !== null);

    // Slider adjustment (simulate user changing slider Y)
    const sliderY = elements.get('lobby-pov-y');
    sliderY.value = '0.05';
    sliderY.dispatchEvent({ type: 'input' });

    assert.equal(cam.cockpitUserOffset.y, 0.05);
    assert.match(elements.get('lobby-pov-y-val').textContent, /\+5 cm/);
    // Verify chained in-flight listener was preserved
    assert.ok(inFlightOffsetNotified !== null);

    // Reset to defaults
    elements.get('btn-lobby-camera-reset').dispatchEvent({ type: 'click' });
    assert.equal(cam.cockpitUserOffset.y, 0);
    assert.equal(elements.get('lobby-pov-y-val').textContent, '0 cm');

    // Change start mode to Cockpit (0)
    const startModeSelect = elements.get('lobby-camera-start-mode');
    startModeSelect.value = '0';
    startModeSelect.dispatchEvent({ type: 'change' });

    assert.equal(cam.getPreferredStartMode(), CameraSystem.MODES.COCKPIT);
    assert.match(elements.get('lobby-camera-btn-label').textContent, /조종석|Cockpit/);

    // Close modal: userModeSelected must be restored to original false
    modal.close();
    assert.equal(elements.get('lobby-camera-modal').open, false);
    assert.equal(cam.userModeSelected, false);

    // Test with held sortie (canResumeFromLobby = true): must NOT switch aircraft
    setAircraftCalledWith = null;
    sim.currentAircraftId = 'B738';
    sim.lobby.aircraft = 'F16';
    sim.gameFlow = { canResumeFromLobby: () => true };

    modal.open();
    assert.equal(setAircraftCalledWith, null, 'setAircraft should not be called when sortie is held');
    assert.equal(modal.getAircraftId(), 'B738');
    modal.close();

    // Test manual camera mode selection (userModeSelected = true): must force COCKPIT preview and restore true
    delete sim.gameFlow;
    cam.setMode(CameraSystem.MODES.CHASE, true);
    assert.equal(cam.userModeSelected, true);

    const mockUpdater = () => {};
    cam.customViewUpdater = mockUpdater;

    modal.open();
    assert.equal(cam.mode, CameraSystem.MODES.COCKPIT);
    modal.close();
    assert.equal(cam.mode, CameraSystem.MODES.CHASE);
    assert.equal(cam.userModeSelected, true);
    assert.equal(cam.customViewUpdater, mockUpdater, 'customViewUpdater should be restored after preview close');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  }
});

test('preset spawn applies custom preferred start mode and sets userModeSelected', async () => {
  const previousLocalStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
  };

  try {
    const { createPilotMissionSimulation } = await import('./helpers/pilotMissionFlight.js');
    const sim = createPilotMissionSimulation({ aircraftId: 'C172' });
    const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
    cam.loadAircraftConfig(sim.currentAircraftConfig);
    sim.cameraSystem = cam;

    // Initially unconfigured (default CHASE)
    assert.equal(cam.hasCustomPreferredStartMode(), false);
    assert.equal(cam.getPreferredStartMode(), CameraSystem.MODES.CHASE);

    // User chooses COCKPIT (0) in lobby
    cam.setPreferredStartMode(CameraSystem.MODES.COCKPIT);
    assert.equal(cam.hasCustomPreferredStartMode(), true);
    assert.equal(cam.getPreferredStartMode(), CameraSystem.MODES.COCKPIT);

    // Prior view was CHASE (e.g. from demo)
    cam.setMode(CameraSystem.MODES.CHASE);
    cam.userModeSelected = false;

    // Spawning scenario inplay
    sim.setPreset('runway');

    assert.equal(cam.mode, CameraSystem.MODES.COCKPIT, 'should start in COCKPIT mode');
    assert.equal(cam.userModeSelected, true, 'custom mode should set userModeSelected to avoid automated overrides');
  } finally {
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  }
});

test('resumeFlight from lobby applies updated preferred camera mode and updates pauseView', async () => {
  const previousLocalStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
  };

  try {
    const cam = new CameraSystem(new THREE.PerspectiveCamera(), { addEventListener: () => {}, style: {} });
    cam.setMode(CameraSystem.MODES.CHASE, true);

    // Hold sortie in lobby (enters pauseView)
    assert.equal(cam.beginPauseView(), true);
    assert.equal(cam.mode, CameraSystem.MODES.DRONE);
    assert.ok(cam.pauseView);
    assert.equal(cam.pauseView.mode, CameraSystem.MODES.CHASE);

    let modalClosed = false;
    let enteredFlight = false;
    const sim = {
      airportLoading: false,
      startingFlight: false,
      isCrashed: false,
      cameraSystem: cam,
      lobbyCameraModal: { close: () => { modalClosed = true; } },
      gameFlow: {
        canResumeFromLobby: () => true,
        enterFlight: () => {
          enteredFlight = true;
          // In production, syncFlowUi calls cameraSystem.endPauseView()
          cam.endPauseView();
        },
      },
    };

    // Change preferred mode to COCKPIT while in held lobby
    cam.setPreferredStartMode(CameraSystem.MODES.COCKPIT);
    assert.equal(cam.pauseView.mode, CameraSystem.MODES.COCKPIT, 'pauseView mode should update with preferred start mode');

    SimulatorClass.prototype.resumeFlight.call(sim);

    assert.equal(modalClosed, true);
    assert.equal(enteredFlight, true);
    assert.equal(cam.pauseView, null, 'pauseView should be ended on resume');
    assert.equal(cam.mode, CameraSystem.MODES.COCKPIT, 'resumed flight should switch to preferred start mode');
    assert.equal(cam.userModeSelected, true);
  } finally {
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  }
});
