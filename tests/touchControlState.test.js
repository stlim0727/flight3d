import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { screenTilt } from '../src/controls/gyroOrientation.js';
import { TouchFlightControls, shapeTouchStick } from '../src/controls/TouchFlightControls.js';

function overlayControls() {
  const controls = Object.create(TouchFlightControls.prototype);
  Object.assign(controls, {
    enabled: true,
    throttleActive: false,
    controls: { throttle: 0.55 },
    overlay: { querySelector: () => null },
  });
  return controls;
}

describe('Gyro stick sizing before pointer interaction', () => {
  it('keeps full and diagonal tilts inside the resized zone without changing control input', t => {
    const original = globalThis.window;
    globalThis.window = { screen: { orientation: { angle: 0, type: 'portrait-primary' } } };
    t.after(() => { globalThis.window = original; });
    const controls = overlayControls();
    let size = 120;
    let input;
    Object.assign(controls, {
      gyroActive: true, stickActive: false, gyroOrientation: 'auto',
      gyroScreen: { angle: 0, type: 'portrait' }, gyroReadyAt: 0,
      gyroCalibration: screenTilt(0, 0, 0),
      stickRadius: 60,
      stickZone: { getBoundingClientRect: () => ({ left: 0, top: 0, width: size, height: size }) },
      stickKnob: { offsetWidth: 48, offsetHeight: 48, style: {} },
      updateStickTelemetry: () => {},
    });
    controls.controls.setTouchStick = (pitch, roll) => { input = [pitch, roll]; };
    controls.handleOrientation({ beta: 0, gamma: 31 });
    assert.equal(controls.stickRadius, 34);
    assert.equal(controls.stickKnob.style.transform, 'translate(34px, 0px)');
    assert.deepEqual(input, [0, 1]);

    controls.handleOrientation({ beta: 30, gamma: 45 });
    const position = controls.stickKnob.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    assert.ok(Math.hypot(Number(position[1]), Number(position[2])) <= 34.00001);
    assert.ok(Math.abs(Math.hypot(...input) - 1) < 1e-12);
    assert.ok(input[0] > .7 && input[1] > .7, 'Diagonal tilt must share the circular travel budget');

    size = 160;
    controls.stickKnob.offsetWidth = controls.stickKnob.offsetHeight = 56;
    controls.handleOrientation({ beta: 0, gamma: -31 });
    assert.equal(controls.stickRadius, 50);
    assert.equal(controls.stickKnob.style.transform, 'translate(-50px, 0px)');
    controls.handleOrientation({ beta: 0, gamma: 0 });
    assert.equal(controls.stickKnob.style.transform, 'translate(0px, 0px)');
  });
});

describe('Touch stick precision and pointer ownership', () => {
  it('filters small drift, stays monotonic, and preserves full/diagonal authority', () => {
    assert.deepEqual(shapeTouchStick(0.03, -0.03), [0, 0]);
    let previous = 0;
    for (let i = 7; i <= 100; i++) {
      const [pitch, roll] = shapeTouchStick(0, i / 100);
      assert.equal(pitch, 0);
      assert.ok(roll > previous);
      previous = roll;
    }
    assert.ok(shapeTouchStick(0, 0.21)[1] < 0.065);
    assert.deepEqual(shapeTouchStick(-1, 0), [-1, 0]);
    const diagonal = shapeTouchStick(1, -1);
    assert.ok(Math.abs(Math.hypot(...diagonal) - 1) < 1e-12);
  });

  it('starts off-centre grabs at neutral, ignores another finger, and releases capture safely', () => {
    const c = overlayControls();
    let input;
    Object.assign(c, {
      stickActive: false, gyroActive: false,
      stickZone: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 88, height: 88 }),
        setPointerCapture: () => {},
      },
      stickKnob: { offsetWidth: 36, offsetHeight: 36, style: {} },
      updateStickTelemetry: () => {},
    });
    c.controls.setTouchStick = (...axes) => { input = axes; };
    c.onStickPointerDown({ pointerId: 1, clientX: 55, clientY: 50 });
    assert.deepEqual(input, [0, 0]);
    c.onStickPointerDown({ pointerId: 2, clientX: 0, clientY: 0 });
    c.onStickPointerMove({ pointerId: 2, clientX: 0, clientY: 0 });
    assert.equal(c.stickPointerId, 1);
    c.onStickPointerMove({ pointerId: 1, clientX: 60, clientY: 50 });
    assert.ok(input[1] > 0 && input[1] < 0.065);
    c.onStickPointerMove({ pointerId: 1, clientX: 79, clientY: 50 });
    assert.deepEqual(input, [0, 1]);
    c.onStickPointerUp({ pointerId: 2 });
    assert.equal(c.stickActive, true);
    c.onStickPointerUp({ pointerId: 1 });
    assert.deepEqual(input, [0, 0]);
    c.onStickPointerUp({ pointerId: 1 });
    assert.equal(c.stickActive, false);
  });
});

describe('Simultaneous gyro tilt and touch drag', () => {
  it('allows touch drag to control aircraft surfaces while tilt is active and blends both smoothly', t => {
    const original = globalThis.window;
    globalThis.window = { screen: { orientation: { angle: 0, type: 'portrait-primary' } } };
    t.after(() => { globalThis.window = original; });

    const c = overlayControls();
    let currentInput = null;
    let telemetryText = '';
    const telemetryEl = { set textContent(val) { telemetryText = val; }, get textContent() { return telemetryText; } };

    Object.assign(c, {
      gyroActive: true, stickActive: false, gyroOrientation: 'auto',
      gyroScreen: { angle: 0, type: 'portrait' }, gyroReadyAt: 0,
      gyroCalibration: screenTilt(0, 0, 0),
      stickRadius: 60,
      stickZone: {
        getBoundingClientRect: () => ({ left: 100, top: 100, width: 120, height: 120 }),
        setPointerCapture: () => {},
      },
      stickKnob: { offsetWidth: 48, offsetHeight: 48, style: {} },
      stickTelemetry: telemetryEl,
    });
    c.controls.setTouchStick = (pitch, roll) => { currentInput = [pitch, roll]; };

    // 1. Tilt phone: 0 degrees pitch, 15 degrees roll right
    // gamma = 15 (roll: 15/30 = 0.5)
    c.handleOrientation({ beta: 0, gamma: 15 });
    const expectedPureGyro = shapeTouchStick(0, 0.5);
    assert.deepEqual(currentInput, expectedPureGyro);
    assert.ok(c.stickKnob.style.transform.includes('translate('));

    // 2. Touch down on the flight yoke: grab starts neutral relative to grab point
    c.onStickPointerDown({ pointerId: 1, clientX: 160, clientY: 160 });
    assert.equal(c.stickActive, true);
    // At grab point, touch delta is 0, so output remains pure gyro without sudden jumping
    assert.deepEqual(currentInput, expectedPureGyro);

    // 3. Drag stick right and up (more roll right, pitch up)
    // stickRadius is (120 - 48)/2 - 2 = 34px
    // clientX moved +17px (dx = +17 -> stickNormRoll = 17/34 = +0.5)
    // clientY moved -17px (dy = -17 -> stickNormPitch = -17/34 = -0.5)
    c.onStickPointerMove({ pointerId: 1, clientX: 177, clientY: 143 });
    // Combined raw: pitch = 0 - 0.5 = -0.5, roll = 0.5 + 0.5 = 1.0
    // Mag: hypot(-0.5, 1.0) = ~1.118 -> clamped to unit circle
    const mag1 = Math.hypot(-0.5, 1.0);
    const expectedCombined = shapeTouchStick(-0.5 / mag1, 1.0 / mag1);
    assert.ok(Math.abs(currentInput[0] - expectedCombined[0]) < 1e-12);
    assert.ok(Math.abs(currentInput[1] - expectedCombined[1]) < 1e-12);
    assert.equal(c.stickKnob.style.transform, 'translate(17px, -17px)');
    assert.ok(telemetryText.includes('P:') && telemetryText.includes('R:'));

    // 4. Orientation update arrives while finger is still dragging
    // beta changes to 0 (neutral pitch), gamma stays 15 (roll = 0.5)
    c.handleOrientation({ beta: 0, gamma: 15 });
    // Knob stays under user's thumb
    assert.equal(c.stickKnob.style.transform, 'translate(17px, -17px)');
    // Combined raw: pitch = 0 - 0.5 = -0.5, roll = 0.5 + 0.5 = 1.0
    const mag = Math.hypot(-0.5, 1.0);
    const expectedOrientationDuringTouch = shapeTouchStick(-0.5 / mag, 1.0 / mag);
    assert.ok(Math.abs(currentInput[0] - expectedOrientationDuringTouch[0]) < 1e-12);
    assert.ok(Math.abs(currentInput[1] - expectedOrientationDuringTouch[1]) < 1e-12);

    // 5. Release touch: stick returns to 0, output smoothly transitions to pure gyro
    c.onStickPointerUp({ pointerId: 1 });
    assert.equal(c.stickActive, false);
    const expectedAfterRelease = shapeTouchStick(0, 0.5);
    assert.ok(Math.abs(currentInput[0] - expectedAfterRelease[0]) < 1e-12);
    assert.ok(Math.abs(currentInput[1] - expectedAfterRelease[1]) < 1e-12);
    // Knob reflects current gyro position
    assert.equal(c.stickKnob.style.transform, 'translate(17px, 0px)');
  });
});
