/**
 * src/config/terrainInsets.js
 *
 * Declarative registry for high-resolution terrain insets.
 * Expresses region-specific high-detail areas (e.g. airport precincts)
 * as data consumed by the common tile streaming engine (OpenWorldTerrain).
 *
 * Each inset specifies:
 * - id: unique identifier
 * - region: associated airport/region id ('jeju', 'incheon', etc.)
 * - name: descriptive name
 * - bounds: [minX, minZ, maxX, maxZ] in local metric coordinates relative to region origin
 * - minDetailLevel: zoom level to request on initial approach (e.g. 13)
 * - maxDetailLevel: maximum zoom level on close approach / final (e.g. 14)
 * - approachDistanceM: camera distance threshold in meters to trigger detail refinement
 */

export const TERRAIN_INSETS = Object.freeze([
  Object.freeze({
    id: 'rksi',
    region: 'incheon',
    name: 'Incheon International Airport (RKSI) Inset',
    bounds: Object.freeze([-3200, -2500, 3200, 2500]),
    minDetailLevel: 13,
    maxDetailLevel: 14,
    approachDistanceM: 8000,
  }),
  Object.freeze({
    id: 'rkpc',
    region: 'jeju',
    name: 'Jeju International Airport (RKPC) Inset',
    // [-3200, -1500, 3200, 1500] covers RKPC runway 07/25, runway 13/31, apron, and terminal precinct
    bounds: Object.freeze([-3200, -1500, 3200, 1500]),
    minDetailLevel: 13,
    maxDetailLevel: 14,
    approachDistanceM: 8000,
  }),
]);

/**
 * Returns all active insets for a specific region.
 * @param {string} region
 * @returns {Array<Object>}
 */
export function getInsetsForRegion(region) {
  return TERRAIN_INSETS.filter((inset) => inset.region === region);
}
