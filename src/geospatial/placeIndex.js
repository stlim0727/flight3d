// Browser-side loader for the committed GeoNames place index.
// The manifest pins the artifact path, schema and count so a stale or partial
// artifact is rejected instead of silently yielding empty search results.
export const PLACE_SCHEMA_VERSION = 1;

/** Vite injects BASE_URL (e.g. `/flight3d/` on Pages); Node falls back to `/`. */
export function placeDataBaseUrl(base) {
  const configured = typeof import.meta.env === 'object' ? import.meta.env.BASE_URL : undefined;
  const prefix = base ?? configured ?? '/';
  return `${prefix.endsWith('/') ? prefix : `${prefix}/`}data/places/`;
}

const DEFAULT_BASE_URL = placeDataBaseUrl();
const manifestCache = new Map();
const searchIndexCache = new Map();

function resourceUrl(baseUrl, path) {
  const root = new URL(baseUrl, globalThis.location?.href ?? 'http://localhost/');
  return new URL(path, root).toString();
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Place index request failed (${response.status}): ${url}`);
  return response.json();
}

function validCoordinate(entry) {
  return Number.isFinite(entry?.latitude) && Number.isFinite(entry?.longitude)
    && entry.latitude >= -90 && entry.latitude <= 90
    && entry.longitude >= -180 && entry.longitude <= 180;
}

export function clearPlaceIndexCache() {
  manifestCache.clear();
  searchIndexCache.clear();
}

/** Fetch and validate the small root manifest; cached per base URL. */
export async function loadPlaceManifest({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (manifestCache.has(baseUrl)) return manifestCache.get(baseUrl);
  const manifest = await getJson(resourceUrl(baseUrl, 'manifest.json'), fetchImpl);
  if (manifest?.schemaVersion !== 1 || manifest.kind !== 'flight3d-place-index'
    || typeof manifest.version !== 'string' || !manifest.version
    || !manifest.searchIndex || typeof manifest.searchIndex.path !== 'string') {
    throw new Error('Unsupported place index manifest');
  }
  manifestCache.set(baseUrl, manifest);
  return manifest;
}

/** Load the compact place artifact lazily, validating every entry. */
export async function loadPlaceSearchIndex(manifest, {
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  const descriptor = manifest?.searchIndex;
  if (!descriptor || descriptor.schemaVersion !== PLACE_SCHEMA_VERSION
    || !Number.isInteger(descriptor.count) || descriptor.count < 0) {
    throw new Error('Unsupported place search index');
  }
  const key = `${baseUrl}|${manifest.version}|${descriptor.path}`;
  if (searchIndexCache.has(key)) return searchIndexCache.get(key);
  const index = await getJson(resourceUrl(baseUrl, descriptor.path), fetchImpl);
  if (index?.schemaVersion !== PLACE_SCHEMA_VERSION || index.version !== manifest.version
    || !Array.isArray(index.places) || index.places.length !== descriptor.count) {
    throw new Error('Invalid place search index');
  }
  for (const entry of index.places) {
    if (!entry || typeof entry.id !== 'string' || !entry.id
      || typeof entry.label !== 'string' || !entry.label
      || !Array.isArray(entry.aliases) || !entry.aliases.every(alias => typeof alias === 'string')
      || typeof entry.country !== 'string' || typeof entry.kind !== 'string'
      || typeof entry.detail !== 'string' || !validCoordinate(entry)) {
      throw new Error('Invalid place search index entry');
    }
  }
  Object.freeze(index.places);
  searchIndexCache.set(key, index.places);
  return index.places;
}
