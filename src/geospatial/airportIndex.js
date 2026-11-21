// Browser-side lookup for the versioned OurAirports runway index.
// Only the manifest and the tiles intersecting a query are fetched.
const DEFAULT_BASE_URL = '/data/airports/';
const EARTH_RADIUS_KM = 6371.0088;
const MAX_PIN_DISTANCE_KM = 5;

const manifestCache = new Map();
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
  const latDelta = radiusKm / 111.32;
  const cosLat = Math.cos(latitude * Math.PI / 180);
  const lonDelta = cosLat <= 1e-6 ? 180 : Math.min(180, radiusKm / (111.32 * cosLat));
  const allLongitudes = lonDelta >= 180;
  const tileIds = tileIdsForBounds({
    north: Math.min(90, latitude + latDelta),
    south: Math.max(-90, latitude - latDelta),
    west: allLongitudes ? -180 : longitude - lonDelta,
    east: allLongitudes ? 180 : longitude + lonDelta,
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
  const tileId = manifest.icao[key] ?? manifest.iata[key];
  if (!tileId) return null;
  const tile = await loadAirportTile(manifest, tileId, options);
  return tile.airports.find(airport => airport.icao === key || airport.iata === key || airport.ident === key) ?? null;
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
    const matches = airports.filter(airport => airport.icao === code || airport.iata === code || airport.ident === code);
    return matches.length === 1 ? matches[0] : null;
  }
  const name = normalizeName(pin.names?.en ?? pin.names?.ko ?? pin.name ?? pin.en ?? pin.ko);
  if (!name || !validCoordinate(pin.latitude, pin.longitude)) return null;
  const matches = airports.filter(airport => normalizeName(airport.name) === name
    && distanceKm(pin, airport) <= MAX_PIN_DISTANCE_KM);
  return matches.length === 1 ? matches[0] : null;
}
