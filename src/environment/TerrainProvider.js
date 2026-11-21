/**
 * Terrain provider contract: ground truth for physics, independent of how the
 * terrain is drawn (analytic meshes, DEM grids, streamed raster/3D tiles).
 *
 * The headless contract, analytic wrapper, paired surface queries, and
 * conformance assertion live in `@stlim0727/flightsim-core/terrain/TerrainProvider.js`
 * (shared with hajun3d). Flight3d adds `openWorldTerrainProvider` here for
 * `OpenWorldTerrain`.
 */

export {
  analyticTerrainProvider,
  assertTerrainProviderContract,
  createGroundHeightQuery,
  createGroundSurfaceQueries,
  resolveGroundHeight,
  toNormalVector3,
} from '@stlim0727/flightsim-core/terrain/TerrainProvider.js';

/**
 * Wrap OpenWorldTerrain. Heights are only authoritative where a tile is loaded
 * and outside its protected areas (airport surfaces own those), so isReady is
 * false there and callers fall back to the airport/flight surface.
 */
export function openWorldTerrainProvider(world, { normalStepM = 30 } = {}) {
  const height = (x, z) => {
    const s = world.sample(x, z);
    return s ? s.height : null;
  };
  return {
    kind: 'streamed-raster',
    source: world,
    visualRoot: world.group ?? null,
    getHeight: height,
    getNormal(x, z) {
      const d = normalStepM;
      const hl = height(x - d, z), hr = height(x + d, z), hf = height(x, z - d), hb = height(x, z + d);
      if ([hl, hr, hf, hb].some(v => v === null)) return null;
      const nx = hl - hr, nz = hf - hb, ny = 2 * d;
      const len = Math.hypot(nx, ny, nz);
      return { x: nx / len, y: ny / len, z: nz / len };
    },
    isReady: (x, z) => !world.protects(x, z) && world.sample(x, z) !== undefined,
    update(position, velocity, camera, viewportHeight) {
      world.update(position, velocity, camera, viewportHeight);
    },
    dispose() { world.dispose(); },
  };
}
