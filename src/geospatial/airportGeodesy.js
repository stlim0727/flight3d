import { APPROACH_DATA } from '../config/approachData.js';
import luklaGrid from '../config/luklaTerrainGrid.json' with { type: 'json' };
import { INCHEON_PATCH, projectToLocal } from './incheon.js';
import { JEJU_ORIGIN, jejuLocalToWgs84, incheonSceneryLocalToWgs84 } from './CorridorCoordinateSystem.js';
import { localToWgs84 } from './TileCoordinateSystem.js';

/** Offset of a real airport's origin in the Incheon scenery frame, if it has one. */
export function realOffsetInIncheonFrame(id) {
  const origin = AIRPORT_ORIGINS[id];
  return origin ? projectToLocal(origin.latitude, origin.longitude) : null;
}

/**
 * WGS84 reference points for airports that have real-world coordinates.
 * Coastal International, Neon Metropolis and the generated valley are
 * fictional arenas authored at the origin; they have no geodesy.
 */
export const REAL_AIRPORTS = Object.freeze(['incheon', 'jeju', 'lukla']);

export const AIRPORT_ORIGINS = Object.freeze({
  incheon: Object.freeze(INCHEON_PATCH.origin),
  jeju: Object.freeze({ latitude: JEJU_ORIGIN.latitude, longitude: JEJU_ORIGIN.longitude }),
  lukla: Object.freeze(luklaGrid.origin),
});

function thresholdAt(id) {
  const t = APPROACH_DATA[id]?.threshold;
  if (!t) return null;
  if (id === 'incheon') return incheonSceneryLocalToWgs84(t.x, t.z);
  if (id === 'jeju') return jejuLocalToWgs84(t.x, t.z);
  if (id === 'lukla') return localToWgs84(t.x, t.z, AIRPORT_ORIGINS.lukla);
  return null;
}

export const RUNWAY_THRESHOLDS = Object.freeze({
  incheon: Object.freeze(thresholdAt('incheon')),
  jeju: Object.freeze(thresholdAt('jeju')),
  lukla: Object.freeze(thresholdAt('lukla')),
});

/** Latitude/longitude of a world-frame position when the anchor is a real airport. */
export function worldPositionToWgs84(anchor, x, z) {
  const origin = AIRPORT_ORIGINS[anchor];
  return origin ? localToWgs84(x, z, origin) : null;
}
