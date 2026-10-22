import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TouchFlightControls } from '../src/controls/TouchFlightControls.js';

function movedControls() {
  const controls = Object.create(TouchFlightControls.prototype);
  Object.assign(controls, {
    enabled: true,
    throttleActive: false,
    controls: { throttle: 0.55 },
    // Action groups have moved out of the overlay into the mobile menu.
    overlay: { querySelector: () => null },
    gearBtn: {}, spoilersBtn: {}, reverserBtn: {}, soundBtn: {},
  });
  return controls;
}

describe('Reparented mobile action state', () => {
  it('updates gear, spoiler and reverse states through deployment and recovery', () => {
    const controls = movedControls();
    controls.updateUI({ gearState: 1, spoilers: 0, engine1: { reverserActive: false } });
    assert.match(controls.gearBtn.innerHTML, /GEAR DN/);
    assert.equal(controls.gearBtn.className, 'btn-touch-pill active');
    assert.equal(controls.spoilersBtn.className, 'btn-touch-pill');
    assert.equal(controls.reverserBtn.className, 'btn-touch-pill');

    controls.enabled = false;
    controls.updateUI({ gearState: 0, spoilers: 1, engine1: { reverserActive: true } });
    assert.match(controls.gearBtn.innerHTML, /GEAR UP/);
    assert.equal(controls.gearBtn.className, 'btn-touch-pill');
    assert.equal(controls.spoilersBtn.className, 'btn-touch-pill active');
    assert.equal(controls.reverserBtn.className, 'btn-touch-pill active-amber');

    controls.updateUI({ gearState: 0.5, spoilers: 0, engine1: { reverserActive: false } });
    assert.match(controls.gearBtn.innerHTML, /TRANS/);
    assert.equal(controls.spoilersBtn.className, 'btn-touch-pill');
    assert.equal(controls.reverserBtn.className, 'btn-touch-pill');
    controls.enabled = true;
    controls.updateUI({ gearState: 1 });
    assert.match(controls.gearBtn.innerHTML, /GEAR DN/);
  });

  it('keeps audio mode and mute indicators synchronized after reparenting', () => {
    const controls = movedControls();
    for (const [state, className, text] of [
      [{ mode: 'normal' }, 'active', /100%/],
      [{ muted: true }, 'muted', /OFF/],
      [{ muted: false, mode: 'normal' }, 'active', /100%/],
    ]) {
      controls.updateAudioUI(state);
      assert.equal(controls.soundBtn.className, `btn-touch-pill ${className}`);
      assert.match(controls.soundBtn.innerHTML, text);
    }
  });
});


describe('Gyro stick sizing before pointer interaction', () => {
  it('keeps full and diagonal tilts inside the resized zone without changing control input', () => {
    const controls = movedControls();
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
