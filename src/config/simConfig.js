/**
 * @file simConfig.js
 * @description Global simulation constants, physics substepping settings, world dimensions, and airport coordinates.
 */

export const SIM_CONFIG = {
  // Physics Timing & Integration
  physics: {
    targetHz: 120,                  // 120Hz substepping
    get fixedDt() { return 1 / this.targetHz; },
    maxFrameDelta: 0.1,
    gravityMs2: 9.80665,
    groundClampMarginM: 0.1
  },

  // World & Terrain Parameters
  world: {
    terrainSizeM: 20000,            // 20 km x 20 km
    terrainSegments: 256,
    oceanSizeM: 24000,
    waterLevelY: 0.0,
    cloudsAltitudeM: 1800,
    initialTimeOfDayHours: 16.8     // 16:48 (Golden hour)
  },

  // Airport Runway 09L/27R Parameters
  airport: {
    icao: 'RKSS',
    elevationM: 12.0,
    runwayLengthM: 3200,
    runwayWidthM: 60,
    runwayCenter: { x: 0.0, y: 12.0, z: 0.0 },
    runwayHeadingDeg: 90.0,         // East-West (090°)
    touchdownZoneWestM: { x: -1200, y: 12.0, z: 0 },
    touchdownZoneEastM: { x: 1200, y: 12.0, z: 0 },
    alsLengthM: 900,
    papiSlopeDeg: 3.0
  },

  // Navigation Waypoints for ND Display
  waypoints: [
    { name: 'RW09L', x: -1500, z: 0, altFt: 50 },
    { name: 'APPR1', x: -6500, z: 0, altFt: 1050 },
    { name: 'MERIT', x: -12000, z: 2500, altFt: 3000 },
    { name: 'COAST', x: 2500, z: 6000, altFt: 2500 },
    { name: 'ISLND', x: -4000, z: -8000, altFt: 4000 }
  ]
};
