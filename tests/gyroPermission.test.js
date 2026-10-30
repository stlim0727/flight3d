import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TouchFlightControls } from '../src/controls/TouchFlightControls.js';
import { detectGyroBrowser } from '../src/controls/gyroBrowser.js';

function harness(t, orientation = class {}) {
  const listeners = new Set();
  let timeout;
  const original = globalThis.window;
  globalThis.window = {
    isSecureContext: true, DeviceOrientationEvent: orientation,
    addEventListener: (name, fn) => { if (name === 'deviceorientation') listeners.add(fn); },
    removeEventListener: (name, fn) => { if (name === 'deviceorientation') listeners.delete(fn); },
    setTimeout: fn => { timeout = fn; return 1; }, clearTimeout: () => { timeout = null; },
  };
  t.after(() => { globalThis.window = original; });
  const controller = Object.create(TouchFlightControls.prototype);
  const inputs = [], reasons = [];
  Object.assign(controller, {
    gyroAttempt: 0, gyroActive: false, gyroPending: false,
    gyroOrientation: 'auto', gyroLockAttempt: 0, gyroSettings: { hidden: true },
    controls: { setTouchStick: (...input) => inputs.push(input) },
    updateStickTelemetry() {}, triggerHaptic() {},
    setGyroLabel(key) { this.label = key; },
    showGyroHelp(reason) { reasons.push(reason); },
  });
  controller.handleOrientation = controller.handleOrientation.bind(controller);
  return { controller, inputs, reasons, listeners, expire: () => timeout?.() };
}

test('Android waits for finite readings, times out, retries and cleans up listeners', async t => {
  const { controller: c, reasons, listeners, expire, inputs } = harness(t);
  await c.toggleGyro();
  assert.equal(c.label, 'gyro.checking');
  assert.equal(c.gyroSettings.hidden, false);
  assert.equal(listeners.size, 1);
  c.handleOrientation({ beta: null, gamma: null });
  c.handleOrientation({ beta: NaN, gamma: Infinity });
  assert.ok(inputs.every(([pitch, roll]) => pitch === 0 && roll === 0));
  expire();
  assert.deepEqual(reasons, ['gyro.no.readings']);
  assert.equal(c.gyroActive, false);
  assert.equal(c.gyroSettings.hidden, true);
  assert.equal(listeners.size, 0);
  await c.toggleGyro();
  c.gyroReadyAt = 0;
  c.handleOrientation({ beta: 0, gamma: 0 }); // Capture neutral first.
  c.handleOrientation({ beta: 0, gamma: 15 });
  assert.equal(c.label, 'gyro.on');
  assert.ok(Math.abs(inputs.at(-1)[1] - 0.5) < 1e-12);
  expire();
  assert.equal(reasons.length, 1);
  await c.toggleGyro();
  assert.equal(listeners.size, 0);
  assert.deepEqual(inputs.at(-1), [0, 0]);
});

test('permission is requested during the click and failures provide recovery help', async t => {
  let requested = false;
  const { controller: c, reasons } = harness(t, {
    requestPermission() { requested = true; return Promise.resolve('denied'); },
  });
  const pending = c.toggleGyro();
  assert.equal(requested, true);
  await pending;
  assert.deepEqual(reasons, ['gyro.denied']);
  window.DeviceOrientationEvent.requestPermission = () => { throw new Error('blocked'); };
  await c.toggleGyro();
  assert.deepEqual(reasons, ['gyro.denied', 'gyro.error']);
  window.isSecureContext = false;
  await c.toggleGyro();
  assert.equal(reasons.at(-1), 'gyro.insecure');
  window.isSecureContext = true;
  window.DeviceOrientationEvent = undefined;
  await c.toggleGyro();
  assert.equal(reasons.at(-1), 'gyro.unsupported');
});

test('late permission cannot enable gyro after controls are disabled', async t => {
  let resolve;
  const { controller: c, listeners } = harness(t, { requestPermission: () => new Promise(r => { resolve = r; }) });
  const pending = c.toggleGyro();
  await c.toggleGyro(); // A second tap cannot create another request.
  c.disableGyro();
  resolve('granted');
  await pending;
  assert.equal(c.gyroActive, false);
  assert.equal(listeners.size, 0);
});

test('browser hints distinguish Brave, Chrome, iOS and unknown browsers', async () => {
  const android = { userAgent: 'Android Chrome/130.0' };
  assert.equal(await detectGyroBrowser(android), 'chrome');
  assert.equal(await detectGyroBrowser({ ...android, brave: { isBrave: async () => true } }), 'brave');
  assert.equal(await detectGyroBrowser({ ...android, brave: { isBrave: async () => { throw Error(); } } }), 'chrome');
  assert.equal(await detectGyroBrowser({ userAgent: 'iPhone Safari' }), 'ios');
  assert.equal(await detectGyroBrowser({ userAgent: 'Macintosh', maxTouchPoints: 5 }), 'ios');
  assert.equal(await detectGyroBrowser({ userAgent: 'Android SamsungBrowser/20 Chrome/130' }), 'other');
  assert.equal(await detectGyroBrowser({ userAgent: 'Firefox' }), 'other');
});

test('help offers browser switching, retry, touch fallback, and preserves manual choice', async t => {
  const oldDocument = globalThis.document;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const element = () => ({
    textContent: '', value: '', events: {},
    addEventListener(type, fn) { this.events[type] = fn; },
  });
  const nodes = Object.fromEntries(['select', '.gyro-help-guide', '.gyro-help-reason', '.gyro-retry', '.gyro-close'].map(key => [key, element()]));
  const dialog = {
    open: false, setAttribute() {}, querySelectorAll: () => [],
    querySelector: key => nodes[key],
    showModal() { this.open = true; }, close() { this.open = false; },
  };
  globalThis.document = { createElement: () => dialog, body: { appendChild() {} } };
  let detect;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    userAgent: 'Android Chrome/130', brave: { isBrave: () => new Promise(resolve => { detect = resolve; }) },
  } });
  t.after(() => {
    globalThis.document = oldDocument;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
  });
  const c = Object.create(TouchFlightControls.prototype);
  c.gyroBrowser = 'other';
  let retried = false;
  c.toggleGyro = () => { retried = true; dialog.close(); };
  c.showGyroHelp('gyro.denied');
  assert.equal(dialog.open, true);
  nodes.select.value = 'chrome';
  nodes.select.events.change();
  const chromeGuide = nodes['.gyro-help-guide'].textContent;
  detect(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.gyroBrowser, 'chrome');
  nodes.select.value = 'brave';
  nodes.select.events.change();
  assert.notEqual(nodes['.gyro-help-guide'].textContent, chromeGuide);
  nodes['.gyro-retry'].events.click();
  assert.equal(retried, true);
  c.showGyroHelp('gyro.no.readings');
  assert.equal(dialog.open, true);
  nodes['.gyro-close'].events.click();
  assert.equal(dialog.open, false);
});
