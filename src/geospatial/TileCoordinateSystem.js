/**
 * TileCoordinateSystem.js
 *
 * Bi-directional coordinate transformations for open-world tile streaming:
 * - WGS84 Geodetic (latitude, longitude in degrees)
 * - Web Mercator / Slippy Map Tiles (tile X, tile Y, zoom level, fractional offsets)
 * - Flight3d Local Tangent Plane (meters: +x = East, +z = South, relative to airfield ARP)
 */

const RADIANS = Math.PI / 180;
const DEGREES = 180 / Math.PI;
const WGS84_A = 6378137.0; // Semi-major axis in meters
const WGS84_E2 = 6.6943799901413165e-3; // First eccentricity squared

/**
 * Convert WGS84 latitude/longitude to Web Mercator tile indices.
 * @param {number} latitude - Latitude in degrees [-85.0511, 85.0511]
 * @param {number} longitude - Longitude in degrees [-180, 180]
 * @param {number} zoom - Zoom level integer [0, 22]
 * @returns {{ x: number, y: number, fx: number, fy: number, zoom: number }}
 */
export function wgs84ToTile(latitude, longitude, zoom) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(zoom)) {
    throw new Error('Invalid WGS84 coordinate or zoom level');
  }
  const n = 2 ** zoom;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, latitude));
  const clampedLon = Math.max(-180, Math.min(180, longitude));

  const xExact = ((clampedLon + 180) / 360) * n;
  const latRad = clampedLat * RADIANS;
  const yExact = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const x = Math.floor(xExact);
  const y = Math.floor(yExact);

  return {
    x,
    y,
    fx: xExact - x,
    fy: yExact - y,
    zoom: Math.round(zoom),
  };
}

/**
 * Convert Web Mercator tile index (NW corner) to WGS84 latitude and longitude.
 * @param {number} x - Tile X index (can include fractional offset)
 * @param {number} y - Tile Y index (can include fractional offset)
 * @param {number} zoom - Zoom level integer
 * @returns {{ latitude: number, longitude: number }}
 */
export function tileToWgs84(x, y, zoom) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) {
    throw new Error('Invalid tile coordinate or zoom level');
  }
  const n = 2 ** zoom;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = latRad * DEGREES;
  return { latitude: lat, longitude: lon };
}

/**
 * Compute the WGS84 bounding box for a given tile.
 * @param {number} x - Tile X index
 * @param {number} y - Tile Y index
 * @param {number} zoom - Zoom level
 * @returns {{ nw: { latitude: number, longitude: number }, se: { latitude: number, longitude: number }, center: { latitude: number, longitude: number } }}
 */
export function tileBoundsWgs84(x, y, zoom) {
  const nw = tileToWgs84(x, y, zoom);
  const se = tileToWgs84(x + 1, y + 1, zoom);
  const center = tileToWgs84(x + 0.5, y + 0.5, zoom);
  return { nw, se, center };
}

/**
 * ECEF position vector from WGS84.
 */
function ecef(latitude, longitude) {
  const lat = latitude * RADIANS;
  const lon = longitude * RADIANS;
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
  return [
    n * Math.cos(lat) * Math.cos(lon),
    n * Math.cos(lat) * Math.sin(lon),
    n * (1 - WGS84_E2) * Math.sin(lat),
  ];
}

/**
 * Project WGS84 coordinate to local East/South tangent plane in meters.
 * (+x = East, +z = South, matching Three.js coordinate system where -z is North).
 * @param {number} latitude
 * @param {number} longitude
 * @param {{ latitude: number, longitude: number }} origin
 * @returns {[number, number]} [x, z] in meters
 */
export function wgs84ToLocal(latitude, longitude, origin) {
  if (!origin || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude)) {
    throw new Error('Invalid origin coordinate');
  }
  const pos = ecef(latitude, longitude);
  const center = ecef(origin.latitude, origin.longitude);
  const [dx, dy, dz] = pos.map((v, i) => v - center[i]);
  const lat = origin.latitude * RADIANS;
  const lon = origin.longitude * RADIANS;

  const x = -Math.sin(lon) * dx + Math.cos(lon) * dy;
  const z = Math.sin(lat) * Math.cos(lon) * dx + Math.sin(lat) * Math.sin(lon) * dy - Math.cos(lat) * dz;
  return [x, z];
}

/**
 * Convert local tangent plane [x, z] in meters back to WGS84 latitude/longitude.
 * @param {number} x - East meters
 * @param {number} z - South meters
 * @param {{ latitude: number, longitude: number }} origin
 * @returns {{ latitude: number, longitude: number }}
 */
export function localToWgs84(x, z, origin) {
  if (!origin || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude)) {
    throw new Error('Invalid origin coordinate');
  }
  const lat0 = origin.latitude * RADIANS;
  const lon0 = origin.longitude * RADIANS;
  const sinLat = Math.sin(lat0);
  const Rn = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const Rm = (WGS84_A * (1 - WGS84_E2)) / (1 - WGS84_E2 * sinLat * sinLat) ** 1.5;

  const dLat = -z / Rm;
  const dLon = x / (Rn * Math.cos(lat0));

  return {
    latitude: (lat0 + dLat) * DEGREES,
    longitude: (lon0 + dLon) * DEGREES,
  };
}

/**
 * Get local tangent plane bounds for a Web Mercator tile.
 * @param {number} x - Tile X index
 * @param {number} y - Tile Y index
 * @param {number} zoom - Zoom level
 * @param {{ latitude: number, longitude: number }} origin - Local coordinate origin
 * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number, widthMeters: number, heightMeters: number, centerX: number, centerZ: number }}
 */
export function tileBoundsLocal(x, y, zoom, origin) {
  const { nw, se } = tileBoundsWgs84(x, y, zoom);
  const [minX, minZ] = wgs84ToLocal(nw.latitude, nw.longitude, origin);
  const [maxX, maxZ] = wgs84ToLocal(se.latitude, se.longitude, origin);

  return {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minZ: Math.min(minZ, maxZ),
    maxZ: Math.max(minZ, maxZ),
    widthMeters: Math.abs(maxX - minX),
    heightMeters: Math.abs(maxZ - minZ),
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

/**
 * Compute the list of tiles at a given zoom level covering a WGS84 bounding box.
 * @param {[number, number, number, number]} bbox - [westLon, southLat, eastLon, northLat]
 * @param {number} zoom
 * @returns {Array<{ x: number, y: number, zoom: number }>}
 */
export function tilesForBbox(bbox, zoom) {
  const [west, south, east, north] = bbox;
  const nwTile = wgs84ToTile(north, west, zoom);
  const seTile = wgs84ToTile(south, east, zoom);

  const tiles = [];
  for (let x = nwTile.x; x <= seTile.x; x++) {
    for (let y = nwTile.y; y <= seTile.y; y++) {
      tiles.push({ x, y, zoom });
    }
  }
  return tiles;
}
