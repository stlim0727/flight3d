import { describe, it } from 'node:test';
import assert from 'node:assert';
import { HotasController, applyDeadzone, identifyGamepadType } from '../src/controls/HotasController.js';

describe('HotasController - Device Identification & Deadzone', () => {
  it('correctly applies centered deadzone and smooth scaling', () => {
    assert.strictEqual(applyDeadzone(0.0, 0.05), 0.0);
    assert.strictEqual(applyDeadzone(0.04, 0.05), 0.0);
    assert.strictEqual(applyDeadzone(-0.04, 0.05), 0.0);

    // Smooth scaling from deadzone threshold to 1.0
    const half = applyDeadzone(0.525, 0.05);
    assert.ok(Math.abs(half - 0.5) < 0.01, `Expected ~0.5, got ${half}`);

    assert.strictEqual(applyDeadzone(1.0, 0.05), 1.0);
    assert.strictEqual(applyDeadzone(-1.0, 0.05), -1.0);
  });

  it('identifies T.Flight Hotas One across various OS and browser string formats', () => {
    // Linux / Chrome (PID b68b)
    assert.strictEqual(
      identifyGamepadType({ id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68b)' }),
      'hotas-one'
    );
    // PC / Xbox mode variant (PID b68d)
    assert.strictEqual(
      identifyGamepadType({ id: 'Thrustmaster (Vendor: 044f Product: b68d)' }),
      'hotas-one'
    );
    // Windows / Firefox
    assert.strictEqual(
      identifyGamepadType({ id: '044f-b68b-T.Flight Hotas One' }),
      'hotas-one'
    );
    // Generic name
    assert.strictEqual(
      identifyGamepadType({ id: 'Thrustmaster T-Flight Hotas One Flight Stick' }),
      'hotas-one'
    );
    // Fallback T.Flight models
    assert.strictEqual(
      identifyGamepadType({ id: 'T.Flight Hotas 4 (Vendor: 044f Product: b10a)' }),
      'hotas-tflight'
    );
    assert.strictEqual(
      identifyGamepadType({ id: 'T.Flight Hotas X (Vendor: 044f Product: b108)' }),
      'hotas-tflight'
    );
    // Generic flight stick
    assert.strictEqual(
      identifyGamepadType({ id: 'Logitech Extreme 3D Pro Flight Joystick' }),
      'flight-stick'
    );
    // Standard gamepad
    assert.strictEqual(
      identifyGamepadType({ id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', mapping: 'standard' }),
      'standard-gamepad'
    );
  });
});

describe('HotasController - T.Flight Hotas One Flight Axes', () => {
  function createMockControls() {
    return {
      pitchTrim: 2.0,
      pitchTrimRate: 0.0,
      throttle: 0.0,
      parkingBrake: false,
      inputBlocked: false,
      aircraftControlsDisabled: false,
      setParkingBrake(val) { this.parkingBrake = Boolean(val); },
      onUserInteract() {},
    };
  }

  function createHotasGamepad(axes = [0, 0, 0, 0, 0], buttons = []) {
    return {
      id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68b)',
      index: 0,
      axes: [...axes],
      buttons: buttons.map(b => (typeof b === 'number' ? { pressed: b > 0.5, value: b } : { pressed: Boolean(b?.pressed), value: b?.value ?? 0 })),
    };
  }

  it('maps roll (aileron) and pitch (elevator) axes accurately with sign conventions', () => {
    const controls = createMockControls();
    let mockGamepad = createHotasGamepad([0.8, -0.6, 0, 0, 0]);
    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });

    // Initial update
    hotas.update(1 / 60);

    // Roll: stick right (+0.8) -> aileron > 0.7
    assert.ok(hotas.aileron > 0.7, `Expected positive roll, got ${hotas.aileron}`);

    // Pitch: stick forward (-0.6, dive) -> elevator < -0.5
    assert.ok(hotas.elevator < -0.5, `Expected negative pitch for dive, got ${hotas.elevator}`);

    // Stick back (+0.75, climb) and stick left (-0.5)
    mockGamepad = createHotasGamepad([-0.5, 0.75, 0, 0, 0]);
    hotas.update(1 / 60);
    assert.ok(hotas.aileron < -0.4, `Expected negative roll, got ${hotas.aileron}`);
    assert.ok(hotas.elevator > 0.7, `Expected positive pitch for climb, got ${hotas.elevator}`);
  });

  it('maps throttle lever (axis 2) from idle (+1.0) to full TOGA (-1.0) without altering rudder', () => {
    const controls = createMockControls();
    // Throttle fully back (+1.0 on axis 2) -> 0.0 (Idle), rudder must stay 0.0
    let mockGamepad = createHotasGamepad([0, 0, 1.0, 0.0, 0.0]);
    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });

    hotas.update(1 / 60);
    assert.strictEqual(hotas.throttle, 0.0);
    assert.strictEqual(controls.throttle, 0.0);
    assert.strictEqual(hotas.hasThrottleControl, true);
    assert.strictEqual(hotas.rudder, 0.0, 'Rudder must remain neutral (0.0) when throttle is at idle (+1.0)');

    // Push lever forward to mid-power (0.0 on axis 2) -> 50% thrust
    mockGamepad = createHotasGamepad([0, 0, 0.0, 0.0, 0.0]);
    hotas.update(1 / 60);
    assert.strictEqual(hotas.throttle, 0.5);
    assert.strictEqual(controls.throttle, 0.5);
    assert.strictEqual(hotas.rudder, 0.0, 'Throttle stick movement must never affect rudder');

    // Push lever fully forward (-1.0 on axis 2) -> 100% TOGA thrust
    mockGamepad = createHotasGamepad([0, 0, -1.0, 0.0, 0.0]);
    hotas.update(1 / 60);
    assert.strictEqual(hotas.throttle, 1.0);
    assert.strictEqual(controls.throttle, 1.0);
    assert.strictEqual(hotas.rudder, 0.0, 'Full TOGA throttle must never affect rudder');
  });

  it('maps stick twist (axis 3) to rudder and ignores floating/unconnected RJ12 pedal axis (axis 4 at 1.0)', () => {
    const controls = createMockControls();
    // Hotas One without pedals: Axis 4 floats at +1.0, axis 2 is throttle (+1.0 idle), axis 3 is twist (0.0)
    let mockGamepad = createHotasGamepad([0, 0, 1.0, 0.0, 1.0]);
    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });

    hotas.update(1 / 60);
    assert.strictEqual(hotas.throttle, 0.0, 'Throttle should be idle');
    assert.strictEqual(hotas.rudder, 0.0, 'Floating axis 4 (+1.0) must NOT lock rudder right');

    // Pilot twists stick right (+0.6 on axis 3) while floating axis 4 remains at 1.0
    mockGamepad = createHotasGamepad([0, 0, 1.0, 0.6, 1.0]);
    hotas.update(1 / 60);
    assert.ok(hotas.rudder > 0.5, `Expected rudder from twist, got ${hotas.rudder}`);

    // Pilot twists stick left (-0.7 on axis 3)
    mockGamepad = createHotasGamepad([0, 0, 1.0, -0.7, 1.0]);
    hotas.update(1 / 60);
    assert.ok(hotas.rudder < -0.6, `Expected negative rudder from left twist, got ${hotas.rudder}`);
  });

  it('accepts valid centered secondary rudder (TFRP pedals or 5-axis rocker) on axis 4 when initialized near neutral', () => {
    const controls = createMockControls();
    // Real pedals plugged in, centered at neutral 0.0 on connect
    let mockGamepad = createHotasGamepad([0, 0, 1.0, 0.0, 0.0]);
    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });

    hotas.update(1 / 60);
    assert.strictEqual(hotas.rudder, 0.0);

    // Pilot now presses pedals (-0.9 left on axis 4), overriding slight stick twist (+0.2 on axis 3)
    mockGamepad = createHotasGamepad([0, 0, 1.0, 0.2, -0.9]);
    hotas.update(1 / 60);
    assert.ok(hotas.rudder < -0.8, `Expected pedal rudder to override stick twist, got ${hotas.rudder}`);
  });

  it('maps 3-axis flight stick fallback where axis 2 is throttle and rudder is neutral', () => {
    const controls = createMockControls();
    // 3 axes: [roll, pitch, throttle] (no twist rudder)
    const mockGamepad = {
      id: 'Generic 3-Axis Joystick',
      index: 0,
      axes: [0, 0, 1.0], // Idle throttle
      buttons: [],
    };
    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });
    hotas.update(1 / 60);
    assert.strictEqual(hotas.throttle, 0.0);
    assert.strictEqual(hotas.rudder, 0.0);
  });

  it('maps main trigger (button 0) to proportional wheel brakes', () => {
    const controls = createMockControls();
    const buttons = [0]; // Trigger released
    let mockGamepad = createHotasGamepad([0, 0, 1.0, 0.0, 0.0], buttons);
    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });

    hotas.update(1 / 60);
    assert.strictEqual(hotas.brakes, 0.0);

    // Pull trigger halfway (0.5)
    mockGamepad = createHotasGamepad([0, 0, 1.0, 0.0, 0.0], [0.5]);
    hotas.update(1 / 60);
    assert.strictEqual(hotas.brakes, 0.5);

    // Full brake pull (1.0)
    mockGamepad = createHotasGamepad([0, 0, 1.0, 0.0, 0.0], [1.0]);
    hotas.update(1 / 60);
    assert.strictEqual(hotas.brakes, 1.0);
  });
});

describe('HotasController - Buttons & Systems Actions', () => {
  it('triggers edge-sensitive systems callbacks without repeating while held', () => {
    let spoilersToggled = 0;
    let gearToggled = 0;
    let reverserToggled = 0;
    let flapsCycled = 0;
    let cameraCycled = 0;
    let cameraReset = 0;
    let lightsToggled = 0;
    let parkingBrakeToggled = 0;
    let engineFailureCycled = 0;

    const controls = {
      pitchTrim: 2.0,
      pitchTrimRate: 0.0,
      parkingBrake: false,
      inputBlocked: false,
      aircraftControlsDisabled: false,
      setParkingBrake(val) {
        this.parkingBrake = val;
        parkingBrakeToggled++;
      },
      onToggleSpoilers: () => spoilersToggled++,
      onToggleGear: () => gearToggled++,
      onToggleReverser: () => reverserToggled++,
      onCycleFlaps: (dir) => flapsCycled += dir,
      onCycleCamera: () => cameraCycled++,
      onResetLook: () => cameraReset++,
      onToggleLights: () => lightsToggled++,
      onCycleEngineFailure: () => engineFailureCycled++,
    };

    // Buttons array:
    // 0: Trigger, 1: Spoilers, 2: Gear, 3: Reverser, 4: Flap Retract, 5: Flap Extend,
    // 6: Parking Brake, 7: Camera, 8: Reset Look, 9: Lights, 10: Engine Failure
    const buttons = new Array(16).fill(0);
    let mockGamepad = {
      id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68b)',
      index: 0,
      axes: [0, 0, 0, 0, 0],
      buttons: buttons.map(b => ({ pressed: b > 0.5, value: b })),
    };

    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });
    hotas.update(1 / 60);

    // Press Gear (Button 2) and Flap Extend (Button 5)
    buttons[2] = 1;
    buttons[5] = 1;
    mockGamepad.buttons = buttons.map(b => ({ pressed: b > 0.5, value: b }));
    hotas.update(1 / 60);

    assert.strictEqual(gearToggled, 1);
    assert.strictEqual(flapsCycled, 1);

    // Keep holding buttons on next frame: should NOT fire again
    hotas.update(1 / 60);
    assert.strictEqual(gearToggled, 1);
    assert.strictEqual(flapsCycled, 1);

    // Release buttons
    buttons[2] = 0;
    buttons[5] = 0;
    mockGamepad.buttons = buttons.map(b => ({ pressed: b > 0.5, value: b }));
    hotas.update(1 / 60);

    // Press Spoilers (1), Reverser (3), Flaps Retract (4), Parking Brake (6), Camera (7), Reset (8), Lights (9), Engine (10)
    buttons[1] = 1;
    buttons[3] = 1;
    buttons[4] = 1;
    buttons[6] = 1;
    buttons[7] = 1;
    buttons[8] = 1;
    buttons[9] = 1;
    buttons[10] = 1;
    mockGamepad.buttons = buttons.map(b => ({ pressed: b > 0.5, value: b }));
    hotas.update(1 / 60);

    assert.strictEqual(spoilersToggled, 1);
    assert.strictEqual(reverserToggled, 1);
    assert.strictEqual(flapsCycled, 0); // 1 + (-1) = 0
    assert.strictEqual(parkingBrakeToggled, 1);
    assert.strictEqual(cameraCycled, 1);
    assert.strictEqual(cameraReset, 1);
    assert.strictEqual(lightsToggled, 1);
    assert.strictEqual(engineFailureCycled, 1);
  });

  it('adjusts pitch trim smoothly with POV Hat Up / Down while held', () => {
    let timeDelta = 0;
    const controls = {
      pitchTrim: 2.0,
      pitchTrimRate: 0.0,
      inputBlocked: false,
      aircraftControlsDisabled: false,
      onCycleTimeOfDay: (d) => timeDelta += d,
    };

    const buttons = new Array(16).fill(0);
    // Button 12 = Hat Up (Trim nose down)
    buttons[12] = 1;
    let mockGamepad = {
      id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68b)',
      index: 0,
      axes: [0, 0, 0, 0, 0],
      buttons: buttons.map(b => ({ pressed: b > 0.5, value: b })),
    };

    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });
    hotas.update(0.5); // 0.5s held
    assert.ok(controls.pitchTrim < 2.0, `Pitch trim should have decreased, got ${controls.pitchTrim}`);
    assert.strictEqual(controls.pitchTrimRate, -1.0);

    // Switch to Button 13 = Hat Down (Trim nose up)
    buttons[12] = 0;
    buttons[13] = 1;
    mockGamepad.buttons = buttons.map(b => ({ pressed: b > 0.5, value: b }));
    hotas.update(1.0);
    assert.ok(controls.pitchTrim > 2.0, `Pitch trim should have increased, got ${controls.pitchTrim}`);
    assert.strictEqual(controls.pitchTrimRate, 1.0);

    // Hat Right (15) changes time of day
    buttons[13] = 0;
    buttons[15] = 1;
    mockGamepad.buttons = buttons.map(b => ({ pressed: b > 0.5, value: b }));
    hotas.update(1 / 60);
    assert.strictEqual(timeDelta, 1.5);
  });

  it('respects inputBlocked by suppressing flight surfaces and action buttons', () => {
    let gearToggled = 0;
    const controls = {
      pitchTrim: 2.0,
      pitchTrimRate: 0.0,
      inputBlocked: true,
      aircraftControlsDisabled: false,
      onToggleGear: () => gearToggled++,
    };

    const buttons = new Array(16).fill(0);
    buttons[2] = 1; // Gear button pressed
    const mockGamepad = {
      id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68b)',
      index: 0,
      axes: [0.8, -0.7, 0, 0.5, 0], // Big deflections
      buttons: buttons.map(b => ({ pressed: b > 0.5, value: b })),
    };

    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });
    hotas.update(1 / 60);

    assert.strictEqual(gearToggled, 0, 'Gear toggle must be blocked');
    assert.strictEqual(hotas.elevator, 0.0, 'Elevator output must be zeroed when blocked');
    assert.strictEqual(hotas.aileron, 0.0, 'Aileron output must be zeroed when blocked');
    assert.strictEqual(hotas.rudder, 0.0, 'Rudder output must be zeroed when blocked');
  });

  it('respects aircraftControlsDisabled by permitting camera, lights, time and audio but disabling flight controls', () => {
    let gearToggled = 0;
    let cameraCycled = 0;
    let lightsToggled = 0;

    const controls = {
      pitchTrim: 2.0,
      pitchTrimRate: 0.0,
      inputBlocked: false,
      aircraftControlsDisabled: true,
      onToggleGear: () => gearToggled++,
      onCycleCamera: () => cameraCycled++,
      onToggleLights: () => lightsToggled++,
    };

    const buttons = new Array(16).fill(0);
    buttons[2] = 1; // Gear (flight action)
    buttons[7] = 1; // Camera (utility action)
    buttons[9] = 1; // Lights (utility action)
    const mockGamepad = {
      id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68b)',
      index: 0,
      axes: [0.9, 0.9, 0, 0.9, 0],
      buttons: buttons.map(b => ({ pressed: b > 0.5, value: b })),
    };

    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });
    hotas.update(1 / 60);

    assert.strictEqual(gearToggled, 0, 'Flight action must be ignored during demo');
    assert.strictEqual(cameraCycled, 1, 'Camera action should be allowed during demo');
    assert.strictEqual(lightsToggled, 1, 'Lights action should be allowed during demo');
    assert.strictEqual(hotas.elevator, 0.0);
    assert.strictEqual(hotas.aileron, 0.0);
  });
});

describe('HotasController - Device Connection & Disconnection', () => {
  it('notifies onDeviceConnected and onDeviceDisconnected callbacks', () => {
    let connected = null;
    let disconnected = null;

    const controls = { onUserInteract() {} };
    let mockGamepad = {
      id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68b)',
      index: 0,
      axes: [0, 0, 0, 0, 0],
      buttons: [],
    };

    const hotas = new HotasController(controls, { getGamepads: () => (mockGamepad ? [mockGamepad] : []) });
    hotas.onDeviceConnected = (dev) => { connected = dev; };
    hotas.onDeviceDisconnected = (dev) => { disconnected = dev; };

    // First frame polls and discovers device
    hotas.update(1 / 60);
    assert.ok(connected !== null);
    assert.strictEqual(connected.type, 'hotas-one');
    assert.strictEqual(connected.name, 'Thrustmaster T.Flight Hotas One');

    // Next frame gamepad is disconnected
    mockGamepad = null;
    hotas.update(1 / 60);
    assert.ok(disconnected !== null);
    assert.strictEqual(disconnected.type, 'hotas-one');
  });
});

describe('HotasController - Xbox Mode Profile & Custom Configuration', () => {
  function createMockControls() {
    return {
      pitchTrim: 2.0,
      pitchTrimRate: 0.0,
      throttle: 0.0,
      parkingBrake: false,
      inputBlocked: false,
      aircraftControlsDisabled: false,
      setParkingBrake(val) { this.parkingBrake = Boolean(val); },
      onUserInteract() {},
      onToggleSpoilers() {},
      onToggleGear() {},
      onCycleFlaps() {},
    };
  }

  it('detects Xbox mode and maps Axis 3 to throttle, Axis 2 to rudder, and Button 7 to brakes', () => {
    const controls = createMockControls();
    // In Xbox mode on Hotas One:
    // axes[0] = roll, axes[1] = pitch, axes[2] = rudder (twist/rocker), axes[3] = throttle (forward = -1.0 TOGA, back = +1.0 Idle)
    // buttons[7] = RT trigger (brakes)
    const buttons = new Array(16).fill(0).map(() => ({ pressed: false, value: 0 }));
    buttons[7] = { pressed: true, value: 0.8 }; // Pull RT trigger
    const mockGamepad = {
      id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68d)', // Xbox mode PID b68d
      mapping: 'standard',
      index: 0,
      axes: [0.5, -0.4, 0.7, -1.0], // Roll right, Pitch down, Rudder right, Throttle full TOGA (-1.0)
      buttons,
    };

    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });
    assert.strictEqual(hotas.resolveProfile(mockGamepad), 'hotas-one-xbox');

    hotas.update(1 / 60);

    assert.ok(hotas.aileron > 0.4, `Expected right roll, got ${hotas.aileron}`);
    assert.ok(hotas.elevator < -0.3, `Expected pitch down, got ${hotas.elevator}`);
    assert.ok(hotas.rudder > 0.6, `Expected rudder right from axis 2, got ${hotas.rudder}`);
    assert.strictEqual(hotas.throttle, 1.0, `Expected full TOGA throttle from axis 3 (-1.0), got ${hotas.throttle}`);
    assert.strictEqual(hotas.brakes, 0.8, `Expected wheel brakes from button 7 (RT), got ${hotas.brakes}`);
  });

  it('supports profileOverride to force Xbox mode or PC mode regardless of detection', () => {
    const controls = createMockControls();
    const mockGamepad = {
      id: 'Generic Flight Stick',
      index: 0,
      axes: [0, 0, 0, 0],
      buttons: [],
    };

    const hotas = new HotasController(controls, {
      profileOverride: 'hotas-one-xbox',
      getGamepads: () => [mockGamepad],
    });
    assert.strictEqual(hotas.resolveProfile(mockGamepad), 'hotas-one-xbox');

    hotas.applyConfig({ profileOverride: 'hotas-one' });
    assert.strictEqual(hotas.resolveProfile(mockGamepad), 'hotas-one');
  });

  it('supports pitchInverted and throttleInverted configurations', () => {
    const controls = createMockControls();
    // Axis 1 = +0.6 (pulling back). Normally pitch up (> 0). If pitchInverted, pitch down (< 0).
    // Axis 2 = +1.0 (pulling back). Normally idle (0.0). If throttleInverted, 100% (1.0).
    const mockGamepad = {
      id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68b)',
      index: 0,
      axes: [0, 0.6, 1.0, 0, 0],
      buttons: [],
    };

    const hotas = new HotasController(controls, {
      pitchInverted: true,
      throttleInverted: true,
      getGamepads: () => [mockGamepad],
    });
    hotas.update(1 / 60);

    assert.ok(hotas.elevator < -0.5, `Expected negative pitch with inverted elevator, got ${hotas.elevator}`);
    assert.strictEqual(hotas.throttle, 1.0, `Expected 1.0 with inverted throttle when raw axis is +1.0`);
  });

  it('supports rudderMode twist-only and pedals-only', () => {
    const controls = createMockControls();
    // Twist on axis 3 = +0.8, Pedals on axis 4 = -0.7
    const mockGamepad = {
      id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68b)',
      index: 0,
      axes: [0, 0, 0, 0.8, -0.7],
      buttons: [],
    };

    // Twist only
    const hotasTwist = new HotasController(controls, {
      rudderMode: 'twist',
      getGamepads: () => [mockGamepad],
    });
    hotasTwist.update(1 / 60);
    assert.ok(hotasTwist.rudder > 0.7, `Expected twist rudder (+0.8), got ${hotasTwist.rudder}`);

    // Pedals only
    const hotasPedals = new HotasController(controls, {
      rudderMode: 'pedals',
      getGamepads: () => [mockGamepad],
    });
    hotasPedals.update(1 / 60);
    assert.ok(hotasPedals.rudder < -0.6, `Expected pedal rudder (-0.7), got ${hotasPedals.rudder}`);
  });

  it('provides comprehensive getDiagnostics() for live UI inspection', () => {
    const controls = createMockControls();
    const mockGamepad = {
      id: 'Thrustmaster T.Flight Hotas One (Vendor: 044f Product: b68b)',
      index: 0,
      mapping: '',
      axes: [0.1, -0.2, 0.5, 0.0, 0.0],
      buttons: [{ pressed: true, value: 1.0 }],
    };

    const hotas = new HotasController(controls, { getGamepads: () => [mockGamepad] });
    hotas.update(1 / 60);

    const diag = hotas.getDiagnostics();
    assert.strictEqual(diag.connected, true);
    assert.strictEqual(diag.device.name, 'Thrustmaster T.Flight Hotas One');
    assert.strictEqual(diag.activeProfile, 'hotas-one');
    assert.strictEqual(diag.axes.length, 5);
    assert.strictEqual(diag.buttons[0].pressed, true);
    assert.ok(typeof diag.outputs.throttle === 'number');
  });
});
