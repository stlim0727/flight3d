import { createHash } from 'node:crypto';
// Pure OurAirports CSV -> regional runway index conversion. No network or DOM.
export const SCHEMA_VERSION = 1;
export const DEFAULT_TILE_DEGREES = 10;

const FT_TO_M = 0.3048;
const EARTH_RADIUS_M = 6371008.8;
const LAND_AIRPORT_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport']);

const round = (value, digits) => Number(value.toFixed(digits));

function finite(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function inRange(value, min, max) {
  return value !== null && value >= min && value <= max;
}

function compactText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// OurAirports surface is not a controlled vocabulary; accept only known codes
// and aliases so notes such as "Delete duplicate" cannot become runway data.
const SURFACE_ALIASES = new Map([
  ['ASP', 'ASP'], ['ASPH', 'ASP'], ['ASPHALT', 'ASP'], ['ASPHAULT', 'ASP'],
  ['ASHP', 'ASP'], ['ASHPHALT', 'ASP'], ['ASHPALT', 'ASP'], ['ASB', 'ASP'],
  ['CON', 'CON'], ['CONC', 'CON'], ['CONCRETE', 'CON'], ['COCRETE', 'CON'],
  ['CEMENT', 'CON'], ['CEM', 'CON'],
  ['TURF', 'TURF'], ['GRASS', 'TURF'], ['GRS', 'TURF'], ['GRA', 'TURF'],
  ['GRAS', 'TURF'], ['GRASSY', 'TURF'], ['GRAAS', 'TURF'], ['GRASSS', 'TURF'],
  ['SOD', 'TURF'], ['TORF', 'TURF'], ['ERBA', 'TURF'], ['HERBA', 'TURF'],
  ['GRE', 'GRE'], ['GVL', 'GRE'], ['GRVL', 'GRE'], ['GRV', 'GRE'],
  ['GRAVEL', 'GRE'], ['GRAV', 'GRE'], ['GR', 'GRE'], ['PFC', 'GRE'], ['OILGRAVEL', 'GRE'],
  ['DIRT', 'DIRT'], ['EARTH', 'DIRT'], ['EARTTH', 'DIRT'], ['EERTH', 'DIRT'],
  ['LOAM', 'DIRT'], ['MURRAM', 'DIRT'], ['SOIL', 'DIRT'], ['GROUND', 'DIRT'],
  ['SAIBRO', 'DIRT'], ['CALCRETE', 'DIRT'], ['SHALE', 'DIRT'],
  ['PEM', 'PEM'], ['MAT', 'MAT'], ['MATS', 'MAT'], ['MARSTON', 'MAT'],
  ['WOOD', 'WOOD'], ['MET', 'MET'], ['METAL', 'MET'], ['MTAL', 'MET'],
  ['ALUM', 'MET'], ['STEEL', 'MET'],
  ['SAND', 'SAND'], ['SAN', 'SAND'], ['CLAY', 'CLAY'], ['SNOW', 'SNOW'],
  ['ICE', 'ICE'], ['BLUE', 'ICE'], ['BRICK', 'BRICK'],
  ['PAVED', 'PAVED'], ['PAVEMENT', 'PAVED'], ['PAVING', 'PAVED'],
  ['MACADAM', 'MACADAM'], ['BIT', 'BITUM'], ['BITUM', 'BITUM'],
  ['BITUMEN', 'BITUM'], ['BITUMINOUS', 'BITUM'], ['TAR', 'BITUM'],
  ['CHIPSEAL', 'CHIPSEAL'], ['CORAL', 'CORAL'], ['STONE', 'STONE'],
  ['ROCK', 'STONE'], ['LIMESTONE', 'STONE'], ['ROOF', 'ROOF'],
  ['ROOFTOP', 'ROOF'], ['PAD', 'PAD'],
]);
const SURFACE_MODIFIERS = new Set([
  'F', 'G', 'P', 'E', 'L', 'H', 'TRTD', 'TREATED', 'CRUSHED', 'HARD',
  'OLD', 'PARTIAL', 'SOFT', 'LOOSE', 'ROOF', 'ROOFTOP', 'PAD', 'MATS',
]);
export const SURFACE_CATEGORIES = Object.freeze([...new Set(SURFACE_ALIASES.values())].sort());

/** Normalize a source surface to canonical categories; reject unknown values. */
export function normalizeSurface(raw) {
  const text = compactText(raw).toUpperCase().replace(/[()"'.;]+/g, ' ');
  if (!text) return null;
  const categories = new Set();
  for (const token of text.split(/[\s/,\-+&]+/).filter(Boolean)) {
    if (SURFACE_ALIASES.has(token)) categories.add(SURFACE_ALIASES.get(token));
    else if (!SURFACE_MODIFIERS.has(token)) return null;
  }
  return categories.size ? [...categories].sort().join('/') : null;
}

/** Minimal RFC 4180 reader: OurAirports CSVs use quoted fields, commas and CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some(cell => cell !== '')) rows.push(row);
  const [headers, ...values] = rows;
  if (!headers) return [];
  return values.map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

function greatCircleDistanceM(a, b) {
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat ** 2 + Math.cos(lat1) * Math.cos(lat2) * sinLon ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDegrees(from, to) {
  const lat1 = from.latitude * Math.PI / 180;
  const lat2 = to.latitude * Math.PI / 180;
  const dLon = (to.longitude - from.longitude) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function pointAtDistance(from, bearing, distanceM) {
  const angular = distanceM / EARTH_RADIUS_M;
  const phi1 = from.latitude * Math.PI / 180;
  const lambda1 = from.longitude * Math.PI / 180;
  const theta = bearing * Math.PI / 180;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(angular)
    + Math.cos(phi1) * Math.sin(angular) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(angular) * Math.cos(phi1),
    Math.cos(angular) - Math.sin(phi1) * Math.sin(phi2));
  return {
    latitude: round(phi2 * 180 / Math.PI, 6),
    longitude: round(((lambda2 * 180 / Math.PI + 540) % 360) - 180, 6),
  };
}

/** Airports with no land runway that can be validated remain map pins only. */
export function normalizeAirport(row) {
  const id = compactText(row.id);
  const type = compactText(row.type);
  const latitude = finite(row.latitude_deg);
  const longitude = finite(row.longitude_deg);
  const elevationFt = finite(row.elevation_ft);
  const ident = compactText(row.ident).toUpperCase();
  if (!/^\d+$/.test(id) || !LAND_AIRPORT_TYPES.has(type) || !ident) return null;
  if (!inRange(latitude, -90, 90) || !inRange(longitude, -180, 180) || !inRange(elevationFt, -1500, 30000)) return null;

  const icao = compactText(row.icao_code).toUpperCase() || (/^[A-Z]{4}$/.test(ident) ? ident : '');
  const iata = compactText(row.iata_code).toUpperCase();
  return {
    id,
    ident,
    icao: /^[A-Z]{4}$/.test(icao) ? icao : '',
    iata: /^[A-Z]{3}$/.test(iata) ? iata : '',
    name: compactText(row.name) || ident,
    type,
    latitude: round(latitude, 6),
    longitude: round(longitude, 6),
    elevationM: round(elevationFt * FT_TO_M, 2),
    country: compactText(row.iso_country),
    region: compactText(row.iso_region),
    municipality: compactText(row.municipality),
  };
}

function normalizeEnd(row, prefix, other, measuredLengthM) {
  const latitude = finite(row[`${prefix}_latitude_deg`]);
  const longitude = finite(row[`${prefix}_longitude_deg`]);
  const elevationFt = finite(row[`${prefix}_elevation_ft`]);
  const displacedFt = finite(row[`${prefix}_displaced_threshold_ft`]) ?? 0;
  if (!inRange(latitude, -90, 90) || !inRange(longitude, -180, 180)) return null;
  if (!inRange(elevationFt, -1500, 30000) || !inRange(displacedFt, 0, measuredLengthM / FT_TO_M / 2)) return null;
  const physical = { latitude: round(latitude, 6), longitude: round(longitude, 6), elevationM: round(elevationFt * FT_TO_M, 2) };
  const displacedThresholdM = round(displacedFt * FT_TO_M, 2);
  const heading = bearingDegrees(physical, other.physical);
  const fraction = displacedThresholdM / measuredLengthM;
  // The source only supplies end elevations; interpolate the threshold along the runway.
  const thresholdElevation = physical.elevationM + (other.physical.elevationM - physical.elevationM) * fraction;
  const point = pointAtDistance(physical, heading, displacedThresholdM);
  return {
    ident: compactText(row[`${prefix}_ident`]).toUpperCase(),
    physical,
    threshold: { ...point, elevationM: round(thresholdElevation, 2) },
    displacedThresholdM,
    headingDegT: round(heading, 1) % 360,
  };
}

/** A runway is only usable when both ends, their elevations and its dimensions agree. */
export function normalizeRunway(row, airport) {
  if (compactText(row.airport_ref) !== airport.id) return null;
  if (compactText(row.closed) === '1') return null;
  const lengthFt = finite(row.length_ft);
  const widthFt = finite(row.width_ft);
  const surface = normalizeSurface(row.surface);
  if (!inRange(lengthFt, 500, 30000) || !inRange(widthFt, 15, 1000)) return null;
  if (!surface) return null;

  const leElevationFt = finite(row.le_elevation_ft);
  const heElevationFt = finite(row.he_elevation_ft);
  if (!inRange(leElevationFt, -1500, 30000) || !inRange(heElevationFt, -1500, 30000)) return null;
  const le = {
    physical: {
      latitude: finite(row.le_latitude_deg),
      longitude: finite(row.le_longitude_deg),
      elevationM: round(leElevationFt * FT_TO_M, 2),
    },
  };
  const he = {
    physical: {
      latitude: finite(row.he_latitude_deg),
      longitude: finite(row.he_longitude_deg),
      elevationM: round(heElevationFt * FT_TO_M, 2),
    },
  };
  if (!inRange(le.physical.latitude, -90, 90) || !inRange(le.physical.longitude, -180, 180)) return null;
  if (!inRange(he.physical.latitude, -90, 90) || !inRange(he.physical.longitude, -180, 180)) return null;
  const measuredLengthM = greatCircleDistanceM(le.physical, he.physical);
  if (!Number.isFinite(measuredLengthM) || measuredLengthM < 100) return null;
  if (Math.abs(measuredLengthM - lengthFt * FT_TO_M) > lengthFt * FT_TO_M * 0.3) return null;

  const leEnd = normalizeEnd(row, 'le', he, measuredLengthM);
  const heEnd = normalizeEnd(row, 'he', le, measuredLengthM);
  if (!leEnd || !heEnd) return null;
  return {
    id: compactText(row.id),
    lengthM: round(lengthFt * FT_TO_M, 1),
    widthM: round(widthFt * FT_TO_M, 1),
    surface,
    lighted: compactText(row.lighted) === '1',
    ends: [leEnd, heEnd],
  };
}

export function tileIdFor(latitude, longitude, degrees = DEFAULT_TILE_DEGREES) {
  const x = Math.floor((longitude + 180) / degrees);
  const y = Math.floor((latitude + 90) / degrees);
  if (x < 0 || x >= 360 / degrees || y < 0 || y >= 180 / degrees) return null;
  return `${y}-${x}`;
}

export function tileBounds(tileId, degrees = DEFAULT_TILE_DEGREES) {
  const [y, x] = tileId.split('-').map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  return {
    south: -90 + y * degrees,
    west: -180 + x * degrees,
    north: -90 + (y + 1) * degrees,
    east: -180 + (x + 1) * degrees,
  };
}

/** Version changes when the sources or the tile layout changes. */
export function versionForSources(sources, tileDegrees = DEFAULT_TILE_DEGREES) {
  const raw = sources.airports.lastModified ?? sources.airports.retrievedAt;
  const stamp = raw ? new Date(raw).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') : 'snapshot';
  const digest = createHash('sha256').update(`${tileDegrees}:${sources.airports.sha256}:${sources.runways.sha256}`).digest('hex').slice(0, 8);
  return `${stamp}-${digest}`;
}

/**
 * Build a versioned set of tiles. The version depends only on source metadata and
 * content, so a fresh download of the same snapshot rebuilds identical files.
 */
export function buildIndex({ airportsCsv, runwaysCsv, sources, version, tileDegrees = DEFAULT_TILE_DEGREES, generatedAt }) {
  const airportsById = new Map();
  const exclusions = { nonLandAirport: 0, invalidAirport: 0, noUsableRunway: 0, invalidRunway: 0 };
  for (const row of parseCsv(airportsCsv)) {
    const airport = normalizeAirport(row);
    if (!airport) {
      if (LAND_AIRPORT_TYPES.has(compactText(row.type))) exclusions.invalidAirport++;
      else exclusions.nonLandAirport++;
      continue;
    }
    airportsById.set(airport.id, { airport, runways: [] });
  }

  for (const row of parseCsv(runwaysCsv)) {
    const entry = airportsById.get(compactText(row.airport_ref));
    if (!entry) continue;
    const runway = normalizeRunway(row, entry.airport);
    if (runway) entry.runways.push(runway);
    else exclusions.invalidRunway++;
  }

  const tiles = new Map();
  const icao = {};
  const iata = {};
  let airportCount = 0;
  let runwayCount = 0;
  const entries = [...airportsById.values()].sort((a, b) => Number(a.airport.id) - Number(b.airport.id));
  for (const entry of entries) {
    if (!entry.runways.length) {
      exclusions.noUsableRunway++;
      continue;
    }
    const { airport } = entry;
    const tileId = tileIdFor(airport.latitude, airport.longitude, tileDegrees);
    if (!tileId) {
      exclusions.invalidAirport++;
      continue;
    }
    entry.runways.sort((a, b) => Number(a.id) - Number(b.id));
    if (!tiles.has(tileId)) {
      tiles.set(tileId, {
        schemaVersion: SCHEMA_VERSION,
        version,
        tile: tileId,
        bounds: tileBounds(tileId, tileDegrees),
        airports: [],
      });
    }
    tiles.get(tileId).airports.push({ ...airport, runways: entry.runways });
    if (airport.icao) icao[airport.icao] = tileId;
    if (airport.iata && !Object.hasOwn(iata, airport.iata)) iata[airport.iata] = tileId;
    airportCount++;
    runwayCount += entry.runways.length;
  }

  const tileSummary = {};
  for (const [tileId, tile] of [...tiles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    tileSummary[tileId] = {
      ...tile.bounds,
      airports: tile.airports.length,
      runways: tile.airports.reduce((sum, airport) => sum + airport.runways.length, 0),
    };
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'flight3d-airport-index',
    version,
    generatedAt: generatedAt ?? new Date().toISOString(),
    horizontalDatum: 'WGS84',
    verticalDatum: 'MSL (OurAirports elevation_ft; approximate orthometric height, no geoid correction)',
    tileDegrees,
    sources,
    counts: { airports: airportCount, runways: runwayCount, exclusions },
    icao,
    iata,
    tiles: tileSummary,
    attribution: 'OurAirports contributors (public domain / Unlicense)',
    sourceUrl: 'https://ourairports.com/data/',
  };
  return { manifest, tiles };
}
