import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FlightControls } from '../src/controls/FlightControls.js';

describe('FlightControls (Keyboard & Touch Inputs)', () => {
  it('should initialize with neutral controls and zero touch inputs', () => {
    // Mock minimal DOM element for Node test environment
    const mockDom = { addEventListener: () => {} };
    // Temporarily mock window if not present
    const prevWindow = globalThis.window;
    if (!globalThis.window) {
      globalThis.window = { addEventListener: () => {}, innerWidth: 1920, innerHeight: 1080 };
    }

    const controls = new FlightControls(mockDom);
    assert.strictEqual(controls.elevator, 0.0);
    assert.strictEqual(controls.aileron, 0.0);
    assert.strictEqual(controls.rudder, 0.0);
    assert.strictEqual(controls.throttle, 0.0);
    assert.strictEqual(controls.brakes, 0.0);
    assert.strictEqual(controls.touchElevator, 0.0);
    assert.strictEqual(controls.touchAileron, 0.0);
    assert.strictEqual(controls.touchRudder, 0.0);
    assert.strictEqual(controls.touchBrakes, 0.0);

    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  });

  it('should integrate touch stick inputs (Pitch & Roll) smoothly with slew rates', () => {
    const mockDom = { addEventListener: () => {} };
    const prevWindow = globalThis.window;
    if (!globalThis.window) {
      globalThis.window = { addEventListener: () => {}, innerWidth: 1920, innerHeight: 1080 };
    }

    const controls = new FlightControls(mockDom);

    // Simulate pilot pulling touch stick back for pitch up (0.8) and right roll (0.5)
    controls.setTouchStick(0.8, 0.5);
    assert.strictEqual(controls.touchElevator, 0.8);
    assert.strictEqual(controls.touchAileron, 0.5);

    // Run physics update for 1 second at 140 knots
    controls.update(1.0, 140);
    assert.ok(controls.elevator > 0.4, `Elevator should slew positive towards 0.8, got ${controls.elevator}`);
    assert.ok(controls.aileron > 0.4, `Aileron should slew positive towards 0.5, got ${controls.aileron}`);

    // Pilot releases touch stick (spring to center)
    controls.setTouchStick(0.0, 0.0);
    // Run physics update for 2 seconds
    controls.update(2.0, 140);
    assert.ok(Math.abs(controls.elevator) < 0.05, `Elevator should return to neutral, got ${controls.elevator}`);
    assert.ok(Math.abs(controls.aileron) < 0.05, `Aileron should return to neutral, got ${controls.aileron}`);

    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  });

  it('should integrate touch throttle and rudder inputs accurately', () => {
    const mockDom = { addEventListener: () => {} };
    const prevWindow = globalThis.window;
    if (!globalThis.window) {
      globalThis.window = { addEventListener: () => {}, innerWidth: 1920, innerHeight: 1080 };
    }

    const controls = new FlightControls(mockDom);

    // Touch throttle set to TOGA (1.0)
    controls.setTouchThrottle(1.0);
    assert.strictEqual(controls.throttle, 1.0);

    // Touch throttle set to CLB (0.85)
    controls.setTouchThrottle(0.85);
    assert.strictEqual(controls.throttle, 0.85);

    // Touch rudder set to right pedal (0.7)
    controls.setTouchRudder(0.7);
    assert.strictEqual(controls.touchRudder, 0.7);
    controls.update(1.0, 140);
    assert.ok(controls.rudder > 0.35, `Rudder should slew towards 0.7, got ${controls.rudder}`);

    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  });

  it('should engage and release touch brakes properly', () => {
    const mockDom = { addEventListener: () => {} };
    const prevWindow = globalThis.window;
    if (!globalThis.window) {
      globalThis.window = { addEventListener: () => {}, innerWidth: 1920, innerHeight: 1080 };
    }

    const controls = new FlightControls(mockDom);

    // Hold brake button
    controls.setTouchBrakes(1.0);
    controls.update(0.1, 80);
    assert.strictEqual(controls.brakes, 1.0);

    // Release brake button
    controls.setTouchBrakes(0.0);
    controls.update(0.1, 80);
    assert.strictEqual(controls.brakes, 0.0);

    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  });

  it('should set, hold, and auto-release parking brake upon throttle application', () => {
    const mockDom = { addEventListener: () => {} };
    const prevWindow = globalThis.window;
    if (!globalThis.window) {
      globalThis.window = { addEventListener: () => {}, innerWidth: 1920, innerHeight: 1080 };
    }

    const controls = new FlightControls(mockDom);
    assert.strictEqual(controls.parkingBrake, false);
    assert.strictEqual(controls.brakes, 0.0);

    // Set parking brake
    controls.setParkingBrake(true);
    assert.strictEqual(controls.parkingBrake, true);
    assert.strictEqual(controls.brakes, 1.0);

    // Run frame updates with zero throttle: parking brake remains held
    controls.update(0.1, 0);
    assert.strictEqual(controls.parkingBrake, true);
    assert.strictEqual(controls.brakes, 1.0);

    // Advance throttle to taxi/takeoff (> 0.25)
    controls.throttle = 0.4;
    controls.update(0.1, 0);
    assert.strictEqual(controls.parkingBrake, false);
    assert.strictEqual(controls.brakes, 0.0);

    // Re-engage and explicitly release
    controls.setParkingBrake(true);
    assert.strictEqual(controls.parkingBrake, true);
    controls.setParkingBrake(false);
    assert.strictEqual(controls.parkingBrake, false);
    controls.update(0.1, 0);
    assert.strictEqual(controls.brakes, 0.0);

    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  });
});


it('throttle responds to held Equal/Minus, stops on release, and clamps output', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    const controls = new FlightControls({ addEventListener() {} });
    controls.handleKeyDown({ code: 'Equal' });
    controls.update(1);
    assert.strictEqual(controls.throttle, 0.35);
    controls.handleKeyUp({ code: 'Equal' });
    controls.update(1);
    assert.strictEqual(controls.throttle, 0.35);
    controls.handleKeyDown({ code: 'Minus' });
    controls.update(0.5);
    assert.strictEqual(controls.throttle, 0.175);
    controls.update(10);
    assert.strictEqual(controls.throttle, 0);
    controls.handleKeyUp({ code: 'Minus' });
    controls.handleKeyDown({ code: 'Equal' });
    controls.update(10);
    assert.strictEqual(controls.throttle, 1);
    controls.handleKeyUp({ code: 'Equal' });
    controls.throttle = 0.5;
    for (const code of ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight']) {
      controls.handleKeyDown({ code });
      controls.update(1);
      assert.strictEqual(controls.throttle, 0.5);
      controls.handleKeyUp({ code });
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

it('inputBlocked gates keydown state and one-shot callbacks; keyup still clears', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    const controls = new FlightControls({ addEventListener() {} });
    let gearToggles = 0;
    controls.onToggleGear = () => gearToggles++;
    let cameras = 0;
    controls.onCycleCamera = () => cameras++;

    controls.inputBlocked = true;
    controls.handleKeyDown({ code: 'Equal' });
    controls.handleKeyDown({ code: 'KeyG' });
    controls.handleKeyDown({ code: 'KeyC' });
    assert.deepStrictEqual(controls.keys['Equal'], undefined);
    assert.strictEqual(gearToggles, 0);
    assert.strictEqual(cameras, 0);

    // A key released while blocked must still clear its held state.
    controls.inputBlocked = false;
    controls.handleKeyDown({ code: 'Minus' });
    assert.strictEqual(controls.keys['Minus'], true);
    controls.inputBlocked = true;
    controls.handleKeyUp({ code: 'Minus' });
    assert.strictEqual(controls.keys['Minus'], false);

    controls.inputBlocked = false;
    controls.handleKeyDown({ code: 'KeyG' });
    assert.strictEqual(gearToggles, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

it('releaseAllKeys drops held inputs so update() returns to neutral', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    const controls = new FlightControls({ addEventListener() {} });
    controls.handleKeyDown({ code: 'KeyW' });
    controls.handleKeyDown({ code: 'KeyT' });
    controls.update(1);
    assert.notStrictEqual(controls.pitchTrimRate, 0);

    controls.inputBlocked = true;
    controls.releaseAllKeys();
    controls.inputBlocked = false;
    controls.update(1);
    assert.strictEqual(controls.elevator, 0);
    assert.strictEqual(controls.aileron, 0);
    assert.strictEqual(controls.brakes, 0);
    assert.strictEqual(controls.pitchTrimRate, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
