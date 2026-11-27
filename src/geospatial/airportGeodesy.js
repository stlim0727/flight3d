import { APPROACH_DATA } from '../config/approachData.js';
import luklaGrid from '../config/luklaTerrainGrid.json' with { type: 'json' };
import { INCHEON_PATCH, projectToLocal } from './incheon.js';
import { JEJU_ORIGIN, jejuLocalToWgs84, incheonSceneryLocalToWgs84 } from './CorridorCoordinateSystem.js';
import { PATAGONIA_ORIGIN } from './patagonia.js';
import { localToWgs84 } from './TileCoordinateSystem.js';

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
  patagonia: Object.freeze({ latitude: PATAGONIA_ORIGIN.lat, longitude: PATAGONIA_ORIGIN.lon }),
});

const INCHEON_PLANE_ANCHORS = new Set(REAL_AIRPORTS);

/** Offset of a shared-Incheon-frame real airport's origin, if it has one. */
export function realOffsetInIncheonFrame(id) {
  if (!INCHEON_PLANE_ANCHORS.has(id)) return null;
  const origin = AIRPORT_ORIGINS[id];
  return origin ? projectToLocal(origin.latitude, origin.longitude) : null;
}

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

/**
 * Latitude/longitude of a world-frame position when the anchor has real geodesy.
 * Shared-Incheon-plane anchors (Incheon, Jeju, Lukla) live on the Incheon tangent
 * plane, so anchor-local (x, z) is rebased by the anchor's offset in that plane
 * before inversion. Isolated real anchors (such as Patagonia) invert their own
 * local tangent-plane origin directly. Fictional anchors have no WGS84 frame and
 * report null.
 */
export function worldPositionToWgs84(anchor, x, z, customOrigin = null) {
  if (customOrigin && Number.isFinite(customOrigin.latitude) && Number.isFinite(customOrigin.longitude)) {
    return localToWgs84(x, z, customOrigin);
  }
  const offset = realOffsetInIncheonFrame(anchor);
  if (offset) return localToWgs84(x + offset[0], z + offset[1], AIRPORT_ORIGINS.incheon);
  const origin = AIRPORT_ORIGINS[anchor];
  return origin ? localToWgs84(x, z, origin) : null;
}
