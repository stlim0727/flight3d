/**
 * Final-approach geometry per airport, derived from the flight presets in
 * src/main.js (threshold world position, runway heading, glideslope angle,
 * threshold elevation). Units: meters for world XZ, degrees, feet.
 *
 * World frame matches the sim: heading = atan2(f.x, -f.z), so north is -Z.
 * For a course of headingDeg, the unit course vector is (sin, -cos) in (x, z)
 * and "right of course" is (cos, sin).
 */
export const APPROACH_DATA = {
  lukla: {
    // Lukla Runway 06 (Tenzing-Hillary), 11.7% uphill runway; approach slope 4.28°.
    threshold: { x: -223.5, z: 139.6 },
    headingDeg: 58,
    gsAngleDeg: 4.28,
    elevationFt: 9203,
  },
  coastal: {
    // Coastal International Runway 09L, runway aligned with +X.
    threshold: { x: -1350, z: 0 },
    headingDeg: 90,
    gsAngleDeg: 3.0,
    elevationFt: 39,
  },
};

const DEG = Math.PI / 180;

/**
 * Signed navigation deviations for the active airport's approach course.
 * Returns null when the airport has no approach data.
 *
 * @param {string} airportKey 'lukla' | 'coastal'
 * @param {{x:number,z:number,altitudeFt:number}} pos world position, altitude in ft
 * @returns {{courseDeg:number, crossTrackM:number, distanceToThresholdM:number, glideslopeErrorFt:number}|null}
 *   crossTrackM > 0 = right of centerline, distanceToThresholdM > 0 = before the threshold,
 *   glideslopeErrorFt > 0 = above the glideslope.
 */
export function approachDeviation(airportKey, pos) {
  const data = APPROACH_DATA[airportKey];
  if (!data) return null;
  const th = thRad(data.headingDeg);
  const dx = pos.x - data.threshold.x;
  const dz = pos.z - data.threshold.z;
  const along = dx * Math.sin(th) + dz * -Math.cos(th);
  const cross = dx * Math.cos(th) + dz * Math.sin(th);
  const distanceToThresholdM = -along;
  const gsAltitudeFt = data.elevationFt +
    Math.tan(data.gsAngleDeg * DEG) * distanceToThresholdM / 0.3048;
  const speedKnots = pos.tasKnots ?? pos.groundSpeedKnots ?? pos.iasKnots ?? 140;
  return {
    courseDeg: data.headingDeg,
    crossTrackM: cross,
    distanceToThresholdM,
    glideslopeErrorFt: pos.altitudeFt - gsAltitudeFt,
    // Required sink rate on the glideslope at this speed, negative = descending (fpm).
    referenceSinkFpm: -Math.tan(data.gsAngleDeg * DEG) * speedKnots * 101.27,
  };
}

function thRad(headingDeg) {
  return headingDeg * DEG;
}
