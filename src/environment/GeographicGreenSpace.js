import * as THREE from 'three';
import { VectorTile } from '@mapbox/vector-tile';
import { applyLogDepthOffset } from './RunwayMarkings.js';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import { localToWgs84, tileToWgs84, wgs84ToLocal, wgs84ToTile } from '../geospatial/TileCoordinateSystem.js';
import { projectToLocal, INCHEON_PATCH } from '../geospatial/incheon.js';
import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import luklaGrid from '../config/luklaTerrainGrid.json' with { type: 'json' };

// Parks are absent from the z11 parent tile the water loader reads, so green
// space has its own z13 tile selection over the already-downloaded base archive.
const zoom = 13;
const neighbors = [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const surfaceOffset = 0.2;
const source = new PMTiles(
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-11-18.0/base.pmtiles',
);
const COLORS = {
  park: 0x4a7a3a, garden: 0x5f8f43, grass: 0x6a9a4e, recreation_ground: 0x568a3c,
  playground: 0x6f9a55, golf_course: 0x47763b, meadow: 0x64934a, green: 0x5b8c42,
  forest: 0x3f6a33, shrub: 0x537a3e, nature_reserve: 0x3d6733, village_green: 0x628f45,
};
const LAND_USE = new Set(Object.keys(COLORS).filter(name => name !== 'shrub'));
const LAND_COVER = new Set(['forest', 'shrub']);

function ringOf(ring, tile, project, extent) {
  const points = ring.map(({ x, y }) => {
    const { latitude, longitude } = tileToWgs84(tile.x + x / extent, tile.y + y / extent, zoom);
    const [localX, localZ] = project(latitude, longitude);
    return new THREE.Vector2(localX, localZ);
  });
  if (points.length > 1 && points[0].equals(points.at(-1))) points.pop();
  return points;
}

export function buildGeographicGreenTile(data, tile, project, terrain, exclude = () => false) {
  const layers = new VectorTile(new PbfReader(data)).layers;
  const positions = [];
  const colors = [];
  const triangles = [];
  const color = new THREE.Color();
  const usable = point => Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.height > 0 && !terrain.isWater?.(point.x, point.y)
    && !(Number.isFinite(terrain.size) && Math.max(Math.abs(point.x), Math.abs(point.y)) > terrain.size / 2);

  for (const [name, allowed] of [['land_use', LAND_USE], ['land_cover', LAND_COVER]]) {
    const layer = layers[name];
    for (let i = 0; i < (layer?.length ?? 0); i++) {
      const feature = layer.feature(i);
      const kind = feature.properties.class;
      if (!allowed.has(kind) || feature.type !== 3) continue;
      const rings = feature.loadGeometry().map(ring => ringOf(ring, tile, project, feature.extent));
      const [outer, ...holes] = rings;
      if (!outer || outer.length < 3 || Math.abs(THREE.ShapeUtils.area(outer)) < 4) continue;
      const points = rings.flat();
      const heights = points.map(point => terrain.getHeight(point.x, point.y));
      if (!heights.every(Number.isFinite) || heights.some(height => height <= 0)) continue;
      const center = outer.reduce((sum, point) => sum.add(point), new THREE.Vector2()).divideScalar(outer.length);
      const probe = { x: center.x, y: center.y, height: terrain.getHeight(center.x, center.y) };
      if (!usable(probe) || exclude(center.x, center.y)) continue;
      const faces = THREE.ShapeUtils.triangulateShape(outer, holes);
      if (!faces.length) continue;
      color.setHex(COLORS[kind]);
      const base = positions.length / 3;
      for (const point of points) positions.push(point.x, terrain.getHeight(point.x, point.y) + surfaceOffset, point.y);
      for (const face of faces) {
        for (const index of face.toReversed()) {
          triangles.push(base + index);
          colors.push(color.r, color.g, color.b);
        }
      }
    }
  }
  if (!triangles.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(triangles);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export class GeographicGreenSpace {
  constructor({ origin, project, terrain, exclude, archive = source }) {
    this.origin = origin;
    this.project = project;
    this.terrain = terrain;
    this.exclude = exclude ?? (() => false);
    this.archive = archive;
    this.group = new THREE.Group();
    this.group.name = 'Geographic parks and green space';
    this.material = applyLogDepthOffset(new THREE.MeshLambertMaterial({
      vertexColors: true, side: THREE.DoubleSide,
    }), 3);
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
      const geometry = response && buildGeographicGreenTile(response.data, tile, this.project, this.terrain, this.exclude);
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
    if (this.terrain.geographicGreenLayer === this) delete this.terrain.geographicGreenLayer;
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

export function updateGeographicGreenSpace(sim) {
  const origin = Object.hasOwn(frames, sim.activeAirport) && frames[sim.activeAirport];
  const terrain = sim.currentTerrain;
  if (sim.geographicGreenLayer?.terrain !== terrain || !origin) {
    sim.geographicGreenLayer?.dispose();
    sim.geographicGreenLayer = null;
  }
  if (origin && terrain?.mesh && !sim.geographicGreenLayer) {
    const project = sim.activeAirport === 'incheon' ? projectToLocal
      : (latitude, longitude) => wgs84ToLocal(latitude, longitude, origin);
    const airport = sim.currentAirport;
    sim.geographicGreenLayer = new GeographicGreenSpace({
      origin, project, terrain,
      exclude: (x, z) => {
        if (airport?.hasModeledBuilding?.(x, z) || airport?.isRunwaySafetyArea?.(x, z)) return true;
        if (sim.geographicRoadLayer?.covers(x, z)) return true;
        const buildings = sim.geographicBuildingLayer;
        return Boolean(buildings?.checkCollision?.([{
          pos: new THREE.Vector3(x, terrain.getHeight(x, z), z), radius: 1, desc: 'green space',
        }]));
      },
    });
    terrain.geographicGreenLayer = sim.geographicGreenLayer;
    terrain.mesh.add(sim.geographicGreenLayer.group);
  }
  sim.geographicGreenLayer?.update(sim.position, sim.camera.position);
  const attribution = document.getElementById('geographic-green-attribution');
  if (attribution) attribution.hidden = !sim.geographicGreenLayer?.tiles.size;
}
