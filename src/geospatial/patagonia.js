/** Fitz Roy summit, the Patagonia DEM origin: 49.271278 S, 73.043222 W. */
export const PATAGONIA_ORIGIN = Object.freeze({ lat: -49.271278, lon: -73.043222 });

const EARTH_RADIUS_M = 6378137;
const DEG_TO_RAD = Math.PI / 180;

/** Geographic coordinate to local metres in the builder's azimuthal equidistant frame. */
export function patagoniaToWorld(lat, lon) {
  const originLat = PATAGONIA_ORIGIN.lat * DEG_TO_RAD;
  const targetLat = lat * DEG_TO_RAD;
  const deltaLon = (lon - PATAGONIA_ORIGIN.lon) * DEG_TO_RAD;
  const cosC = Math.sin(originLat) * Math.sin(targetLat)
    + Math.cos(originLat) * Math.cos(targetLat) * Math.cos(deltaLon);
  const centralAngle = Math.acos(Math.min(1, Math.max(-1, cosC)));
  if (centralAngle === 0) return { x: 0, z: 0 };
  const bearing = Math.atan2(Math.cos(targetLat) * Math.sin(deltaLon),
    Math.sin(targetLat) * Math.cos(originLat)
      - Math.cos(targetLat) * Math.sin(originLat) * Math.cos(deltaLon));
  const rho = EARTH_RADIUS_M * centralAngle;
  return { x: rho * Math.sin(bearing), z: -rho * Math.cos(bearing) };
}
