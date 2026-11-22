// First externally indexed destination for #922 step 2. The mesh/contact
// geometry is built from the committed OurAirports index, not per-airport code.
export const EXTERNAL_DESTINATION_CODES = Object.freeze(['RKSS']);

export function isExternalDestination(value) {
  if (typeof value !== 'string') return false;
  const code = value.trim().toUpperCase();
  return EXTERNAL_DESTINATION_CODES.includes(code) || /^[A-Z]{4}$/.test(code);
}
