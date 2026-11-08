import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TouchFlightControls, isGyroSupportedDevice } from '../src/controls/TouchFlightControls.js';
import { SIMULATOR_PREFERENCES_KEY, loadSimulatorPreferences, saveSimulatorPreferences, restoreSimulatorPreferences } from '../src/config/simulatorPreferences.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('preferences validate saved values and tolerate invalid or unavailable storage', () => {
  const s = storage();
  for (const orientation of ['auto', 'portrait', 'landscape']) {
    saveSimulatorPreferences({ gyroEnabled: true, gyroOrientation: orientation, calibration: { pitch: 42 } }, s);
    assert.deepEqual(loadSimulatorPreferences(s), { gyroEnabled: true, gyroOrientation: orientation });
    assert.deepEqual(JSON.parse(s.getItem(SIMULATOR_PREFERENCES_KEY)), { gyroEnabled: true, gyroOrientation: orientation });
  }
  for (const value of ['broken', 'null', 'true', '[]', '{"gyroEnabled":"true","gyroOrientation":"invalid"}']) {
    s.setItem(SIMULATOR_PREFERENCES_KEY, value);
    assert.deepEqual(loadSimulatorPreferences(s), {});
  }
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
  assert.deepEqual(loadSimulatorPreferences(blocked), {});
  assert.doesNotThrow(() => saveSimulatorPreferences({ gyroEnabled: true, gyroOrientation: 'portrait' }, blocked));
});

class GyroControls extends TouchFlightControls {
  initDOM() {
    const classes = new Set();
    this.gyroBtn = {
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        toggle: (c, v) => (v ? classes.add(c) : classes.delete(c)),
        contains: c => classes.has(c),
      },
      setAttribute: (k, v) => { this.gyroBtn[k] = String(v); },
      getAttribute: k => this.gyroBtn[k] ?? null,
    };
  }
  bindEvents() {}
  initGyroSettings() {
    this.gyroSettings = { hidden: true };
    this.gyroOrientationSelect = { value: this.gyroOrientation };
  }
  enable() { this.enabled = true; }
  updateStickTelemetry() {}
  triggerHaptic() {}
  setGyroOrientationStatus(key) { this.status = key; }
  showGyroHelp(reason) { this.help = reason; }
}

function environment(t, saved, requestPermission) {
  const oldWindow = globalThis.window;
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const s = storage();
  if (saved) saveSimulatorPreferences(saved, s);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: s });
  let timeout;
  const locks = [];
  globalThis.window = {
    ontouchstart: null, isSecureContext: true,
    DeviceOrientationEvent: requestPermission ? { requestPermission } : class {},
    screen: { orientation: {
      angle: 0, type: 'portrait-primary', lock: async mode => { locks.push(mode); },
      unlock() {}, addEventListener() {}, removeEventListener() {},
    } },
    addEventListener() {}, removeEventListener() {},
    setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() { timeout = null; },
  };
  t.after(() => {
    globalThis.window = oldWindow;
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else delete globalThis.localStorage;
  });
  return { s, locks, create: () => {
    const controls = new GyroControls({ setTouchStick() {} });
    restoreSimulatorPreferences({ touchControls: controls, lobby: {} }, loadSimulatorPreferences());
    return controls;
  }, expire: () => timeout?.() };
}

test('enable and orientation survive reload; explicit off survives the next reload', async t => {
  const { create, s, locks } = environment(t);
  const first = create();
  assert.equal(first.gyroActive, false);
  await first.toggleGyro();
  await first.setGyroOrientation('landscape');
  first.gyroCalibration = { pitch: 75, roll: 45 };
  const reloaded = create();
  await reloaded.gyroLockQueue;
  assert.equal(reloaded.gyroActive, true);
  assert.equal(reloaded.gyroOrientation, 'landscape');
  assert.equal(reloaded.gyroOrientationSelect.value, 'landscape');
  assert.equal(reloaded.gyroSettings.hidden, false);
  assert.equal(reloaded.gyroBtn.classList.contains('active'), true);
  assert.equal(reloaded.gyroBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(reloaded.gyroCalibration, null);
  assert.deepEqual(locks, ['landscape', 'landscape']);
  await reloaded.toggleGyro();
  assert.deepEqual(loadSimulatorPreferences(s), { gyroEnabled: false, gyroOrientation: 'landscape', touchControls: true });
  const off = create();
  assert.equal(off.gyroActive, false);
  assert.equal(off.gyroOrientationSelect.value, 'landscape');
  assert.equal(off.gyroBtn.classList.contains('active'), false);
  assert.equal(off.gyroBtn.getAttribute('aria-pressed'), 'false');
});

test('gesture-only browsers restore settings without prompting and resume on tap', async t => {
  let prompts = 0;
  const { create } = environment(t, { gyroEnabled: true, gyroOrientation: 'portrait' }, async () => { ++prompts; return 'granted'; });
  const reloaded = create();
  assert.equal(prompts, 0);
  assert.equal(reloaded.label, 'gyro.resume');
  assert.equal(reloaded.gyroActive, false);
  assert.equal(reloaded.gyroSettings.hidden, false);
  assert.equal(reloaded.gyroOrientationSelect.value, 'portrait');
  await reloaded.toggleGyro();
  assert.equal(prompts, 1);
  assert.equal(reloaded.gyroActive, true);
});

test('a blocked sensor on reload preserves preference and offers inline retry without a modal', async t => {
  const { create, expire, s } = environment(t, { gyroEnabled: true, gyroOrientation: 'auto' });
  const reloaded = create();
  expire();
  assert.equal(reloaded.gyroActive, false);
  assert.equal(reloaded.help, undefined);
  assert.equal(reloaded.label, 'gyro.resume');
  assert.equal(reloaded.status, 'gyro.no.readings');
  assert.deepEqual(loadSimulatorPreferences(s), { gyroEnabled: true, gyroOrientation: 'auto', touchControls: true });
  await reloaded.toggleGyro();
  expire(); // Explicit retries still show the existing recovery dialog.
  assert.equal(reloaded.help, 'gyro.no.readings');
});

test('blocked localStorage getters do not prevent controls from starting', t => {
  const { create } = environment(t);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('disabled'); } });
  assert.doesNotThrow(create);
});

test('gyro restoration enables its input path and preserves unrelated saved preferences', async t => {
  const { create, s } = environment(t, { gyroEnabled: true, gyroOrientation: 'landscape', touchControls: false, audioMuted: true });
  // Keep this minimal simulator independent of audio; the app restores audio separately.
  const controls = new GyroControls({ setTouchStick() {} });
  restoreSimulatorPreferences({ touchControls: controls, lobby: {}, audio: { setMuted() {} } }, loadSimulatorPreferences());
  await controls.gyroLockQueue;
  assert.equal(controls.enabled, true);
  assert.equal(controls.gyroActive, true);
  saveSimulatorPreferences({ timeOfDay: 22 }, s);
  assert.deepEqual(loadSimulatorPreferences(s), {
    gyroEnabled: true, gyroOrientation: 'landscape', touchControls: true, audioMuted: true, timeOfDay: 22,
  });
});

test('gyro can be toggled and remembered even when aircraft controls are disabled (e.g. lobby or menu)', async t => {
  const { create, s } = environment(t);
  const controls = create();
  controls.controls.aircraftControlsDisabled = true;
  assert.equal(controls.gyroActive, false);
  await controls.toggleGyro();
  assert.equal(controls.gyroActive, true);
  assert.equal(loadSimulatorPreferences(s).gyroEnabled, true);
  await controls.toggleGyro();
  assert.equal(controls.gyroActive, false);
  assert.equal(loadSimulatorPreferences(s).gyroEnabled, false);
});

test('flight startup restores gyro if requested, even if startup timed out during lobby', async t => {
  const { create, expire, s } = environment(t, { gyroEnabled: true, gyroOrientation: 'auto' });
  const controls = create();
  assert.equal(controls.gyroActive, true);
  expire(); // Timed out during lobby
  assert.equal(controls.gyroActive, false);
  assert.equal(controls.gyroRequested, true);
  // Entering flight re-restores:
  controls.restoreGyroSettings();
  assert.equal(controls.gyroActive, true);
  // Re-restoring when already active is a no-op
  controls.gyroPending = false;
  controls.restoreGyroSettings();
  assert.equal(controls.gyroActive, true);
  assert.equal(controls.gyroPending, false);
});

test('flight startup with user gesture requests permission and activates gyro on gesture platforms', async t => {
  let prompts = 0;
  const { create } = environment(t, { gyroEnabled: true, gyroOrientation: 'portrait' }, async () => { ++prompts; return 'granted'; });
  const reloaded = create();
  assert.equal(prompts, 0);
  assert.equal(reloaded.label, 'gyro.resume');
  assert.equal(reloaded.gyroBtn.classList.contains('active'), true);
  // Flight startup with userGesture: true
  await reloaded.restoreGyroSettings({ userGesture: true });
  assert.equal(prompts, 1);
  assert.equal(reloaded.gyroActive, true);
  assert.equal(reloaded.label, 'gyro.checking');
});

test('toggling gyro off persists preference even before motion readings stream', async t => {
  const { create, s } = environment(t, { gyroEnabled: true, gyroOrientation: 'auto' });
  const controls = create();
  assert.equal(controls.gyroRequested, true);
  controls.label = 'gyro.on';
  controls.gyroActive = false;
  controls.gyroPending = false;
  await controls.toggleGyro();
  assert.equal(controls.gyroRequested, false);
  assert.equal(loadSimulatorPreferences(s).gyroEnabled, false);
});

test('isGyroSupportedDevice correctly detects mobile gyro devices vs desktop/insecure contexts', () => {
  const mockOrientation = class {};
  // 1. Android phone with touch and secure context
  assert.equal(isGyroSupportedDevice(
    { DeviceOrientationEvent: mockOrientation, isSecureContext: true, ontouchstart: null },
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)', maxTouchPoints: 5 }
  ), true);

  // 2. iPhone with touch and secure context
  assert.equal(isGyroSupportedDevice(
    { DeviceOrientationEvent: mockOrientation, isSecureContext: true, ontouchstart: null },
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 }
  ), true);

  // 3. iPad reporting Macintosh with touch points
  assert.equal(isGyroSupportedDevice(
    { DeviceOrientationEvent: mockOrientation, isSecureContext: true, ontouchstart: null },
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }
  ), true);

  // 4. Desktop Chrome on Linux/Windows/Mac (no mobile UA, no touch)
  assert.equal(isGyroSupportedDevice(
    { DeviceOrientationEvent: mockOrientation, isSecureContext: true },
    { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0', maxTouchPoints: 0 }
  ), false);

  // 5. Insecure context (HTTP)
  assert.equal(isGyroSupportedDevice(
    { DeviceOrientationEvent: mockOrientation, isSecureContext: false, ontouchstart: null },
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)', maxTouchPoints: 5 }
  ), false);

  // 6. Device without DeviceOrientationEvent
  assert.equal(isGyroSupportedDevice(
    { isSecureContext: true, ontouchstart: null },
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)', maxTouchPoints: 5 }
  ), false);
});

test('gyro-supported mobile device enables tilt by default on first visit without saved preference', async t => {
  const oldWindow = globalThis.window;
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const s = storage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: s });
  let timeout;
  globalThis.window = {
    ontouchstart: null, isSecureContext: true,
    DeviceOrientationEvent: class {},
    screen: { orientation: { angle: 0, type: 'portrait-primary', unlock() {}, addEventListener() {}, removeEventListener() {} } },
    addEventListener() {}, removeEventListener() {},
    setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() { timeout = null; },
  };
  t.after(() => {
    globalThis.window = oldWindow;
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else delete globalThis.localStorage;
  });

  // Create on mobile device (using gyroDefault: true to simulate mobile gyro detection)
  const controls = new GyroControls({ setTouchStick() {} }, { gyroDefault: true });
  assert.equal(controls.gyroRequested, true, 'Gyro should be requested by default on mobile');
  assert.equal(controls.label, 'gyro.on');

  // restoreSimulatorPreferences restores gyro because gyroRequested is true
  restoreSimulatorPreferences({ touchControls: controls, lobby: {} }, loadSimulatorPreferences(s));
  assert.equal(controls.gyroActive, true, 'Gyro should be active after preference restoration');

  // Explicitly turning it off saves gyroEnabled: false
  await controls.toggleGyro();
  assert.equal(controls.gyroActive, false);
  assert.equal(controls.gyroRequested, false);
  assert.equal(loadSimulatorPreferences(s).gyroEnabled, false);

  // Reload honors the explicit off choice even on mobile gyro device
  const reloaded = new GyroControls({ setTouchStick() {} }, { gyroDefault: true });
  assert.equal(reloaded.gyroRequested, false, 'Saved gyroEnabled: false must override mobile default');
  restoreSimulatorPreferences({ touchControls: reloaded, lobby: {} }, loadSimulatorPreferences(s));
  assert.equal(reloaded.gyroActive, false);
});
