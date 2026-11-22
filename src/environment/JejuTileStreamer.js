import * as THREE from 'three';
import { TileCacheManager } from './TileCacheManager.js';
import {
  wgs84ToLocal,
  tileBoundsWgs84,
  localToWgs84,
  wgs84ToTile,
} from '../geospatial/TileCoordinateSystem.js';

export const JEJU_ORIGIN = Object.freeze({
  latitude: 33.5113,
  longitude: 126.4930,
});

/**
 * 8-tile grid at Zoom 10 covering 100% of Jeju Island (72km East-West, 36km North-South)
 * plus surrounding ocean and outlying islands (Chagwido, Suwolbong, Udo, Seongsan).
 * Tile X: 870 (West Chagwido/Suwolbong), 871 (Central-West/RKPC), 872 (Central-East/Jeju City), 873 (East Seongsan/Udo)
 * Tile Y: 410 (North Jeju / Sea), 411 (South Jeju / Seogwipo / South Sea)
 */
export const JEJU_MACRO_TILES = Object.freeze([
  { z: 10, x: 870, y: 410, col: 0, row: 0 },
  { z: 10, x: 871, y: 410, col: 1, row: 0 },
  { z: 10, x: 872, y: 410, col: 2, row: 0 },
  { z: 10, x: 873, y: 410, col: 3, row: 0 },
  { z: 10, x: 870, y: 411, col: 0, row: 1 },
  { z: 10, x: 871, y: 411, col: 1, row: 1 },
  { z: 10, x: 872, y: 411, col: 2, row: 1 },
  { z: 10, x: 873, y: 411, col: 3, row: 1 },
]);

/**
 * Generate macro tiles for Jeju Island covering the exact same geographic bounds:
 * - Zoom 10: 4 columns x 2 rows (8 tiles) -> 1024x512 canvas (~128m/px)
 * - Zoom 11: 8 columns x 4 rows (32 tiles) -> 2048x1024 canvas (~64m/px)
 */
export function createJejuMacroTiles(zoom = 10) {
  if (zoom === 11) {
    const tiles = [];
    const minTileX = 1740;
    const minTileY = 820;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 8; col++) {
        tiles.push({
          z: 11,
          x: minTileX + col,
          y: minTileY + row,
          col,
          row,
        });
      }
    }
    return Object.freeze(tiles);
  }
  return JEJU_MACRO_TILES;
}

function getQueryParam(key) {
  if (typeof window !== 'undefined' && window.location?.search) {
    try {
      return new URLSearchParams(window.location.search).get(key);
    } catch {
      return null;
    }
  }
  return null;
}

export class JejuTileStreamer {
  /**
   * @param {THREE.Mesh} terrainMesh - The 80km x 56km terrain mesh for Jeju Island
   * @param {Object} flightSurface - JejuFlightSurface instance for physics & elevation
   * @param {Object} [options]
   * @param {number} [options.zoom=10] - Zoom level (10 or 11)
   * @param {number} [options.anisotropy=1] - Texture anisotropy filtering level
   */
  constructor(terrainMesh, flightSurface, options = {}) {
    this.terrainMesh = terrainMesh;
    this.flightSurface = flightSurface;
    this.origin = options.origin || JEJU_ORIGIN;
    this.cacheManager = options.cacheManager || new TileCacheManager(options.cacheOptions);

    const urlZoom = parseInt(getQueryParam('jejuZoom'), 10);
    this.zoom = Number.isFinite(urlZoom) ? urlZoom : (options.zoom ?? 10);

    const urlAnisotropy = parseInt(getQueryParam('jejuAnisotropy'), 10);
    this.anisotropy = Number.isFinite(urlAnisotropy) ? urlAnisotropy : (options.anisotropy ?? 1);

    if (this.zoom === 11) {
      this.minTileX = 1740;
      this.totalTilesX = 8;
      this.minTileY = 820;
      this.totalTilesY = 4;
      this.macroTiles = createJejuMacroTiles(11);
    } else {
      this.zoom = 10;
      this.minTileX = 870;
      this.totalTilesX = 4;
      this.minTileY = 410;
      this.totalTilesY = 2;
      this.macroTiles = JEJU_MACRO_TILES;
    }

    this.macroTexture = null;
    this.canvas = null;
    this.tilesLoaded = 0;
    this.isStreaming = false;
    this.activeLOD = 'macro';
    this.disposed = false;

    // Geographic bounding box in local Three.js meters
    const nw = tileBoundsWgs84(this.minTileX, this.minTileY, this.zoom).nw;
    const se = tileBoundsWgs84(
      this.minTileX + this.totalTilesX - 1,
      this.minTileY + this.totalTilesY - 1,
      this.zoom
    ).se;

    const [nwX, nwZ] = wgs84ToLocal(nw.latitude, nw.longitude, this.origin);
    const [seX, seZ] = wgs84ToLocal(se.latitude, se.longitude, this.origin);

    this.gridBounds = {
      minX: Math.min(nwX, seX),
      maxX: Math.max(nwX, seX),
      minZ: Math.min(nwZ, seZ),
      maxZ: Math.max(nwZ, seZ),
    };
  }

  /**
   * Surface elevation is ALWAYS delegated to JejuFlightSurface.
   * Guarantees ground physics, landing, and ditching integrity regardless
   * of network failures, tile loading latency, or cache misses.
   */
  getHeight(x, z) {
    return this.flightSurface.getHeight(x, z);
  }

  getNormal(x, z) {
    return this.flightSurface.getNormal(x, z);
  }

  isRunwaySafetyArea(x, z) {
    return this.flightSurface.isRunwaySafetyArea(x, z);
  }

  isOnRunway(x, z) {
    return this.flightSurface.isOnRunway(x, z);
  }

  /**
   * Update UV coordinates of the terrain geometry by projecting each vertex
   * from local metric tangent plane into WGS84 and fractional Web Mercator coordinates.
   * Guarantees exact runway, threshold, and coastline visual alignment without nonlinear drift.
   */
  updateMeshUVs() {
    if (!this.terrainMesh?.geometry) return;

    const geometry = this.terrainMesh.geometry;
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    if (!pos || !uv) return;

    const minTileX = this.minTileX;
    const totalTilesX = this.totalTilesX;
    const minTileY = this.minTileY;
    const totalTilesY = this.totalTilesY;
    const zoom = this.zoom;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // 1. Inverse-project metric tangent plane vertex to WGS84
      const { latitude, longitude } = localToWgs84(x, z, this.origin);

      // 2. Exact fractional Web Mercator tile coordinates
      const tile = wgs84ToTile(latitude, longitude, zoom);
      const exactX = tile.x + tile.fx;
      const exactY = tile.y + tile.fy;

      // 3. Normalized UV coordinates [0, 1] across the stitched canvas
      // In Web Mercator Y=0 is North, Y=1 is South; in Three.js UV V=1 is North, V=0 is South
      const u = (exactX - minTileX) / totalTilesX;
      const v = 1.0 - (exactY - minTileY) / totalTilesY;

      uv.setXY(i, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
    }
    uv.needsUpdate = true;
  }

  /**
   * Fetch and stitch the macro tiles covering Jeju Island.
   * Resolves gracefully on network failure by preserving existing terrain shading.
   * @returns {Promise<boolean>} Whether satellite streaming successfully applied
   */
  async loadIslandMacroTiles() {
    if (this.disposed || typeof document === 'undefined') {
      // In headless test environments or disposed instance
      return false;
    }

    this.isStreaming = true;

    try {
      const tiles = this.macroTiles;
      // Fetch macro tiles concurrently through the rate-limited CacheManager
      const tilePromises = tiles.map(async (t) => {
        const img = await this.cacheManager.getTileImage(t.z, t.x, t.y);
        return { ...t, img };
      });

      const results = await Promise.all(tilePromises);
      if (this.disposed) return false;

      const successful = results.filter((r) => r.img && r.img.width > 0);

      // Thread 2: Only swap material map when ALL macro tiles successfully load.
      // If any tile fails or network times out, retain the procedural ground shading
      // so un-covered regions are never rendered black.
      if (successful.length !== tiles.length) {
        return false;
      }

      this.tilesLoaded = successful.length;

      // Stitch onto canvas (totalTilesX * 256 by totalTilesY * 256)
      const canvasWidth = this.totalTilesX * 256;
      const canvasHeight = this.totalTilesY * 256;

      const dimensionsChanged = Boolean(
        this.canvas &&
        (this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight)
      );

      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
      }
      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;

      const ctx = this.canvas.getContext('2d');
      if (!ctx || this.disposed) return false;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      for (const t of successful) {
        ctx.drawImage(t.img, t.col * 256, t.row * 256, 256, 256);
      }

      if (this.disposed) return false;

      // Update mesh UV mapping
      this.updateMeshUVs();

      if (this.disposed) return false;

      // Recreate Three.js texture when dimensions change (WebGL2 immutable storage requirement)
      if (dimensionsChanged && this.macroTexture) {
        this.macroTexture.dispose();
        this.macroTexture = null;
      }

      if (!this.macroTexture) {
        this.macroTexture = new THREE.CanvasTexture(this.canvas);
        this.macroTexture.colorSpace = THREE.SRGBColorSpace;
        this.macroTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.macroTexture.wrapT = THREE.ClampToEdgeWrapping;
      }
      this.macroTexture.anisotropy = this.anisotropy;
      this.macroTexture.needsUpdate = true;

      // Thread 3: Check disposed state before applying texture to terrain material
      if (this.terrainMesh?.material && !this.disposed) {
        this.terrainMesh.material.map = this.macroTexture;
        this.terrainMesh.material.vertexColors = false;
        this.terrainMesh.material.needsUpdate = true;
      }

      return true;
    } catch {
      // Graceful offline fallback: preserve procedural terrain
      return false;
    }
  }

  /**
   * Dynamically update zoom or anisotropy configuration and reload tiles if necessary.
   * @param {Object} config
   * @param {number} [config.zoom]
   * @param {number} [config.anisotropy]
   * @returns {Promise<boolean>}
   */
  async setConfig({ zoom, anisotropy } = {}) {
    if (anisotropy !== undefined) {
      this.anisotropy = anisotropy;
      if (this.macroTexture) {
        this.macroTexture.anisotropy = this.anisotropy;
        this.macroTexture.needsUpdate = true;
      }
    }

    if (zoom !== undefined && zoom !== this.zoom) {
      this.zoom = zoom;
      if (this.zoom === 11) {
        this.minTileX = 1740;
        this.totalTilesX = 8;
        this.minTileY = 820;
        this.totalTilesY = 4;
        this.macroTiles = createJejuMacroTiles(11);
      } else {
        this.zoom = 10;
        this.minTileX = 870;
        this.totalTilesX = 4;
        this.minTileY = 410;
        this.totalTilesY = 2;
        this.macroTiles = JEJU_MACRO_TILES;
      }
      return this.loadIslandMacroTiles();
    }

    return true;
  }

  /**
   * Current streaming and memory metrics.
   */
  getMetrics() {
    return {
      activeLOD: this.activeLOD,
      tilesLoaded: this.tilesLoaded,
      isStreaming: this.isStreaming,
      gridBounds: this.gridBounds,
      disposed: this.disposed,
      cache: this.cacheManager.getMetrics(),
    };
  }

  /**
   * Cleanly dispose of GPU textures, canvases, and cache resources.
   */
  dispose() {
    this.disposed = true;
    this.isStreaming = false;
    if (this.macroTexture) {
      this.macroTexture.dispose();
      this.macroTexture = null;
    }
    this.canvas = null;
    this.cacheManager.dispose();
  }
}
