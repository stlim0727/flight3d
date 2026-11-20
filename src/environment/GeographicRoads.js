import * as THREE from 'three';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import { localToWgs84, tileToWgs84, wgs84ToLocal, wgs84ToTile } from '../geospatial/TileCoordinateSystem.js';
import { projectToLocal, INCHEON_PATCH } from '../geospatial/incheon.js';
import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import luklaGrid from '../config/luklaTerrainGrid.json' with { type: 'json' };

// Overture's z13 segment tiles carry the major road network; z14 adds footways,
// steps and service roads that belong to a later, closer detail pass.
const zoom = 13;
const neighbors = [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const surfaceOffset = 0.35;
const source = new PMTiles(
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-11-18.0/transportation.pmtiles',
);

const MAJOR_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const DEFAULT_WIDTHS = {
  motorway: 36, trunk: 30, primary: 22, secondary: 16, tertiary: 12,
  residential: 8, living_street: 6, service: 5, unclassified: 7,
};
const SURFACE_COLORS = {
  motorway: 0x4b4e51, trunk: 0x525559, primary: 0x585b5f, secondary: 0x5f6266, tertiary: 0x66696d,
};

function parsed(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

function flagsOf(properties) {
  const flags = parsed(properties.road_flags);
  return (Array.isArray(flags) ? flags : [flags]).flatMap(flag =>
    flag?.values ?? (flag?.value ? [flag.value] : []));
}

function isElevated(properties) {
  if (flagsOf(properties).some(flag => ['is_bridge', 'is_tunnel', 'is_covered', 'is_indoor'].includes(flag))) return true;
  const levels = parsed(properties.level_rules);
  return (Array.isArray(levels) ? levels : levels ? [levels] : []).some(rule => rule?.value !== 0);
}

/** Metres. Overture almost never populates width_rules at z13, so grade defaults dominate. */
export function roadWidth(properties) {
  const rules = parsed(properties.width_rules);
  const first = Array.isArray(rules) ? rules[0] : rules;
  const value = Number(first?.value ?? first?.values?.[0]);
  if (Number.isFinite(value) && value >= 2 && value <= 100) return value;
  return DEFAULT_WIDTHS[properties.class] ?? 12;
}

function ribbon(points, width, heights, color) {
  const half = width / 2;
  const normals = points.map((point, i) => {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    let dx = after.x - before.x;
    let dz = after.z - before.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    return { x: -dz, z: dx };
  });
  const miters = normals.map((normal, i) => {
    const previous = normals[Math.max(0, i - 1)];
    let x = previous.x + normal.x;
    let z = previous.z + normal.z;
    const length = Math.hypot(x, z) || 1;
    x /= length;
    z /= length;
    const scale = Math.min(2, 1 / Math.max(0.5, x * normal.x + z * normal.z));
    return { x: x * scale, z: z * scale };
  });
  return points.map((point, i) => ({
    left: new THREE.Vector3(point.x + miters[i].x * half, heights[i] + surfaceOffset, point.z + miters[i].z * half),
    right: new THREE.Vector3(point.x - miters[i].x * half, heights[i] + surfaceOffset, point.z - miters[i].z * half),
    color,
  }));
}

/**
 * Build one draped ribbon mesh. Surface sections of bridge, tunnel, covered and
 * level-separated segments are deliberately omitted until span handling exists.
 */
export function buildGeographicRoadTile(data, tile, project, terrain, exclude = () => false) {
  const layer = new VectorTile(new PbfReader(data)).layers.segment;
  if (!layer?.length) return null;
  const positions = [];
  const colors = [];
  const indices = [];
  const color = new THREE.Color();
  const usable = point => Number.isFinite(point.x) && Number.isFinite(point.z)
    && point.height > 0 && !terrain.isWater?.(point.x, point.z)
    && !exclude(point.x, point.z)
    && !(Number.isFinite(terrain.size) && Math.max(Math.abs(point.x), Math.abs(point.z)) > terrain.size / 2);

  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const properties = feature.properties;
    if (!MAJOR_CLASSES.has(properties.class) || isElevated(properties)) continue;
    color.setHex(SURFACE_COLORS[properties.class] ?? 0x63666a);
    const width = roadWidth(properties);
    const extent = feature.extent;
    for (const ring of feature.loadGeometry()) {
      if (ring.length < 2) continue;
      const points = ring.map(({ x, y }) => {
        const { latitude, longitude } = tileToWgs84(tile.x + x / extent, tile.y + y / extent, zoom);
        const [localX, localZ] = project(latitude, longitude);
        return { x: localX, z: localZ, height: terrain.getHeight(localX, localZ) };
      });
      let run = [];
      const emit = () => {
        if (run.length < 2) return;
        const strip = ribbon(run, width, run.map(point => point.height), color);
        const base = positions.length / 3;
        for (const vertex of strip) {
          positions.push(vertex.left.x, vertex.left.y, vertex.left.z,
            vertex.right.x, vertex.right.y, vertex.right.z);
          colors.push(vertex.color.r, vertex.color.g, vertex.color.b,
            vertex.color.r, vertex.color.g, vertex.color.b);
        }
        for (let j = 0; j < strip.length - 1; j++) {
          const a = base + j * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      };
      for (const point of points) {
        if (usable(point)) run.push(point);
        else { emit(); run = []; }
      }
      emit();
    }
  }
  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export class GeographicRoads {
  constructor({ origin, project, terrain, exclude, isRunwaySafetyArea, archive = source }) {
    this.origin = origin;
    this.project = project;
    this.terrain = terrain;
    this.isRunwaySafetyArea = isRunwaySafetyArea;
    this.exclude = (x, z) => exclude?.(x, z) || isRunwaySafetyArea?.(x, z);
    this.archive = archive;
    this.group = new THREE.Group();
    this.group.name = 'Geographic roads';
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.tiles = new Map();
    this.pending = null;
    this.retryAt = new Map();
  }

  tilesAround(position) {
    const worldTiles = 2 ** zoom;
    const { latitude, longitude } = localToWgs84(position.x, position.z, this.origin);
    const coordinate = wgs84ToTile(latitude, longitude, zoom);
    return neighbors.map(([dx, dy]) => {
      const x = (coordinate.x + dx + worldTiles) % worldTiles;
      const y = coordinate.y + dy;
      return { key: `${x}/${y}`, x, y };
    }).filter(tile => tile.y >= 0 && tile.y < worldTiles);
  }

  tilesNear(position) {
    if (position.y - this.terrain.getHeight(position.x, position.z) >= 3500) return [];
    return this.tilesAround(position);
  }

  hasGround(tile) {
    return this.terrain.openWorld?.readyForTile(tile, zoom) ?? true;
  }

  update(position, cameraPosition = position) {
    if (this.terrain.isLoaded === false) return;
    const aircraftTiles = this.tilesNear(position);
    const cameraTiles = cameraPosition === position ? [] : this.tilesNear(cameraPosition);
    const selection = `${aircraftTiles[0]?.key ?? ''}:${cameraTiles[0]?.key ?? ''}`;
    if (selection !== this.selection) {
      this.selection = selection;
      this.aircraftTiles = new Set(aircraftTiles.map(tile => tile.key));
      this.wantedTiles = [...new Map([...aircraftTiles, ...cameraTiles].map(tile => [tile.key, tile])).values()];
      this.retainTiles(this.wantedTiles);
      if (this.pending && !this.aircraftTiles.has(this.pending.key)
        && aircraftTiles.some(({ key }) => !this.tiles.has(key))) this.pending.controller.abort();
    }
    if (this.pending) return;
    const now = performance.now();
    const tile = this.wantedTiles.find(candidate => !this.tiles.has(candidate.key)
      && now >= (this.retryAt.get(candidate.key) ?? 0) && this.hasGround(candidate));
    if (tile) void this.load(tile);
  }

  retainTiles(wanted) {
    const wantedKeys = new Set(wanted.map(tile => tile.key));
    for (const [key, mesh] of this.tiles) {
      if (wantedKeys.has(key)) continue;
      mesh?.removeFromParent();
      mesh?.geometry.dispose();
      this.tiles.delete(key);
    }
    for (const key of this.retryAt.keys()) if (!wantedKeys.has(key)) this.retryAt.delete(key);
    if (this.pending && !wantedKeys.has(this.pending.key)) this.pending.controller.abort();
  }

  async load(tile) {
    const controller = new AbortController();
    this.pending = { key: tile.key, controller };
    try {
      const response = await this.archive.getZxy(zoom, tile.x, tile.y, controller.signal);
      if (controller.signal.aborted) return;
      const geometry = response && buildGeographicRoadTile(response.data, tile, this.project, this.terrain, this.exclude);
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.tiles.set(tile.key, mesh);
      } else {
        this.tiles.set(tile.key, null);
      }
      this.retryAt.delete(tile.key);
    } catch {
      if (!controller.signal.aborted) this.retryAt.set(tile.key, performance.now() + 5000);
    } finally {
      this.pending = null;
    }
  }

  dispose() {
    this.pending?.controller.abort();
    this.group.removeFromParent();
    for (const mesh of this.tiles.values()) mesh?.geometry.dispose();
    if (this.terrain.geographicRoadLayer === this) delete this.terrain.geographicRoadLayer;
    this.group.clear();
    this.tiles.clear();
    this.retryAt.clear();
    this.material.dispose();
  }
}

const frames = {
  incheon: INCHEON_PATCH.origin,
  jeju: JEJU_ORIGIN,
  lukla: luklaGrid.origin,
};

export function updateGeographicRoads(sim) {
  const origin = Object.hasOwn(frames, sim.activeAirport) && frames[sim.activeAirport];
  const terrain = sim.currentTerrain;
  if (sim.geographicRoadLayer?.terrain !== terrain || !origin) {
    sim.geographicRoadLayer?.dispose();
    sim.geographicRoadLayer = null;
  }
  if (origin && terrain?.mesh && !sim.geographicRoadLayer) {
    const project = sim.activeAirport === 'incheon' ? projectToLocal
      : (latitude, longitude) => wgs84ToLocal(latitude, longitude, origin);
    const airport = sim.currentAirport;
    sim.geographicRoadLayer = new GeographicRoads({
      origin, project, terrain,
      exclude: (x, z) => airport?.hasModeledBuilding?.(x, z),
      isRunwaySafetyArea: (x, z) => airport?.isRunwaySafetyArea?.(x, z),
    });
    terrain.geographicRoadLayer = sim.geographicRoadLayer;
    terrain.mesh.add(sim.geographicRoadLayer.group);
  }
  sim.geographicRoadLayer?.update(sim.position, sim.camera.position);
  const attribution = document.getElementById('geographic-roads-attribution');
  if (attribution) attribution.hidden = !sim.geographicRoadLayer?.tiles.size;
}
