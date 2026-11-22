// Browser-side lookup for the versioned OurAirports runway index.
// Only the manifest and the tiles intersecting a query are fetched.
/** Vite injects BASE_URL (e.g. `/flight3d/` on Pages); Node falls back to `/`. */
/** Search artifact schema; it is versioned with the tile index it was built from. */
export const SEARCH_SCHEMA_VERSION = 1;
export function airportDataBaseUrl(base) {
  const configured = typeof import.meta.env === 'object' ? import.meta.env.BASE_URL : undefined;
  const prefix = base ?? configured ?? '/';
  return `${prefix.endsWith('/') ? prefix : `${prefix}/`}data/airports/`;
}

const DEFAULT_BASE_URL = airportDataBaseUrl();
const EARTH_RADIUS_KM = 6371.0088;
const MAX_PIN_DISTANCE_KM = 5;

const manifestCache = new Map();
const searchIndexCache = new Map();
const tileCache = new Map();

function resourceUrl(baseUrl, path) {
  const root = new URL(baseUrl, globalThis.location?.href ?? 'http://localhost/');
  return new URL(path, root).toString();
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Airport index request failed (${response.status}): ${url}`);
  return response.json();
}

function validCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function distanceKm(a, b) {
  if (!validCoordinate(a?.latitude, a?.longitude) || !validCoordinate(b?.latitude, b?.longitude)) return Infinity;
  const toRad = Math.PI / 180;
  const lat1 = a.latitude * toRad;
  const lat2 = b.latitude * toRad;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function clearAirportIndexCache() {
  manifestCache.clear();
  tileCache.clear();
  searchIndexCache.clear();
}

/**
 * Load the compact global search artifact lazily. The manifest pins its path,
 * schema and count, so a stale or partial artifact is rejected rather than
 * silently yielding an empty search result.
 */
export async function loadAirportSearchIndex(manifest, {
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  const descriptor = manifest?.searchIndex;
  if (!descriptor || typeof descriptor.path !== 'string' || !descriptor.path
    || descriptor.schemaVersion !== SEARCH_SCHEMA_VERSION
    || !Number.isInteger(descriptor.count) || descriptor.count < 0) {
    throw new Error('Unsupported airport search index');
  }
  const key = `${baseUrl}|${manifest.version}|${descriptor.path}`;
  if (searchIndexCache.has(key)) return searchIndexCache.get(key);
  const index = await getJson(resourceUrl(baseUrl, descriptor.path), fetchImpl);
  if (index?.schemaVersion !== SEARCH_SCHEMA_VERSION || index.version !== manifest.version
    || !Array.isArray(index.airports) || index.airports.length !== descriptor.count) {
    throw new Error('Invalid airport search index');
  }
  for (const entry of index.airports) {
    if (!entry || typeof entry.code !== 'string' || !entry.code
      || typeof entry.name !== 'string' || !entry.name
      || typeof entry.iata !== 'string' || typeof entry.country !== 'string'
      || typeof entry.type !== 'string' || typeof entry.tileId !== 'string'
      || !Object.hasOwn(manifest.tiles, entry.tileId)
      || !validCoordinate(entry.latitude, entry.longitude)) {
      throw new Error('Invalid airport search index entry');
    }
  }
  Object.freeze(index.airports);
  searchIndexCache.set(key, index.airports);
  return index.airports;
}

/** Fetch and validate the small root manifest; cached per base URL. */
export async function loadAirportManifest({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (manifestCache.has(baseUrl)) return manifestCache.get(baseUrl);
  const manifest = await getJson(resourceUrl(baseUrl, 'manifest.json'), fetchImpl);
  if (manifest?.schemaVersion !== 1 || typeof manifest.version !== 'string'
    || !Number.isFinite(manifest.tileDegrees) || !manifest.tiles || !manifest.icao || !manifest.iata) {
    throw new Error('Unsupported airport index manifest');
  }
  manifestCache.set(baseUrl, manifest);
  return manifest;
}

export async function loadAirportTile(manifest, tileId, {
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!manifest?.tiles?.[tileId]) throw new Error(`Unknown airport tile: ${tileId}`);
  const key = `${baseUrl}|${manifest.version}|${tileId}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const tile = await getJson(resourceUrl(baseUrl, `${manifest.version}/tiles/${tileId}.json`), fetchImpl);
  if (tile?.schemaVersion !== 1 || tile.version !== manifest.version || tile.tile !== tileId
    || !Array.isArray(tile.airports)) {
    throw new Error(`Invalid airport tile: ${tileId}`);
  }
  tileCache.set(key, tile);
  return tile;
}

function normalizeLongitude(longitude) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

/** Tile IDs whose 10-degree (or configured) boxes overlap a latitude/longitude box. */
export function tileIdsForBounds({ north, south, west, east }, tileDegrees) {
  if (!Number.isFinite(tileDegrees) || tileDegrees <= 0 || 360 % tileDegrees || 180 % tileDegrees) {
    throw new Error('Invalid airport tile size');
  }
  if (![north, south, west, east].every(Number.isFinite) || north < south
    || north < -90 || south > 90) return [];
  const firstY = Math.max(0, Math.floor((Math.max(-90, south) + 90) / tileDegrees));
  const lastY = Math.min(180 / tileDegrees - 1, Math.floor((Math.min(90, north) + 90) / tileDegrees));
  const xCount = 360 / tileDegrees;
  let xs;
  if (west <= -180 && east >= 180) {
    xs = Array.from({ length: xCount }, (_, index) => index);
  } else {
    const firstX = Math.floor((normalizeLongitude(west) + 180) / tileDegrees);
    const lastX = Math.floor((normalizeLongitude(east) + 180) / tileDegrees);
    xs = [];
    for (let x = firstX; x !== lastX; x = (x + 1) % xCount) {
      xs.push(x);
      if (xs.length >= xCount) break;
    }
    xs.push(lastX);
  }
  const ids = [];
  for (let y = firstY; y <= lastY; y++) {
    for (const x of xs) ids.push(`${y}-${x}`);
  }
  return ids;
}

/** Load only nearby tiles and return airports inside the radius, closest first. */
export async function findAirportsInRegion(manifest, { latitude, longitude, radiusKm = 50 }, options = {}) {
  if (!validCoordinate(latitude, longitude) || !Number.isFinite(radiusKm) || radiusKm < 0) {
    throw new Error('Invalid regional airport query');
  }
  const center = { latitude, longitude };
  const angularRadius = Math.min(Math.PI, radiusKm / EARTH_RADIUS_KM);
  const latDelta = angularRadius * 180 / Math.PI;
  const reachesPole = latitude + latDelta >= 90 || latitude - latDelta <= -90;
  let west = -180;
  let east = 180;
  if (!reachesPole) {
    const cosLat = Math.max(1e-9, Math.cos(latitude * Math.PI / 180));
    const lonDelta = Math.asin(Math.min(1, Math.sin(angularRadius) / cosLat)) * 180 / Math.PI;
    west = longitude - lonDelta;
    east = longitude + lonDelta;
  }
  const tileIds = tileIdsForBounds({
    north: Math.min(90, latitude + latDelta),
    south: Math.max(-90, latitude - latDelta),
    west,
    east,
  }, manifest.tileDegrees).filter(id => Object.hasOwn(manifest.tiles, id));
  const tiles = await Promise.all(tileIds.map(id => loadAirportTile(manifest, id, options)));
  return tiles.flatMap(tile => tile.airports)
    .map(airport => ({ ...airport, distanceKm: distanceKm(center, airport) }))
    .filter(airport => airport.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id));
}

/** Resolve an ICAO or IATA code through the manifest: one tile request, no scan. */
export async function findAirportByCode(manifest, code, options = {}) {
  const key = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!key) return null;
  const hint = typeof options.tileId === 'string' && Object.hasOwn(manifest.tiles, options.tileId)
    ? options.tileId : null;
  const tileId = hint ?? manifest.icao[key] ?? manifest.iata[key] ?? manifest.ident?.[key];
  if (!tileId) return null;
  const tile = await loadAirportTile(manifest, tileId, options);
  const airports = tile.airports;
  return airports.find(airport => airport.icao === key || airport.iata === key)
    ?? airports.find(airport => airport.ident === key) ?? null;
}

function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\bint'?l\b/gi, 'international')
    .replace(/국제공항/g, '공항')
    .replace(/\b(?:international|int'l)\s+airport\b/g, 'airport')
    .replace(/[\s·.,\-_'’"()/]+/g, '');
}

/**
 * Connect a map pin to an index airport. Codes win; without one, names must
 * match and the positions must agree. Ambiguity keeps the pin unlinked.
 */
export function matchAirportPin(pin, airports) {
  if (!pin || !Array.isArray(airports)) return null;
  const code = (pin.icao || pin.iata || '').trim().toUpperCase();
  if (code) {
    const matches = airports.filter(airport => airport.icao === code || airport.iata === code);
    return matches.length === 1 ? matches[0] : null;
  }
  const name = normalizeName(pin.names?.en ?? pin.names?.ko ?? pin.name ?? pin.en ?? pin.ko);
  if (!name || !validCoordinate(pin.latitude, pin.longitude)) return null;
  const matches = airports.filter(airport => normalizeName(airport.name) === name
    && distanceKm(pin, airport) <= MAX_PIN_DISTANCE_KM);
  return matches.length === 1 ? matches[0] : null;
}
