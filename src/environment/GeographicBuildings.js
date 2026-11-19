import * as THREE from 'three';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import polygonClipping from 'polygon-clipping';
import { localToWgs84, tileToWgs84, wgs84ToLocal, wgs84ToTile } from '../geospatial/TileCoordinateSystem.js';
import { projectToLocal, INCHEON_PATCH } from '../geospatial/incheon.js';
import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { pointInRing, segmentDistance } from '../geospatial/incheonDressing.js';
import luklaGrid from '../config/luklaTerrainGrid.json' with { type: 'json' };

const neighbors = [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const zoom = 14;
const worldTiles = 2 ** zoom;
const collisionCellSize = 128;
const source = new PMTiles(
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-11-18.0/buildings.pmtiles',
);

export function geographicBuildingHeight({ height, num_floors: floors }) {
  if (Number.isFinite(height) && height > 0 && height <= 1500) return height;
  if (Number.isFinite(floors) && floors > 0 && floors <= 300) return floors * 3.2;
  return 9;
}

function ringArea(ring) {
  return ring.reduce((area, [x, y], i) => {
    const [nextX, nextY] = ring[(i + 1) % ring.length];
    return area + x * nextY - nextX * y;
  }, 0);
}

function tilePolygons(feature) {
  const polygons = [];
  for (const ring of feature.loadGeometry()) {
    const points = ring.map(({ x, y }) => [x, y]);
    const area = ringArea(points);
    if (area > 0) polygons.push([points]);
    else if (area < 0 && polygons.length) polygons.at(-1).push(points);
  }
  const extent = feature.extent;
  const tile = [[[0, 0], [extent, 0], [extent, extent], [0, extent], [0, 0]]];
  return polygons.flatMap(polygon => polygon.every(ring =>
    ring.every(([x, y]) => x >= 0 && x <= extent && y >= 0 && y <= extent))
    ? [polygon] : polygonClipping.intersection(polygon, tile));
}

export function buildGeographicBuildingTile(data, tile, project, terrain, exclude = () => false, colliders = null) {
  const layer = new VectorTile(new PbfReader(data)).layers.building;
  if (!layer?.length) return null;
  const positions = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== 3 || feature.properties.is_underground) continue;
    for (const polygon of tilePolygons(feature)) {
      const rings = polygon.map(ring => ring.slice(0, -1).map(([x, y]) => {
        const { latitude, longitude } = tileToWgs84(tile.x + x / feature.extent, tile.y + y / feature.extent, zoom);
        const [localX, localZ] = project(latitude, longitude);
        return new THREE.Vector2(localX, localZ);
      }));
      const [outer, ...holes] = rings;
      if (outer.length < 3 || Math.abs(THREE.ShapeUtils.area(outer)) < 3) continue;
      const center = outer.reduce((sum, point) => sum.add(point), new THREE.Vector2()).divideScalar(outer.length);
      if (exclude(center.x, center.y) || terrain.isWater?.(center.x, center.y)
        || (Number.isFinite(terrain.size) && Math.max(Math.abs(center.x), Math.abs(center.y)) > terrain.size / 2)) continue;
      const samples = outer.map(point => terrain.getHeight(point.x, point.y));
      const low = Math.min(...samples);
      const high = Math.max(...samples);
      if (!Number.isFinite(low) || !Number.isFinite(high) || high <= 0) continue;
      const roof = high + geographicBuildingHeight(feature.properties);
      const roofTriangles = THREE.ShapeUtils.triangulateShape(outer, holes);
      if (!roofTriangles.length) continue;
      if (colliders) colliders.push({ rings: rings.map(ring => ring.map(({ x, y }) => [x, y])), low, roof });
      const points = rings.flat();
      for (const triangle of roofTriangles) {
        for (const index of triangle.toReversed()) {
          const point = points[index];
          positions.push(point.x, roof, point.y);
        }
      }
      for (const ring of rings) {
        for (let j = 0; j < ring.length; j++) {
          const a = ring[j];
          const b = ring[(j + 1) % ring.length];
          positions.push(a.x, low, a.y, b.x, low, b.y, a.x, roof, a.y,
            b.x, low, b.y, b.x, roof, b.y, a.x, roof, a.y);
        }
      }
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function* collisionCells(minX, minZ, maxX, maxZ) {
  for (let x = Math.floor(minX / collisionCellSize); x <= Math.floor(maxX / collisionCellSize); x++) {
    for (let z = Math.floor(minZ / collisionCellSize); z <= Math.floor(maxZ / collisionCellSize); z++) {
      yield `${x}/${z}`;
    }
  }
}

function indexColliders(colliders) {
  const cells = new Map();
  for (const collider of colliders) {
    const [outer] = collider.rings;
    const xs = outer.map(point => point[0]);
    const zs = outer.map(point => point[1]);
    for (const key of collisionCells(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs))) {
      const cell = cells.get(key) ?? [];
      if (!cells.has(key)) cells.set(key, cell);
      cell.push(collider);
    }
  }
  return cells;
}

function intersectsBuilding({ pos, radius }, { rings, low, roof }) {
  const vertical = Math.max(low - pos.y, pos.y - roof, 0);
  if (vertical > radius) return false;
  const [outer, ...holes] = rings;
  if (pointInRing(pos.x, pos.z, outer) && !holes.some(ring => pointInRing(pos.x, pos.z, ring))) return true;
  const horizontal = Math.sqrt(radius * radius - vertical * vertical);
  return rings.some(ring => ring.some((point, i) =>
    segmentDistance(pos.x, pos.z, point, ring[(i + 1) % ring.length]) <= horizontal));
}

export class GeographicBuildings {
  constructor({ origin, project, terrain, exclude, archive = source }) {
    this.origin = origin;
    this.project = project;
    this.terrain = terrain;
    this.exclude = exclude;
    this.archive = archive;
    this.group = new THREE.Group();
    this.group.name = 'Geographic buildings';
    this.material = new THREE.MeshLambertMaterial({ color: 0xb5aaa0, side: THREE.DoubleSide });
    this.tiles = new Map();
    this.pending = null;
    this.retryAt = new Map();
  }

  tilesNear(position) {
    if (position.y - this.terrain.getHeight(position.x, position.z) >= 3500) return [];
    const { latitude, longitude } = localToWgs84(position.x, position.z, this.origin);
    const center = wgs84ToTile(latitude, longitude, zoom);
    return neighbors.map(([dx, dy]) => {
      const x = (center.x + dx + worldTiles) % worldTiles;
      const y = center.y + dy;
      return { key: `${x}/${y}`, x, y };
    }).filter(tile => tile.y >= 0 && tile.y < worldTiles);
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
    const tile = this.wantedTiles.find(({ key }) => !this.tiles.has(key) && now >= (this.retryAt.get(key) ?? 0));
    if (tile) void this.load(tile);
  }

  retainTiles(wanted) {
    const wantedKeys = new Set(wanted.map(tile => tile.key));
    for (const [key, { mesh }] of this.tiles) {
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
      const colliders = [];
      const geometry = response && buildGeographicBuildingTile(response.data, tile, this.project, this.terrain, this.exclude, colliders);
      const collisionCells = indexColliders(colliders);
      const mesh = geometry ? new THREE.Mesh(geometry, this.material) : null;
      if (mesh) {
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
      this.tiles.set(tile.key, { mesh, collisionCells });
      this.retryAt.delete(tile.key);
    } catch {
      if (!controller.signal.aborted) this.retryAt.set(tile.key, performance.now() + 5000);
    } finally {
      this.pending = null;
    }
  }

  checkCollision(probes) {
    if (!this.tiles.size) return null;
    for (const probe of probes) {
      const { pos, radius } = probe;
      for (const cell of collisionCells(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius)) {
        for (const key of this.aircraftTiles ?? []) {
          if (this.tiles.get(key)?.collisionCells.get(cell)?.some(collider => intersectsBuilding(probe, collider))) {
            return { point: pos.clone(), get part() { return probe.desc; } };
          }
        }
      }
    }
    return null;
  }

  dispose() {
    this.pending?.controller.abort();
    this.group.removeFromParent();
    for (const { mesh } of this.tiles.values()) mesh?.geometry.dispose();
    if (this.terrain.geographicBuildingLayer === this) delete this.terrain.geographicBuildingLayer;
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

export function updateGeographicBuildings(sim) {
  const origin = Object.hasOwn(frames, sim.activeAirport) && frames[sim.activeAirport];
  const terrain = sim.currentTerrain;
  if (sim.geographicBuildingLayer?.terrain !== terrain || !origin) {
    sim.geographicBuildingLayer?.dispose();
    sim.geographicBuildingLayer = null;
  }
  if (origin && terrain?.mesh && !sim.geographicBuildingLayer) {
    const project = sim.activeAirport === 'incheon' ? projectToLocal
      : (latitude, longitude) => wgs84ToLocal(latitude, longitude, origin);
    const airport = sim.currentAirport;
    sim.geographicBuildingLayer = new GeographicBuildings({
      origin, project, terrain,
      exclude: (x, z) => airport?.isRunwaySafetyArea?.(x, z) || airport?.hasModeledBuilding?.(x, z),
    });
    terrain.geographicBuildingLayer = sim.geographicBuildingLayer;
    terrain.mesh.add(sim.geographicBuildingLayer.group);
  }
  sim.geographicBuildingLayer?.update(sim.position, sim.camera.position);
  const attribution = document.getElementById('geographic-buildings-attribution');
  if (attribution) attribution.hidden = !sim.geographicBuildingLayer?.group.children.length;
}
