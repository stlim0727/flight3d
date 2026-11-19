import * as THREE from 'three';
import { TileCacheManager } from './TileCacheManager.js';
import {
  wgs84ToLocal,
  tileBoundsWgs84,
} from '../geospatial/TileCoordinateSystem.js';

export const JEJU_ORIGIN = Object.freeze({
  latitude: 33.5113,
  longitude: 126.4930,
});

/**
 * 4-tile grid at Zoom 10 covering 100% of Jeju Island (72km East-West, 36km North-South).
 * Tile X: 871 (West Jeju), 872 (East Jeju)
 * Tile Y: 410 (North Jeju / RKPC), 411 (South Jeju / Seogwipo)
 */
export const JEJU_MACRO_TILES = Object.freeze([
  { z: 10, x: 871, y: 410, col: 0, row: 0 },
  { z: 10, x: 872, y: 410, col: 1, row: 0 },
  { z: 10, x: 871, y: 411, col: 0, row: 1 },
  { z: 10, x: 872, y: 411, col: 1, row: 1 },
]);

export class JejuTileStreamer {
  /**
   * @param {THREE.Mesh} terrainMesh - The 80km x 56km terrain mesh for Jeju Island
   * @param {Object} flightSurface - JejuFlightSurface instance for physics & elevation
   * @param {Object} [options]
   */
  constructor(terrainMesh, flightSurface, options = {}) {
    this.terrainMesh = terrainMesh;
    this.flightSurface = flightSurface;
    this.origin = options.origin || JEJU_ORIGIN;
    this.cacheManager = options.cacheManager || new TileCacheManager(options.cacheOptions);

    this.macroTexture = null;
    this.canvas = null;
    this.tilesLoaded = 0;
    this.isStreaming = false;
    this.activeLOD = 'macro';

    // Geographic bounding box of the 4-tile Zoom 10 grid in local Three.js meters
    // Tile 871..872, 410..411
    const nw = tileBoundsWgs84(871, 410, 10).nw;
    const se = tileBoundsWgs84(872, 411, 10).se;

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
   * Update UV coordinates of the terrain geometry to match the Web Mercator tile grid.
   */
  updateMeshUVs() {
    if (!this.terrainMesh?.geometry) return;

    const geometry = this.terrainMesh.geometry;
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    if (!pos || !uv) return;

    const { minX, maxX, minZ, maxZ } = this.gridBounds;
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // Normalized coordinates [0, 1] across the 4-tile grid
      const u = (x - minX) / spanX;
      // In Web Mercator, Y=0 is North, Y=1 is South; in Three.js UV, V=1 is North (minZ), V=0 is South (maxZ)
      const v = 1.0 - (z - minZ) / spanZ;

      uv.setXY(i, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
    }
    uv.needsUpdate = true;
  }

  /**
   * Fetch and stitch the Zoom 10 macro tiles covering Jeju Island.
   * Resolves gracefully on network failure by preserving existing terrain shading.
   * @returns {Promise<boolean>} Whether satellite streaming successfully applied
   */
  async loadIslandMacroTiles() {
    if (typeof document === 'undefined') {
      // In headless test environments without DOM canvas
      return false;
    }

    this.isStreaming = true;

    try {
      // Fetch 4 tiles concurrently through the rate-limited CacheManager
      const tilePromises = JEJU_MACRO_TILES.map(async (t) => {
        const img = await this.cacheManager.getTileImage(t.z, t.x, t.y);
        return { ...t, img };
      });

      const results = await Promise.all(tilePromises);
      const successful = results.filter((r) => r.img && r.img.width > 0);

      if (successful.length === 0) {
        // Full offline fallback: retain procedural vertex colors
        return false;
      }

      this.tilesLoaded = successful.length;

      // Stitch onto a 512x512 canvas
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 512;
        this.canvas.height = 512;
      }
      const ctx = this.canvas.getContext('2d');
      if (!ctx) return false;

      ctx.clearRect(0, 0, 512, 512);

      for (const t of successful) {
        ctx.drawImage(t.img, t.col * 256, t.row * 256, 256, 256);
      }

      // Update mesh UV mapping
      this.updateMeshUVs();

      // Create or update Three.js texture
      if (!this.macroTexture) {
        this.macroTexture = new THREE.CanvasTexture(this.canvas);
        this.macroTexture.colorSpace = THREE.SRGBColorSpace;
        this.macroTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.macroTexture.wrapT = THREE.ClampToEdgeWrapping;
      }
      this.macroTexture.needsUpdate = true;

      // Apply texture to terrain material
      if (this.terrainMesh?.material) {
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
   * Current streaming and memory metrics.
   */
  getMetrics() {
    return {
      activeLOD: this.activeLOD,
      tilesLoaded: this.tilesLoaded,
      isStreaming: this.isStreaming,
      gridBounds: this.gridBounds,
      cache: this.cacheManager.getMetrics(),
    };
  }

  /**
   * Cleanly dispose of GPU textures, canvases, and cache resources.
   */
  dispose() {
    this.isStreaming = false;
    if (this.macroTexture) {
      this.macroTexture.dispose();
      this.macroTexture = null;
    }
    this.canvas = null;
    this.cacheManager.dispose();
  }
}
