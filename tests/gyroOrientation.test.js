import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenTilt, readGyroScreen, angleDelta } from '../src/controls/gyroOrientation.js';
import { TouchFlightControls, shapeTouchStick } from '../src/controls/TouchFlightControls.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('screen axes preserve pitch and roll signs in both portrait and landscape directions', () => {
  for (const [angle, pitchBeta, pitchGamma, rollBeta, rollGamma] of [
    [0, 25, 0, 0, 30], [90, 0, -25, 30, 0],
    [180, -25, 0, 0, -30], [270, 0, 25, -30, 0],
  ]) {
    const pitch = screenTilt(pitchBeta, pitchGamma, angle);
    near(pitch.pitch, 25);
    near(pitch.roll, 0);
    const roll = screenTilt(rollBeta, rollGamma, angle);
    near(roll.pitch, 0);
    near(roll.roll, 30);
  }
});

test('equivalent Euler representations stay continuous and pitch wraps the short way', () => {
  const a = screenTilt(30, 90, 90);
  const b = screenTilt(150, -90, 90);
  near(a.pitch, b.pitch);
  near(a.roll, b.roll);
  near(angleDelta(-179, 179), 2);
  near(angleDelta(179, -179), -2);
});

test('screen orientation supports legacy angles and natural-landscape tablets', () => {
  assert.deepEqual(readGyroScreen({ orientation: -90, innerWidth: 800, innerHeight: 400 }), { angle: 270, type: 'landscape' });
  assert.deepEqual(readGyroScreen({ screen: { orientation: { angle: 0, type: 'landscape-primary' } } }), { angle: 0, type: 'landscape' });
});

function harness(t) {
  const original = globalThis.window;
  const orientation = { angle: 0, type: 'portrait-primary', unlock() {} };
  globalThis.window = { screen: { orientation } };
  t.after(() => { globalThis.window = original; });
  const c = Object.create(TouchFlightControls.prototype);
  const inputs = [];
  Object.assign(c, {
    gyroActive: true, gyroPending: false, gyroOrientation: 'auto', gyroLockAttempt: 0,
    gyroReadyAt: 0, gyroCalibration: null,
    gyroScreen: { angle: 0, type: 'portrait' },
    controls: { setTouchStick: (...axes) => inputs.push(axes) },
    updateStickTelemetry() {},
    setGyroOrientationStatus(key) { this.status = key; },
  });
  const sample = (beta, gamma) => c.handleOrientation({ beta, gamma });
  return { c, inputs, orientation, sample };
}

test('enable, turn, rotate, settle and re-center keep calibration transitions neutral', t => {
  const { c, inputs, orientation, sample } = harness(t);
  sample(38, 0);
  assert.deepEqual(inputs.at(-1), [0, 0]);
  sample(48, 0);
  near(inputs.at(-1)[0], shapeTouchStick(0.4, 0)[0]);
  orientation.angle = 90;
  orientation.type = 'landscape-primary';
  sample(0, -38);
  assert.deepEqual(inputs.at(-1), [0, 0]);
  sample(10, 50); // Transitional sensor sample is ignored.
  assert.deepEqual(inputs.at(-1), [0, 0]);
  c.gyroReadyAt = 0;
  sample(0, -38);
  assert.deepEqual(inputs.at(-1), [0, 0]);
  sample(0, -48);
  near(inputs.at(-1)[0], shapeTouchStick(0.4, 0)[0]);
  c.recenterGyro();
  assert.deepEqual(inputs.at(-1), [0, 0]);
  c.gyroReadyAt = 0;
  sample(0, -48);
  assert.deepEqual(inputs.at(-1), [0, 0]);
});

test('fixed orientation holds neutral until screen matches, including unsupported locks', async t => {
  const { c, inputs, orientation, sample } = harness(t);
  await c.setGyroOrientation('landscape');
  assert.equal(c.status, 'gyro.orientation.lock.unavailable');
  sample(80, 70);
  assert.deepEqual(inputs.at(-1), [0, 0]);
  assert.equal(c.status, 'gyro.orientation.rotate.landscape');
  orientation.angle = 270;
  orientation.type = 'landscape-secondary';
  sample(0, 38);
  c.gyroReadyAt = 0;
  sample(0, 38);
  assert.deepEqual(inputs.at(-1), [0, 0]);
  assert.equal(c.status, 'gyro.orientation.lock.unavailable');
  sample(0, 48);
  near(inputs.at(-1)[0], shapeTouchStick(0.4, 0)[0]);
});

test('orientation locks are serialized and released on disabling or follow-screen selection', async t => {
  const { c, orientation } = harness(t);
  let finish;
  let unlocked = 0;
  const modes = [];
  orientation.unlock = () => ++unlocked;
  orientation.lock = mode => {
    modes.push(mode);
    return modes.length === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve();
  };
  const portrait = c.setGyroOrientation('portrait');
  await Promise.resolve();
  const landscape = c.setGyroOrientation('landscape');
  finish();
  await Promise.all([portrait, landscape]);
  assert.deepEqual(modes, ['portrait', 'landscape']);
  assert.equal(c.gyroOwnsLock, true);
  await c.setGyroOrientation('auto');
  assert.equal(c.gyroOwnsLock, false);
  assert.equal(unlocked, 2);
  const pending = c.setGyroOrientation('portrait');
  c.gyroActive = false;
  c.releaseGyroLock();
  await pending;
  assert.equal(modes.length, 2); // Cancelled before invoking the browser API.
});

test('a lock completing after gyro turns off is released', async t => {
  const { c, orientation } = harness(t);
  let finish;
  let unlocked = 0;
  orientation.lock = () => new Promise(resolve => { finish = resolve; });
  orientation.unlock = () => ++unlocked;
  const pending = c.setGyroOrientation('portrait');
  await Promise.resolve();
  c.gyroActive = false;
  c.releaseGyroLock();
  finish();
  await pending;
  assert.equal(unlocked, 1);
  assert.equal(c.gyroOwnsLock, false);
});

test('the menu orientation selector and re-center button invoke gyro actions', t => {
  const { c } = harness(t);
  const original = globalThis.document;
  const select = { value: 'landscape', addEventListener(_, fn) { this.change = fn; } };
  const button = { addEventListener(_, fn) { this.click = fn; } };
  const status = {};
  const settings = {
    querySelectorAll: () => [],
    querySelector: key => key === 'select' ? select : key === '.gyro-recenter' ? button : status,
  };
  globalThis.document = { createElement: () => settings };
  t.after(() => { globalThis.document = original; });
  let inserted;
  c.gyroBtn = { after(node) { inserted = node; } };
  let mode;
  let centered = false;
  c.setGyroOrientation = value => { mode = value; };
  c.recenterGyro = () => { centered = true; };
  c.initGyroSettings();
  assert.equal(inserted, settings);
  assert.equal(settings.hidden, true);
  select.change();
  assert.equal(mode, 'landscape');
  button.click();
  assert.equal(centered, true);
});


test('gyro sweep matches thumb-stick precision without early saturation', t => {
  const { sample, inputs } = harness(t);
  sample(0, 0);
  let previous = 0;
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    sample(x * 25, 0);
    const output = inputs.at(-1)[0];
    near(output, shapeTouchStick(x, 0)[0]);
    assert.ok(output >= previous - 1e-12);
    if (x < 1) assert.ok(output < 1);
    previous = output;
  }
  sample(2.5, 0);
  assert.ok(inputs.at(-1)[0] < .02, '10% device tilt must retain central precision');
  sample(0, 0);
  assert.deepEqual(inputs.at(-1), [0, 0]);
});
