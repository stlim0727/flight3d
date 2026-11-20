import * as THREE from 'three';
import { PMTiles } from 'pmtiles';
import { localToWgs84, wgs84ToLocal, wgs84ToTile } from '../geospatial/TileCoordinateSystem.js';
import { INCHEON_PATCH, projectToLocal } from '../geospatial/incheon.js';
import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import {
  dedupeLandmarks,
  extractBaseLandmarks,
  extractDivisionLandmarks,
} from '../geospatial/overtureLandmarks.js';
import luklaGrid from '../config/luklaTerrainGrid.json' with { type: 'json' };

const neighbors = [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const maxTileCache = 48;
const retryDelayMs = 5000;
const lookAheadDistancesM = [7500, 11500, 15500];

const defaultDivisionsArchive = new PMTiles(
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-11-18.0/divisions.pmtiles',
);
const defaultBaseArchive = new PMTiles(
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-11-18.0/base.pmtiles',
);

const tileKey = (source, zoom, x, y) => `${source}:${zoom}:${x}/${y}`;

function pushTile(target, seen, source, zoom, x, y) {
  const worldTiles = 2 ** zoom;
  if (y < 0 || y >= worldTiles) return;
  const wrappedX = ((x % worldTiles) + worldTiles) % worldTiles;
  const key = tileKey(source, zoom, wrappedX, y);
  if (seen.has(key)) return;
  seen.add(key);
  target.push({ source, zoom, x: wrappedX, y, key });
}

/**
 * Automatically streams regional and local Overture Maps landmarks (`divisions` +
 * `base`, plus shared tiles from `GeographicGreenSpace` and `GeographicBuildings`)
 * around the aircraft and camera without requiring manual per-place configuration.
 */
export class GeographicLandmarks {
  constructor({
    map,
    origin,
    project,
    terrain,
    divisionsArchive = defaultDivisionsArchive,
    baseArchive = defaultBaseArchive,
  }) {
    this.map = map;
    this.origin = origin;
    this.project = project;
    this.terrain = terrain;
    this.divisionsArchive = divisionsArchive;
    this.baseArchive = baseArchive;
    this.tiles = new Map();
    this.retryAt = new Map();
    this.pending = null;
    this.wanted = [];
    this.wantedSignature = '';
    this.buildingLayer = null;
    this.buildingVersion = 0;
    this.buildingRecords = [];
    this.records = [];
    this.version = 0;
    this.hasStreamedData = false;
    this.forward = new THREE.Vector3();
  }

  projectRecord(record) {
    if (Number.isFinite(record.x) && Number.isFinite(record.z)) return record;
    const [x, z] = this.project(record.latitude, record.longitude);
    return {
      ...record,
      ko: record.names?.ko ?? record.ko,
      en: record.names?.en ?? record.en,
      x,
      z,
      height: Number.isFinite(record.elevationM) ? record.elevationM : (record.heightOffsetM ?? 0),
    };
  }

  setCachedTile(key, records) {
    if (this.tiles.has(key)) this.tiles.delete(key);
    this.tiles.set(key, records);
    while (this.tiles.size > maxTileCache) {
      const oldest = this.tiles.keys().next().value;
      if (oldest === undefined) break;
      this.tiles.delete(oldest);
    }
  }

  rebuildRecords() {
    const merged = [];
    for (const items of this.tiles.values()) merged.push(...items);
    merged.push(...this.buildingRecords);
    this.records = dedupeLandmarks(merged);
    this.hasStreamedData = this.tiles.size > 0 || this.buildingRecords.length > 0;
    this.version++;
  }

  wantedTilesFor(position, camera) {
    const anchor = camera?.position ?? position;
    if (!anchor) return [];
    const aircraftPos = position ?? anchor;
    const wanted = [];
    const seen = new Set();

    const camWgs = localToWgs84(anchor.x, anchor.z, this.origin);
    const acWgs = aircraftPos === anchor ? camWgs : localToWgs84(aircraftPos.x, aircraftPos.z, this.origin);

    // 1. divisions z9 (regional cities; add neighboring tiles near edges)
    const div9 = wgs84ToTile(camWgs.latitude, camWgs.longitude, 9);
    const dxs = [0];
    const dys = [0];
    if (div9.fx < 0.25) dxs.push(-1);
    else if (div9.fx > 0.75) dxs.push(1);
    if (div9.fy < 0.25) dys.push(-1);
    else if (div9.fy > 0.75) dys.push(1);
    for (const dx of dxs) {
      for (const dy of dys) pushTile(wanted, seen, 'divisions', 9, div9.x + dx, div9.y + dy);
    }

    // 2. divisions z10 (districts, macrohoods, local towns)
    const div10 = wgs84ToTile(camWgs.latitude, camWgs.longitude, 10);
    pushTile(wanted, seen, 'divisions', 10, div10.x, div10.y);

    // 3. base z11 3x3 (islands, national parks, large lakes, airfields)
    const base11 = wgs84ToTile(camWgs.latitude, camWgs.longitude, 11);
    for (const [dx, dy] of neighbors) pushTile(wanted, seen, 'base', 11, base11.x + dx, base11.y + dy);

    // 4. base z13 3x3 around aircraft and camera (airports, peaks, bridges, towers, campuses)
    const ac13 = wgs84ToTile(acWgs.latitude, acWgs.longitude, 13);
    for (const [dx, dy] of neighbors) pushTile(wanted, seen, 'base', 13, ac13.x + dx, ac13.y + dy);
    if (aircraftPos !== anchor) {
      const cam13 = wgs84ToTile(camWgs.latitude, camWgs.longitude, 13);
      for (const [dx, dy] of neighbors) pushTile(wanted, seen, 'base', 13, cam13.x + dx, cam13.y + dy);
    }

    // 5. base z13 look-ahead along camera view direction (distant peaks & bridges)
    if (typeof camera?.getWorldDirection === 'function') {
      camera.getWorldDirection(this.forward);
      const horizLen = Math.hypot(this.forward.x, this.forward.z);
      if (horizLen > 0.25) {
        const hx = this.forward.x / horizLen;
        const hz = this.forward.z / horizLen;
        for (const distM of lookAheadDistancesM) {
          const aheadWgs = localToWgs84(anchor.x + hx * distM, anchor.z + hz * distM, this.origin);
          const ahead13 = wgs84ToTile(aheadWgs.latitude, aheadWgs.longitude, 13);
          pushTile(wanted, seen, 'base', 13, ahead13.x, ahead13.y);
        }
      }
    }

    return wanted;
  }

  /** Reuse Overture `base` tiles already fetched by GeographicGreenSpace without extra downloads. */
  ingestBaseTile(tile, zoom, data) {
    if (!tile || !Number.isFinite(zoom)) return;
    const key = tileKey('base', zoom, tile.x, tile.y);
    if (this.tiles.has(key)) {
      const existing = this.tiles.get(key);
      this.tiles.delete(key);
      this.tiles.set(key, existing);
      return;
    }
    if (this.pending?.key === key) {
      this.pending.controller.abort();
      this.pending = null;
    }
    const extracted = data
      ? extractBaseLandmarks(data, tile, zoom).map(record => this.projectRecord(record))
      : [];
    this.setCachedTile(key, extracted);
    this.retryAt.delete(key);
    this.rebuildRecords();
  }

  syncBuildingLandmarks(buildingLayer) {
    const nextVersion = buildingLayer?.landmarksVersion ?? 0;
    if (buildingLayer === this.buildingLayer && nextVersion === this.buildingVersion) return false;
    this.buildingLayer = buildingLayer;
    this.buildingVersion = nextVersion;
    const raw = buildingLayer?.getLandmarks?.() ?? [];
    this.buildingRecords = raw.map(record => this.projectRecord(record));
    return true;
  }

  update(position, camera, buildingLayer = null) {
    if (this.terrain?.isLoaded === false) return;
    const buildingsChanged = this.syncBuildingLandmarks(buildingLayer);
    const wanted = this.wantedTilesFor(position, camera);
    const signature = wanted.map(tile => tile.key).join('|');
    if (signature !== this.wantedSignature) {
      this.wantedSignature = signature;
      this.wanted = wanted;
      const wantedKeys = new Set();
      for (const tile of wanted) {
        wantedKeys.add(tile.key);
        if (this.tiles.has(tile.key)) {
          const cached = this.tiles.get(tile.key);
          this.tiles.delete(tile.key);
          this.tiles.set(tile.key, cached);
        }
      }
      if (this.pending && !wantedKeys.has(this.pending.key)
        && wanted.some(tile => !this.tiles.has(tile.key))) {
        this.pending.controller.abort();
        this.pending = null;
      }
    }
    if (buildingsChanged) this.rebuildRecords();
    if (this.pending) return;
    const now = performance.now();
    const nextTile = this.wanted.find(tile => !this.tiles.has(tile.key)
      && now >= (this.retryAt.get(tile.key) ?? 0));
    if (nextTile) void this.load(nextTile);
  }

  async load(tile) {
    const controller = new AbortController();
    this.pending = { key: tile.key, controller };
    const archive = tile.source === 'divisions' ? this.divisionsArchive : this.baseArchive;
    try {
      const response = await archive.getZxy(tile.zoom, tile.x, tile.y, controller.signal);
      if (controller.signal.aborted) return;
      const raw = !response?.data ? []
        : (tile.source === 'divisions'
          ? extractDivisionLandmarks(response.data, tile, tile.zoom)
          : extractBaseLandmarks(response.data, tile, tile.zoom));
      const projected = raw.map(record => this.projectRecord(record));
      this.setCachedTile(tile.key, projected);
      this.retryAt.delete(tile.key);
      this.rebuildRecords();
    } catch {
      if (!controller.signal.aborted) this.retryAt.set(tile.key, performance.now() + retryDelayMs);
    } finally {
      if (this.pending?.controller === controller) this.pending = null;
    }
  }

  dispose() {
    this.pending?.controller.abort();
    this.pending = null;
    this.tiles.clear();
    this.retryAt.clear();
    this.wanted = [];
    this.wantedSignature = '';
    this.buildingLayer = null;
    this.buildingRecords = [];
    this.records = [];
    this.hasStreamedData = false;
  }
}

const frames = {
  incheon: INCHEON_PATCH.origin,
  jeju: JEJU_ORIGIN,
  lukla: luklaGrid.origin,
};

export function updateGeographicLandmarks(sim) {
  const candidateOrigin = (Object.hasOwn(frames, sim.activeAirport) && frames[sim.activeAirport])
    || sim.currentTerrain?.origin
    || sim.currentTerrain?.wgs84Origin;
  const origin = Number.isFinite(candidateOrigin?.latitude) && Number.isFinite(candidateOrigin?.longitude)
    ? candidateOrigin
    : null;
  const terrain = sim.currentTerrain;
  if (sim.geographicLandmarkLayer?.terrain !== terrain || sim.geographicLandmarkLayer?.map !== sim.activeAirport || !origin) {
    sim.geographicLandmarkLayer?.dispose();
    sim.geographicLandmarkLayer = null;
  }
  if (origin && terrain?.mesh && !sim.geographicLandmarkLayer) {
    const project = sim.activeAirport === 'incheon' ? projectToLocal
      : (typeof terrain?.projectToLocal === 'function'
        ? (latitude, longitude) => terrain.projectToLocal(latitude, longitude)
        : (latitude, longitude) => wgs84ToLocal(latitude, longitude, origin));
    sim.geographicLandmarkLayer = new GeographicLandmarks({
      map: sim.activeAirport,
      origin,
      project,
      terrain,
    });
  }
  sim.geographicLandmarkLayer?.update(sim.position, sim.camera, sim.geographicBuildingLayer);
  const attribution = document.getElementById('geographic-buildings-attribution');
  if (attribution) {
    attribution.hidden = !(sim.geographicBuildingLayer?.group.children.length
      || sim.geographicLandmarkLayer?.hasStreamedData);
  }
}
