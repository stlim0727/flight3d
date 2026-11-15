import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { BOEING_737_800, F16_FALCON } from '../src/config/aircraftConfigs.js';
import { CockpitPovPanel } from '../src/ui/CockpitPovPanel.js';

test('Boeing 737-800 default cockpit viewpoint raises eye height above dashboard', () => {
  const cockpit = BOEING_737_800.cockpit;
  assert.equal(cockpit.captainEyePos.y, 0.88, 'B738 captain eye Y is raised to 0.88m to reduce dashboard dominance');
  assert.equal(cockpit.portraitEyeY, 0.88, 'Portrait eye Y matches landscape raised height');
  assert.equal(cockpit.defaultLookPitchRad, -0.08, 'Default look pitch is balanced forward looking at runway/instruments');
});

test('F-16 default cockpit viewpoint brings eye closer to HUD', () => {
  const cockpit = F16_FALCON.cockpit;
  assert.equal(cockpit.captainEyePos.z, -3.60, 'F16 captain eye Z is moved closer to the HUD combiner glass');
  assert.equal(cockpit.captainEyePos.x, 0.0, 'F16 eye is centered laterally');
  assert.equal(cockpit.captainEyePos.y, 0.94, 'F16 eye is level with HUD optical center');
});

test('CameraSystem user cockpit POV offset (X, Y, Z) applies only to cockpit view', () => {
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 1000);
  const domElement = { addEventListener() {}, removeEventListener() {} };
  const cameraSystem = new CameraSystem(camera, domElement);
  cameraSystem.loadAircraftConfig(BOEING_737_800);

  // Default: zero offset
  assert.equal(cameraSystem.isCockpitUserOffsetModified(), false);
  const initialOffset = cameraSystem.getCockpitUserOffset();
  assert.deepEqual({ x: initialOffset.x, y: initialOffset.y, z: initialOffset.z }, { x: 0, y: 0, z: 0 });

  // Set custom user offset (raised Y, closer Z, slight right X)
  cameraSystem.setCockpitUserOffset(0.03, 0.06, -0.05);
  assert.equal(cameraSystem.isCockpitUserOffsetModified(), true);
  const updatedOffset = cameraSystem.getCockpitUserOffset();
  assert.equal(updatedOffset.x, 0.03);
  assert.equal(updatedOffset.y, 0.06);
  assert.equal(updatedOffset.z, -0.05);

  // Dummy aircraft mesh at world origin
  const aircraftMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  aircraftMesh.position.set(0, 100, 0);
  aircraftMesh.quaternion.identity();
  aircraftMesh.updateMatrixWorld(true);

  // In Cockpit view: eye position includes cockpitUserOffset
  cameraSystem.setMode(CameraSystem.MODES.COCKPIT, true);
  cameraSystem.update(1 / 60, aircraftMesh, {
    airspeedMs: 50,
    altitudeM: 100,
    verticalSpeedMs: 0,
    accelNormalG: 1.0,
    accelLateralG: 0,
    accelLongitudinalG: 0,
  });

  // Expected eye position = cockpitHeadOffset + cockpitUserOffset + aircraftMesh.position
  const expectedCockpitEyeY = 100 + BOEING_737_800.cockpit.captainEyePos.y + 0.06;
  const expectedCockpitEyeZ = BOEING_737_800.cockpit.captainEyePos.z - 0.05;
  assert.ok(
    Math.abs(camera.position.y - expectedCockpitEyeY) < 0.02,
    `Cockpit camera Y (${camera.position.y}) should reflect user offset (${expectedCockpitEyeY})`
  );
  assert.ok(
    Math.abs(camera.position.z - expectedCockpitEyeZ) < 0.02,
    `Cockpit camera Z (${camera.position.z}) should reflect user offset (${expectedCockpitEyeZ})`
  );

  // In HUD mode: position should NOT be altered by cockpitUserOffset
  cameraSystem.setMode(CameraSystem.MODES.HUD, true);
  cameraSystem.updateHudView(aircraftMesh);
  const hudExpectedY = 100 + BOEING_737_800.cockpit.captainEyePos.y;
  assert.ok(
    Math.abs(camera.position.y - hudExpectedY) < 0.001,
    `HUD view should not include cockpit user offset`
  );

  // Reset offset
  cameraSystem.resetCockpitUserOffset();
  assert.equal(cameraSystem.isCockpitUserOffsetModified(), false);
  const resetOffset = cameraSystem.getCockpitUserOffset();
  assert.deepEqual({ x: resetOffset.x, y: resetOffset.y, z: resetOffset.z }, { x: 0, y: 0, z: 0 });
});

test('CameraSystem persists user cockpit offset to localStorage per aircraft', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
  };

  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 1000);
  const domElement = { addEventListener() {}, removeEventListener() {} };
  const cameraSystem = new CameraSystem(camera, domElement);

  // B738 adjustment
  cameraSystem.loadAircraftConfig(BOEING_737_800);
  cameraSystem.setCockpitUserOffset(0.01, 0.05, -0.02);
  assert.ok(store.has('flight3d.cockpitUserOffset.B738'));

  // Switch to F-16: should start clean or load F-16 specific offset
  cameraSystem.loadAircraftConfig(F16_FALCON);
  assert.equal(cameraSystem.getCockpitUserOffset().y, 0);

  // Set F-16 specific offset
  cameraSystem.setCockpitUserOffset(0.0, 0.02, -0.08);
  assert.ok(store.has('flight3d.cockpitUserOffset.F16'));

  // Switch back to B738: restores B738 offset
  cameraSystem.loadAircraftConfig(BOEING_737_800);
  const restoredB738 = cameraSystem.getCockpitUserOffset();
  assert.equal(restoredB738.y, 0.05);
  assert.equal(restoredB738.z, -0.02);
});

test('CockpitPovPanel handles UI controls, step increments, reset, and mode visibility', () => {
  // Mock DOM
  const elements = new Map();
  function createElement(id, tag = 'div') {
    const el = {
      id,
      tagName: tag.toUpperCase(),
      hidden: true,
      value: '0',
      textContent: '',
      step: '0.005',
      min: '-0.2',
      max: '0.3',
      dataset: {},
      attributes: new Map(),
      listeners: new Map(),
      addEventListener(event, fn) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(fn);
      },
      dispatchEvent(event) {
        for (const fn of this.listeners.get(event.type) || []) fn(event);
      },
      setAttribute(k, v) { this.attributes.set(k, String(v)); },
      getAttribute(k) { return this.attributes.get(k); },
      querySelectorAll() { return []; },
    };
    elements.set(id, el);
    return el;
  }

  const panel = createElement('cockpit-pov-panel');
  const toggleBtn = createElement('btn-cockpit-pov');
  const moreToggleBtn = createElement('btn-open-cockpit-pov');
  const closeBtn = createElement('btn-cockpit-pov-close');
  const resetBtn = createElement('btn-cockpit-pov-reset');
  const sliderY = createElement('cockpit-pov-y', 'input');
  const outputY = createElement('cockpit-pov-y-val', 'output');
  const sliderZ = createElement('cockpit-pov-z', 'input');
  const outputZ = createElement('cockpit-pov-z-val', 'output');
  const sliderX = createElement('cockpit-pov-x', 'input');
  const outputX = createElement('cockpit-pov-x-val', 'output');

  panel.querySelectorAll = (sel) => {
    if (sel === '.cockpit-pov-step') return [];
    return [];
  };

  const originalDoc = globalThis.document;
  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
    addEventListener() {},
  };

  try {
    const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 1000);
    const cameraSystem = new CameraSystem(camera, { addEventListener() {}, removeEventListener() {} });
    cameraSystem.loadAircraftConfig(BOEING_737_800);
    cameraSystem.setMode(CameraSystem.MODES.COCKPIT, true);

    const povPanel = new CockpitPovPanel({ cameraSystem });

    // Open panel in cockpit mode
    povPanel.open();
    assert.equal(panel.hidden, false);
    assert.equal(toggleBtn.getAttribute('aria-expanded'), 'true');

    // Simulate slider change
    sliderY.value = '0.05';
    sliderY.dispatchEvent({ type: 'input' });
    assert.equal(cameraSystem.getCockpitUserOffset().y, 0.05);

    // Close panel
    povPanel.close();
    assert.equal(panel.hidden, true);
    assert.equal(toggleBtn.getAttribute('aria-expanded'), 'false');

    // Reset button
    sliderY.value = '0.08';
    resetBtn.dispatchEvent({ type: 'click' });
    assert.equal(cameraSystem.getCockpitUserOffset().y, 0);
    assert.equal(sliderY.value, '0');

    // Outside cockpit mode: updateMode closes panel and hides toggle buttons
    povPanel.open();
    assert.equal(panel.hidden, false);
    povPanel.updateMode(CameraSystem.MODES.CHASE);
    assert.equal(panel.hidden, true, 'Panel must close when leaving cockpit mode');
    assert.equal(toggleBtn.hidden, true, 'Toggle button must be hidden in exterior views');
    assert.equal(moreToggleBtn.hidden, true, 'More toggle button must be hidden in exterior views');

    // Cannot open when mode is not cockpit
    cameraSystem.mode = CameraSystem.MODES.CHASE;
    povPanel.open();
    assert.equal(panel.hidden, true, 'Panel must not open in exterior camera modes');
  } finally {
    globalThis.document = originalDoc;
  }
});

test('updateControlState restricts cockpit POV adjustment controls to cockpit mode only', async () => {
  const { updateControlState } = await import('../src/ui/FlightPanels.js');
  const mockElements = new Map();
  const createMock = (id) => {
    const el = { id, hidden: true, attributes: new Map(), setAttribute(k, v) { this.attributes.set(k, v); } };
    mockElements.set(id, el);
    return el;
  };

  const povPill = createMock('btn-cockpit-pov');
  const povMore = createMock('btn-open-cockpit-pov');
  const povPanel = createMock('cockpit-pov-panel');

  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById: (id) => mockElements.get(id) || null,
    body: { classList: { contains: () => false } }
  };

  try {
    const camera = { mode: 0, autoSwitch: false };
    const telemetry = { flapIndex: 0, flapDegree: 0, gearState: 1, spoilers: 0 };

    // In cockpit mode (mode 0): buttons are visible
    updateControlState(telemetry, camera);
    assert.equal(povPill.hidden, false, 'btn-cockpit-pov should be visible in cockpit mode');
    assert.equal(povMore.hidden, false, 'btn-open-cockpit-pov should be visible in cockpit mode');

    // Switch to exterior mode (e.g. chase mode 1)
    camera.mode = 1;
    povPanel.hidden = false; // pretend panel was open
    updateControlState(telemetry, camera);
    assert.equal(povPill.hidden, true, 'btn-cockpit-pov should be hidden in exterior mode');
    assert.equal(povMore.hidden, true, 'btn-open-cockpit-pov should be hidden in exterior mode');
    assert.equal(povPanel.hidden, true, 'cockpit-pov-panel should be closed in exterior mode');
  } finally {
    globalThis.document = prevDoc;
  }
});
