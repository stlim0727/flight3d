import {
  CHUJA_EMERGENCY_STRIP,
  JEJU_ORIGIN,
  wgs84ToJejuLocal,
} from '../geospatial/CorridorCoordinateSystem.js';

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
});
