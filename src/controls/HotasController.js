/**
 * @file HotasController.js
 * @description Native Gamepad API controller support with specialized mapping for the
 * Thrustmaster T.Flight Hotas One flight stick and throttle system, as well as
 * fallback profiles for T.Flight Hotas X/4, generic flight sticks, and standard gamepads.
 */

/**
 * Apply a centered deadzone and rescale the remaining range to [0, 1] smoothly.
 * @param {number} value Raw axis value (-1 to 1)
 * @param {number} deadzone Deadzone threshold (0 to 1)
 * @returns {number} Filtered and rescaled value (-1 to 1)
 */
export function applyDeadzone(value, deadzone = 0.04) {
  if (value === undefined || value === null || Number.isNaN(value)) return 0.0;
  if (Math.abs(value) <= deadzone) return 0.0;
  const sign = Math.sign(value);
  const scaled = (Math.abs(value) - deadzone) / (1.0 - deadzone);
  return sign * Math.min(1.0, Math.max(0.0, scaled));
}

/**
 * Identify controller profile type from gamepad object.
 * @param {Gamepad|object} gamepad
 * @returns {'hotas-one' | 'hotas-tflight' | 'flight-stick' | 'standard-gamepad' | 'generic'}
 */
export function identifyGamepadType(gamepad) {
  if (!gamepad || !gamepad.id) return 'generic';
  const id = gamepad.id.toLowerCase();

  // T.Flight Hotas One explicitly (VID 044f, PID b68b or b68d, or name contains 'hotas one')
  const isHotasOneVidPid = /(?:044f|vendor:\s*044f).*?(?:b68b|b68d|product:\s*(?:b68b|b68d))/i.test(gamepad.id);
  const isHotasOneName = id.includes('hotas one') || id.includes('hotas-one');
  if (isHotasOneVidPid || isHotasOneName) {
    return 'hotas-one';
  }

  // Other T.Flight Hotas models (Hotas X, Hotas 4)
  if (id.includes('t.flight') || id.includes('t-flight') || (id.includes('thrustmaster') && id.includes('hotas'))) {
    return 'hotas-tflight';
  }

  // Generic flight sticks / yokes / HOTAS systems
  if (id.includes('hotas') || id.includes('flight') || id.includes('joystick') || id.includes('yoke')) {
    return 'flight-stick';
  }

  // Standard Gamepad fallback (e.g. Xbox controller, PlayStation controller, XInput)
  if (gamepad.mapping === 'standard' || id.includes('xbox') || id.includes('xinput')) {
    return 'standard-gamepad';
  }

  return 'generic';
}

/**
 * Controller driver for HOTAS and gamepad input.
 */
export class HotasController {
  constructor(flightControls, options = {}) {
    this.controls = flightControls;
    this.getGamepadsFn = options.getGamepads || null;

    // Analog outputs (-1.0 to 1.0 or 0.0 to 1.0)
    this.elevator = 0.0;     // Pitch: stick back = positive (climb)
    this.aileron = 0.0;      // Roll: stick right = positive
    this.rudder = 0.0;       // Yaw: right pedal/rocker/twist = positive
    this.throttle = 0.0;     // 0.0 to 1.0
    this.brakes = 0.0;       // 0.0 to 1.0
    this.hasThrottleControl = false;

    // Configuration
    this.deadzoneStick = 0.04;
    this.deadzoneRudder = 0.05;
    this.throttleInverted = false; // standard: forward = 1.0 (TOGA), backward = 0.0 (Idle)
    this.throttleDeltaThreshold = 0.005;

    // Internal state tracking
    this.lastRawThrottle = null;
    this.prevButtons = [];
    this.activeGamepadIndex = -1;
    this.connectedDevice = null;
    this.lastActiveTime = 0;
    this.axis4Valid = undefined;

    // Callbacks
    this.onDeviceConnected = null;
    this.onDeviceDisconnected = null;

    this.initListeners();
  }

  initListeners() {
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => {
        this.handleGamepadConnected(e.gamepad);
      });
      window.addEventListener('gamepaddisconnected', (e) => {
        this.handleGamepadDisconnected(e.gamepad);
      });
    }
  }

  handleGamepadConnected(gamepad) {
    if (!gamepad) return;
    const type = identifyGamepadType(gamepad);
    this.connectedDevice = {
      index: gamepad.index,
      id: gamepad.id,
      type,
      name: this.formatDeviceName(gamepad.id, type),
    };
    this.activeGamepadIndex = gamepad.index;
    if (this.onDeviceConnected) {
      this.onDeviceConnected(this.connectedDevice);
    }
    if (this.controls?.onUserInteract) {
      this.controls.onUserInteract();
    }
  }

  handleGamepadDisconnected(gamepad) {
    if (!gamepad) return;
    if (this.connectedDevice && this.connectedDevice.index === gamepad.index) {
      const disconnected = this.connectedDevice;
      this.connectedDevice = null;
      this.activeGamepadIndex = -1;
      this.resetOutputs();
      if (this.onDeviceDisconnected) {
        this.onDeviceDisconnected(disconnected);
      }
    }
  }

  formatDeviceName(rawId, type) {
    if (type === 'hotas-one') return 'Thrustmaster T.Flight Hotas One';
    if (type === 'hotas-tflight') return 'Thrustmaster T.Flight Hotas';
    if (type === 'flight-stick') return 'Flight Stick / HOTAS';
    if (type === 'standard-gamepad') return 'Gamepad Controller';
    return rawId ? rawId.split('(')[0].trim() : 'Game Controller';
  }

  resetOutputs() {
    this.elevator = 0.0;
    this.aileron = 0.0;
    this.rudder = 0.0;
    this.brakes = 0.0;
    this.hasThrottleControl = false;
    this.lastRawThrottle = null;
    this.prevButtons = [];
    this.axis4Valid = undefined;
  }

  getGamepads() {
    if (typeof this.getGamepadsFn === 'function') {
      return this.getGamepadsFn();
    }
    if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      return navigator.getGamepads();
    }
    return [];
  }

  findActiveGamepad() {
    const gamepads = this.getGamepads();
    if (!gamepads || gamepads.length === 0) return null;

    // Prioritize previously active index if still connected
    if (this.activeGamepadIndex >= 0 && gamepads[this.activeGamepadIndex]) {
      return gamepads[this.activeGamepadIndex];
    }

    // Look for T.Flight Hotas One first
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp && identifyGamepadType(gp) === 'hotas-one') {
        this.activeGamepadIndex = i;
        return gp;
      }
    }

    // Look for other HOTAS / flight sticks
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp) {
        const type = identifyGamepadType(gp);
        if (type === 'hotas-tflight' || type === 'flight-stick') {
          this.activeGamepadIndex = i;
          return gp;
        }
      }
    }

    // Fallback to any connected gamepad
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) {
        this.activeGamepadIndex = i;
        return gamepads[i];
      }
    }

    return null;
  }

  update(dt = 1 / 60) {
    const gp = this.findActiveGamepad();
    if (!gp) {
      if (this.connectedDevice) {
        this.handleGamepadDisconnected({ index: this.connectedDevice.index, id: this.connectedDevice.id });
      }
      return;
    }

    // Check if new device was detected via polling
    if (!this.connectedDevice || this.connectedDevice.index !== gp.index) {
      this.handleGamepadConnected(gp);
    }

    const type = this.connectedDevice?.type || identifyGamepadType(gp);
    const axes = gp.axes || [];
    const buttons = gp.buttons || [];

    let userInteracted = false;

    // Check interaction across buttons and axes
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      if (btn && (btn.pressed || (btn.value && btn.value > 0.1))) {
        userInteracted = true;
        break;
      }
    }

    if (type === 'hotas-one' || type === 'hotas-tflight' || type === 'flight-stick') {
      this.updateHotasProfile(gp, axes, buttons, dt);
    } else {
      this.updateStandardGamepadProfile(gp, axes, buttons, dt);
    }

    if (Math.abs(this.elevator) > 0.05 || Math.abs(this.aileron) > 0.05 || Math.abs(this.rudder) > 0.05) {
      userInteracted = true;
    }

    if (userInteracted && this.controls?.onUserInteract) {
      this.controls.onUserInteract();
    }

    // Save button states for next frame edge detection
    this.prevButtons = buttons.map(b => Boolean(b && (b.pressed || b.value > 0.5)));
  }

  isButtonPressed(buttons, index) {
    const b = buttons[index];
    return Boolean(b && (b.pressed || b.value > 0.5));
  }

  wasJustPressed(buttons, index) {
    const current = this.isButtonPressed(buttons, index);
    const prev = Boolean(this.prevButtons[index]);
    return current && !prev;
  }

  updateThrottleFromRaw(rawThrottle) {
    let normalized = this.throttleInverted
      ? (rawThrottle + 1.0) * 0.5
      : (1.0 - rawThrottle) * 0.5;
    normalized = Math.max(0.0, Math.min(1.0, normalized));

    if (this.lastRawThrottle === null) {
      // Initial sync
      this.lastRawThrottle = rawThrottle;
      this.throttle = normalized;
      this.hasThrottleControl = true;
      if (this.controls) this.controls.throttle = normalized;
    } else if (Math.abs(rawThrottle - this.lastRawThrottle) > this.throttleDeltaThreshold) {
      // Pilot physically adjusted lever
      this.lastRawThrottle = rawThrottle;
      this.throttle = normalized;
      this.hasThrottleControl = true;
      if (this.controls) this.controls.throttle = normalized;
    }
  }

  updateHotasProfile(gp, axes, buttons, dt) {
    const blocked = this.controls?.inputBlocked === true;
    const aircraftDisabled = this.controls?.aircraftControlsDisabled === true;

    // --- 1. Flight Control Axes ---
    if (!blocked && !aircraftDisabled) {
      // Axis 0: Roll (Aileron) - left negative, right positive
      this.aileron = applyDeadzone(axes[0] ?? 0.0, this.deadzoneStick);

      // Axis 1: Pitch (Elevator) - forward negative (dive/down), back positive (climb/up)
      this.elevator = applyDeadzone(axes[1] ?? 0.0, this.deadzoneStick);

      // Axis 2: Throttle Lever (Forward = TOGA / 1.0, Backward = Idle / 0.0)
      if (axes.length > 2 && axes[2] !== undefined) {
        this.updateThrottleFromRaw(axes[2]);
      }

      // Axis 3: Primary Rudder (Stick Twist handle, and throttle rocker in 4-axis mode)
      const twist = (axes.length > 3 && axes[3] !== undefined)
        ? applyDeadzone(axes[3], this.deadzoneRudder)
        : 0.0;

      // Axis 4: Secondary Rudder (e.g. TFRP pedals or independent 5-axis rocker paddle).
      // Note: On T.Flight Hotas One, if no pedals are plugged into the RJ12 port,
      // the floating ADC pin defaults to +1.0 (or -1.0), which would lock the rudder hard right/left.
      // We only accept axis 4 if it starts near neutral center (abs <= 0.25).
      let secondaryRudder = 0.0;
      if (axes.length > 4 && axes[4] !== undefined) {
        const rawAxis4 = axes[4];
        if (this.axis4Valid === undefined) {
          this.axis4Valid = Math.abs(rawAxis4) <= 0.25;
        } else if (!this.axis4Valid && Math.abs(rawAxis4) <= 0.1) {
          // If pedals were plugged in later and passed through neutral center
          this.axis4Valid = true;
        }
        if (this.axis4Valid) {
          secondaryRudder = applyDeadzone(rawAxis4, this.deadzoneRudder);
        }
      }

      // Whichever has higher deflection governs the rudder
      this.rudder = Math.abs(secondaryRudder) > Math.abs(twist) ? secondaryRudder : twist;

      // Wheel Brakes: Trigger (Button 0)
      const triggerBtn = buttons[0];
      if (triggerBtn) {
        const triggerVal = triggerBtn.value !== undefined ? triggerBtn.value : (triggerBtn.pressed ? 1.0 : 0.0);
        this.brakes = triggerVal > 0.05 ? triggerVal : 0.0;
      } else {
        this.brakes = 0.0;
      }
    } else {
      this.elevator = 0.0;
      this.aileron = 0.0;
      this.rudder = 0.0;
      this.brakes = 0.0;
    }

    if (blocked) return;

    // --- 2. Aircraft Systems One-Shot Buttons ---
    if (!aircraftDisabled) {
      // Button 1 (B1 / A): Toggle Spoilers / Speedbrakes
      if (this.wasJustPressed(buttons, 1)) {
        this.controls?.onToggleSpoilers?.();
      }

      // Button 2 (B2 / B): Toggle Landing Gear
      if (this.wasJustPressed(buttons, 2)) {
        this.controls?.onToggleGear?.();
      }

      // Button 3 (B3 / Y): Toggle Thrust Reverser
      if (this.wasJustPressed(buttons, 3)) {
        this.controls?.onToggleReverser?.();
      }

      // Button 4 (B4 / LB on throttle): Flaps Retract
      if (this.wasJustPressed(buttons, 4)) {
        this.controls?.onCycleFlaps?.(-1);
      }

      // Button 5 (B5 / RB on throttle): Flaps Extend
      if (this.wasJustPressed(buttons, 5)) {
        this.controls?.onCycleFlaps?.(1);
      }

      // Button 6 (Throttle base / paddle toggle): Parking Brake Toggle
      if (this.wasJustPressed(buttons, 6)) {
        if (this.controls) {
          this.controls.setParkingBrake(!this.controls.parkingBrake);
        }
      }

      // Button 10: Cycle Engine Failure Simulation
      if (this.wasJustPressed(buttons, 10)) {
        this.controls?.onCycleEngineFailure?.();
      }
    }

    // --- 3. View, Camera, Lighting & Utility Buttons (Allowed during demo) ---
    // Button 7: Camera Mode Cycle
    if (this.wasJustPressed(buttons, 7)) {
      this.controls?.onCycleCamera?.();
    }

    // Button 8 (View / Select): Center View / Reset Look
    if (this.wasJustPressed(buttons, 8)) {
      if (this.controls?.onResetLook) {
        this.controls.onResetLook();
      } else if (this.controls?.onSelectCamera) {
        this.controls.onSelectCamera(0);
      }
    }

    // Button 9 (Menu / Start): Toggle Aircraft Lights
    if (this.wasJustPressed(buttons, 9)) {
      this.controls?.onToggleLights?.();
    }

    // Button 11 (if present): Toggle Audio
    if (this.wasJustPressed(buttons, 11)) {
      this.controls?.onToggleAudio?.();
    }

    // --- 4. POV / Hat Switch ---
    // Buttons 12-15 or raw Hat axes (D-pad mapping)
    // Hat Up (12): Trim Nose Down (T equivalent)
    const hatUp = this.isButtonPressed(buttons, 12);
    // Hat Down (13): Trim Nose Up (Y equivalent)
    const hatDown = this.isButtonPressed(buttons, 13);
    // Hat Left (14): Cycle Time of Day backward
    const hatLeft = this.wasJustPressed(buttons, 14);
    // Hat Right (15): Cycle Time of Day forward
    const hatRight = this.wasJustPressed(buttons, 15);

    if (!aircraftDisabled) {
      if (hatUp) {
        if (this.controls) {
          this.controls.pitchTrim -= dt * 1.5;
          this.controls.pitchTrimRate = -1.0;
        }
      } else if (hatDown) {
        if (this.controls) {
          this.controls.pitchTrim += dt * 1.5;
          this.controls.pitchTrimRate = 1.0;
        }
      }
    }

    if (hatLeft) {
      this.controls?.onCycleTimeOfDay?.(-1.5);
    }
    if (hatRight) {
      this.controls?.onCycleTimeOfDay?.(1.5);
    }
  }

  updateStandardGamepadProfile(gp, axes, buttons, dt) {
    const blocked = this.controls?.inputBlocked === true;
    const aircraftDisabled = this.controls?.aircraftControlsDisabled === true;

    if (!blocked && !aircraftDisabled) {
      // Left Stick: Pitch and Roll
      this.aileron = applyDeadzone(axes[0] ?? 0.0, this.deadzoneStick);
      this.elevator = applyDeadzone(axes[1] ?? 0.0, this.deadzoneStick);

      // Right Stick X: Rudder / Yaw
      const rStickX = applyDeadzone(axes[2] ?? 0.0, this.deadzoneRudder);
      // Bumpers (LB / RB) as alternative rudder pedals
      const bumperL = this.isButtonPressed(buttons, 4) ? -1.0 : 0.0;
      const bumperR = this.isButtonPressed(buttons, 5) ? 1.0 : 0.0;
      const bumperRudder = bumperL + bumperR;
      this.rudder = Math.abs(rStickX) > 0.05 ? rStickX : bumperRudder;

      // Triggers: LT (brakes), RT (throttle / brake)
      const ltBtn = buttons[6];
      const rtBtn = buttons[7];
      if (ltBtn) {
        this.brakes = ltBtn.value !== undefined ? ltBtn.value : (ltBtn.pressed ? 1.0 : 0.0);
      } else {
        this.brakes = 0.0;
      }

      // Right Stick Y or RT can drive throttle
      if (axes.length > 3 && axes[3] !== undefined) {
        const rawRightY = axes[3];
        if (Math.abs(rawRightY) > 0.15) {
          // Relative throttle adjustment
          if (this.controls) {
            this.controls.throttle = Math.max(0.0, Math.min(1.0, this.controls.throttle - rawRightY * dt * 0.4));
          }
        }
      }
    } else {
      this.elevator = 0.0;
      this.aileron = 0.0;
      this.rudder = 0.0;
      this.brakes = 0.0;
    }

    if (blocked) return;

    if (!aircraftDisabled) {
      // Face Buttons: A (Spoilers), B (Gear), X (Flaps -), Y (Flaps +)
      if (this.wasJustPressed(buttons, 0)) this.controls?.onToggleSpoilers?.();
      if (this.wasJustPressed(buttons, 1)) this.controls?.onToggleGear?.();
      if (this.wasJustPressed(buttons, 2)) this.controls?.onCycleFlaps?.(-1);
      if (this.wasJustPressed(buttons, 3)) this.controls?.onCycleFlaps?.(1);
    }

    // View & menu buttons
    if (this.wasJustPressed(buttons, 8)) this.controls?.onCycleCamera?.();
    if (this.wasJustPressed(buttons, 9)) this.controls?.onToggleLights?.();

    // D-pad
    const dUp = this.isButtonPressed(buttons, 12);
    const dDown = this.isButtonPressed(buttons, 13);
    const dLeft = this.wasJustPressed(buttons, 14);
    const dRight = this.wasJustPressed(buttons, 15);

    if (!aircraftDisabled) {
      if (dUp && this.controls) {
        this.controls.pitchTrim -= dt * 1.5;
        this.controls.pitchTrimRate = -1.0;
      } else if (dDown && this.controls) {
        this.controls.pitchTrim += dt * 1.5;
        this.controls.pitchTrimRate = 1.0;
      }
    }

    if (dLeft) this.controls?.onCycleTimeOfDay?.(-1.5);
    if (dRight) this.controls?.onCycleTimeOfDay?.(1.5);
  }
}
