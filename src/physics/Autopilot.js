import { AutopilotController as CoreAutopilot } from '@stlim0727/flightsim-core/physics/Autopilot.js';
import { approachDeviation } from '../config/approachData.js';
import { CorridorFlightPlanManager } from '../geospatial/CorridorFlightPlan.js';
import { wrapHeading, autopilotState } from '@stlim0727/flightsim-core/physics/Autopilot.js';

export { wrapHeading, autopilotState };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Supply Flight3d's airport navigation and corridor LNAV/VNAV to the controller. */
export class AutopilotController extends CoreAutopilot {
  constructor(options = {}) {
    super({ approachDeviation, ...options });
    this.flightPlan = new CorridorFlightPlanManager(1);
  }

  reset() {
    super.reset();
    if (this.flightPlan) {
      this.flightPlan.reset(1);
    }
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
        this.trim.elevator +
        altErrFt * this.elevatorPerFtAlt -
        telemetry.vsiFpm * this.elevatorPerFpmDamp,
        -1, 1
      );
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
