/**
 * Terrain provider contract: ground truth for physics, independent of how the
 * terrain is drawn (analytic meshes, DEM grids, streamed raster/3D tiles).
 *
 * Shared with hajun3d (web/js/terrain_provider.js) so either app can swap
 * providers. Keep the shape in sync with that file.
 *
 *   kind                          'analytic' | 'streamed-raster' | ...
 *   getHeight(x, z)               metres in the sim frame, or null when unknown
 *   getNormal(x, z)               plain {x, y, z} unit vector, or null
 *   isReady(x, z)                 true => getHeight(x, z) is authoritative there
 *   update(position, velocity, camera, viewportHeight)   optional, per frame
 *   visualRoot                    THREE.Object3D to add to the scene, or null
 *   dispose()
 *
 * Callers combine providers with `resolveGroundHeight`, which never returns
 * null/NaN: unready or failed areas fall back to another surface.
 */

import { Vector3 } from 'three';

function toPlainNormal(n) {
  return n ? { x: n.x, y: n.y, z: n.z } : null;
}

/**
 * Wrap an object with a synchronous analytic `getHeight`/`getNormal` (Terrain,
 * LuklaTerrain, JejuFlightSurface, IncheonFlightSurface...). Always ready.
 */
export function analyticTerrainProvider(source, { kind = 'analytic', visualRoot = null } = {}) {
  if (typeof source?.getHeight !== 'function') {
    throw new TypeError('analyticTerrainProvider needs an object with getHeight(x, z)');
  }
  return {
    kind,
    source,
    visualRoot: visualRoot ?? source.mesh ?? source.group ?? null,
    getHeight(x, z) {
      const h = source.getHeight(x, z);
      return Number.isFinite(h) ? h : null;
    },
    getNormal(x, z) {
      return typeof source.getNormal === 'function' ? toPlainNormal(source.getNormal(x, z)) : null;
    },
    isReady: () => true,
    update() {},
    dispose() { source.dispose?.(); },
  };
}

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

/** Height that prefers `provider` where ready and otherwise `fallback(x, z)`. Never null/NaN. */
export function resolveGroundHeight(getProvider, fallback) {
  return (x, z) => {
    const provider = getProvider();
    if (provider?.isReady(x, z)) {
      const h = provider.getHeight(x, z);
      if (Number.isFinite(h)) return h;
    }
    return fallback(x, z);
  };
}

function toNormalVector3(normal) {
  if (!normal) return null;
  const { x, y, z } = normal;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  if (x * x + y * y + z * z <= 0.0001) return null;
  return normal.isVector3 ? normal : new Vector3(x, y, z);
}

function sampleOverrideHeight(override, x, z) {
  if (!override?.isReady?.(x, z)) return null;
  const h = override.getHeight?.(x, z);
  return Number.isFinite(h) ? h : null;
}

/**
 * Ground-height and normal queries for physics. Uses `getOverride()` (a provider
 * swapped in at runtime) when it is ready and yields a finite height, otherwise
 * falls back to the active terrain surface so height and normal always describe
 * the same surface. Adapts plain `{ x, y, z }` normals into `THREE.Vector3`
 * instances for physics consumers.
 */
export function createGroundSurfaceQueries({ getTerrain, getOverride = () => null }) {
  return {
    getGroundHeight(x, z) {
      const overrideHeight = sampleOverrideHeight(getOverride(), x, z);
      if (overrideHeight !== null) return overrideHeight;
      return getTerrain()?.getHeight?.(x, z) ?? 0;
    },
    getGroundNormal(x, z) {
      const override = getOverride();
      if (sampleOverrideHeight(override, x, z) !== null) {
        return toNormalVector3(override.getNormal?.(x, z) ?? null);
      }
      return toNormalVector3(getTerrain()?.getNormal?.(x, z) ?? null);
    },
  };
}

/**
 * Ground-height query for physics. Uses `getOverride()` (a provider swapped in
 * at runtime) where it is ready, otherwise the active terrain surface, otherwise
 * 0. Behaves exactly like the former `terrain?.getHeight?.(x, z) ?? 0` when no
 * override is set.
 */
export function createGroundHeightQuery(options) {
  return createGroundSurfaceQueries(options).getGroundHeight;
}

/** Throws unless `provider` implements the contract; used by conformance tests. */
export function assertTerrainProviderContract(provider, points = [[0, 0]]) {
  for (const name of ['getHeight', 'getNormal', 'isReady', 'update', 'dispose']) {
    if (typeof provider?.[name] !== 'function') throw new Error(`terrain provider is missing ${name}()`);
  }
  if (typeof provider.kind !== 'string') throw new Error('terrain provider needs a string kind');
  for (const [x, z] of points) {
    const h = provider.getHeight(x, z);
    if (h !== null && !Number.isFinite(h)) throw new Error(`getHeight(${x}, ${z}) must be a finite number or null`);
    if (provider.isReady(x, z) && h === null) throw new Error(`isReady(${x}, ${z}) is true but getHeight is null`);
    const n = provider.getNormal(x, z);
    if (n !== null) {
      const len = Math.hypot(n.x, n.y, n.z);
      if (!(Math.abs(len - 1) < 1e-3) || n.y <= 0) throw new Error(`getNormal(${x}, ${z}) must be an upward unit vector`);
    }
  }
  return true;
}
