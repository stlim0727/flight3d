import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TouchFlightControls } from '../src/controls/TouchFlightControls.js';

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
  it('keeps full and diagonal tilts inside the resized zone without changing control input', () => {
    const controls = overlayControls();
    let size = 120;
    let input;
    Object.assign(controls, {
      gyroActive: true, stickActive: false, gyroZeroPitch: 38, gyroZeroRoll: 0,
      stickRadius: 60,
      stickZone: { getBoundingClientRect: () => ({ left: 0, top: 0, width: size, height: size }) },
      stickKnob: { offsetWidth: 48, offsetHeight: 48, style: {} },
      updateStickTelemetry: () => {},
    });
    controls.controls.setTouchStick = (pitch, roll) => { input = [pitch, roll]; };
    controls.handleOrientation({ beta: 38, gamma: 30 });
    assert.equal(controls.stickRadius, 34);
    assert.equal(controls.stickKnob.style.transform, 'translate(34px, 0px)');
    assert.deepEqual(input, [0, 1]);

    controls.handleOrientation({ beta: 63, gamma: 30 });
    const position = controls.stickKnob.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    assert.ok(Math.hypot(Number(position[1]), Number(position[2])) <= 34.00001);
    assert.deepEqual(input, [1, 1]);

    size = 160;
    controls.stickKnob.offsetWidth = controls.stickKnob.offsetHeight = 56;
    controls.handleOrientation({ beta: 38, gamma: -30 });
    assert.equal(controls.stickRadius, 50);
    assert.equal(controls.stickKnob.style.transform, 'translate(-50px, 0px)');
    controls.handleOrientation({ beta: 38, gamma: 0 });
    assert.equal(controls.stickKnob.style.transform, 'translate(0px, 0px)');
  });
});
