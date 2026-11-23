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
  },
};

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
