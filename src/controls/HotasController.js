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
    this.axesLayout = options.axesLayout || 'auto'; // 'auto' (detect roles at rest), 'thrustmaster' (Rudder 2, Throttle 3), 'legacy' (Throttle 2, Rudder 3)
    this.throttleInverted = options.throttleInverted ?? false; // standard: forward = 1.0 (TOGA), backward = 0.0 (Idle)
    this.pitchInverted = options.pitchInverted ?? false;
    this.rudderMode = options.rudderMode || 'auto'; // 'auto', 'twist', 'pedals'
    this.deadzoneStick = options.deadzoneStick ?? 0.04;
    this.deadzoneRudder = options.deadzoneRudder ?? 0.05;
    this.throttleDeltaThreshold = 0.005;
    this.throttleAxis = 3;
    this.rudderAxis = 2;
    this.customMapping = options.customMapping || null;

    // Internal state tracking
    this.lastRawThrottle = null;
    this.prevButtons = [];
    this.activeGamepadIndex = -1;
    this.connectedDevice = null;
    this.lastActiveTime = 0;
    // Set by the Joystick Check Dialog: map live axis values into the outputs
    // for its meters while suppressing every write that would reach the aircraft.
    this.diagnosticActive = false;
    this.resetAdaptationState();

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
    if (cfg.customMapping !== undefined) {
      this.customMapping = cfg.customMapping;
    }
  }

  getConfig() {
    return {
      profileOverride: this.profileOverride,
      axesLayout: this.axesLayout,
      customMapping: this.customMapping,
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
        || (gamepad.id || '').toLowerCase().includes('xinput')
        // Windows XInput hides the Thrustmaster vendor/product ids. A PC-mode
        // Hotas One always reports >= 5 raw axes; XInput serves 4 standard axes.
        || (gamepad.mapping === 'standard' && (gamepad.axes || []).length <= 4);
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
    if (!this.connectedDevice
      || this.connectedDevice.index !== gamepad.index
      || this.connectedDevice.id !== gamepad.id) {
      this.resetAdaptationState();
    }
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
    this.resetAdaptationState();
  }

  // Clear per-device learned state (axis validity latch, auto-detected axis roles).
  resetAdaptationState() {
    this.axis4Valid = false;
    this.axis4CenterFrames = 0;
    this.axis4ExtremeFrames = 0;
    this.hasSecondaryRudderControl = false;
    this.lastRawAxis4 = null;
    this.axis4Floating = false;
    this.activeRudderSource = 'twist';
    this.lastReportTimestamp = null;
    this.axisRoleProbe = null;
  }

  // Chrome can serve several animation frames of one hardware report (and an
  // all-zero synthesized array right after connect). Only count frames that
  // carry a new report so rest-detection budgets cannot be burned by stale data.
  newGamepadReport(gp) {
    if (gp.timestamp === undefined) return true;
    if (gp.timestamp === this.lastReportTimestamp) return false;
    this.lastReportTimestamp = gp.timestamp;
    return true;
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

    if (this.customMapping) {
      this.updateCustomMappingProfile(gp, axes, buttons, dt);
    } else if (activeProfile === 'hotas-one-xbox') {
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

  /**
   * Read 8-way POV hat switch direction from D-pad buttons (12-15),
   * raw HID encoded 8-way hat axis (axes[9] on DirectInput/IOHIDManager),
   * or dual-axis hat (axes[5], axes[6] on Linux evdev).
   * @returns {{ dirX: number, dirY: number }}
   */
  readHatSwitch(gp, axes = [], buttons = []) {
    const hatUp = this.isButtonPressed(buttons, 12);
    const hatDown = this.isButtonPressed(buttons, 13);
    const hatLeft = this.isButtonPressed(buttons, 14);
    const hatRight = this.isButtonPressed(buttons, 15);

    let dirX = (hatRight ? 1 : 0) - (hatLeft ? 1 : 0);
    let dirY = (hatDown ? 1 : 0) - (hatUp ? 1 : 0);
    if (dirX !== 0 || dirY !== 0) {
      return { dirX, dirY };
    }

    if (gp?.mapping === 'standard') {
      return { dirX: 0, dirY: 0 };
    }

    // DirectInput / macOS raw HID 8-way POV hat encoded on axes[9]:
    // k = 0..7 -> value = (2 * k - 7) / 7; centered > 1.05 (e.g. 9/7 = 1.286 or 3.286) or 0.0
    if (axes.length > 9 && Number.isFinite(axes[9])) {
      const rawHat = axes[9];
      if (Math.abs(rawHat) > 0.08 && rawHat <= 1.05) {
        const k = Math.round(((rawHat + 1) * 7) / 2);
        const expected = (2 * k - 7) / 7;
        if (k >= 0 && k <= 7 && Math.abs(rawHat - expected) <= 0.08) {
          const hatDirs = [
            { dirX: 0, dirY: -1 },  // 0: N (Up)
            { dirX: 1, dirY: -1 },  // 1: NE (Up-Right)
            { dirX: 1, dirY: 0 },   // 2: E (Right)
            { dirX: 1, dirY: 1 },   // 3: SE (Down-Right)
            { dirX: 0, dirY: 1 },   // 4: S (Down)
            { dirX: -1, dirY: 1 },  // 5: SW (Down-Left)
            { dirX: -1, dirY: 0 },  // 6: W (Left)
            { dirX: -1, dirY: -1 }, // 7: NW (Up-Left)
          ];
          return hatDirs[k];
        }
      }
    }

    // Linux evdev dual-axis POV hat (ABS_HAT0X on axes[5], ABS_HAT0Y on axes[6])
    if (axes.length >= 7 && axes.length <= 8) {
      const hx = Number.isFinite(axes[5]) && Math.abs(axes[5]) > 0.5 ? Math.sign(axes[5]) : 0;
      const hy = Number.isFinite(axes[6]) && Math.abs(axes[6]) > 0.5 ? Math.sign(axes[6]) : 0;
      if (hx !== 0 || hy !== 0) {
        return { dirX: hx, dirY: hy };
      }
    }

    return { dirX: 0, dirY: 0 };
  }

  updateThrottleFromRaw(rawThrottle, applyToControls = true) {
    let normalized = this.throttleInverted
      ? (rawThrottle + 1.0) * 0.5
      : (1.0 - rawThrottle) * 0.5;
    normalized = Math.max(0.0, Math.min(1.0, normalized));

    if (this.lastRawThrottle === null) {
      // Initial sync
      this.lastRawThrottle = rawThrottle;
      this.throttle = normalized;
      this.hasThrottleControl = true;
      if (applyToControls && this.controls) this.controls.throttle = normalized;
    } else if (Math.abs(rawThrottle - this.lastRawThrottle) > this.throttleDeltaThreshold) {
      // Pilot physically adjusted lever
      this.lastRawThrottle = rawThrottle;
      this.throttle = normalized;
      this.hasThrottleControl = true;
      if (applyToControls && this.controls) this.controls.throttle = normalized;
    }
  }

  // Observe candidate axes 2 and 3 and assign roles from physical behavior:
  // the twist handle is spring-centered (rests at 0 and returns after release),
  // the throttle lever parks where it is left (often pegged near a rail at idle).
  // Returns { twist, throttle, decided }; while undecided, the candidate axis
  // nearer center is provisionally treated as the twist.
  detectAxisRoles(gp, axes, freshReport) {
    if (!this.axisRoleProbe || this.axisRoleProbe.deviceId !== gp.id) {
      this.axisRoleProbe = { deviceId: gp.id, frames: 0, obs: {} };
      for (const idx of [2, 3]) {
        this.axisRoleProbe.obs[idx] = {
          min: axes[idx] ?? 0,
          max: axes[idx] ?? 0,
          centerFrames: 0,
          extremeFrames: 0,
          stayFrames: 0,
          returnedToCenter: false,
          lastValue: axes[idx] ?? 0,
        };
      }
    }
    const probe = this.axisRoleProbe;
    if (freshReport) {
      probe.frames += 1;
      for (const idx of [2, 3]) {
        const o = probe.obs[idx];
        const v = axes[idx] ?? 0.0;
        o.min = Math.min(o.min, v);
        o.max = Math.max(o.max, v);
        if (Math.abs(v) <= 0.15) o.centerFrames += 1;
        if (Math.abs(v) > 0.35) o.extremeFrames += 1;
        if (Math.abs(v - o.lastValue) > 0.04) {
          o.stayFrames = 0;
        } else if (Math.abs(v) > 0.15) {
          o.stayFrames += 1;
        }
        if ((o.max > 0.4 || o.min < -0.4) && Math.abs(v) <= 0.15) o.returnedToCenter = true;
        o.lastValue = v;
      }
    }

    const a = probe.obs[2];
    const b = probe.obs[3];
    const centeredAlways = (o) => probe.frames >= 2 && o.centerFrames === probe.frames;
    const parkedAtRail = (o) => probe.frames >= 2 && o.extremeFrames === probe.frames;
    // One axis has sat at a rail since connect while the other never left center.
    if (parkedAtRail(a) && centeredAlways(b)) return { twist: 3, throttle: 2, decided: true };
    if (parkedAtRail(b) && centeredAlways(a)) return { twist: 2, throttle: 3, decided: true };
    // One axis moved and stayed put while the other showed a release-to-center.
    if (a.stayFrames >= 45 && b.returnedToCenter) return { twist: 3, throttle: 2, decided: true };
    if (b.stayFrames >= 45 && a.returnedToCenter) return { twist: 2, throttle: 3, decided: true };
    if (probe.frames >= 120) {
      // Settle timeout: whichever axis has spent more time near center is the twist.
      const aScore = a.centerFrames + (a.returnedToCenter ? 60 : 0);
      const bScore = b.centerFrames + (b.returnedToCenter ? 60 : 0);
      return aScore >= bScore
        ? { twist: 2, throttle: 3, decided: true }
        : { twist: 3, throttle: 2, decided: true };
    }
    // Undecided: provisionally treat the axis nearer center as the twist so
    // even the first frames map a rail-parked idle lever to the throttle.
    const aAbs = Math.abs(a.lastValue);
    const bAbs = Math.abs(b.lastValue);
    return aAbs <= bAbs
      ? { twist: 2, throttle: 3, decided: false }
      : { twist: 3, throttle: 2, decided: false };
  }

  updateHotasProfile(gp, axes, buttons, dt) {
    const blocked = this.controls?.inputBlocked === true;
    const aircraftDisabled = this.controls?.aircraftControlsDisabled === true;
    const live = !blocked && !aircraftDisabled;

    // --- 1. Flight Control Axes ---
    if (live || this.diagnosticActive) {
      // Axis 0: Roll (Aileron) - left negative, right positive
      this.aileron = applyDeadzone(axes[0] ?? 0.0, this.deadzoneStick);

      // Axis 1: Pitch (Elevator) - forward negative (dive/down), back positive (climb/up)
      const rawElevator = applyDeadzone(axes[1] ?? 0.0, this.deadzoneStick);
      this.elevator = this.pitchInverted ? -rawElevator : rawElevator;

      // Determine axes assignment based on layout
      const freshReport = this.newGamepadReport(gp);
      let twistAxisIdx;
      let throttleAxisIdx;

      if (axes.length <= 3) {
        twistAxisIdx = -1;
        throttleAxisIdx = 2;
      } else if (this.axesLayout === 'legacy') {
        twistAxisIdx = 3;
        throttleAxisIdx = 2;
      } else if (this.axesLayout === 'thrustmaster') {
        twistAxisIdx = 2;
        throttleAxisIdx = 3;
      } else {
        // 'auto': Thrustmaster units disagree on which of axes 2/3 is the
        // spring-centered twist handle versus the parkable lever (model and
        // 4/5-axis switch mode), so learn the roles from observed behavior.
        const roles = this.detectAxisRoles(gp, axes, freshReport);
        twistAxisIdx = roles.twist;
        throttleAxisIdx = roles.throttle;
      }
      this.throttleAxis = throttleAxisIdx;
      this.rudderAxis = twistAxisIdx;

      // Throttle Lever
      if (throttleAxisIdx >= 0 && axes.length > throttleAxisIdx && axes[throttleAxisIdx] !== undefined) {
        this.updateThrottleFromRaw(axes[throttleAxisIdx], live && !this.diagnosticActive);
      }

      // Primary Rudder: spring-centered stick twist handle at the resolved twist axis
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
            if (freshReport) this.axis4CenterFrames += 1;
            if (this.axis4CenterFrames >= 2) {
              // Spring-centered control confirmed at rest; this also re-arms
              // axis 4 when pedals are plugged back in after a floating pin.
              this.axis4Valid = true;
              this.axis4ExtremeFrames = 0;
            }
          } else if (isExtreme) {
            if (this.axis4Valid) {
              if (freshReport) this.axis4ExtremeFrames += 1;
              if (this.axis4ExtremeFrames >= 45) {
                // A confirmed-connected pedal was unplugged while the stick stayed
                // connected: the ADC pin floats back to the rail. A real full pedal
                // press is transient; a sustained rail means the control is gone.
                this.axis4Valid = false;
                this.axis4CenterFrames = 0;
                this.axis4ExtremeFrames = 0;
                axis4Floating = true;
              }
            } else {
              this.axis4CenterFrames = 0;
              axis4Floating = true;
            }
          } else {
            this.axis4ExtremeFrames = 0;
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

    if (blocked || this.diagnosticActive) return;

    // --- 2. Aircraft Systems & View Buttons ---
    this.updateHotasButtons(gp, axes, buttons, dt, aircraftDisabled);
  }

  updateCustomMappingProfile(gp, axes, buttons, dt) {
    const blocked = this.controls?.inputBlocked === true;
    const aircraftDisabled = this.controls?.aircraftControlsDisabled === true;
    const live = !blocked && !aircraftDisabled;
    const m = this.customMapping;

    if (live || this.diagnosticActive) {
      // 1. Roll (Aileron)
      if (m.rollAxis >= 0 && axes.length > m.rollAxis && axes[m.rollAxis] !== undefined) {
        const rawRoll = applyDeadzone(axes[m.rollAxis], this.deadzoneStick);
        this.aileron = m.rollInverted ? -rawRoll : rawRoll;
      }

      // 2. Pitch (Elevator)
      if (m.pitchAxis >= 0 && axes.length > m.pitchAxis && axes[m.pitchAxis] !== undefined) {
        const rawPitch = applyDeadzone(axes[m.pitchAxis], this.deadzoneStick);
        const inv = Boolean(m.pitchInverted) !== Boolean(this.pitchInverted);
        this.elevator = inv ? -rawPitch : rawPitch;
      }

      // 3. Throttle Lever (Calibrated from idleVal to maxVal)
      if (m.throttleAxis >= 0 && axes.length > m.throttleAxis && axes[m.throttleAxis] !== undefined) {
        this.throttleAxis = m.throttleAxis;
        const raw = axes[m.throttleAxis];
        const idle = typeof m.throttleIdleVal === 'number' ? m.throttleIdleVal : 1.0;
        const max = typeof m.throttleMaxVal === 'number' ? m.throttleMaxVal : -1.0;
        let normalized;
        if (Math.abs(max - idle) > 0.05) {
          normalized = (raw - idle) / (max - idle);
        } else {
          normalized = (1.0 - raw) * 0.5;
        }
        if (m.throttleInverted || this.throttleInverted) {
          normalized = 1.0 - normalized;
        }
        normalized = Math.max(0.0, Math.min(1.0, normalized));

        if (this.lastRawThrottle === null) {
          this.lastRawThrottle = raw;
          this.throttle = normalized;
          this.hasThrottleControl = true;
          if (live && !this.diagnosticActive && this.controls) this.controls.throttle = normalized;
        } else if (Math.abs(raw - this.lastRawThrottle) > this.throttleDeltaThreshold) {
          this.lastRawThrottle = raw;
          this.throttle = normalized;
          this.hasThrottleControl = true;
          if (live && !this.diagnosticActive && this.controls) this.controls.throttle = normalized;
        }
      }

      // 4. Rudder
      if (m.rudderAxis >= 0 && axes.length > m.rudderAxis && axes[m.rudderAxis] !== undefined) {
        this.rudderAxis = m.rudderAxis;
        const rawRudder = applyDeadzone(axes[m.rudderAxis], this.deadzoneRudder);
        this.rudder = m.rudderInverted ? -rawRudder : rawRudder;
        this.activeRudderSource = 'custom';
      }

      // 5. Wheel Brakes
      let brakeVal = 0.0;
      if (m.brakesButton >= 0 && buttons[m.brakesButton]) {
        const btn = buttons[m.brakesButton];
        brakeVal = btn.value !== undefined ? btn.value : (btn.pressed ? 1.0 : 0.0);
      } else if (m.brakesAxis >= 0 && axes.length > m.brakesAxis && axes[m.brakesAxis] !== undefined) {
        brakeVal = Math.max(0.0, axes[m.brakesAxis]);
      }
      this.brakes = brakeVal > 0.05 ? brakeVal : 0.0;
    } else {
      this.elevator = 0.0;
      this.aileron = 0.0;
      this.rudder = 0.0;
      this.brakes = 0.0;
    }

    if (blocked || this.diagnosticActive) return;

    this.updateHotasButtons(gp, axes, buttons, dt, aircraftDisabled);
  }

  updateHotasButtons(gp, axes, buttons, dt, aircraftDisabled) {
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

    // --- 4. POV / Hat Switch (Quick Glance) ---
    // Buttons 12-15 or raw HID Hat axes (axes[9] encoded 8-way or axes[5..6] dual hat)
    const { dirX: hatDirX, dirY: hatDirY } = this.readHatSwitch(gp, axes, buttons);
    if (hatDirX !== 0 || hatDirY !== 0) {
      this.controls?.onHatLook?.(hatDirX, hatDirY, dt);
    }
  }

  updateHotasXboxProfile(gp, axes, buttons, dt) {
    const blocked = this.controls?.inputBlocked === true;
    const aircraftDisabled = this.controls?.aircraftControlsDisabled === true;
    const live = !blocked && !aircraftDisabled;

    // --- 1. Flight Control Axes (Xbox / XInput Mode) ---
    if (live || this.diagnosticActive) {
      // Axis 0: Roll (Aileron) - left negative, right positive
      this.aileron = applyDeadzone(axes[0] ?? 0.0, this.deadzoneStick);

      // Axis 1: Pitch (Elevator) - forward negative (dive/down), back positive (climb/up)
      const rawElevator = applyDeadzone(axes[1] ?? 0.0, this.deadzoneStick);
      this.elevator = this.pitchInverted ? -rawElevator : rawElevator;

      // Axis 3: Throttle Lever (Right Stick Y in Xbox mode: forward = -1.0 TOGA, backward = +1.0 Idle)
      if (axes.length > 3 && axes[3] !== undefined) {
        this.updateThrottleFromRaw(axes[3], live && !this.diagnosticActive);
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

    if (blocked || this.diagnosticActive) return;

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

    // --- 4. POV / D-pad (Quick Glance) ---
    const { dirX: hatDirX, dirY: hatDirY } = this.readHatSwitch(gp, axes, buttons);
    if (hatDirX !== 0 || hatDirY !== 0) {
      this.controls?.onHatLook?.(hatDirX, hatDirY, dt);
    }
  }

  updateStandardGamepadProfile(gp, axes, buttons, dt) {
    const blocked = this.controls?.inputBlocked === true;
    const aircraftDisabled = this.controls?.aircraftControlsDisabled === true;
    const live = !blocked && !aircraftDisabled;

    if (live || this.diagnosticActive) {
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
      if (live && !this.diagnosticActive && axes.length > 3 && axes[3] !== undefined) {
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

    if (blocked || this.diagnosticActive) return;

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

    // D-pad (Quick Glance)
    const { dirX: dDirX, dirY: dDirY } = this.readHatSwitch(gp, axes, buttons);
    if (dDirX !== 0 || dDirY !== 0) {
      this.controls?.onHatLook?.(dDirX, dDirY, dt);
    }
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
        customMapping: this.customMapping,
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
      activeRudderSource: this.customMapping ? 'custom' : (this.activeRudderSource || 'twist'),
      axis4Valid: Boolean(this.axis4Valid),
      axis4Floating: Boolean(this.axis4Floating),
      axesLayout: this.axesLayout,
      customMapping: this.customMapping,
      throttleAxis: this.throttleAxis,
      rudderAxis: this.rudderAxis,
    };
  }
}
