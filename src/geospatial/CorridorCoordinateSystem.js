/**
 * CorridorCoordinateSystem.js
 *
 * Common coordinate, elevation standards, and route geometry for the 451.2km
 * Incheon (RKSI) ↔ Jeju (RKPC) flight corridor.
 *
 * Standards:
 * - Incheon ARP: Lat 37.4691°N, Lon 126.4506°E, Pavement Elevation 7.0m MSL
 * - Jeju ARP: Lat 33.5113°N, Lon 126.4930°E, Pavement Elevation 36.0m MSL
 * - Mean Sea Level (MSL): 0.0m across all marine waters (Yellow Sea, Dadohae, Korea Strait)
 * - Exact bidirectional projection using WGS84 ellipsoidal tangent plane transformations
 */

import koreaRoutes from '../config/koreaFlightRoutes.json' with { type: 'json' };
import {
  wgs84ToLocal,
  localToWgs84,
  wgs84ToTile,
  tileToWgs84,
  tileBoundsLocal,
  tilesForBbox,
} from './TileCoordinateSystem.js';

export const INCHEON_ORIGIN = Object.freeze({
  latitude: koreaRoutes.departure.latitude,
  longitude: koreaRoutes.departure.longitude,
  elevationM: koreaRoutes.departure.elevationM,
  icao: 'RKSI',
});

/**
 * Incheon 3D Scenery Patch Origin (INCHEON_PATCH.origin from src/geospatial/incheon.js).
 * The modeled airport airfield pavement, buildings, and ground mesh are centered at this origin.
 */
export const INCHEON_SCENERY_ORIGIN = Object.freeze({
  latitude: 37.448,
  longitude: 126.455,
  elevationM: 7.0,
});

export const JEJU_ORIGIN = Object.freeze({
  latitude: koreaRoutes.destination.latitude,
  longitude: koreaRoutes.destination.longitude,
  elevationM: koreaRoutes.destination.elevationM,
  icao: 'RKPC',
});

export const MEAN_SEA_LEVEL_M = 0.0;

export const CORRIDOR_WAYPOINTS = Object.freeze(koreaRoutes.route.map(w => Object.freeze({ ...w })));

/**
 * Great-circle distance between two WGS84 points in meters (Haversine formula).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in meters
 */
export function haversineDistanceM(lat1, lon1, lat2, lon2) {
  const R = 6371008.8; // Mean earth radius in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Convert Incheon local metric tangent plane [x, z] to WGS84.
 */
export function incheonLocalToWgs84(x, z) {
  return localToWgs84(x, z, INCHEON_ORIGIN);
}

/**
 * Convert WGS84 [latitude, longitude] to Incheon local metric tangent plane [x, z].
 */
export function wgs84ToIncheonLocal(latitude, longitude) {
  return wgs84ToLocal(latitude, longitude, INCHEON_ORIGIN);
}

/**
 * Convert WGS84 [latitude, longitude] to Incheon Scenery local tangent plane [x, z]
 * centered at INCHEON_SCENERY_ORIGIN (37.448, 126.455).
 */
export function wgs84ToIncheonSceneryLocal(latitude, longitude) {
  return wgs84ToLocal(latitude, longitude, INCHEON_SCENERY_ORIGIN);
}

/**
 * Convert Jeju local metric tangent plane [x, z] to WGS84.
 */
export function jejuLocalToWgs84(x, z) {
  return localToWgs84(x, z, JEJU_ORIGIN);
}

/**
 * Convert WGS84 [latitude, longitude] to Jeju local metric tangent plane [x, z].
 */
export function wgs84ToJejuLocal(latitude, longitude) {
  return wgs84ToLocal(latitude, longitude, JEJU_ORIGIN);
}

/**
 * Direct coordinate transformation from Incheon local plane to Jeju local plane.
 * @param {number} incheonX
 * @param {number} incheonZ
 * @returns {[number, number]} [jejuX, jejuZ]
 */
export function incheonToJejuLocal(incheonX, incheonZ) {
  const wgs = incheonLocalToWgs84(incheonX, incheonZ);
  return wgs84ToJejuLocal(wgs.latitude, wgs.longitude);
}

/**
 * Direct coordinate transformation from Jeju local plane to Incheon local plane.
 * @param {number} jejuX
 * @param {number} jejuZ
 * @returns {[number, number]} [incheonX, incheonZ]
 */
export function jejuToIncheonLocal(jejuX, jejuZ) {
  const wgs = jejuLocalToWgs84(jejuX, jejuZ);
  return wgs84ToIncheonLocal(wgs.latitude, wgs.longitude);
}

/**
 * Cumulative segment distances along the corridor in meters.
 * @type {number[]}
 */
const CUMULATIVE_DISTANCES = [0];
for (let i = 1; i < CORRIDOR_WAYPOINTS.length; i++) {
  const prev = CORRIDOR_WAYPOINTS[i - 1];
  const curr = CORRIDOR_WAYPOINTS[i];
  const segDist = haversineDistanceM(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
  CUMULATIVE_DISTANCES.push(CUMULATIVE_DISTANCES[i - 1] + segDist);
}

/**
 * Total route distance along waypoints in meters (~451,200m).
 */
export function getCorridorDistanceM() {
  return CUMULATIVE_DISTANCES[CUMULATIVE_DISTANCES.length - 1];
}

/**
 * Interpolate flight state along the corridor route at a given progress ratio [0, 1].
 * @param {number} progressRatio - 0.0 (RKSI) to 1.0 (RW07)
 * @returns {{ latitude: number, longitude: number, altitudeFt: number, altitudeM: number, headingDeg: number, segmentIndex: number }}
 */
export function interpolateRoute(progressRatio) {
  const clamped = Math.max(0, Math.min(1, progressRatio));
  const totalDist = getCorridorDistanceM();
  const targetDist = clamped * totalDist;

  let segIdx = 0;
  while (segIdx < CUMULATIVE_DISTANCES.length - 2 && CUMULATIVE_DISTANCES[segIdx + 1] < targetDist) {
    segIdx++;
  }

  const p0 = CORRIDOR_WAYPOINTS[segIdx];
  const p1 = CORRIDOR_WAYPOINTS[segIdx + 1];
  const segStartDist = CUMULATIVE_DISTANCES[segIdx];
  const segEndDist = CUMULATIVE_DISTANCES[segIdx + 1];
  const segLen = segEndDist - segStartDist;
  const segRatio = segLen > 0 ? (targetDist - segStartDist) / segLen : 0;

  const latitude = p0.latitude + (p1.latitude - p0.latitude) * segRatio;
  const longitude = p0.longitude + (p1.longitude - p0.longitude) * segRatio;
  const altitudeFt = p0.altitudeFt + (p1.altitudeFt - p0.altitudeFt) * segRatio;

  // Heading calculation
  const dLat = (p1.latitude - p0.latitude) * (Math.PI / 180);
  const dLon = (p1.longitude - p0.longitude) * (Math.PI / 180);
  const y = Math.sin(dLon) * Math.cos(p1.latitude * (Math.PI / 180));
  const x =
    Math.cos(p0.latitude * (Math.PI / 180)) * Math.sin(p1.latitude * (Math.PI / 180)) -
    Math.sin(p0.latitude * (Math.PI / 180)) * Math.cos(p1.latitude * (Math.PI / 180)) * Math.cos(dLon);
  const headingDeg = (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;

  return {
    latitude,
    longitude,
    altitudeFt,
    altitudeM: altitudeFt * 0.3048,
    headingDeg,
    segmentIndex: segIdx,
  };
}

/**
 * Project a WGS84 point onto the corridor polyline.
 * @param {number} latitude
 * @param {number} longitude
 * @returns {{ distanceAlongRouteM: number, crossTrackDistanceM: number, closestPoint: { latitude: number, longitude: number }, segmentIndex: number }}
 */
export function projectPointOnRoute(latitude, longitude) {
  let minDistance = Infinity;
  let bestAlongM = 0;
  let bestClosest = { latitude: CORRIDOR_WAYPOINTS[0].latitude, longitude: CORRIDOR_WAYPOINTS[0].longitude };
  let bestSegIdx = 0;

  for (let i = 0; i < CORRIDOR_WAYPOINTS.length - 1; i++) {
    const a = CORRIDOR_WAYPOINTS[i];
    const b = CORRIDOR_WAYPOINTS[i + 1];

    const segLen = haversineDistanceM(a.latitude, a.longitude, b.latitude, b.longitude);
    if (segLen <= 0) continue;

    const dLat = b.latitude - a.latitude;
    const dLon = b.longitude - a.longitude;
    const t = Math.max(0, Math.min(1,
      ((latitude - a.latitude) * dLat + (longitude - a.longitude) * dLon) / (dLat * dLat + dLon * dLon)
    ));

    const projLat = a.latitude + t * dLat;
    const projLon = a.longitude + t * dLon;
    const dist = haversineDistanceM(latitude, longitude, projLat, projLon);

    if (dist < minDistance) {
      minDistance = dist;
      bestAlongM = CUMULATIVE_DISTANCES[i] + t * segLen;
      bestClosest = { latitude: projLat, longitude: projLon };
      bestSegIdx = i;
    }
  }

  return {
    distanceAlongRouteM: bestAlongM,
    crossTrackDistanceM: minDistance,
    closestPoint: bestClosest,
    segmentIndex: bestSegIdx,
  };
}

/**
 * Bounding box for the corridor [westLon, southLat, eastLon, northLat].
 */
export function getCorridorBbox(paddingDeg = 0.5) {
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  for (const w of CORRIDOR_WAYPOINTS) {
    if (w.latitude < minLat) minLat = w.latitude;
    if (w.latitude > maxLat) maxLat = w.latitude;
    if (w.longitude < minLon) minLon = w.longitude;
    if (w.longitude > maxLon) maxLon = w.longitude;
  }

  return [
    minLon - paddingDeg,
    minLat - paddingDeg,
    maxLon + paddingDeg,
    maxLat + paddingDeg,
  ];
}
