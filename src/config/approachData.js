import { approachDeviation as calculateDeviation } from '@stlim0727/flightsim-core/navigation/approachDeviation.js';
import incheon from './incheonAirfield.json' with { type: 'json' };
import { getAirportOverride } from './airportOverrides.js';
/**
 * Final-approach geometry per airport, derived from the flight presets in
 * src/main.js (threshold world position, runway heading, glideslope angle,
 * threshold elevation). Units: meters for world XZ, degrees, feet.
 *
 * World frame matches the sim: heading = atan2(f.x, -f.z), so north is -Z.
 * For a course of headingDeg, the unit course vector is (sin, -cos) in (x, z)
 * and "right of course" is (cos, sin).
 */
export const APPROACH_DATA = {
  incheon: incheon.approach,
  // RKPC approach geometry is owned by the declarative airport registry.
  jeju: (() => {
    const spawn = getAirportOverride('RKPC')?.spawn;
    return {
      threshold: { x: spawn.frame.threshold.x, z: spawn.frame.threshold.z },
      end: spawn.frame.end,
      gsAngleDeg: spawn.glideslopeDeg,
      elevationFt: Math.round(spawn.frame.elevationM * 3.28084),
    };
  })(),
  neon: {
    // Neon Metropolis Runway 09, aligned with +X towards the setting retro sun.
    threshold: { x: -2000, z: 0 },
    headingDeg: 90,
    gsAngleDeg: 3.0,
    elevationFt: 0,
  },
  lukla: {
    // Lukla Runway 06 (Tenzing-Hillary), 11.7% uphill runway; approach slope 4.28°.
    threshold: { x: -223.5, z: 139.6 },
    headingDeg: 58,
    gsAngleDeg: 4.28,
    elevationFt: 9203,
  },
  coastal: {
    // Coastal International Runway 09L, runway aligned with +X.
    threshold: { x: -1350, z: 0 },
    headingDeg: 90,
    gsAngleDeg: 3.0,
    elevationFt: 39,
  },
};

export function approachDeviation(airportKey, pos) {
  return calculateDeviation(APPROACH_DATA[airportKey], pos);
}
