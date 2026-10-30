import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TouchFlightControls } from '../src/controls/TouchFlightControls.js';
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
  initDOM() {}
  bindEvents() {}
  initGyroSettings() {
    this.gyroSettings = { hidden: true };
    this.gyroOrientationSelect = { value: this.gyroOrientation };
  }
  enable() { this.enabled = true; }
  updateStickTelemetry() {}
  triggerHaptic() {}
  setGyroLabel(key) { this.label = key; }
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
  assert.equal(reloaded.gyroCalibration, null);
  assert.deepEqual(locks, ['landscape', 'landscape']);
  await reloaded.toggleGyro();
  assert.deepEqual(loadSimulatorPreferences(s), { gyroEnabled: false, gyroOrientation: 'landscape', touchControls: true });
  const off = create();
  assert.equal(off.gyroActive, false);
  assert.equal(off.gyroOrientationSelect.value, 'landscape');
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
