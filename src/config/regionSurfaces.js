import {
  CHUJA_EMERGENCY_STRIP,
  JEJU_ORIGIN,
  wgs84ToJejuLocal,
} from '../geospatial/CorridorCoordinateSystem.js';
import luklaGrid from './luklaTerrainGrid.json' with { type: 'json' };

const [chujaX, chujaZ] = wgs84ToJejuLocal(
  CHUJA_EMERGENCY_STRIP.center.latitude,
  CHUJA_EMERGENCY_STRIP.center.longitude,
);

/** Anchor-surface data for regions rendered by the common open-world engine. */
export const REGION_SURFACES = Object.freeze({
  jeju: Object.freeze({
    origin: JEJU_ORIGIN,
    elevationM: 36.0,
    precinctExtent: Object.freeze([-3200, -1500, 3200, 1500]),
    strips: Object.freeze([
      Object.freeze({
        center: Object.freeze([chujaX, chujaZ]),
        headingDeg: CHUJA_EMERGENCY_STRIP.headingDeg,
        lengthM: CHUJA_EMERGENCY_STRIP.lengthM,
        widthM: CHUJA_EMERGENCY_STRIP.widthM,
        elevationM: CHUJA_EMERGENCY_STRIP.elevationM,
      }),
    ]),
  }),
  lukla: Object.freeze({
    origin: Object.freeze(luklaGrid.origin),
    size: luklaGrid.worldSize,
    gridSize: luklaGrid.gridSize,
    segments: 255,
    demUrl: 'terrain/lukla_dem.bin',
    imageryUrl: 'terrain/lukla_satellite.jpg',
    runway: Object.freeze({
      headingDeg: 58,
      lengthM: 527,
      widthM: 30,
      gradient: 0.1176,
      threshold06ElevationM: 2805,
      threshold24ElevationM: 2867,
      midElevationM: 2836,
    }),
    grading: Object.freeze({
      runwayFadeM: 50,
      widthFadeM: 30,
      apronS: Object.freeze([-15, 135]),
      apronW: Object.freeze([15, 85]),
      apronFadeM: 20,
      apronMinElevationM: 2844,
    }),
    terrace: Object.freeze({
      lengthM: 800,
      widthM: 300,
      segmentsX: 80,
      segmentsZ: 30,
      depressionM: 0.5,
      coarseDepressionM: 10,
    }),
    contact: Object.freeze({
      apron: Object.freeze({
        s: Object.freeze([15, 105]),
        w: Object.freeze([12, 52]),
        safetyS: Object.freeze([10, 110]),
        safetyW: Object.freeze([8, 58]),
      }),
      departureCorridor: Object.freeze({
        s: Object.freeze([-400, -265]),
        halfWidthM: 30,
        safetyHalfWidthM: 35,
      }),
    }),
  }),
  patagonia: Object.freeze({
    origin: Object.freeze({ lat: -49.271278, lon: -73.043222 }),
    elevationM: 2492,
    size: 44000,
    gridSize: 1025,
    segments: 255,
    demUrl: 'terrain/patagonia/patagonia_dem.bin',
    imageryUrl: 'terrain/patagonia/patagonia_satellite.jpg',
    runway: Object.freeze({ headingDeg: 215, lengthM: 0, widthM: 0, gradient: 0,
      threshold06ElevationM: 2492, threshold24ElevationM: 2492, midElevationM: 2492 }),
    grading: Object.freeze({ runwayFadeM: 0, widthFadeM: 0 }),
    terrace: Object.freeze({ lengthM: 0, widthM: 0, segmentsX: 2, segmentsZ: 2,
      depressionM: 0, coarseDepressionM: 0 }),
  }),
});
