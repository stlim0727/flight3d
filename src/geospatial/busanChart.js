import { REGIONAL_CRUISES } from '../config/regionalCruises.js';
import { INCHEON_PATCH } from './incheon.js';
import { localToWgs84, tileToWgs84, tilesForBbox, wgs84ToLocal } from './TileCoordinateSystem.js';

const origin = REGIONAL_CRUISES.busan;
export const CHART_ZOOM = 13;

export function chartPoint({ latitude, longitude }) {
  return wgs84ToLocal(latitude, longitude, origin);
}

/** WGS84 box the Southeast atlas paper is fitted to. */
export const SOUTHEAST_ATLAS_BOUNDS = Object.freeze({ west: 127.53, north: 35.96, east: 129.52, south: 34.49 });

export function insideSoutheastAtlas(position) {
  const { west, north, east, south } = SOUTHEAST_ATLAS_BOUNDS;
  return Boolean(position) && position.longitude >= west && position.longitude <= east
    && position.latitude >= south && position.latitude <= north;
}

const incheonSceneWgs84 = (x, z) => localToWgs84(x, z, INCHEON_PATCH.origin);

/** `toWgs` inverts the scenery frame; Busan cruises fly in the Incheon plane. */
export function chartAircraft({ x, z }, forward, previousHeading, toWgs = incheonSceneWgs84) {
  const point = chartPoint(toWgs(x, z));
  const length = Math.hypot(forward.x, forward.z);
  let heading = previousHeading;
  if (length > 1e-5) {
    const ahead = chartPoint(toWgs(x + 10 * forward.x / length,
      z + 10 * forward.z / length));
    heading = Math.atan2(ahead[0] - point[0], point[1] - ahead[1]);
  }
  return { point, heading };
}

export function chartTilePoint(tx, ty) {
  return chartPoint(tileToWgs84(tx, ty, CHART_ZOOM));
}

// DOMMatrix-compatible transform from chart metres (east, south) to CSS pixels.
export function chartView(center, width, height, angle) {
  const metersPerPixel = Math.max(12000 / width, 6500 / height);
  const c = Math.cos(angle), s = Math.sin(angle);
  const transform = [
    c / metersPerPixel, -s / metersPerPixel, s / metersPerPixel, c / metersPerPixel,
    width / 2 - (c * center[0] + s * center[1]) / metersPerPixel,
    height / 2 - (-s * center[0] + c * center[1]) / metersPerPixel,
  ];
  const corners = [];
  for (const dx of [-width / 2, width / 2]) {
    for (const dy of [-height / 2, height / 2]) {
      corners.push(localToWgs84(center[0] + (c * dx - s * dy) * metersPerPixel,
        center[1] + (s * dx + c * dy) * metersPerPixel, origin));
    }
  }
  const lats = corners.map(p => p.latitude), lons = corners.map(p => p.longitude);
  const tiles = tilesForBbox([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], CHART_ZOOM);
  return { metersPerPixel, transform, tiles };
}
