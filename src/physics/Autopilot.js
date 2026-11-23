import { AutopilotController as CoreAutopilot } from '@stlim0727/flightsim-core/physics/Autopilot.js';
import { approachDeviation } from '../config/approachData.js';
import { CorridorFlightPlanManager } from '../geospatial/CorridorFlightPlan.js';
import { wrapHeading, autopilotState } from '@stlim0727/flightsim-core/physics/Autopilot.js';
import { Atmosphere } from './Atmosphere.js';
import { solveTrim } from './TrimSolver.js';
import { TRIM_WHEEL_AUTHORITY } from './trimWheel.js';

export { wrapHeading, autopilotState };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

const MAX_ELEVATOR_RAD = Math.PI / 9; // ±20° surface travel, as in the trim solver.

const REFERENCE_ELEVATOR_KTS = 220; // gains were tuned near this approach speed.

/**
 * Elevator authority is proportional to dynamic pressure. Fixed gains tuned at
 * ~220 kt become five times too strong at 450 kt, exciting a short-period
 * oscillation. Scale only the error-correction terms, never the solved trim
 * feedforward, so the loop damping stays roughly constant across the envelope.
 */
export function elevatorGainScale(telemetry, referenceKts = REFERENCE_ELEVATOR_KTS) {
  const tasKts = Number.isFinite(telemetry.tasKnots) ? telemetry.tasKnots : telemetry.iasKnots;
  if (!Number.isFinite(tasKts) || tasKts <= 0) return 1;
  const altitudeM = Math.max(0, Atmosphere.feetToMeters(telemetry.altitudeFt ?? 0));
  const density = Atmosphere.getConditions(altitudeM).density;
  const speed = Atmosphere.knotsToMs(Math.max(1, tasKts));
  const qDyn = 0.5 * density * speed * speed;
  const referenceSpeed = Atmosphere.knotsToMs(Math.max(1, referenceKts));
  const referenceQ = 0.5 * Atmosphere.getConditions(0).density * referenceSpeed * referenceSpeed;
  return clamp(referenceQ / Math.max(referenceQ, qDyn), 0.25, 1);
}

/**
 * solveTrim returns the total tail deflection needed for equilibrium, while
 * the autopilot's elevator feedforward is applied on top of the installed
 * pitch trim. Subtract the trim already trimmed in, so the two do not count
 * the same tail force twice and bias altitude hold.
 */
export function elevatorFeedforwardRelativeToTrim(aero, solution) {
  if (!solution || !solution.feasible || !Number.isFinite(solution.elevator)) return solution;
  const trimRad = (aero.pitchTrim ?? 0) * Math.PI / 180 * TRIM_WHEEL_AUTHORITY;
  const surfaceRange = MAX_ELEVATOR_RAD * (aero.tuning?.elevatorSensitivity ?? 1);
  return { ...solution, elevator: clamp(solution.elevator - trimRad / surfaceRange, -1, 1) };
}

/** Production autopilot: Flight3d trim solution plus airport/corridor guidance. */
export function createSimulatorAutopilot(sim) {
  return new AutopilotController({
    trimSolver: (telemetry, flightPathAngleDeg) => {
      const solution = solveTrim(sim.aero, sim.engines, {
        iasKnots: telemetry.iasKnots,
        altitudeMeters: Atmosphere.feetToMeters(telemetry.altitudeFt),
        flightPathAngleDeg,
        flapsIndex: sim.aero.flapsIndex,
        gearState: sim.telemetry.gearState,
        spoilers: sim.aero.spoilers,
      });
      return elevatorFeedforwardRelativeToTrim(sim.aero, solution);
    },
  });
}

/** Supply Flight3d's airport navigation and corridor LNAV/VNAV to the controller. */
export class AutopilotController extends CoreAutopilot {
  constructor(options = {}) {
    super({ approachDeviation, ...options });
    this.flightPlan = new CorridorFlightPlanManager(1);
    // Altitude hold needs a slow integral as well: the captured trim solution
    // goes stale after a speed or configuration change, and proportional
    // elevator alone then settles with a steady altitude error.
    this.altKi = 1e-5;             // elevator per foot-second
    this.altIntegralLimit = 30000; // foot-seconds, bounded anti-windup
    this._altIntegral = 0;
    this._altIntegralActive = false;
    // Autothrottle: solved thrust feedforward + gentle PI correction. The
    // core's 0.15/s pure integrator saturates at the throttle stops and pumps
    // the phugoid; a bounded integral trims residual error without hunting.
    this.speedKp = 0.03;            // throttle per knot of IAS error
    this.speedKi = 0.02;            // throttle per knot-second
    this.speedIntegralLimit = 60;   // knot-seconds, caps integral authority
    this._speedIntegral = 0;
    this._speedIntegralActive = false;
  }

  reset() {
    super.reset();
    if (this.flightPlan) {
      this.flightPlan.reset(1);
    }
  }

  disengage() {
    super.disengage();
    this._speedIntegral = 0;
    this._altIntegral = 0;
    this._speedIntegralActive = false;
    this._altIntegralActive = false;
  }

  engage(mode, telemetry) {
    if (mode === 'LNAV') {
      telemetry = autopilotState(telemetry, this._snapshot);
      if (!this.master) {
        this.master = true;
        this.capturePitch(telemetry);
        this.captureSpeed(telemetry);
      }
      this.lateralMode = 'LNAV';
      this.refreshTrim(telemetry);
      return;
    }
    if (mode === 'VNAV') {
      telemetry = autopilotState(telemetry, this._snapshot);
      if (!this.master) {
        this.master = true;
        this.capturePitch(telemetry);
        this.captureSpeed(telemetry);
      }
      this.verticalMode = 'VNAV';
      this.refreshTrim(telemetry);
      return;
    }
    if (mode === 'ALT') {
      this._altIntegral = 0;
      this._altIntegralActive = true;
    }
    if (mode === 'SPD') {
      this._speedIntegral = 0;
      this._speedIntegralActive = true;
    }
    super.engage(mode, telemetry);
  }

  toggle(mode, telemetry) {
    if (mode === 'LNAV') {
      if (this.lateralMode === 'LNAV') {
        this.lateralMode = null;
        return false;
      }
      this.engage('LNAV', telemetry);
      return true;
    }
    if (mode === 'VNAV') {
      if (this.verticalMode === 'VNAV') {
        this.verticalMode = 'PITCH';
        return false;
      }
      this.engage('VNAV', telemetry);
      return true;
    }
    return super.toggle(mode, telemetry);
  }

  update(telemetry, dt) {
    const out = super.update(telemetry, dt);
    if (!this.master) return out;

    telemetry = autopilotState(telemetry, this._snapshot);

    // PITCH/VS/APP come from the core law. Scale their correction around the
    // solved trim; ALT/VNAV below recompute with the same scaled gains.
    const elevatorGain = elevatorGainScale(telemetry);
    out.elevator = this.trim.elevator + (out.elevator - this.trim.elevator) * elevatorGain;

    // Handle LNAV lateral guidance
    if (this.lateralMode === 'LNAV') {
      const airport = telemetry.airportKey === 'incheon' ? 'incheon' : 'jeju';
      const leg = this.flightPlan.updateLocal(telemetry.x ?? 0, telemetry.z ?? 0, airport);
      const crossTrackCorrectionDeg = clamp(leg.crossTrackM * 0.05, -30, 30);
      const headingError = wrapHeading(leg.desiredTrackDeg - telemetry.headingDeg) - crossTrackCorrectionDeg;
      out.aileron = this.bankCommand(headingError, telemetry.rollDeg);
    }

    // Handle VNAV vertical guidance
    if (this.verticalMode === 'VNAV') {
      const airport = telemetry.airportKey === 'incheon' ? 'incheon' : 'jeju';
      const leg = this.flightPlan.updateLocal(telemetry.x ?? 0, telemetry.z ?? 0, airport);
      const targetAltFt = leg.activeWaypoint.altitudeFt;
      const altErrFt = targetAltFt - telemetry.altitudeFt;
      out.elevator = clamp(
        this.trim.elevator + (altErrFt * this.elevatorPerFtAlt -
          telemetry.vsiFpm * this.elevatorPerFpmDamp) * elevatorGain,
        -1, 1
      );
    }

    // ALT: the proportional law cannot zero a steady error once the captured
    // trim goes stale (speed/flap/thrust changes). A slow bounded integral on
    // altitude error removes that offset without affecting capture dynamics.
    if (this.verticalMode === 'ALT') {
      if (!this._altIntegralActive) {
        this._altIntegral = 0;
        this._altIntegralActive = true;
      }
      const error = this.targets.altitudeFt - telemetry.altitudeFt;
      const command = this.trim.elevator + (error * this.elevatorPerFtAlt -
        telemetry.vsiFpm * this.elevatorPerFpmDamp + this._altIntegral * this.altKi) * elevatorGain;
      out.elevator = clamp(command, -1, 1);
      if (!((out.elevator >= 1 && error > 0) || (out.elevator <= -1 && error < 0))) {
        this._altIntegral = clamp(
          this._altIntegral + error * dt, -this.altIntegralLimit, this.altIntegralLimit);
      }
    } else {
      this._altIntegral = 0;
      this._altIntegralActive = false;
    }

    // Autothrottle: thrust feedforward from the captured trim solution plus a
    // bounded PI correction. Conditional integration stops windup at the
    // throttle stops; the core's raw integrator is too fast for engine spool
    // dynamics and drives a throttle/airspeed limit cycle.
    if (!this.speedMode) {
      this._speedIntegral = 0;
      this._speedIntegralActive = false;
    } else if (Number.isFinite(telemetry.iasKnots)) {
      if (!this._speedIntegralActive) {
        this._speedIntegral = 0;
        this._speedIntegralActive = true;
      }
      const error = this.targets.iasKnots - telemetry.iasKnots;
      const command = this.trim.throttle + error * this.speedKp + this._speedIntegral * this.speedKi;
      out.throttle = clamp(command, 0, 1);
      if (!((out.throttle >= 1 && error > 0) || (out.throttle <= 0 && error < 0))) {
        this._speedIntegral = clamp(
          this._speedIntegral + error * dt, -this.speedIntegralLimit, this.speedIntegralLimit);
      }
    }
    return out;
  }

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
