// Externally indexed destinations that the runtime can actually stream.
// The map catalog registers its index-backed codes here at load time; no
// arbitrary four-letter token is accepted.
export const EXTERNAL_DESTINATION_CODES = Object.freeze(['RKSS']);
const RESERVED_REGION_IDS = new Set(['coastal', 'incheon', 'jeju', 'lukla', 'neon', 'valley']);
const known = new Set(EXTERNAL_DESTINATION_CODES);

export function registerExternalDestinations(codes = []) {
  for (const value of codes) {
    if (typeof value !== 'string') continue;
    const code = value.trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(code) && !RESERVED_REGION_IDS.has(code.toLowerCase())) known.add(code);
  }
}

export function isExternalDestination(value) {
  if (typeof value !== 'string') return false;
  const code = value.trim().toUpperCase();
  return known.has(code) && !RESERVED_REGION_IDS.has(code.toLowerCase());
}
