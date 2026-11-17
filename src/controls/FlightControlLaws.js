export function applyDeadzone(value, deadzone = 0.04) {
  if (value === undefined || value === null || Number.isNaN(value)) return 0.0;
  if (Math.abs(value) <= deadzone) return 0.0;
  const sign = Math.sign(value);
  const scaled = (Math.abs(value) - deadzone) / (1.0 - deadzone);
  return sign * Math.min(1.0, Math.max(0.0, scaled));
}

/** Stateful, headless input shaping. No device polling, events or UI callbacks.
 * update(raw, dt, iasKnots, aircraftId) accepts normalized axes. Throttle is
 * absolute 0..1; throttleRate and pitchTrim are signed rate commands. Discrete
 * toggles/deltas are pulses supplied once by the caller. Output is a physics input object.
 * updateSources preserves source-specific arbitration for the browser adapter.
 */
export class FlightControlLaws {
  constructor(options = {}) {
    this.deadzoneStick = options.deadzoneStick ?? 0;
    this.deadzoneRudder = options.deadzoneRudder ?? 0;
    this.precisionCurve = options.precisionCurve ?? false;
    this.flapCount = options.flapCount ?? null;
    // Control Inputs (-1.0 to 1.0 or 0.0 to 1.0)
    this.elevator = 0.0;    // Pitch: stick back = positive (climb)
    this.aileron = 0.0;     // Roll: stick right = positive
    this.rudder = 0.0;      // Yaw: right pedal = positive
    this.throttle = 0.0;    // 0.0 to 1.0
    this.pitchTrim = 2.0;   // Degrees
    this.pitchTrimRate = 0.0;
    this.brakes = 0.0;      // 0.0 to 1.0
    this.parkingBrake = false;
    this.mouseControl = false;

    // Virtual inputs for AI agent / Autopilot / Test harness
    this.virtualElevator = null;
    this.virtualAileron = null;
    this.virtualRudder = null;
    this.virtualBrakes = null;

    // Mobile / Touchscreen on-screen inputs
    this.touchElevator = 0.0;
    this.touchAileron = 0.0;
    this.touchPitchReturning = false;
    this.touchRollReturning = false;
    this.keyboardPitchReturning = false;
    this.keyboardRollReturning = false;
    this.keyboardAircraftId = null;
    this.touchRudder = 0.0;
    this.touchBrakes = 0.0;

    this.hotasElevator = this.hotasAileron = this.hotasRudder = this.hotasBrakes = 0;
    this.keys = {};
    this.mouseX = this.mouseY = 0;
    this.aircraftControlsDisabled = false;
    this.flapsIndex = 0;
    this.spoilers = 0;
    this.gearHandleDown = true;
    this.reverserActive = false;
  }

  update(raw = {}, dt = 0, iasKnots = 140, aircraftId = 'B738') {
    const shape = value => {
      const axis = applyDeadzone(value ?? 0, this.deadzoneStick);
      return this.precisionCurve && (aircraftId === 'F16' || aircraftId === 'C172')
        ? 0.35 * axis + 0.65 * axis ** 3 : axis;
    };
    this.virtualElevator = shape(raw.pitch);
    this.virtualAileron = shape(raw.roll);
    this.virtualRudder = applyDeadzone(raw.yaw ?? 0, this.deadzoneRudder);
    this.virtualBrakes = raw.brakes ?? 0;
    if (raw.throttle !== undefined) this.throttle = Math.max(0, Math.min(1, raw.throttle));
    this.throttle = Math.max(0, Math.min(1, this.throttle + (raw.throttleRate ?? 0) * dt * 0.35));
    this.keys = {};
    this.flapsIndex = Math.max(0, Math.min((this.flapCount ?? ({ B738: 7, F16: 2, C172: 4 }[aircraftId] ?? 1)) - 1,
      this.flapsIndex + (raw.flapsDelta ?? 0)));
    if (raw.gearToggle) this.gearHandleDown = !this.gearHandleDown;
    if (raw.reverserToggle) this.reverserActive = !this.reverserActive;
    if (raw.spoilers !== undefined) this.spoilers = raw.spoilers;
    this.updateSources(dt, iasKnots, aircraftId);
    this.pitchTrimRate = raw.pitchTrim ?? 0;
    this.pitchTrim += this.pitchTrimRate * dt * 1.5;
    return { elevator: this.elevator, aileron: this.aileron, rudder: this.rudder,
      throttle: this.throttle, brakes: this.brakes, pitchTrim: this.pitchTrim,
      flapsIndex: this.flapsIndex, spoilers: this.spoilers,
      gearHandleDown: this.gearHandleDown, reverserActive: this.reverserActive };
  }

  updateSources(dt, iasKnots = 140, aircraftId = 'B738') {
    if (this.aircraftControlsDisabled) {
      // In autonomous demo mode, user inputs are disabled.
      // Slew control surfaces purely towards virtual commands.
      let targetElevator = this.virtualElevator !== null ? this.virtualElevator : 0.0;
      let targetAileron = this.virtualAileron !== null ? this.virtualAileron : 0.0;
      let targetRudder = this.virtualRudder !== null ? this.virtualRudder : 0.0;

      const stiffness = Math.max(0.40, 1.0 - Math.max(0, (iasKnots - 140) / 220.0) * 0.55);
      targetElevator *= stiffness;
      targetAileron *= stiffness;
      targetRudder *= stiffness;

      const maxElevatorRate = 0.55;
      const maxAileronRate = 0.85;
      const maxRudderRate = 0.60;

      const elevDelta = targetElevator - this.elevator;
      const aileronDelta = targetAileron - this.aileron;
      const rudderDelta = targetRudder - this.rudder;

      this.elevator += Math.sign(elevDelta) * Math.min(Math.abs(elevDelta), maxElevatorRate * dt);
      this.aileron += Math.sign(aileronDelta) * Math.min(Math.abs(aileronDelta), maxAileronRate * dt);
      this.rudder += Math.sign(rudderDelta) * Math.min(Math.abs(rudderDelta), maxRudderRate * dt);

      this.pitchTrimRate = 0.0;
      if (this.virtualBrakes !== null && this.virtualBrakes !== undefined) {
        this.brakes = this.virtualBrakes;
      } else if (this.parkingBrake) {
        this.brakes = 1.0;
      } else {
        this.brakes = 0.0;
      }
      return;
    }

    // 1. Throttle input (Equal increases, Minus decreases)
    if (this.keys['Equal']) {
      this.throttle = Math.min(1.0, this.throttle + dt * 0.35);
    }
    if (this.keys['Minus']) {
      this.throttle = Math.max(0.0, this.throttle - dt * 0.35);
    }

    // F16/C172 manual precision curve: soften the centre without reducing full travel.
    // HOTAS axes have already had their configurable deadzone applied. Touch/tilt
    // are shaped upstream; virtual controllers must retain their calibrated inputs.
    const precisionStick = value => 0.35 * value + 0.65 * value ** 3;
    const precisionHotas = aircraftId === 'F16' || aircraftId === 'C172';
    const keyboardReturnEnabled = precisionHotas || aircraftId === 'B738';
    const sameKeyboardAircraft = this.keyboardAircraftId === aircraftId;
    this.keyboardAircraftId = aircraftId;
    const hotasPitch = precisionHotas ? precisionStick(this.hotasElevator) : this.hotasElevator;
    const hotasRoll = precisionHotas ? precisionStick(this.hotasAileron) : this.hotasAileron;

    // 2. Pitch Control (W/S or Down/Up Arrow or Touch or HOTAS)
    // Positive elevator = pitch UP (pulling stick back / KeyS / ArrowDown / Touch Drag Down / HOTAS Stick Back)
    let targetElevator = this.virtualElevator !== null
      ? this.virtualElevator
      : (this.touchElevator + hotasPitch);
    if (this.keys['KeyS'] || this.keys['ArrowDown']) {
      targetElevator += 1.0; // Pitch UP
    }
    if (this.keys['KeyW'] || this.keys['ArrowUp']) {
      targetElevator -= 1.0; // Pitch DOWN
    }
    targetElevator = Math.max(-1.0, Math.min(1.0, targetElevator));

    // 3. Roll Control (A/D or Left/Right Arrow or Touch or HOTAS)
    let targetAileron = this.virtualAileron !== null
      ? this.virtualAileron
      : (this.touchAileron + hotasRoll);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) {
      targetAileron += 1.0; // Bank RIGHT
    }
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
      targetAileron -= 1.0; // Bank LEFT
    }
    targetAileron = Math.max(-1.0, Math.min(1.0, targetAileron));

    // Mouse flight override
    if (this.mouseControl) {
      targetElevator = Math.max(-1.0, Math.min(1.0, this.mouseY * 1.5));
      targetAileron = Math.max(-1.0, Math.min(1.0, this.mouseX * 1.5));
    }

    // 4. Yaw Rudder Control (Q/E or Touch or HOTAS)
    let targetRudder = this.virtualRudder !== null
      ? this.virtualRudder
      : (this.touchRudder + this.hotasRudder);
    if (this.keys['KeyE']) {
      targetRudder += 1.0; // Yaw RIGHT
    }
    if (this.keys['KeyQ']) {
      targetRudder -= 1.0; // Yaw LEFT
    }
    targetRudder = Math.max(-1.0, Math.min(1.0, targetRudder));

    // Dynamic pressure stiffness: At high airspeed, aerodynamic air resistance stiffens control columns
    const stiffness = Math.max(0.40, 1.0 - Math.max(0, (iasKnots - 140) / 220.0) * 0.55);
    targetElevator *= stiffness;
    targetAileron *= stiffness;
    targetRudder *= stiffness;

    // Heavy airliner actuator response & hydraulic control feel:
    // A 66-ton aircraft's control surfaces cannot snap instantaneously.
    // Realistic slew rate limits: Elevator ~0.55/s (2.0s for full travel), Aileron ~0.85/s, Rudder ~0.60/s
    const maxElevatorRate = 0.55; // units per second
    const maxAileronRate = 0.85;
    const maxRudderRate = 0.60;

    const elevDelta = targetElevator - this.elevator;
    const aileronDelta = targetAileron - this.aileron;
    const rudderDelta = targetRudder - this.rudder;

    // A released thumb stick must not keep commanding a turn for over a second.
    // Only speed up its return to neutral; keyboard/mouse/AI keep their own slew.
    if (targetElevator !== 0 || this.virtualElevator !== null || this.mouseControl ||
        this.keys['KeyS'] || this.keys['ArrowDown'] || this.keys['KeyW'] || this.keys['ArrowUp']) {
      this.touchPitchReturning = false;
    }
    if (targetAileron !== 0 || this.virtualAileron !== null || this.mouseControl ||
        this.keys['KeyD'] || this.keys['ArrowRight'] || this.keys['KeyA'] || this.keys['ArrowLeft']) {
      this.touchRollReturning = false;
    }
    const pitchKeyHeld = this.keys.KeyS || this.keys.ArrowDown || this.keys.KeyW || this.keys.ArrowUp;
    const rollKeyHeld = this.keys.KeyD || this.keys.ArrowRight || this.keys.KeyA || this.keys.ArrowLeft;
    this.keyboardPitchReturning = Boolean(keyboardReturnEnabled && (pitchKeyHeld ||
      (sameKeyboardAircraft && this.keyboardPitchReturning && targetElevator === 0 && this.elevator !== 0)));
    this.keyboardRollReturning = Boolean(keyboardReturnEnabled && (rollKeyHeld ||
      (sameKeyboardAircraft && this.keyboardRollReturning && targetAileron === 0 && this.aileron !== 0)));
    const keyboardPitchReturn = this.keyboardPitchReturning && !pitchKeyHeld &&
      targetElevator === 0 && this.virtualElevator === null && !this.mouseControl;
    const keyboardRollReturn = this.keyboardRollReturning && !rollKeyHeld &&
      targetAileron === 0 && this.virtualAileron === null && !this.mouseControl;
    const elevatorRate = this.touchPitchReturning || keyboardPitchReturn ? 4.0 : maxElevatorRate;
    const aileronRate = this.touchRollReturning || keyboardRollReturn ? 4.0 : maxAileronRate;
    this.elevator += Math.sign(elevDelta) * Math.min(Math.abs(elevDelta), elevatorRate * dt);
    this.aileron += Math.sign(aileronDelta) * Math.min(Math.abs(aileronDelta), aileronRate * dt);
    if (this.elevator === 0) this.touchPitchReturning = false;
    if (this.aileron === 0) this.touchRollReturning = false;
    this.rudder += Math.sign(rudderDelta) * Math.min(Math.abs(rudderDelta), maxRudderRate * dt);

    // 5. Pitch Trim (T = Trim nose down, Y = Trim nose up)
    this.pitchTrimRate = 0.0;
    if (this.keys['KeyY']) {
      this.pitchTrim += dt * 1.5;
      this.pitchTrimRate = 1.0;
    }
    if (this.keys['KeyT']) {
      this.pitchTrim -= dt * 1.5;
      this.pitchTrimRate = -1.0;
    }
    // Auto-release parking brake when pilot applies substantial forward throttle (> 25%)
    if (this.parkingBrake && this.throttle > 0.25) {
      this.parkingBrake = false;
    }

    // 6. Wheel Brakes (Spacebar, Virtual/Touch Brakes, HOTAS Trigger, or Parking Brake)
    if (this.keys['Space']) {
      this.brakes = 1.0;
    } else if (this.virtualBrakes !== null && this.virtualBrakes !== undefined) {
      this.brakes = this.virtualBrakes;
    } else if (this.touchBrakes > 0) {
      this.brakes = this.touchBrakes;
    } else if (this.hotasBrakes > 0) {
      this.brakes = this.hotasBrakes;
    } else if (this.parkingBrake) {
      this.brakes = 1.0;
    } else {
      this.brakes = 0.0;
    }
  }

}
