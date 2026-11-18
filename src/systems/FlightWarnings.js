import { FlightWarningsCore } from './FlightWarningsCore.js';
export { PROFILES, terrainConflictSeconds } from './FlightWarningsCore.js';

/** Compatibility adapter for existing HUD/audio consumers. */
export class FlightWarnings extends FlightWarningsCore {
  update(dt, telemetry, terrainAheadSeconds = Infinity) {
    // Keep near-limit hysteresis and clear recovered B738 overspeed immediately.
    if (this.id === 'B738' && Number.isFinite(dt) && dt > 0
        && telemetry.iasKnots <= this.profile.vne - 5
        && telemetry.mach <= this.profile.mach - 0.01) {
      this.active.delete('overspeed');
    }
    return super.update(dt, telemetry, terrainAheadSeconds).activeWarnings;
  }
}
