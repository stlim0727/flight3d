// Geometry for the generic pilotage chart drawn around the aircraft in any
// real region. Chart metres are (east, south) on the tangent plane of the
// chart centre, so canvas y grows downward and north is up.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { isWaterPolygon } from './overtureWater.js';
import { realOffsetInIncheonFrame, worldPositionToWgs84 } from './airportGeodesy.js';
import { projectToLocal } from './incheon.js';
import { applyAirportOverrides } from '../config/airportOverrides.js';
import { localToWgs84, tileToWgs84, wgs84ToTile, wgs84ToLocal } from './TileCoordinateSystem.js';

/** Water tiles share the open-world terrain's zoom, so the view has often fetched them already. */
export const CHART_WATER_ZOOM = 11;
export const CHART_TILE_LIMIT = 64;
/** Smallest ground area the paper shows, east-west by north-south. */
export const CHART_SPAN_M = Object.freeze([60000, 42000]);
/** The paper re-centres once the aircraft leaves this share of the half-extent. */
export const RECENTER_FRACTION = 0.55;
/** Airports are looked up within this radius of the chart centre. */
export const AIRPORT_RADIUS_KM = 80;

const SCALE_STEPS_KM = [1, 2, 5, 10, 20, 50, 100];
const LABELLED_TYPES = new Set(['large_airport', 'medium_airport']);
const CHARTED_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport']);

// Arenas authored without geodesy. The generated valley keeps the previous
// world anchor, so the active airport, not the anchor, rules it out.
const FICTIONAL_AIRPORTS = new Set(['coastal', 'neon', 'valley', 'generated-valley']);

/**
 * Tangent-plane origin of the scenery when the flight is in a real region,
 * else null. A null origin keeps the chart menu hidden and starts no requests.
 */
export function chartSceneOrigin({ activeAirport, world } = {}) {
  return FICTIONAL_AIRPORTS.has(activeAirport) ? null : world?.activeOrigin ?? null;
}

/**
 * Everything a chart needs to agree with the scenery, or null outside real
 * regions: the scene plane origin, its inverse and the streamed-airport placement.
 */
export function chartSceneFrame(sim) {
  const origin = chartSceneOrigin(sim);
  if (!origin) return null;
  const { anchor, customOrigin } = sim.world;
  return {
    origin,
    // Invert the same tangent plane as the local terrain (especially at Lukla).
    toWgs: (x, z) => worldPositionToWgs84(anchor, x, z, origin),
    placeAirport: sceneAirportPlacement(anchor, origin, customOrigin),
  };
}

/** Metres per CSS pixel that fit the chart span into the paper. */
export function chartMetersPerPixel(width, height) {
  return Math.max(CHART_SPAN_M[0] / width, CHART_SPAN_M[1] / height);
}

/** Tangent-plane projection centred on a WGS84 point. */
export function chartProjection(center) {
  const origin = Object.freeze({ latitude: center.latitude, longitude: center.longitude });
  return {
    center: origin,
    project: ({ latitude, longitude }) => wgs84ToLocal(latitude, longitude, origin),
    unproject: (east, south) => localToWgs84(east, south, origin),
  };
}

/**
 * Aircraft position and screen heading (radians clockwise from chart north).
 * `toWgs` inverts the frame the scenery is drawn in; the nose direction is the
 * projected 10 m step along the forward vector, so grid convergence between the
 * scenery and chart planes is included. A level-zero forward keeps the last heading.
 */
export function chartAircraftMark(projection, toWgs, position, forward, previousHeading = 0) {
  const point = projection.project(toWgs(position.x, position.z));
  const length = Math.hypot(forward.x, forward.z);
  let heading = previousHeading;
  if (length > 1e-5) {
    const ahead = projection.project(toWgs(position.x + 10 * forward.x / length,
      position.z + 10 * forward.z / length));
    heading = Math.atan2(ahead[0] - point[0], point[1] - ahead[1]);
  }
  return { point, heading };
}

/** True once the aircraft has drifted far enough to re-centre the paper. */
export function chartNeedsRecenter(point, width, height, metersPerPixel) {
  if (!point.every(Number.isFinite)) return true;
  const halfX = width * metersPerPixel / 2;
  const halfY = height * metersPerPixel / 2;
  return Math.abs(point[0]) > halfX * RECENTER_FRACTION || Math.abs(point[1]) > halfY * RECENTER_FRACTION;
}

/** WGS84 sheet bounds including a one-tenth margin. West > east spans the date line. */
export function chartBounds(projection, widthM, heightM) {
  const halfX = widthM * 0.55;
  const halfY = heightM * 0.55;
  const corners = [[-halfX, -halfY], [halfX, -halfY], [-halfX, halfY], [halfX, halfY]]
    .map(([east, south]) => projection.unproject(east, south));
  const lats = corners.map(point => point.latitude);
  const lons = corners.map(point => point.longitude);
  const south = Math.min(...lats), north = Math.max(...lats);
  // Crossing the date line takes the short arc from the last tile column to the first.
  const crossesDateLine = Math.max(...lons) - Math.min(...lons) > 180;
  const west = crossesDateLine ? Math.min(...lons.filter(lon => lon >= 0)) : Math.min(...lons);
  const east = crossesDateLine ? Math.max(...lons.filter(lon => lon < 0)) : Math.max(...lons);
  return { north, south, east, west };
}

/** Web Mercator water tiles under the paper, with a one-tenth margin. */
export function chartWaterTiles(projection, width, height, metersPerPixel, zoom = CHART_WATER_ZOOM) {
  const { north, south, east, west } = chartBounds(projection, width * metersPerPixel, height * metersPerPixel);
  if (south > 85.0511 || north < -85.0511) return [];
  // Mercator tiles shrink at high latitudes. Keep one sheet within the tile budget.
  for (let level = zoom; level >= 0; level--) {
    const count = 2 ** level;
    const nw = wgs84ToTile(north, west, level);
    const se = wgs84ToTile(south, east, level);
    const columns = (se.x - nw.x + count) % count + 1;
    if (columns * (se.y - nw.y + 1) > CHART_TILE_LIMIT) continue;
    const tiles = [];
    for (let i = 0; i < columns; i++) {
      for (let y = nw.y; y <= se.y; y++) tiles.push({ x: (nw.x + i) % count, y, zoom: level });
    }
    return tiles;
  }
  return [];
}

/**
 * Affine [a, b, c, d, e, f] from tile units (0..1 across, 0..1 down) to chart
 * metres. Three projected corners keep the tile's rotation and scale on the
 * chart plane; inside one zoom-11 tile the residual curvature stays under
 * about 40 m, below one chart pixel.
 */
export function chartTileTransform(projection, x, y, zoom = CHART_WATER_ZOOM) {
  const p0 = projection.project(tileToWgs84(x, y, zoom));
  const p1 = projection.project(tileToWgs84(x + 1, y, zoom));
  const p2 = projection.project(tileToWgs84(x, y + 1, zoom));
  return [p1[0] - p0[0], p1[1] - p0[1], p2[0] - p0[0], p2[1] - p0[1], p0[0], p0[1]];
}

/** Water polygon rings of one Overture base tile, in tile units. */
export function decodeWaterRings(data) {
  const layer = new VectorTile(new PbfReader(data)).layers.water;
  const rings = [];
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const feature = layer.feature(i);
    if (!isWaterPolygon(feature)) continue;
    const scale = 1 / feature.extent;
    for (const ring of feature.loadGeometry()) {
      if (ring.length < 3) continue;
      const points = new Float32Array(ring.length * 2);
      for (let j = 0; j < ring.length; j++) {
        points[2 * j] = ring[j].x * scale;
        points[2 * j + 1] = ring[j].y * scale;
      }
      rings.push(points);
    }
  }
  return rings;
}

function endPoint(end) {
  const point = end?.physical ?? end?.threshold;
  return Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude) ? point : null;
}

/**
 * Where the scenery shows an airport-index coordinate, as WGS84 in the scene
 * frame. Streamed airports without a custom origin are laid out on the shared
 * Incheon plane and shifted into the anchor frame (overrides such as VNLK are
 * pre-distorted for that), so the chart repeats that placement before
 * inverting the scene plane. A custom origin streams in its own plane.
 */
function sceneAirportPlacement(anchor, origin, customOrigin) {
  if (origin === customOrigin) return point => point;
  const [ox, oz] = realOffsetInIncheonFrame(anchor);
  return point => {
    const [x, z] = projectToLocal(point.latitude, point.longitude);
    return localToWgs84(x - ox, z - oz, origin);
  };
}

/**
 * Runway centrelines and labelled airports from airport-index entries, with
 * the same precision overrides the streamed surfaces render.
 */
export function chartAirports(airports, projection, place = point => point) {
  const runways = [];
  const labels = [];
  for (const indexed of airports ?? []) {
    if (!CHARTED_TYPES.has(indexed?.type)) continue;
    const airport = applyAirportOverrides(indexed);
    for (const runway of airport.runways ?? []) {
      const from = endPoint(runway.ends?.[0]);
      const to = endPoint(runway.ends?.[1]);
      if (!from || !to) continue;
      runways.push({
        from: projection.project(place(from)),
        to: projection.project(place(to)),
        widthM: Number.isFinite(runway.widthM) ? runway.widthM : 30,
      });
    }
    const code = airport.icao || airport.ident;
    if (code && LABELLED_TYPES.has(airport.type)) {
      labels.push({ code, point: projection.project(place(airport)), major: airport.type === 'large_airport' });
    }
  }
  return { runways, labels };
}

/** Longest round scale-bar length no wider than `maxPixels`. */
export function chartScaleBar(metersPerPixel, maxPixels = 120) {
  const limitKm = metersPerPixel * maxPixels / 1000;
  const km = SCALE_STEPS_KM.filter(step => step <= limitKm).at(-1) ?? SCALE_STEPS_KM[0];
  return { km, pixels: km * 1000 / metersPerPixel };
}

/** Compact hemisphere-labelled position, e.g. "37.46°N 126.44°E". */
export function formatChartPosition({ latitude, longitude }) {
  const lat = `${Math.abs(latitude).toFixed(2)}°${latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(longitude).toFixed(2)}°${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}
