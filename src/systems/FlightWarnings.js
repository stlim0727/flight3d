import { FlightWarningsCore } from './FlightWarningsCore.js';
export { PROFILES, terrainConflictSeconds } from './FlightWarningsCore.js';

/** Compatibility adapter for existing HUD/audio consumers. */
export class FlightWarnings extends FlightWarningsCore {
  update(dt, telemetry, terrainAheadSeconds = Infinity) {
    return super.update(dt, telemetry, terrainAheadSeconds).activeWarnings;
  }
}
