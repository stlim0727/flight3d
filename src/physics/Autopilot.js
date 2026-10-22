import { approachDeviation } from '../config/approachData.js';

/** Smallest signed difference between two headings, in degrees [-180..180). */
export function wrapHeading(deltaDeg) {
  const wrapped = ((deltaDeg + 180) % 360 + 360) % 360 - 180;
  // A raw difference of exactly 180 keeps its sign.
  return wrapped === -180 && deltaDeg >= 180 ? 180 : wrapped;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Pure autopilot control laws (no THREE/DOM). Consumes the telemetry snapshot
 * and produces surface/throttle commands in FlightControls conventions:
 * elevator + = nose up, aileron + = right roll, throttle 0..1.
 *
 * Mode stack: lateral (HDG | APP), vertical (PITCH | ALT | VS | APP), speed (IAS).
 * Master gates everything; targets are captured from telemetry on engage.
 * When a trimSolver is injected (see TrimSolver.solveTrim), engage captures a
 * steady-state trim solution and the vertical/speed laws add it as a
 * feedforward term, so engagement is bumpless and holds no longer rely on the
 * proportional term fighting the steady stick force by itself. Without a
 * solver the laws behave exactly as the previous wings-leveler did.
 */
export class AutopilotController {
  constructor(options = {}) {
    this.master = false;
    this.lateralMode = null;   // 'HDG' | 'APP'
    this.verticalMode = null;  // 'PITCH' | 'ALT' | 'VS' | 'APP'
    this.speedMode = false;
    this.appArmed = false;

    this.targets = {
      headingDeg: 0,
      altitudeFt: 0,
      pitchDeg: 0,
      vsFpm: 0,
      iasKnots: 0,
    };

    // Steady-state feedforward captured on engage (trim elevator −1..1 and
    // throttle 0..1). Zero means "no trim known".
    this.trimSolver = options.trimSolver || null;
    this.trim = { elevator: 0, throttle: 0 };
    this._trimThrottlePending = false;

    this.maxBankDeg = 30;
    this.hdgDegPerDegError = 1.0;      // heading error -> bank target
    this.aileronPerDegBankError = 0.06;
    this.aileronBankDamping = 0.02;
    this.elevatorPerFtAlt = 0.0012;
    this.elevatorPerFpmDamp = 0.00012;
    this.elevatorPerDegPitch = 0.08;
    this.elevatorPerFpmVs = 0.00035;
    this.gsElevatorPerFt = 0.0015;
    this.gsElevatorPerFpmDamp = 0.00015;
    this.throttlePerKtPerSec = 0.15;
    this.appCaptureFt = 300;
    this.appMaxCrossTrackM = 1200;
    this.appMaxRangeM = 12000;
    this.pitchLimitsDeg = { min: -5, max: 20 };

    // Preallocated so 120 Hz substeps never allocate.
    this.output = { aileron: 0, elevator: 0, throttle: 0 };
  }

  /** @param {'MASTER'|'HDG'|'ALT'|'VS'|'SPD'|'APP'} mode */
  engage(mode, telemetry) {
    if (mode === 'MASTER') {
      if (this.master) {
        this.disengage();
        return;
      }
      this.master = true;
      this.capturePitch(telemetry);
      this.captureSpeed(telemetry);
      this.refreshTrim(telemetry);
      return;
    }
    if (!this.master) {
      this.master = true;
      this.capturePitch(telemetry);
      this.captureSpeed(telemetry);
    }
    let engagedSpeed = false;
    switch (mode) {
      case 'HDG':
        this.captureHeading(telemetry);
        this.lateralMode = 'HDG';
        break;
      case 'ALT':
        this.captureAltitude(telemetry);
        this.verticalMode = 'ALT';
        break;
      case 'VS':
        this.captureVS(telemetry);
        this.verticalMode = 'VS';
        break;
      case 'SPD':
        this.captureSpeed(telemetry);
        this.speedMode = true;
        engagedSpeed = true;
        break;
      case 'APP':
        this.evaluateAppCapture(telemetry);
        break;
    }
    this.refreshTrim(telemetry);
    if (engagedSpeed && this.trim.throttle > 0) this._trimThrottlePending = true;
  }

  disengage() {
    this.master = false;
    this.lateralMode = null;
    this.verticalMode = null;
    this.speedMode = false;
    this.appArmed = false;
    this.trim.elevator = 0;
    this.trim.throttle = 0;
    this._trimThrottlePending = false;
  }

  reset() {
    this.disengage();
  }

  /**
   * Toggle a mode off when it is already the active one, else engage it.
   * Used by the one-click HUD buttons.
   */
  toggle(mode, telemetry) {
    if (mode === 'MASTER') {
      this.engage('MASTER', telemetry);
      return this.master;
    }
    const isActive =
      (mode === 'HDG' && this.lateralMode === 'HDG') ||
      (mode === 'APP' && (this.lateralMode === 'APP' || this.appArmed)) ||
      (mode === 'ALT' && this.verticalMode === 'ALT') ||
      (mode === 'VS' && this.verticalMode === 'VS') ||
      (mode === 'SPD' && this.speedMode);
    if (isActive) {
      if (mode === 'HDG') this.lateralMode = null;
      if (mode === 'APP') {
        this.lateralMode = null;
        if (this.verticalMode === 'APP') this.verticalMode = 'PITCH';
        this.appArmed = false;
      }
      if (mode === 'ALT' || mode === 'VS') this.verticalMode = 'PITCH';
      if (mode === 'SPD') this.speedMode = false;
      return false;
    }
    this.engage(mode, telemetry);
    return true;
  }

  captureHeading(telemetry) { this.targets.headingDeg = telemetry.headingDeg; }
  captureAltitude(telemetry) { this.targets.altitudeFt = telemetry.altitudeFt; }
  capturePitch(telemetry) { this.targets.pitchDeg = telemetry.pitchDeg; }
  captureVS(telemetry) { this.targets.vsFpm = telemetry.vsiFpm; }
  captureSpeed(telemetry) { this.targets.iasKnots = telemetry.iasKnots; }

  /** Desired steady flight-path angle of the active vertical mode, degrees. */
  flightPathAngleDeg(telemetry, vsOverrideFpm) {
    const vsFpm = vsOverrideFpm !== undefined ? vsOverrideFpm
      : (this.verticalMode === 'VS' ? this.targets.vsFpm : 0);
    const tasMs = Math.max(1, (telemetry.tasKnots || 0) * 0.514444);
    return Math.atan2(vsFpm / 60.0, tasMs) * 180 / Math.PI;
  }

  /**
   * Capture the steady-state trim solution for the current targets. Called on
   * engage/target changes only — never per substep — so the injected solver may
   * allocate. Falls back to zero feedforward when no solver or no solution.
   */
  refreshTrim(telemetry, vsOverrideFpm) {
    this.trim.elevator = 0;
    this.trim.throttle = 0;
    if (!this.trimSolver) return;
    const solution = this.trimSolver(telemetry, this.flightPathAngleDeg(telemetry, vsOverrideFpm));
    if (!solution || !solution.feasible) return;
    if (Number.isFinite(solution.elevator)) this.trim.elevator = solution.elevator;
    if (Number.isFinite(solution.throttle)) this.trim.throttle = solution.throttle;
  }

  /**
   * APP becomes active only when established near the approach course;
   * otherwise it arms and captures automatically in update().
   * @returns {boolean} true when APP is active
   */
  evaluateAppCapture(telemetry) {
    const dev = approachDeviation(telemetry.airportKey, telemetry);
    if (dev && this.appWithinCapture(dev)) {
      this.lateralMode = 'APP';
      this.verticalMode = 'APP';
      this.appArmed = false;
      this.master = true;
      this.refreshTrim(telemetry, dev.referenceSinkFpm);
      return true;
    }
    this.appArmed = true;
    this.master = true;
    return false;
  }

  appWithinCapture(dev) {
    return dev.distanceToThresholdM > 0 &&
      dev.distanceToThresholdM < this.appMaxRangeM &&
      Math.abs(dev.crossTrackM) < this.appMaxCrossTrackM &&
      Math.abs(dev.glideslopeErrorFt) < this.appCaptureFt;
  }

  /**
   * @param {object} telemetry sim snapshot (headingDeg, rollDeg, pitchDeg,
   *   altitudeFt, vsiFpm, iasKnots, throttle, x, z, altitude, airportKey)
   * @param {number} dt seconds
   * @returns {{aileron:number, elevator:number, throttle:number}} zero axes when
   *   master is off; throttle passes through unless speed mode is active.
   */
  update(telemetry, dt) {
    const out = this.output;
    out.aileron = 0;
    out.elevator = 0;
    out.throttle = telemetry.throttle ?? 0;
    if (!this.master) return out;

    if (this.appArmed) this.evaluateAppCapture(telemetry);

    if (this.lateralMode === 'APP') {
      const dev = approachDeviation(telemetry.airportKey, telemetry);
      if (!dev || dev.distanceToThresholdM <= 0) {
        this.lateralMode = null;
      } else {
        // Right of the localizer course (crossTrackM > 0) demands left bank,
        // so the cross-track correction subtracts from the course error.
        const headingError = wrapHeading(dev.courseDeg - telemetry.headingDeg) -
          clamp(dev.crossTrackM * 0.05, -25, 25);
        out.aileron = this.bankCommand(headingError, telemetry.rollDeg);
      }
    } else if (this.lateralMode === 'HDG') {
      out.aileron = this.bankCommand(
        wrapHeading(this.targets.headingDeg - telemetry.headingDeg), telemetry.rollDeg);
    }

    if (this.verticalMode === 'APP') {
      const dev = approachDeviation(telemetry.airportKey, telemetry);
      if (!dev || dev.distanceToThresholdM <= 0) {
        this.verticalMode = 'PITCH';
      } else {
        // Damping acts on sink excess vs the glideslope reference so that
        // tracking the path exactly (at the captured trim) is the steady state.
        out.elevator = clamp(
          this.trim.elevator -
          dev.glideslopeErrorFt * this.gsElevatorPerFt -
          (telemetry.vsiFpm - dev.referenceSinkFpm) * this.gsElevatorPerFpmDamp, -1, 1);
      }
    } else if (this.verticalMode === 'ALT') {
      const altErrFt = this.targets.altitudeFt - telemetry.altitudeFt;
      out.elevator = clamp(
        this.trim.elevator +
        altErrFt * this.elevatorPerFtAlt -
        telemetry.vsiFpm * this.elevatorPerFpmDamp, -1, 1);
    } else if (this.verticalMode === 'VS') {
      const vsErrFpm = this.targets.vsFpm - telemetry.vsiFpm;
      out.elevator = clamp(
        this.trim.elevator + vsErrFpm * this.elevatorPerFpmVs, -1, 1);
    } else {
      // PITCH hold (also the master-only fallback): hold captured pitch.
      out.elevator = clamp(
        this.trim.elevator +
        (this.targets.pitchDeg - telemetry.pitchDeg) * this.elevatorPerDegPitch, -1, 1);
    }

    if (this.speedMode) {
      if (this._trimThrottlePending) {
        // Bumpless SPD capture: jump to the solved trim thrust once, then
        // integrate speed error around it.
        out.throttle = clamp(this.trim.throttle, 0, 1);
        this._trimThrottlePending = false;
      } else {
        out.throttle = clamp(
          out.throttle + (this.targets.iasKnots - telemetry.iasKnots) *
            this.throttlePerKtPerSec * dt, 0, 1);
      }
    }
    return out;
  }

  /** Turn toward the heading error at up to maxBankDeg, then roll out. */
  bankCommand(headingErrorDeg, rollDeg) {
    const bankTargetDeg = clamp(
      headingErrorDeg * this.hdgDegPerDegError,
      -this.maxBankDeg, this.maxBankDeg);
    if (Math.abs(headingErrorDeg) < 0.5 && Math.abs(rollDeg) < 1) return 0;
    // Damping on bank angle (aileron -> 30 deg of bank) removes the ~1 s lag
    // of the aileron response and prevents roll-out overshoot.
    const bankTerm = clamp(headingErrorDeg * this.hdgDegPerDegError,
      -this.maxBankDeg, this.maxBankDeg) * this.aileronPerDegBankError;
    return clamp(bankTerm - rollDeg * this.aileronBankDamping, -1, 1);
  }

  /** Compact mode annunciation for HUD/MCP, e.g. "HDG ALT SPD" or "APP armed". */
  annunciation() {
    if (!this.master) return '';
    const modes = [];
    if (this.appArmed) modes.push('APP armed');
    if (this.lateralMode === 'APP' && this.verticalMode === 'APP') {
      modes.push('APP');
    } else {
      if (this.lateralMode) modes.push(this.lateralMode);
      if (this.verticalMode) modes.push(this.verticalMode);
    }
    if (this.speedMode) modes.push('SPD');
    return modes.join(' ');
  }
}
