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
    // Scenario poses in the Jeju region frame, now owned by shared
    // declarative airport data and consumed by the common spawn planner.
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
  // Built-in scenario poses for RKSI, frozen from the retired incheonSpawn.
  // Positions with a finite Y are surface-relative; `y` is absolute MSL.
  RKSI: {
    ident: 'RKSI',
    elevationM: 7.0,
    // 16R/34L is indexed but not authored in IncheonFlightSurface; exposing it
    // would render pavement without matching contact height.
    hideRunways: ['346105'],
    // Surveyed 15R/33L and 15L/33R endpoints from incheonAirfield.json, kept
    // so common descriptors reproduce the legacy runway world positions.
    runways: [
      {
        ident: '15R/33L',
        widthM: 60.0,
        lengthM: 3750,
        ends: [
          {
            ident: '15R',
            physical: { latitude: 37.48176097002019, longitude: 126.43639076503925, elevationM: 7.0 },
            threshold: { latitude: 37.48176097002019, longitude: 126.43639076503925, elevationM: 7.0 },
            displacedThresholdM: 0,
          },
          {
            ident: '33L',
            physical: { latitude: 37.45427703801685, longitude: 126.46082463701009, elevationM: 7.0 },
            threshold: { latitude: 37.45427703801685, longitude: 126.46082463701009, elevationM: 7.0 },
            displacedThresholdM: 0,
          },
        ],
      },
      {
        ident: '15L/33R',
        widthM: 60.0,
        lengthM: 3750,
        ends: [
          {
            ident: '15L',
            physical: { latitude: 37.48392158616689, longitude: 126.44019363573169, elevationM: 7.0 },
            threshold: { latitude: 37.48392158616689, longitude: 126.44019363573169, elevationM: 7.0 },
            displacedThresholdM: 0,
          },
          {
            ident: '33R',
            physical: { latitude: 37.45638479357091, longitude: 126.4646985821534, elevationM: 7.0 },
            threshold: { latitude: 37.45638479357091, longitude: 126.4646985821534, elevationM: 7.0 },
            displacedThresholdM: 0,
          },
        ],
      },
    ],
    spawn: {
      poses: {
        runway: {
          position: [-1588.1188929124337, 7.0, -3665.574191913371],
          headingDeg: 144.68220519241027,
          speedMps: { B738: 0, C172: 0, F16: 0 },
        },
        approach: {
          position: [-2513.096606313494, 85.6116689245618, -4971.107121299431],
          headingDeg: 144.68220519241027,
          glideslopeDeg: 3.0,
          speedMps: { B738: 74.5, C172: 33, F16: 90 },
          pitchDeg: 2.291831,
        },
        cruise: {
          y: 750,
          position: [-1356.8744645621687, 750, -3339.1909595668562],
          headingDeg: 144.68220519241027,
          speedMps: { B738: 108, C172: 48, F16: 180 },
        },
        challenge: {
          position: [-5111.126218119344, 360.24278605672663, -8032.600569958097],
          headingDeg: 124.68220519241027,
          vy: -2.5,
          pitchDeg: 0.572958,
          speedMps: { B738: 85, C172: 42, F16: 105 },
        },
      },
    },
  },
  // Built-in scenario poses for VNLK, frozen from the dedicated Lukla branch.
  // The sloped 06/24 runway keeps its downhill 24 takeoff and 4.28° approach.
  VNLK: {
    ident: 'VNLK',
    elevationM: 2836.0,
    // Per-end elevations are kept so the common surface owns the 11.76% grade.
    runways: [
      {
        ident: '06/24',
        widthM: 30.0,
        lengthM: 527,
        // Coordinates are chosen so the common Incheon-framed projection maps
        // them back onto the surveyed 58° / 11.76% local runway geometry.
        ends: [
          {
            ident: '06',
            physical: {
              latitude: 27.684705043808055,
              longitude: 86.72742950102968,
              elevationM: 2805.0,
            },
            threshold: {
              latitude: 27.684705043808055,
              longitude: 86.72742950102968,
              elevationM: 2805.0,
            },
            displacedThresholdM: 0,
          },
          {
            ident: '24',
            physical: {
              latitude: 27.68896323482566,
              longitude: 86.731474387483,
              elevationM: 2867.0,
            },
            threshold: {
              latitude: 27.68896323482566,
              longitude: 86.731474387483,
              elevationM: 2867.0,
            },
            displacedThresholdM: 0,
          },
        ],
      },
    ],
    // Facilities remain in LuklaAirport until its dedicated visuals are retired;
    // the common region must not create duplicates during runway handoff.
    spawn: {
      poses: {
        runway: {
          position: [162.719765, 2858.941176, -107.574445],
          headingDeg: 238,
          pitchDeg: -6.71,
          speedMps: { B738: 0, C172: 0, F16: 0 },
          byAircraft: { F16: { position: [166.960005, 2859.529412, -110.22404] } },
        },
        cliff: {
          position: [166.960005, 2859.529412, -110.22404],
          headingDeg: 238,
          pitchDeg: -6.71,
          speedMps: { B738: 0, C172: 0, F16: 0 },
          byAircraft: {
            B738: { position: [162.719765, 2858.941176, -107.574445] },
            C172: { position: [162.719765, 2858.941176, -107.574445] },
          },
        },
        approach: {
          y: 3070,
          position: [-3222.5824, 3070, 2013.6922],
          headingDeg: 58,
          vy: -5.2,
          pitchDeg: 1,
          speedMps: { B738: 69.4, C172: 69.4, F16: 69.4 },
        },
        cruise: {
          y: 3960,
          position: [-1500, 3960, -800],
          headingDeg: 54,
          velocityHeadingDeg: 53.130102,
          speedMps: { B738: 100, C172: 53, F16: 100 },
        },
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
