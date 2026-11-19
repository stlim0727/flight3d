import * as THREE from 'three';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import polygonClipping from 'polygon-clipping';
import { localToWgs84, tileToWgs84, wgs84ToLocal, wgs84ToTile } from '../geospatial/TileCoordinateSystem.js';
import { projectToLocal, INCHEON_PATCH } from '../geospatial/incheon.js';
import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import luklaGrid from '../config/luklaTerrainGrid.json' with { type: 'json' };

const neighbors = [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const zoom = 14;
const worldTiles = 2 ** zoom;
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

export function buildGeographicBuildingTile(data, tile, project, terrain, exclude = () => false) {
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
    this.retryAt = 0;
  }

  update(position) {
    if (this.terrain.isLoaded === false) return;
    const { latitude, longitude } = localToWgs84(position.x, position.z, this.origin);
    const center = wgs84ToTile(latitude, longitude, zoom);
    const nearGround = position.y - this.terrain.getHeight(position.x, position.z) < 3500;
    const wanted = nearGround ? neighbors.map(([dx, dy]) => {
      const x = (center.x + dx + worldTiles) % worldTiles;
      const y = center.y + dy;
      return { key: `${x}/${y}`, x, y };
    }).filter(tile => tile.y >= 0 && tile.y < worldTiles) : [];
    const selection = nearGround ? `${center.x}/${center.y}` : null;
    if (selection !== this.selection) {
      this.selection = selection;
      this.retainTiles(wanted);
    }
    if (this.pending || performance.now() < this.retryAt) return;
    const tile = wanted.find(({ key }) => !this.tiles.has(key));
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
    if (this.pending && !wantedKeys.has(this.pending.key)) this.pending.controller.abort();
  }

  async load(tile) {
    const controller = new AbortController();
    this.pending = { key: tile.key, controller };
    try {
      const response = await this.archive.getZxy(zoom, tile.x, tile.y, controller.signal);
      if (controller.signal.aborted) return;
      const geometry = response && buildGeographicBuildingTile(response.data, tile, this.project, this.terrain, this.exclude);
      const mesh = geometry ? new THREE.Mesh(geometry, this.material) : null;
      if (mesh) {
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
      this.tiles.set(tile.key, mesh);
    } catch {
      if (!controller.signal.aborted) this.retryAt = performance.now() + 5000;
    } finally {
      this.pending = null;
    }
  }

  dispose() {
    this.pending?.controller.abort();
    this.group.removeFromParent();
    for (const mesh of this.tiles.values()) mesh?.geometry.dispose();
    this.group.clear();
    this.tiles.clear();
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
    terrain.mesh.add(sim.geographicBuildingLayer.group);
  }
  sim.geographicBuildingLayer?.update(sim.camera.position);
  const attribution = document.getElementById('geographic-buildings-attribution');
  if (attribution) attribution.hidden = !sim.geographicBuildingLayer?.group.children.length;
}
