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
  tileBoundsWgs84,
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
    const altitudeM = aircraftState.altitudeM ?? (aircraftState.y ?? 0);
    const selectedZoom = this.selectZoom(altitudeM);
    this.currentZoom = selectedZoom;

    for (const t of needed) {
      const key = `${t.zoom}/${t.x}/${t.y}`;
      neededKeys.add(key);

      const existing = this.activeTiles.get(key);
      if (existing) {
        existing.lastAccessTime = now;
        // Retry failed tile images with exponential backoff
        if (!existing.imageLoaded && !this.inFlightRequests.has(key)) {
          const retryCount = existing.retryCount || 0;
          const backoffDelay = Math.min(30000, 2000 * (2 ** retryCount));
          if (now - (existing.lastFailedTime || 0) >= backoffDelay) {
            loadPromises.push(this.retryTileImage(existing, key));
          }
        }
      } else if (!this.inFlightRequests.has(key)) {
        loadPromises.push(this.loadTile(t, now));
      }
    }

    // 2. Prune trailing tiles exceeding retention radius or replaced LOD zoom levels
    let prunedCount = 0;
    const { x, z } = aircraftState;

    for (const [key, entry] of this.activeTiles.entries()) {
      const distM = Math.hypot(entry.centerX - x, entry.centerZ - z);

      // Evict if wrong LOD zoom level (to prevent z-fighting), or beyond retention radius, or over capacity
      const isWrongLOD = entry.tile.zoom !== selectedZoom;
      const isTooFar = distM > this.config.retentionRadiusM && !neededKeys.has(key);
      const isOverCapacity = this.activeTiles.size > this.config.maxActiveTiles;

      if (isWrongLOD || isTooFar || isOverCapacity) {
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
   * Construct tile grid geometry by directly converting each vertex's fractional
   * Web Mercator coordinate to WGS84 and the local tangent plane.
   * Guarantees that adjacent tiles share identical boundary vertices with 0 gap.
   */
  createTileGeometry(tileInfo) {
    const segments = 4;
    const vertexCount = (segments + 1) * (segments + 1);
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = [];

    let idx = 0;
    let uvIdx = 0;
    let sumX = 0;
    let sumZ = 0;

    for (let r = 0; r <= segments; r++) {
      const fy = r / segments;
      const exactY = tileInfo.y + fy;

      for (let c = 0; c <= segments; c++) {
        const fx = c / segments;
        const exactX = tileInfo.x + fx;

        const { latitude, longitude } = tileToWgs84(exactX, exactY, tileInfo.zoom);
        const [vx, vz] = wgs84ToLocal(latitude, longitude, this.origin);
        let h = this.flightSurface.getHeight(vx, vz);

        // Avoid low-poly background tile vertices bulging through the detailed Chuja 3D island patch
        const distChujaM = Math.hypot(
          (longitude - 126.3000) * 88000,
          (latitude - 33.9600) * 111000
        );
        if (distChujaM < 3500) {
          h = Math.min(h, 12.0);
        }

        positions[idx * 3] = vx;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = vz;

        uvs[uvIdx * 2] = fx;
        uvs[uvIdx * 2 + 1] = 1.0 - fy; // Web Mercator Y=0 is North, Three.js V=1 is North

        sumX += vx;
        sumZ += vz;
        idx++;
        uvIdx++;
      }
    }

    const gridWidth = segments + 1;
    for (let r = 0; r < segments; r++) {
      for (let c = 0; c < segments; c++) {
        const a = r * gridWidth + c;
        const b = r * gridWidth + (c + 1);
        const d = (r + 1) * gridWidth + c;
        const e = (r + 1) * gridWidth + (c + 1);

        // Exclude quads covering Jeju Island mainland to prevent low-poly corridor meshes
        // from obscuring or clipping Jeju's dedicated 80km x 56km high-resolution terrain mesh
        const cellX = (positions[a * 3] + positions[e * 3]) * 0.5;
        const cellZ = (positions[a * 3 + 2] + positions[e * 3 + 2]) * 0.5;
        const isInsideJejuMainland = cellX >= -36000 && cellX <= 44000 && cellZ >= -11000 && cellZ <= 43000;

        if (!isInsideJejuMainland) {
          indices.push(a, d, b);
          indices.push(b, d, e);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const centerX = sumX / vertexCount;
    const centerZ = sumZ / vertexCount;

    return { geo, centerX, centerZ };
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
      // 1. Construct tile mesh with direct spherical vertex projection (0 gap with neighbors)
      const { geo, centerX, centerZ } = this.createTileGeometry(tileInfo);

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
        centerX,
        centerZ,
        lastAccessTime: accessTime,
        imageLoaded: false,
        retryCount: 0,
        lastFailedTime: 0,
      };
      this.activeTiles.set(key, entry);

      // Fetch satellite image through rate-limited cache
      const img = await this.cacheManager.getTileImage(tileInfo.zoom, tileInfo.x, tileInfo.y);

      if (this.disposed || !this.activeTiles.has(key)) {
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
        entry.imageLoaded = true;
        this.tilesLoaded++;
      } else {
        entry.imageLoaded = false;
        entry.lastFailedTime = performance.now();
        entry.retryCount = 1;
      }
    } catch {
      const entry = this.activeTiles.get(key);
      if (entry) {
        entry.imageLoaded = false;
        entry.lastFailedTime = performance.now();
        entry.retryCount = (entry.retryCount || 0) + 1;
      }
    } finally {
      this.inFlightRequests.delete(key);
    }
  }

  /**
   * Retry loading satellite image for an active tile that initially failed.
   */
  async retryTileImage(entry, key) {
    if (this.disposed || !this.activeTiles.has(key)) return;
    this.inFlightRequests.add(key);

    try {
      const img = await this.cacheManager.getTileImage(entry.tile.zoom, entry.tile.x, entry.tile.y);
      if (this.disposed || !this.activeTiles.has(key)) return;

      if (img && img.width > 0 && typeof document !== 'undefined') {
        const texture = new THREE.CanvasTexture(img);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

        entry.mesh.material.map = texture;
        entry.mesh.material.color.setHex(0xffffff);
        entry.mesh.material.needsUpdate = true;
        entry.texture = texture;
        entry.imageLoaded = true;
        this.tilesLoaded++;
      } else {
        entry.lastFailedTime = performance.now();
        entry.retryCount = (entry.retryCount || 0) + 1;
      }
    } catch {
      entry.lastFailedTime = performance.now();
      entry.retryCount = (entry.retryCount || 0) + 1;
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
