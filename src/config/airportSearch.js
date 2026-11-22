// Pure search over the lobby map catalog. No DOM, storage, or catalog mutation.

const DEFAULT_LIMIT = 20;

const EXACT = 0;
const PREFIX = 1;
const NAME_PREFIX = 2;
const TOKEN_PREFIX = 3;
const SUBSTRING = 4;

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
  const words = text.split(' ');
  if (text.startsWith(query)) return NAME_PREFIX;
  const terms = query.split(' ');
  if (terms.every(term => words.some(word => word.startsWith(term)))) return TOKEN_PREFIX;
  if (text.includes(query)) return SUBSTRING;
  return -1;
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
  if (!hasCoordinates(airport) || typeof airport.code !== 'string' || !airport.code.trim()) return null;
  const code = airport.code.trim();
  const name = typeof airport.name === 'string' ? airport.name.trim() : '';
  const iata = typeof airport.iata === 'string' ? airport.iata.trim() : '';
  const identifiers = [code, iata].filter(Boolean).map(normalizeSearchText);
  const codeScore = identifierScore(identifiers, query);
  const score = codeScore >= 0 ? codeScore : bestTextScore([name], query);
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
      detail: 'cruise',
      latitude: point.latitude,
      longitude: point.longitude,
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

/** Return up to `limit` catalog places ranked by code match, then text match. */
export function searchMapPlaces(places, query, limit = DEFAULT_LIMIT) {
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

  matches.sort((a, b) => a.score - b.score
    || compareText(a.result.kind, b.result.kind)
    || compareText(a.result.id, b.result.id)
    || compareText(a.result.label, b.result.label));
  return matches.slice(0, max).map(match => match.result);
}
