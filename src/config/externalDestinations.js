// First externally indexed destination for #922 step 2. The mesh/contact
// geometry is built from the committed OurAirports index, not per-airport code.
export const EXTERNAL_DESTINATION_CODES = Object.freeze(['RKSS']);

export function isExternalDestination(value) {
  return typeof value === 'string' && EXTERNAL_DESTINATION_CODES.includes(value.trim().toUpperCase());
}
