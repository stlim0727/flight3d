/**
 * TileCoordinateSystem.js
 *
 * Bi-directional coordinate transformations for open-world tile streaming:
 * - WGS84 Geodetic (latitude, longitude in degrees)
 * - Web Mercator / Slippy Map Tiles (tile X, tile Y, zoom level, fractional offsets)
 * - Flight3d Local Tangent Plane (meters: +x = East, +z = South, relative to airfield ARP)
 */

import {
  ecefToWgs84 as coreEcefToWgs84,
  enuToWgs84,
  lonLatToTilePixel,
  tilePixelToLonLat,
  wgs84ToEnu,
} from '@stlim0727/flightsim-core/geo/Geodesy.js';

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
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, latitude));
  const clampedLon = Math.max(-180, Math.min(180, longitude));
  const tile = lonLatToTilePixel(clampedLat, clampedLon, zoom);
  // Core wraps longitude to [-180, 180); keep the legacy +180 tile edge.
  const fx = tile.fx + (clampedLon === 180 ? 2 ** zoom : 0);
  const fy = tile.fy;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  return {
    x,
    y,
    fx: fx - x,
    fy: fy - y,
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
  const { lat, lon } = tilePixelToLonLat(x, y, zoom);
  // Restore the tile-column winding that core's [0, 1) wrapping discards.
  return { latitude: lat, longitude: lon + Math.floor(x / 2 ** zoom) * 360 };
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
  const frame = { latitude: origin.latitude, longitude: origin.longitude };
  const { east, north } = wgs84ToEnu(latitude, longitude, frame);
  return [east, -north];
}

/**
 * Invert ECEF coordinates [X, Y, Z] to WGS84 latitude/longitude.
 * @param {number} X
 * @param {number} Y
 * @param {number} Z
 * @returns {{ latitude: number, longitude: number }}
 */
export function ecefToWgs84(X, Y, Z) {
  const { latitude, longitude } = coreEcefToWgs84(X, Y, Z);
  return { latitude, longitude };
}

/**
 * Convert local tangent plane [x, z] in meters back to WGS84 latitude/longitude.
 * Uses the shared exact ellipsoid intersection for regional distances.
 * @param {number} x - East meters
 * @param {number} z - South meters
 * @param {{ latitude: number, longitude: number }} origin
 * @returns {{ latitude: number, longitude: number }}
 */
export function localToWgs84(x, z, origin) {
  if (!origin || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude)) {
    throw new Error('Invalid origin coordinate');
  }
  const frame = { latitude: origin.latitude, longitude: origin.longitude };
  const { latitude, longitude } = enuToWgs84(x, -z, 0, frame);
  return { latitude, longitude };
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
