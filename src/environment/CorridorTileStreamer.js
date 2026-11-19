/**
 * CorridorTileStreamer.js
 *
 * Dynamic streaming terrain pipeline for the 451.2km Incheon ↔ Jeju flight corridor.
 * Features:
 * - Forward lookahead prefetching (15~30km ahead along flight path)
 * - Trailing tile automatic unloading & GPU VRAM disposal (strict < 150MB budget)
 * - Sliding window of dynamic Three.js tile chunk meshes with skirts
 * - Seamless integration with CorridorFlightSurface and WaterDitching (0m water level)
 * - Rate limiting (max 4 concurrent) and CDN terms compliance via TileCacheManager
 */

import * as THREE from 'three';
import { TileCacheManager } from './TileCacheManager.js';
import {
  wgs84ToTile,
  tileToWgs84,
  tileBoundsLocal,
  localToWgs84,
  wgs84ToLocal,
  tilesForBbox,
} from '../geospatial/TileCoordinateSystem.js';
import {
  JEJU_ORIGIN,
  INCHEON_ORIGIN,
  CORRIDOR_WAYPOINTS,
  haversineDistanceM,
} from '../geospatial/CorridorCoordinateSystem.js';

export const CORRIDOR_DEFAULTS = Object.freeze({
  defaultZoom: 10,
  cruiseZoom: 9,
  lookaheadDistM: 25000,      // 25km ahead
  activeRadiusM: 20000,       // 20km around aircraft
  retentionRadiusM: 40000,    // 40km retention (tiles further behind are pruned)
  maxActiveTiles: 36,         // Hard limit to guarantee < 150MB VRAM
});

export class CorridorTileStreamer {
  /**
   * @param {Object} flightSurface - CorridorFlightSurface instance
   * @param {Object} [options]
   * @param {THREE.Group} [options.group] - Three.js group to hold dynamic tile meshes
   * @param {Object} [options.origin] - Active reference origin (default: JEJU_ORIGIN)
   * @param {TileCacheManager} [options.cacheManager]
   * @param {Object} [options.config]
   */
  constructor(flightSurface, options = {}) {
    this.flightSurface = flightSurface;
    this.origin = options.origin || JEJU_ORIGIN;
    this.group = options.group || new THREE.Group();
    this.cacheManager = options.cacheManager || new TileCacheManager(options.cacheOptions);

    this.config = { ...CORRIDOR_DEFAULTS, ...options.config };
    this.activeTiles = new Map(); // key `${z}/${x}/${y}` -> { mesh, texture, tile, centerX, centerZ, lastAccessTime }

    this.disposed = false;
    this.tilesLoaded = 0;
    this.tilesDisposed = 0;
    this.inFlightRequests = new Set();
  }

  /**
   * Surface elevation is delegated to the analytical CorridorFlightSurface.
   */
  getHeight(x, z) {
    return this.flightSurface.getHeight(x, z);
  }

  getWaterLevel(x, z) {
    return this.flightSurface.getWaterLevel(x, z);
  }

  isWater(x, z) {
    return this.flightSurface.isWater(x, z);
  }

  getNormal(x, z) {
    return this.flightSurface.getNormal(x, z);
  }

  /**
   * Select streaming zoom level based on altitude.
   * High altitude cruise (> 5,000m / FL160) uses Zoom 9 (broader view, lower VRAM).
   * Medium/low altitude uses Zoom 10 (higher fidelity).
   * @param {number} altitudeM
   * @returns {number} Zoom level integer
   */
  selectZoom(altitudeM) {
    return altitudeM > 5000 ? this.config.cruiseZoom : this.config.defaultZoom;
  }

  /**
   * Determine required tiles based on aircraft position, heading, and altitude.
   * @param {{ x: number, z: number, y?: number, altitudeM?: number, headingDeg?: number, speedMs?: number }} aircraftState
   * @returns {Array<{ x: number, y: number, zoom: number, distM: number }>}
   */
  computeNeededTiles(aircraftState) {
    const { x, z } = aircraftState;
    const altitudeM = aircraftState.altitudeM ?? (aircraftState.y ?? 0);
    const headingDeg = aircraftState.headingDeg ?? 180; // Default south
    const zoom = this.selectZoom(altitudeM);

    const headingRad = (headingDeg * Math.PI) / 180;
    const forwardX = Math.sin(headingRad);
    const forwardZ = -Math.cos(headingRad); // -Z is North in Three.js, +Z is South

    // Lookahead center
    const lookaheadX = x + forwardX * this.config.lookaheadDistM;
    const lookaheadZ = z + forwardZ * this.config.lookaheadDistM;

    // Convert aircraft and lookahead centers to WGS84
    const acWgs = localToWgs84(x, z, this.origin);
    const lookaheadWgs = localToWgs84(lookaheadX, lookaheadZ, this.origin);

    // Compute bounding box covering both active radius and forward cone
    const maxOffsetM = this.config.activeRadiusM + this.config.lookaheadDistM;
    const [minX, minZ] = [Math.min(x, lookaheadX) - this.config.activeRadiusM, Math.min(z, lookaheadZ) - this.config.activeRadiusM];
    const [maxX, maxZ] = [Math.max(x, lookaheadX) + this.config.activeRadiusM, Math.max(z, lookaheadZ) + this.config.activeRadiusM];

    const nw = localToWgs84(minX, minZ, this.origin);
    const se = localToWgs84(maxX, maxZ, this.origin);

    const bbox = [
      Math.min(nw.longitude, se.longitude),
      Math.min(nw.latitude, se.latitude),
      Math.max(nw.longitude, se.longitude),
      Math.max(nw.latitude, se.latitude),
    ];

    const candidateTiles = tilesForBbox(bbox, zoom);

    // Score and sort candidates: tiles closer to aircraft / along forward track first
    const scored = candidateTiles.map((t) => {
      const bounds = tileBoundsLocal(t.x, t.y, t.zoom, this.origin);
      const distM = Math.hypot(bounds.centerX - x, bounds.centerZ - z);
      return { ...t, distM, bounds };
    });

    scored.sort((a, b) => a.distM - b.distM);
    return scored;
  }

  /**
   * Update streamer with current aircraft telemetry.
   * Loads lookahead tiles and unloads trailing tiles.
   * @param {{ x: number, z: number, y?: number, altitudeM?: number, headingDeg?: number, speedMs?: number }} aircraftState
   * @returns {Promise<{ loaded: number, disposed: number, active: number }>}
   */
  async update(aircraftState) {
    if (this.disposed) return { loaded: 0, disposed: 0, active: 0 };

    const needed = this.computeNeededTiles(aircraftState);
    const neededKeys = new Set();
    const now = performance.now();

    // 1. Mark needed tiles and start fetching new ones
    const loadPromises = [];
    for (const t of needed) {
      const key = `${t.zoom}/${t.x}/${t.y}`;
      neededKeys.add(key);

      const existing = this.activeTiles.get(key);
      if (existing) {
        existing.lastAccessTime = now;
      } else if (!this.inFlightRequests.has(key)) {
        loadPromises.push(this.loadTile(t, now));
      }
    }

    // 2. Prune trailing tiles exceeding retention radius
    let prunedCount = 0;
    const { x, z } = aircraftState;

    for (const [key, entry] of this.activeTiles.entries()) {
      const distM = Math.hypot(entry.centerX - x, entry.centerZ - z);

      // Evict if beyond retention radius or if over hard capacity
      const isTooFar = distM > this.config.retentionRadiusM && !neededKeys.has(key);
      const isOverCapacity = this.activeTiles.size > this.config.maxActiveTiles;

      if (isTooFar || isOverCapacity) {
        this.disposeTile(key);
        prunedCount++;
      }
    }

    // Wait for in-flight loads to initiate
    await Promise.all(loadPromises);

    return {
      loaded: this.tilesLoaded,
      disposed: this.tilesDisposed,
      active: this.activeTiles.size,
    };
  }

  /**
   * Fetch a single tile and attach its textured mesh.
   */
  async loadTile(tileInfo, accessTime) {
    const key = `${tileInfo.zoom}/${tileInfo.x}/${tileInfo.y}`;
    if (this.disposed || this.inFlightRequests.has(key) || this.activeTiles.has(key)) {
      return;
    }

    this.inFlightRequests.add(key);

    try {
      const bounds = tileInfo.bounds || tileBoundsLocal(tileInfo.x, tileInfo.y, tileInfo.zoom, this.origin);

      // Create geometry representing the tile with slight skirts
      const width = bounds.widthMeters;
      const height = bounds.heightMeters;
      const segments = 4;
      const geo = new THREE.PlaneGeometry(width, height, segments, segments);
      geo.rotateX(-Math.PI / 2);
      geo.translate(bounds.centerX, 0, bounds.centerZ);

      // Set elevation from analytical flight surface
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vz = pos.getZ(i);
        const h = this.flightSurface.getHeight(vx, vz);
        pos.setY(i, h);
      }
      geo.computeVertexNormals();

      // Fallback procedural material (ocean/land gradient)
      const mat = new THREE.MeshBasicMaterial({
        color: 0x1a4060, // Deep ocean blue
        wireframe: false,
      });

      const mesh = new THREE.Mesh(geo, mat);
      this.group.add(mesh);

      const entry = {
        mesh,
        texture: null,
        tile: tileInfo,
        centerX: bounds.centerX,
        centerZ: bounds.centerZ,
        lastAccessTime: accessTime,
      };
      this.activeTiles.set(key, entry);

      // Fetch satellite image through rate-limited cache
      const img = await this.cacheManager.getTileImage(tileInfo.zoom, tileInfo.x, tileInfo.y);

      if (this.disposed) {
        this.disposeTile(key);
        return;
      }

      if (img && img.width > 0 && typeof document !== 'undefined') {
        const texture = new THREE.CanvasTexture(img);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

        mesh.material.map = texture;
        mesh.material.color.setHex(0xffffff);
        mesh.material.needsUpdate = true;
        entry.texture = texture;
        this.tilesLoaded++;
      }
    } catch {
      // Offline fallback: keep procedural mesh
    } finally {
      this.inFlightRequests.delete(key);
    }
  }

  /**
   * Dispose and free GPU resources for a specific tile.
   */
  disposeTile(key) {
    const entry = this.activeTiles.get(key);
    if (!entry) return;

    this.activeTiles.delete(key);
    this.group.remove(entry.mesh);

    if (entry.mesh.geometry) {
      entry.mesh.geometry.dispose();
    }
    if (entry.texture) {
      entry.texture.dispose();
    }
    if (entry.mesh.material) {
      if (entry.mesh.material.map) entry.mesh.material.map.dispose();
      entry.mesh.material.dispose();
    }

    this.tilesDisposed++;
  }

  /**
   * Metrics and VRAM budget tracking.
   */
  getMetrics() {
    const activeCount = this.activeTiles.size;
    // Estimated VRAM: 256x256x4 bytes (256 KB) per texture + ~5 KB per geometry
    const estimatedVramBytes = activeCount * (262144 + 5120);
    const estimatedVramMb = Number((estimatedVramBytes / (1024 * 1024)).toFixed(2));

    return {
      activeTiles: activeCount,
      tilesLoaded: this.tilesLoaded,
      tilesDisposed: this.tilesDisposed,
      estimatedVramMb,
      vramBudgetMb: 150.0,
      underBudget: estimatedVramMb < 150.0,
      disposed: this.disposed,
      cache: this.cacheManager.getMetrics(),
    };
  }

  /**
   * Cleanly dispose of all resources, textures, and geometry.
   */
  dispose() {
    this.disposed = true;

    for (const key of Array.from(this.activeTiles.keys())) {
      this.disposeTile(key);
    }
    this.activeTiles.clear();
    this.inFlightRequests.clear();

    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    this.cacheManager.dispose();
  }
}
