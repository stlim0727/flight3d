/**
 * CorridorFlightPlan.js
 *
 * Navigational flight plan management, active waypoint sequencing, cross-track error,
 * and display projections for the Incheon (RKSI) ↔ Jeju (RKPC) flight corridor.
 */

import {
  CORRIDOR_WAYPOINTS,
  haversineDistanceM,
  wgs84ToIncheonLocal,
  wgs84ToIncheonSceneryLocal,
  wgs84ToJejuLocal,
  jejuLocalToWgs84,
  incheonLocalToWgs84,
  incheonSceneryLocalToWgs84,
} from './CorridorCoordinateSystem.js';

const M_TO_NM = 1 / 1852;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Recommended IAS speed profile along the corridor in knots. */
const WAYPOINT_SPEEDS = {
  RKSI: 160,
  BOPTA: 250,
  OLMEN: 280,
  SOSDO: 300,
  DOTOL: 280,
  CHUJA: 240,
  TAMNA: 210,
  RW07: 140,
};

/**
 * Pre-projected corridor waypoints with both WGS84 coordinates, local tangent
 * frames (Jeju & Incheon), altitudes, and speed constraints.
 */
export const CORRIDOR_WAYPOINTS_EXPANDED = Object.freeze(
  CORRIDOR_WAYPOINTS.map(wpt => {
    const [jejuX, jejuZ] = wgs84ToJejuLocal(wpt.latitude, wpt.longitude);
    const [incheonX, incheonZ] = wgs84ToIncheonSceneryLocal(wpt.latitude, wpt.longitude);
    return Object.freeze({
      ...wpt,
      altitudeM: wpt.altitudeFt * 0.3048,
      speedKnots: WAYPOINT_SPEEDS[wpt.ident] ?? 250,
      jejuX,
      jejuZ,
      incheonX,
      incheonZ,
    });
  })
);

/**
 * Calculate initial great-circle bearing from point 1 to point 2 in degrees [0, 360).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Bearing in degrees
 */
export function calculateBearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const deltaLambda = (lon2 - lon1) * DEG_TO_RAD;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
}

/**
 * Calculate signed cross-track error in meters relative to great-circle path from (lat1, lon1) to (lat2, lon2).
 * Positive = aircraft is right of track, Negative = aircraft is left of track.
 * @param {number} lat - Aircraft latitude
 * @param {number} lon - Aircraft longitude
 * @param {number} lat1 - Segment start latitude
 * @param {number} lon1 - Segment start longitude
 * @param {number} lat2 - Segment end latitude
 * @param {number} lon2 - Segment end longitude
 * @returns {number} Cross-track distance in meters
 */
export function calculateCrossTrackErrorM(lat, lon, lat1, lon1, lat2, lon2) {
  const d13 = haversineDistanceM(lat1, lon1, lat, lon) / 6371008.8; // Angular distance in radians
  const theta13 = calculateBearingDeg(lat1, lon1, lat, lon) * DEG_TO_RAD;
  const theta12 = calculateBearingDeg(lat1, lon1, lat2, lon2) * DEG_TO_RAD;

  const xtkRad = Math.asin(Math.sin(d13) * Math.sin(theta13 - theta12));
  return xtkRad * 6371008.8;
}

/**
 * Advance active waypoint index when aircraft is within capture radius or past the waypoint.
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} [currentIndex=1]
 * @param {number} [captureRadiusM=4500]
 * @returns {number} New active waypoint index
 */
export function findActiveWaypointIndex(latitude, longitude, currentIndex = 1, captureRadiusM = 4500) {
  const waypoints = CORRIDOR_WAYPOINTS_EXPANDED;
  if (currentIndex >= waypoints.length - 1) return waypoints.length - 1;

  let idx = Math.max(1, Math.min(waypoints.length - 1, currentIndex));

  while (idx < waypoints.length - 1) {
    const targetWpt = waypoints[idx];
    const prevWpt = waypoints[idx - 1];

    const distToTarget = haversineDistanceM(latitude, longitude, targetWpt.latitude, targetWpt.longitude);
    if (distToTarget <= captureRadiusM) {
      idx++;
      continue;
    }

    const segDist = haversineDistanceM(prevWpt.latitude, prevWpt.longitude, targetWpt.latitude, targetWpt.longitude);
    if (segDist <= 0) {
      idx++;
      continue;
    }

    const brgSeg = calculateBearingDeg(prevWpt.latitude, prevWpt.longitude, targetWpt.latitude, targetWpt.longitude);
    const brgAc = calculateBearingDeg(prevWpt.latitude, prevWpt.longitude, latitude, longitude);
    const angleDiffRad = (brgAc - brgSeg) * DEG_TO_RAD;
    const distFromStart = haversineDistanceM(prevWpt.latitude, prevWpt.longitude, latitude, longitude);
    const alongTrackM = distFromStart * Math.cos(angleDiffRad);

    // If aircraft has flown past the waypoint along the segment track
    if (alongTrackM >= segDist - captureRadiusM) {
      idx++;
      continue;
    }

    break;
  }

  return idx;
}

/**
 * Get comprehensive active leg guidance data.
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} [currentIndex=1]
 * @returns {{
 *   activeIndex: number,
 *   activeWaypoint: object,
 *   previousWaypoint: object,
 *   nextWaypoints: object[],
 *   distanceM: number,
 *   distanceNm: number,
 *   bearingDeg: number,
 *   desiredTrackDeg: number,
 *   crossTrackM: number,
 *   crossTrackNm: number
 * }}
 */
export function getActiveLegInfo(latitude, longitude, currentIndex = 1) {
  const waypoints = CORRIDOR_WAYPOINTS_EXPANDED;
  const activeIndex = findActiveWaypointIndex(latitude, longitude, currentIndex);
  const activeWpt = waypoints[activeIndex];
  const prevWpt = waypoints[activeIndex - 1] ?? activeWpt;

  const distanceM = haversineDistanceM(latitude, longitude, activeWpt.latitude, activeWpt.longitude);
  const distanceNm = distanceM * M_TO_NM;
  const bearingDeg = calculateBearingDeg(latitude, longitude, activeWpt.latitude, activeWpt.longitude);
  const desiredTrackDeg = calculateBearingDeg(prevWpt.latitude, prevWpt.longitude, activeWpt.latitude, activeWpt.longitude);
  const crossTrackM = calculateCrossTrackErrorM(
    latitude,
    longitude,
    prevWpt.latitude,
    prevWpt.longitude,
    activeWpt.latitude,
    activeWpt.longitude
  );

  return {
    activeIndex,
    activeWaypoint: activeWpt,
    previousWaypoint: prevWpt,
    nextWaypoints: waypoints.slice(activeIndex + 1),
    distanceM,
    distanceNm,
    bearingDeg,
    desiredTrackDeg,
    crossTrackM,
    crossTrackNm: crossTrackM * M_TO_NM,
  };
}

/**
 * Stateful flight plan tracker for active simulator flights.
 */
export class CorridorFlightPlanManager {
  constructor(initialWaypointIndex = 1) {
    this.activeIndex = initialWaypointIndex;
    this.waypoints = CORRIDOR_WAYPOINTS_EXPANDED;
    this.currentLeg = null;
  }

  reset(initialWaypointIndex = 1) {
    this.activeIndex = initialWaypointIndex;
    this.currentLeg = null;
  }

  /**
   * Update flight plan with current aircraft position.
   * @param {number} latitude
   * @param {number} longitude
   * @returns {object} Updated leg info
   */
  update(latitude, longitude) {
    this.currentLeg = getActiveLegInfo(latitude, longitude, this.activeIndex);
    this.activeIndex = this.currentLeg.activeIndex;
    return this.currentLeg;
  }

  /**
   * Update from local simulator position (X, Z) and airport context.
   * @param {number} x
   * @param {number} z
   * @param {'jeju'|'incheon'} airport
   * @returns {object} Updated leg info
   */
  updateLocal(x, z, airport = 'jeju') {
    const wgs = airport === 'incheon' ? incheonSceneryLocalToWgs84(x, z) : jejuLocalToWgs84(x, z);
    return this.update(wgs.latitude, wgs.longitude);
  }

  /**
   * Formatted leg rows for CDU / FMC display.
   * @returns {Array<{ ident: string, distStr: string, spdAltStr: string, isActive: boolean }>}
   */
  getCDULegs() {
    const rows = [];
    const active = this.activeIndex;
    const startIdx = Math.max(0, active - 1);
    const endIdx = Math.min(this.waypoints.length, startIdx + 3);

    for (let i = startIdx; i < endIdx; i++) {
      const wpt = this.waypoints[i];
      const isActive = i === active;
      const distNm = isActive
        ? (this.currentLeg?.distanceNm ?? 0).toFixed(0) + 'NM'
        : i > 0
        ? (
            haversineDistanceM(
              this.waypoints[i - 1].latitude,
              this.waypoints[i - 1].longitude,
              wpt.latitude,
              wpt.longitude
            ) * M_TO_NM
          ).toFixed(0) + 'NM'
        : '0NM';

      const altStr = wpt.altitudeFt >= 18000 ? `FL${Math.round(wpt.altitudeFt / 100)}` : `${wpt.altitudeFt}`;
      const spdAltStr = `${wpt.speedKnots}/${altStr.padStart(5, ' ')}`;

      rows.push({
        ident: wpt.ident,
        distStr: distNm.padStart(4, '0'),
        spdAltStr,
        isActive,
      });
    }

    return rows;
  }
}
