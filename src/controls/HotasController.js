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
    this.profileOverride = options.profileOverride || 'auto'; // 'auto', 'hotas-one', 'hotas-one-xbox', 'hotas-tflight', 'flight-stick', 'standard-gamepad'
    this.axesLayout = options.axesLayout || 'thrustmaster'; // 'thrustmaster' (Rudder 2, Throttle 3), 'legacy' (Throttle 2, Rudder 3), 'auto'
    this.throttleInverted = options.throttleInverted ?? false; // standard: forward = 1.0 (TOGA), backward = 0.0 (Idle)
    this.pitchInverted = options.pitchInverted ?? false;
    this.rudderMode = options.rudderMode || 'auto'; // 'auto', 'twist', 'pedals'
    this.deadzoneStick = options.deadzoneStick ?? 0.04;
    this.deadzoneRudder = options.deadzoneRudder ?? 0.05;
    this.throttleDeltaThreshold = 0.005;
    this.throttleAxis = 3;
    this.rudderAxis = 2;

    // Internal state tracking
    this.lastRawThrottle = null;
    this.prevButtons = [];
    this.activeGamepadIndex = -1;
    this.connectedDevice = null;
    this.lastActiveTime = 0;
    this.axis4Valid = false;
    this.axis4CenterFrames = 0;
    this.hasSecondaryRudderControl = false;
    this.lastRawAxis4 = null;
    this.axis4Floating = false;
    this.activeRudderSource = 'twist';

    // Callbacks
    this.onDeviceConnected = null;
    this.onDeviceDisconnected = null;

    this.initListeners();
  }

  applyConfig(cfg = {}) {
    if (typeof cfg.profileOverride === 'string') this.profileOverride = cfg.profileOverride;
    if (['thrustmaster', 'legacy', 'auto'].includes(cfg.axesLayout)) this.axesLayout = cfg.axesLayout;
    if (typeof cfg.throttleInverted === 'boolean') this.throttleInverted = cfg.throttleInverted;
    if (typeof cfg.pitchInverted === 'boolean') this.pitchInverted = cfg.pitchInverted;
    if (['auto', 'twist', 'pedals'].includes(cfg.rudderMode)) this.rudderMode = cfg.rudderMode;
    if (typeof cfg.deadzoneStick === 'number' && Number.isFinite(cfg.deadzoneStick)) {
      this.deadzoneStick = Math.max(0, Math.min(0.2, cfg.deadzoneStick));
    }
    if (typeof cfg.deadzoneRudder === 'number' && Number.isFinite(cfg.deadzoneRudder)) {
      this.deadzoneRudder = Math.max(0, Math.min(0.2, cfg.deadzoneRudder));
    }
  }

  getConfig() {
    return {
      profileOverride: this.profileOverride,
      axesLayout: this.axesLayout,
      throttleInverted: this.throttleInverted,
      pitchInverted: this.pitchInverted,
      rudderMode: this.rudderMode,
      deadzoneStick: this.deadzoneStick,
      deadzoneRudder: this.deadzoneRudder,
    };
  }

  resolveProfile(gamepad) {
    if (!gamepad) return 'generic';
    if (this.profileOverride && this.profileOverride !== 'auto') {
      return this.profileOverride;
    }
    const baseType = identifyGamepadType(gamepad);
    if (baseType === 'hotas-one') {
      const isPcMode = /(?:b68b|product:\s*b68b)/i.test(gamepad.id || '');
      if (isPcMode) return 'hotas-one';
      const isXboxMode = /(?:b68d|product:\s*b68d)/i.test(gamepad.id || '')
        || (gamepad.id || '').toLowerCase().includes('xbox')
        || (gamepad.id || '').toLowerCase().includes('xinput');
      return isXboxMode ? 'hotas-one-xbox' : 'hotas-one';
    }
    return baseType;
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
    if (type === 'hotas-one-xbox') return 'Thrustmaster T.Flight Hotas One (Xbox Mode)';
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
    this.axis4Valid = false;
    this.axis4CenterFrames = 0;
    this.hasSecondaryRudderControl = false;
    this.lastRawAxis4 = null;
    this.axis4Floating = false;
    this.activeRudderSource = 'twist';
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

    const activeProfile = this.resolveProfile(gp);
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

    if (activeProfile === 'hotas-one-xbox') {
      this.updateHotasXboxProfile(gp, axes, buttons, dt);
    } else if (activeProfile === 'hotas-one' || activeProfile === 'hotas-tflight' || activeProfile === 'flight-stick') {
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
      const rawElevator = applyDeadzone(axes[1] ?? 0.0, this.deadzoneStick);
      this.elevator = this.pitchInverted ? -rawElevator : rawElevator;

      // Determine axes assignment based on layout
      let twistAxisIdx = 2;
      let throttleAxisIdx = 3;

      if (axes.length <= 3) {
        twistAxisIdx = -1;
        throttleAxisIdx = 2;
      } else if (this.axesLayout === 'legacy') {
        twistAxisIdx = 3;
        throttleAxisIdx = 2;
      } else {
        // 'thrustmaster' default (and auto with >= 4 axes): Z=Rudder (Axis 2), RZ=Throttle (Axis 3)
        twistAxisIdx = 2;
        throttleAxisIdx = 3;
      }
      this.throttleAxis = throttleAxisIdx;
      this.rudderAxis = twistAxisIdx;

      // Throttle Lever
      if (throttleAxisIdx >= 0 && axes.length > throttleAxisIdx && axes[throttleAxisIdx] !== undefined) {
        this.updateThrottleFromRaw(axes[throttleAxisIdx]);
      }

      // Primary Rudder (Stick Twist handle on Axis 2, and throttle rocker in 4-axis mode)
      const twist = (twistAxisIdx >= 0 && axes.length > twistAxisIdx && axes[twistAxisIdx] !== undefined)
        ? applyDeadzone(axes[twistAxisIdx], this.deadzoneRudder)
        : 0.0;

      // Axis 4: Secondary Rudder (e.g. TFRP pedals or independent 5-axis rocker paddle).
      // Note: On T.Flight Hotas One, if no pedals are plugged into the RJ12 port,
      // the floating ADC pin defaults to +1.0 (or -1.0), which would lock the rudder hard right/left.
      // Floating pin protection:
      // A floating pin sits continuously pegged at extreme values (+1.0 or -1.0) without returning to center.
      // A real physical pedal or rocker paddle rests at neutral center (abs <= 0.20) with a return spring.
      let secondaryRudder = 0.0;
      let axis4Floating = false;

      if (axes.length > 4 && axes[4] !== undefined) {
        const rawAxis4 = axes[4];
        if (this.rudderMode === 'pedals') {
          // Explicit user override in settings
          this.axis4Valid = true;
          this.hasSecondaryRudderControl = true;
          secondaryRudder = applyDeadzone(rawAxis4, this.deadzoneRudder);
        } else if (this.rudderMode === 'twist') {
          // Explicit twist only: disable secondary axis completely
          this.axis4Valid = false;
          this.hasSecondaryRudderControl = false;
        } else {
          // 'auto' mode:
          // A real physical pedal or rocker paddle rests at neutral center (abs <= 0.20) with a return spring.
          // A floating pin sits continuously pegged at extreme values (+1.0 or -1.0) without resting at center.
          const isExtreme = Math.abs(rawAxis4) >= 0.90;

          if (Math.abs(rawAxis4) <= 0.20) {
            this.axis4CenterFrames = (this.axis4CenterFrames || 0) + 1;
            if (this.axis4CenterFrames >= 2) {
              this.axis4Valid = true;
            }
          } else if (isExtreme && !this.axis4Valid) {
            // Pegged at extreme without having been confirmed centered: floating pin!
            this.axis4CenterFrames = 0;
            axis4Floating = true;
          }

          if (this.axis4Valid) {
            secondaryRudder = applyDeadzone(rawAxis4, this.deadzoneRudder);
          }
        }
        this.lastRawAxis4 = rawAxis4;
      }
      this.axis4Floating = axis4Floating;

      if (this.rudderMode === 'twist') {
        this.rudder = twist;
        this.activeRudderSource = 'twist';
      } else if (this.rudderMode === 'pedals') {
        this.rudder = secondaryRudder;
        this.activeRudderSource = 'pedals';
      } else {
        // Auto mode: whichever active source has higher deflection governs the rudder
        if (Math.abs(secondaryRudder) > Math.abs(twist)) {
          this.rudder = secondaryRudder;
          this.activeRudderSource = 'pedals';
        } else {
          this.rudder = twist;
          this.activeRudderSource = 'twist';
        }
      }

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

  updateHotasXboxProfile(gp, axes, buttons, dt) {
    const blocked = this.controls?.inputBlocked === true;
    const aircraftDisabled = this.controls?.aircraftControlsDisabled === true;

    // --- 1. Flight Control Axes (Xbox / XInput Mode) ---
    if (!blocked && !aircraftDisabled) {
      // Axis 0: Roll (Aileron) - left negative, right positive
      this.aileron = applyDeadzone(axes[0] ?? 0.0, this.deadzoneStick);

      // Axis 1: Pitch (Elevator) - forward negative (dive/down), back positive (climb/up)
      const rawElevator = applyDeadzone(axes[1] ?? 0.0, this.deadzoneStick);
      this.elevator = this.pitchInverted ? -rawElevator : rawElevator;

      // Axis 3: Throttle Lever (Right Stick Y in Xbox mode: forward = -1.0 TOGA, backward = +1.0 Idle)
      if (axes.length > 3 && axes[3] !== undefined) {
        this.updateThrottleFromRaw(axes[3]);
      }

      // Axis 2: Rudder (Twist & Rocker paddle map to Right Stick X in Xbox mode)
      this.rudder = (axes.length > 2 && axes[2] !== undefined)
        ? applyDeadzone(axes[2], this.deadzoneRudder)
        : 0.0;
      this.activeRudderSource = 'xbox';
      this.axis4Floating = false;

      // Wheel Brakes: Main trigger is Right Trigger (RT / Button 7), fallback to Button 0 or Left Trigger (LT)
      const rtBtn = buttons[7];
      const ltBtn = buttons[6];
      const b0 = buttons[0];
      const primaryTrig = rtBtn ?? b0;
      let trigVal = 0.0;
      if (primaryTrig) {
        trigVal = primaryTrig.value !== undefined ? primaryTrig.value : (primaryTrig.pressed ? 1.0 : 0.0);
      }
      if (trigVal <= 0.05 && ltBtn) {
        trigVal = ltBtn.value !== undefined ? ltBtn.value : (ltBtn.pressed ? 1.0 : 0.0);
      }
      this.brakes = trigVal > 0.05 ? trigVal : 0.0;
    } else {
      this.elevator = 0.0;
      this.aileron = 0.0;
      this.rudder = 0.0;
      this.brakes = 0.0;
    }

    if (blocked) return;

    // --- 2. Aircraft Systems Buttons (Xbox layout) ---
    if (!aircraftDisabled) {
      // Button 0 (A): Toggle Spoilers / Speedbrakes
      if (this.wasJustPressed(buttons, 0)) {
        this.controls?.onToggleSpoilers?.();
      }

      // Button 1 (B): Toggle Landing Gear
      if (this.wasJustPressed(buttons, 1)) {
        this.controls?.onToggleGear?.();
      }

      // Button 2 (X): Parking Brake Toggle
      if (this.wasJustPressed(buttons, 2)) {
        this.controls?.setParkingBrake?.(!this.controls.parkingBrake);
      }

      // Button 3 (Y): Thrust Reverser Toggle
      if (this.wasJustPressed(buttons, 3)) {
        this.controls?.onToggleReverser?.();
      }

      // Button 4 (LB on throttle): Flaps Retract
      if (this.wasJustPressed(buttons, 4)) {
        this.controls?.onCycleFlaps?.(-1);
      }

      // Button 5 (RB on throttle): Flaps Extend
      if (this.wasJustPressed(buttons, 5)) {
        this.controls?.onCycleFlaps?.(1);
      }

      // Button 11 (RS click): Cycle Engine Failure Simulation
      if (this.wasJustPressed(buttons, 11)) {
        this.controls?.onCycleEngineFailure?.();
      }
    }

    // --- 3. View, Camera, Lighting & Utility Buttons ---
    // Button 8 (View / Back): Camera Mode Cycle
    if (this.wasJustPressed(buttons, 8)) {
      this.controls?.onCycleCamera?.();
    }

    // Button 9 (Menu / Start): Center View / Reset Look
    if (this.wasJustPressed(buttons, 9)) {
      if (this.controls?.onResetLook) {
        this.controls.onResetLook();
      } else if (this.controls?.onSelectCamera) {
        this.controls.onSelectCamera(0);
      }
    }

    // Button 10 (LS click): Toggle Aircraft Lights
    if (this.wasJustPressed(buttons, 10)) {
      this.controls?.onToggleLights?.();
    }

    // --- 4. POV / D-pad ---
    // Button 12: D-pad Up (Trim Nose Down)
    const hatUp = this.isButtonPressed(buttons, 12);
    // Button 13: D-pad Down (Trim Nose Up)
    const hatDown = this.isButtonPressed(buttons, 13);
    // Button 14: D-pad Left (Time cycle backward)
    const hatLeft = this.wasJustPressed(buttons, 14);
    // Button 15: D-pad Right (Time cycle forward)
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

    if (hatLeft) this.controls?.onCycleTimeOfDay?.(-1.5);
    if (hatRight) this.controls?.onCycleTimeOfDay?.(1.5);
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
      this.activeRudderSource = 'gamepad';
      this.axis4Floating = false;

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

  getDiagnostics() {
    const gp = this.findActiveGamepad();
    if (!gp) {
      return {
        connected: false,
        device: null,
        activeProfile: 'none',
        config: this.getConfig(),
        axes: [],
        buttons: [],
        outputs: {
          elevator: this.elevator,
          aileron: this.aileron,
          rudder: this.rudder,
          throttle: this.throttle,
          brakes: this.brakes,
        },
        activeRudderSource: this.activeRudderSource || 'twist',
        axis4Valid: false,
        axis4Floating: false,
        axesLayout: this.axesLayout,
        throttleAxis: this.throttleAxis,
        rudderAxis: this.rudderAxis,
      };
    }

    const type = identifyGamepadType(gp);
    const activeProfile = this.resolveProfile(gp);
    const axes = Array.from(gp.axes || []);
    const buttons = (gp.buttons || []).map((b, i) => ({
      index: i,
      pressed: Boolean(b && (b.pressed || b.value > 0.5)),
      value: b ? (b.value !== undefined ? b.value : (b.pressed ? 1.0 : 0.0)) : 0.0,
    }));

    return {
      connected: true,
      device: {
        index: gp.index,
        id: gp.id,
        mapping: gp.mapping || 'raw',
        type,
        name: this.formatDeviceName(gp.id, activeProfile),
      },
      activeProfile,
      config: this.getConfig(),
      axes,
      buttons,
      outputs: {
        elevator: this.elevator,
        aileron: this.aileron,
        rudder: this.rudder,
        throttle: this.throttle,
        brakes: this.brakes,
      },
      activeRudderSource: this.activeRudderSource || 'twist',
      axis4Valid: Boolean(this.axis4Valid),
      axis4Floating: Boolean(this.axis4Floating),
      axesLayout: this.axesLayout,
      throttleAxis: this.throttleAxis,
      rudderAxis: this.rudderAxis,
    };
  }
}
