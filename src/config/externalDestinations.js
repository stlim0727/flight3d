// Externally indexed destinations that the runtime can actually stream.
// RKSI (Incheon), RKPC (Jeju) and VNLK (Lukla) back built-in presets, so they
// must not depend on the optional map catalog; other index codes register at
// catalog load.
export const EXTERNAL_DESTINATION_CODES = Object.freeze(['RKSS', 'RKSI', 'RKPC', 'VNLK']);
const RESERVED_REGION_IDS = new Set(['coastal', 'incheon', 'jeju', 'lukla', 'neon', 'valley']);
// OurAirports idents also use digits and hyphens (01A, SA34, BR-1941, US-6882).
// The bounded shape still rejects paths, whitespace, stray separators and
// generated region IDs.
const SAFE_CODE = /^(?=.{2,12}$)[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const SAFE_TILE_ID = /^[0-9]{1,3}-[0-9]{1,3}$/;
const known = new Set(EXTERNAL_DESTINATION_CODES);
const tilesByCode = new Map();

function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!SAFE_CODE.test(code) || RESERVED_REGION_IDS.has(code.toLowerCase())) return null;
  return code;
}

export function normalizeExternalTileId(value) {
  if (typeof value !== 'string') return null;
  const tileId = value.trim();
  return SAFE_TILE_ID.test(tileId) ? tileId : null;
}

/** Register index codes; `{ code, tileId }` entries disambiguate collisions. */
export function registerExternalDestinations(codes = []) {
  for (const entry of codes) {
    const record = entry && typeof entry === 'object' ? entry : null;
    const code = normalizeCode(record ? record.code : entry);
    if (!code) continue;
    known.add(code);
    const tileId = normalizeExternalTileId(record?.tileId);
    if (tileId) tilesByCode.set(code, tileId);
  }
}

/** Tile hint remembered for a registered destination, or null. */
export function externalDestinationTileId(value) {
  const code = normalizeCode(value);
  return code ? tilesByCode.get(code) ?? null : null;
}

export function isExternalDestination(value) {
  const code = normalizeCode(value);
  return code !== null && known.has(code);
}
