/**
 * src/config/airportOverrides.js
 *
 * Declarative airport override & enhancement data registry.
 * Provides precision elevations, runway adjustments, interactive lighting (PAPI, ALS),
 * taxiways/aprons, and facility layouts (control towers, terminals) for airports where
 * raw OurAirports index data needs augmentation.
 */

export const AIRPORT_OVERRIDES = {
  RKPC: {
    ident: 'RKPC',
    elevationM: 36.0,
    runways: [
      {
        ident: '07/25',
        widthM: 45.0,
        lengthM: 3180,
        // Legacy RKPC survey used by the Jeju preset. Index coordinates place
        // runway 07 about 800 m away and 8° off, so keep the validated local
        // geometry as a declarative correction for both render and physics.
        ends: [
          {
            ident: '07',
            physical: { latitude: 33.505697338000054, longitude: 126.47724821520636, elevationM: 36.0 },
            threshold: { latitude: 33.505697338000054, longitude: 126.47724821520636, elevationM: 36.0 },
            displacedThresholdM: 0,
          },
          {
            ident: '25',
            physical: { latitude: 33.516900653878146, longitude: 126.50875381490887, elevationM: 36.0 },
            threshold: { latitude: 33.516900653878146, longitude: 126.50875381490887, elevationM: 36.0 },
            displacedThresholdM: 0,
          },
        ],
        lighting: {
          papi: [
            {
              endIdent: '07',
              side: 'left',
              touchdownDistanceM: 350,
              lateralOffsetM: 22,
              glideslopeDeg: 3.0,
              units: 4,
            },
            {
              endIdent: '25',
              side: 'left',
              touchdownDistanceM: 350,
              lateralOffsetM: 22,
              glideslopeDeg: 3.0,
              units: 4,
            },
          ],
          approachLighting: [
            {
              endIdent: '07',
              type: 'MALSR',
              lengthM: 750,
              strobes: 15,
              crossbars: [
                { distanceM: 150, widthM: 16, lights: 5 },
                { distanceM: 300, widthM: 24, lights: 9 },
              ],
            },
          ],
        },
      },
      {
        ident: '13/31',
        widthM: 45.0,
        lengthM: 1910.5,
        lighting: {
          papi: [
            {
              endIdent: '13',
              side: 'left',
              touchdownDistanceM: 300,
              lateralOffsetM: 20,
              glideslopeDeg: 3.0,
              units: 4,
            },
          ],
        },
      },
    ],
    taxiways: [
      {
        id: 'twy-main-parallel',
        name: 'Parallel Taxiway P',
        widthM: 23,
        surface: 'ASP',
        points: [
          [-1400, 480],
          [1400, -760],
        ],
      },
      {
        id: 'twy-apron-connector-1',
        name: 'Connector A1',
        widthM: 23,
        surface: 'ASP',
        points: [
          [0, -100],
          [50, 150],
          [100, 240],
        ],
      },
    ],
    facilities: [
      {
        id: 'tower',
        name: 'Jeju Air Traffic Control Tower',
        kind: 'tower',
        position: [-80, 36.0, 260],
        height: 49.0,
        radius: 12.0,
        cabHeight: 8.0,
        cabRadius: 11.0,
        shaftRadius: 8.0,
        collision: {
          type: 'cylinder',
          radius: 12.0,
          maxAltitudeM: 91.0, // 36.0 + 55m
        },
      },
      {
        id: 'terminal',
        name: 'Jeju International Passenger Terminal',
        kind: 'terminal',
        position: [150, 36.0, 320],
        size: [450, 22, 120],
        collision: {
          type: 'box',
          halfX: 230,
          halfZ: 65,
          maxAltitudeM: 61.0, // 36.0 + 25m
        },
      },
    ],
    lighting: {
      apronLamps: [
        { x: 50, y: 36.0, z: 240, height: 20, target: [50, 39.0, 180] },
        { x: 250, y: 36.0, z: 240, height: 20, target: [250, 39.0, 180] },
      ],
    },
    // Scenario poses in the Jeju region frame (same numbers the legacy
    // JejuFlightSurface used, now owned by shared declarative airport data).
    spawn: {
      runwayId: '07/25',
      endId: '07',
      frame: {
        threshold: { x: -1463.6, z: 621.3 },
        end: { x: 1463.6, z: -621.3 },
        elevationM: 36.0,
        headingDeg: 67,
      },
      takeoffDistanceM: 100,
      approachDistanceM: 5556,
      glideslopeDeg: 3.0,
      cruise: {
        x: 3741.4, z: 7500, y: 3048, headingDeg: 180,
        speedMps: { B738: 108, C172: 48, F16: 180 },
      },
      challenge: {
        x: -18300, z: -65000, y: 2400, headingDeg: 180, vy: -2.8,
        speedMps: { B738: 110, C172: 45, F16: 160 },
      },
    },
  },
};

const finiteOverride = Number.isFinite;

/**
 * Merge declarative precision corrections into an indexed airport record.
 * Both the map planner and the streamed surface consume this record so
 * rendering and contact geometry cannot diverge.
 */
export function applyAirportOverrides(airport) {
  if (!airport || !Array.isArray(airport.runways)) return airport;
  const code = airport.ident ?? airport.icao ?? airport.code;
  const overrides = getAirportOverride(code);
  if (!overrides) return airport;
  return {
    ...airport,
    elevationM: finiteOverride(overrides.elevationM) ? overrides.elevationM : airport.elevationM,
    runways: airport.runways.map(runway => {
      const endIdents = (runway.ends ?? []).map(end => String(end?.ident));
      const runwayOverride = overrides.runways?.find(entry =>
        String(entry.ident ?? '').split('/').some(ident => endIdents.includes(ident)));
      if (!runwayOverride) return runway;
      return {
        ...runway,
        widthM: finiteOverride(runwayOverride.widthM) ? runwayOverride.widthM : runway.widthM,
        lengthM: finiteOverride(runwayOverride.lengthM) ? runwayOverride.lengthM : runway.lengthM,
        ends: (runway.ends ?? []).map(end => {
          const corrected = runwayOverride.ends?.find(entry => entry.ident === end?.ident);
          return corrected ? { ...end, ...corrected } : end;
        }),
      };
    }),
  };
}

/**
 * Retrieve override config for a given airport code.
 * @param {string} code - 4-letter ICAO or identifier (e.g. 'RKPC')
 * @returns {object|null}
 */
export function getAirportOverride(code) {
  if (typeof code !== 'string') return null;
  const key = code.trim().toUpperCase();
  return AIRPORT_OVERRIDES[key] ?? null;
}
