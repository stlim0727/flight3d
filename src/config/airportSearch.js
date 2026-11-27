// Pure search over the lobby map catalog. No DOM, storage, or catalog mutation.

const DEFAULT_LIMIT = 20;

const EXACT = 0;
const PREFIX = 1;
const NAME_EXACT = 2;
const NAME_PREFIX = 3;
const TOKEN_PREFIX = 4;
const SUBSTRING = 5;

const normalizedPlaceCache = new WeakMap();

/**
 * Fold a user query or catalog field for comparison: lowercase, no accents,
 * punctuation treated as word separators, and single-spaced.
 */
export function normalizeSearchText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasCoordinates(place) {
  return !!place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude);
}

function identifierScore(identifiers, query) {
  if (identifiers.some(identifier => identifier === query)) return EXACT;
  if (identifiers.some(identifier => identifier.startsWith(query))) return PREFIX;
  return -1;
}

function textScore(text, query) {
  if (!text) return -1;
  if (text === query) return NAME_EXACT;
  const words = text.split(' ');
  if (text.startsWith(query)) return NAME_PREFIX;
  const terms = query.split(' ');
  if (terms.every(term => words.some(word => word.startsWith(term)))) return TOKEN_PREFIX;
  if (text.includes(query)) return SUBSTRING;
  return -1;
}

function bestNormalizedTextScore(normalizedTexts, query) {
  let best = -1;
  for (const text of normalizedTexts) {
    if (!text) continue;
    const score = textScore(text, query);
    if (score >= 0 && (best < 0 || score < best)) best = score;
  }
  return best;
}

function bestTextScore(texts, query) {
  let best = -1;
  for (const text of texts.map(normalizeSearchText)) {
    if (!text) continue;
    const score = textScore(text, query);
    if (score >= 0 && (best < 0 || score < best)) best = score;
  }
  return best;
}

function airportMatch(airport, query) {
  const code = typeof airport.code === 'string' ? airport.code.trim()
    : typeof airport.icao === 'string' ? airport.icao.trim() : '';
  if (!hasCoordinates(airport) || !code) return null;
  const name = typeof airport.name === 'string' ? airport.name.trim() : '';
  const iata = typeof airport.iata === 'string' ? airport.iata.trim() : '';
  const identifiers = [code, iata].filter(Boolean).map(normalizeSearchText);
  const codeScore = identifierScore(identifiers, query);
  const aliases = Array.isArray(airport.aliases) ? airport.aliases : [airport.ko, airport.en, airport.nameKo].filter(Boolean);
  const score = codeScore >= 0 ? codeScore : bestTextScore([name, ...aliases], query);
  if (score < 0) return null;
  const detail = iata
    ? `IATA ${iata}`
    : airport.type
      ? String(airport.type)
      : `${airport.latitude.toFixed(3)}, ${airport.longitude.toFixed(3)}`;
  return {
    score,
    result: {
      kind: 'airport',
      id: code,
      label: `${code} · ${name}`,
      detail,
      latitude: airport.latitude,
      longitude: airport.longitude,
    },
  };
}

function pointMatch(point, query) {
  if (!hasCoordinates(point)) return null;
  const id = typeof point.id === 'string' ? point.id.trim() : '';
  const label = typeof point.label === 'string' ? point.label.trim() : '';
  const aliases = Array.isArray(point.aliases) ? point.aliases : [point.ko, point.en].filter(Boolean);
  const score = bestTextScore([label, id, ...aliases], query);
  if (score < 0) return null;
  return {
    score,
    result: {
      kind: 'point',
      id,
      label,
      detail: typeof point.detail === 'string' && point.detail ? point.detail : 'cruise',
      latitude: point.latitude,
      longitude: point.longitude,
      ...(Number.isFinite(point.altitudeM) ? { altitudeM: point.altitudeM } : {}),
      ...(Number.isFinite(point.headingDeg) ? { headingDeg: point.headingDeg } : {}),
    },
  };
}

function regionMatch(region, query) {
  if (!region || typeof region.id !== 'string' || !region.id.trim()) return null;
  const id = region.id.trim();
  const code = typeof region.code === 'string' ? region.code.trim() : '';
  const label = typeof region.label === 'string' ? region.label.trim() : '';
  const aliases = Array.isArray(region.aliases) ? region.aliases : [];
  const identifiers = [code, id].filter(Boolean).map(normalizeSearchText);
  const codeScore = identifierScore(identifiers, query);
  const score = codeScore >= 0 ? codeScore : bestTextScore([label, ...aliases], query);
  if (score < 0) return null;
  return {
    score,
    result: {
      kind: 'region',
      id,
      label: label || code || id,
      detail: code || 'region',
      ...(region.nameKey ? { nameKey: region.nameKey } : {}),
    },
  };
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
function rankedMatches(matches, max, scored) {
  matches.sort((a, b) => a.score - b.score
    || (b.population ?? 0) - (a.population ?? 0)
    || compareText(a.result.kind, b.result.kind)
    || compareText(a.result.id, b.result.id)
    || compareText(a.result.label, b.result.label));
  return matches.slice(0, max).map(match => scored ? { ...match.result, score: match.score } : match.result);
}

/** Ranked catalog matches with their score, for merging with global results. */
export function searchMapPlacesScored(places, query, limit = DEFAULT_LIMIT) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const max = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : DEFAULT_LIMIT;
  if (max === 0) return [];

  const airports = Array.isArray(places?.airports) ? places.airports : [];
  const points = Array.isArray(places?.points) ? places.points : [];
  const regions = Array.isArray(places?.regions) ? places.regions : [];
  const matches = [];
  for (const airport of airports) {
    const match = airportMatch(airport, normalized);
    if (match) matches.push(match);
  }
  for (const point of points) {
    const match = pointMatch(point, normalized);
    if (match) matches.push(match);
  }
  for (const region of regions) {
    const match = regionMatch(region, normalized);
    if (match) matches.push(match);
  }
  return rankedMatches(matches, max, true);
}

/** Return up to `limit` catalog places ranked by code match, then text match. */
export function searchMapPlaces(places, query, limit = DEFAULT_LIMIT) {
  return searchMapPlacesScored(places, query, limit).map(({ score, ...result }) => result);
}

/** Ranked global matches with their score, for merging with local results. */
export function searchAirportIndexScored(index, query, limit = DEFAULT_LIMIT) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const max = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : DEFAULT_LIMIT;
  if (max === 0) return [];
  const airports = Array.isArray(index) ? index : index?.airports;
  if (!Array.isArray(airports)) return [];
  const matches = [];
  for (const airport of airports) {
    const match = airportMatch(airport, normalized);
    if (match) matches.push(match);
  }
  return rankedMatches(matches, max, true);
}

/**
 * Search the compact global artifact (an entry array or `{ airports }`) with
 * the same normalization and ranking as the local catalog. No DOM, no fetch.
 */
export function searchAirportIndex(index, query, limit = DEFAULT_LIMIT) {
  return searchAirportIndexScored(index, query, limit).map(({ score, ...result }) => result);
}

/** Default cruise altitude above MSL for a GeoNames place. */
export function placeCruiseAltitude(entry) {
  const elevation = Number.isFinite(entry?.elevationM) ? entry.elevationM : 0;
  return Math.max(600, Math.round((elevation + 700) / 50) * 50);
}

function preparedPlaces(places) {
  let cached = normalizedPlaceCache.get(places);
  if (cached && cached.length === places.length) return cached;
  cached = places.map(entry => {
    if (!hasCoordinates(entry)) return null;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [entry.ko, entry.en].filter(Boolean);
    const texts = [label, id, ...aliases].map(normalizeSearchText).filter(Boolean);
    return {
      entry,
      id,
      label,
      detail: typeof entry.detail === 'string' && entry.detail ? entry.detail : 'cruise',
      population: Number.isFinite(entry.population) ? entry.population : 0,
      texts,
    };
  });
  normalizedPlaceCache.set(places, cached);
  return cached;
}

/** Ranked matches from the offline GeoNames place index, using the local point rules. */
export function searchPlaceIndexScored(index, query, limit = DEFAULT_LIMIT) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const max = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : DEFAULT_LIMIT;
  if (max === 0) return [];
  const places = Array.isArray(index) ? index : index?.places;
  if (!Array.isArray(places)) return [];
  const matches = [];
  for (const item of preparedPlaces(places)) {
    if (!item) continue;
    const score = bestNormalizedTextScore(item.texts, normalized);
    if (score < 0) continue;
    matches.push({
      score,
      population: item.population,
      result: {
        kind: 'point',
        id: item.id,
        label: item.label,
        detail: item.detail,
        latitude: item.entry.latitude,
        longitude: item.entry.longitude,
        altitudeM: placeCruiseAltitude(item.entry),
        headingDeg: 90,
      },
    });
  }
  return rankedMatches(matches, max, true);
}

/** Plain (unscored) results from the offline place index. */
export function searchPlaceIndex(index, query, limit = DEFAULT_LIMIT) {
  return searchPlaceIndexScored(index, query, limit).map(({ score, ...result }) => result);
}

/** Merge scored local and global matches; exact global codes outrank weak local text hits. */
export function mergeScoredResults(localResults, globalResults, limit = DEFAULT_LIMIT) {
  const max = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : DEFAULT_LIMIT;
  const candidates = new Map();
  let order = 0;
  for (const result of localResults) {
    const key = `${result.kind}:${result.id}`;
    if (!candidates.has(key)) candidates.set(key, { result, source: 'local', tie: 0, order: order++ });
  }
  for (const result of globalResults) {
    const key = `${result.kind}:${result.id}`;
    if (!candidates.has(key)) candidates.set(key, { result, source: 'global', tie: 1, order: order++ });
  }
  return [...candidates.values()]
    .sort((a, b) => a.result.score - b.result.score || a.tie - b.tie || a.order - b.order)
    .slice(0, max)
    .map(({ result, source }) => {
      const { score, ...place } = result;
      return { ...place, key: `${place.kind}:${place.id}`, source };
    });
}
