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
    assert.deepEqual(input, [1, 1]);

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
