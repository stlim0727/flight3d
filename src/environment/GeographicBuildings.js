import * as THREE from 'three';
import { nightLightLevel } from './AirportNightLighting.js';
import { cityFacadeUvShader, createCityFacadeAtlas } from './CityBuildingAssets.js';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import polygonClipping from 'polygon-clipping';
import { localToWgs84, tileToWgs84, wgs84ToLocal, wgs84ToTile } from '../geospatial/TileCoordinateSystem.js';
import { projectToLocal, INCHEON_PATCH } from '../geospatial/incheon.js';
import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { pointInRing, segmentDistance } from '../geospatial/incheonDressing.js';
import { extractBuildingLandmarks } from '../geospatial/overtureLandmarks.js';
import luklaGrid from '../config/luklaTerrainGrid.json' with { type: 'json' };
import { setMapAttributionSource } from '../ui/mapAttribution.js';

const neighbors = [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const zoom = 14;
const overviewZoom = 12;
const collisionCellSize = 128;
const source = new PMTiles(
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-11-18.0/buildings.pmtiles',
);

function lightTexture(size, sample, alphaOnly = false) {
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = Math.round(sample(x, y) * 255);
      const channel = alphaOnly ? 255 : value;
      bytes.set([channel, channel, channel, value], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function cityGlowTexture() {
  return lightTexture(16, (x, y) => Math.max(0, 1 - Math.hypot(x - 7.5, y - 7.5) / 7.5), true);
}

const fract = value => value - Math.floor(value);
const roofAtlasUv = (x, z) => [
  (1 + 0.02 + fract(x / 24) * 0.96) / 2,
  (1 + 0.02 + fract(z / 24) * 0.96) / 2,
];

function buildOverviewTile(data, tile, project, terrain, exclude) {
  const layer = new VectorTile(new PbfReader(data)).layers.building;
  const occupied = new Set();
  const positions = [];
  const detailKeys = [];
  const footprintOffsets = [];
  const boxes = [];
  const detailScale = 2 ** (zoom - overviewZoom);
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const feature = layer.feature(i);
    if (feature.type !== 3 || feature.properties.is_underground) continue;
    const [west, north, east, south] = feature.bbox();
    const x = (west + east) / (2 * feature.extent);
    const y = (north + south) / (2 * feature.extent);
    if (x < 0 || x >= 1 || y < 0 || y >= 1) continue;
    const cell = `${Math.floor(x * 96)}/${Math.floor(y * 96)}`;
    if (occupied.has(cell)) continue;
    const { latitude, longitude } = tileToWgs84(tile.x + x, tile.y + y, overviewZoom);
    const [localX, localZ] = project(latitude, longitude);
    if (Number.isFinite(terrain.size) && Math.max(Math.abs(localX), Math.abs(localZ)) > terrain.size / 2) continue;
    const height = terrain.getHeight(localX, localZ);
    // At this scale a mapped footprint still contributes light where the flight surface
    // lacks local terrain. Its source coordinates remain the anchor.
    occupied.add(cell);
    positions.push(localX, (Number.isFinite(height) ? height : 0) + 30, localZ);
    detailKeys.push(`${Math.floor((tile.x + x) * detailScale)}/${Math.floor((tile.y + y) * detailScale)}`);

    footprintOffsets.push(-1);
    if (!Number.isFinite(height) || height <= 0 || terrain.isWater?.(localX, localZ)) continue;
    const { latitude: nwLat, longitude: nwLon } = tileToWgs84(
      tile.x + west / feature.extent, tile.y + north / feature.extent, overviewZoom,
    );
    const { latitude: seLat, longitude: seLon } = tileToWgs84(
      tile.x + east / feature.extent, tile.y + south / feature.extent, overviewZoom,
    );
    const [x0, z0] = project(nwLat, nwLon);
    const [x1, z1] = project(seLat, seLon);
    const width = Math.min(180, Math.abs(x1 - x0) * 0.75);
    const depth = Math.min(180, Math.abs(z1 - z0) * 0.75);
    if (width * depth < 65) continue;
    const corners = [
      { x: localX - width / 2, y: localZ - depth / 2 },
      { x: localX - width / 2, y: localZ + depth / 2 },
      { x: localX + width / 2, y: localZ - depth / 2 },
      { x: localX + width / 2, y: localZ + depth / 2 },
    ];
    if (exclude(localX, localZ, corners)) continue;
    const base = Math.min(height, ...corners.map(point => terrain.getHeight(point.x, point.y)));
    if (!Number.isFinite(base)) continue;
    footprintOffsets[footprintOffsets.length - 1] = boxes.length;
    boxes.push({ x: localX, z: localZ, base, width, depth, top: height + geographicBuildingHeight(feature.properties) });
  }
  if (!positions.length) return null;
  const lights = new THREE.BufferGeometry();
  lights.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  lights.setAttribute('color', new THREE.BufferAttribute(new Float32Array(detailKeys.length * 4).fill(1), 4));
  lights.attributes.color.setUsage(THREE.DynamicDrawUsage);
  return { lights, silhouettes: buildSilhouettes(boxes), detailKeys, footprintOffsets };
}

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const boxVertexCount = boxGeometry.attributes.position.count;

function buildSilhouettes(boxes) {
  if (!boxes.length) return null;
  const positions = [];
  const normals = [];
  const indices = [];
  const { position, normal } = boxGeometry.attributes;
  for (const [i, { x, z, base, width, depth, top }] of boxes.entries()) {
    const mid = (base + top) / 2;
    for (let v = 0; v < boxVertexCount; v++) {
      positions.push(x + width * position.getX(v), mid + (top - base) * position.getY(v), z + depth * position.getZ(v));
      normals.push(normal.getX(v), normal.getY(v), normal.getZ(v));
    }
    for (const index of boxGeometry.index.array) indices.push(i * boxVertexCount + index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(boxes.length * boxVertexCount * 4).fill(1), 4));
  geometry.attributes.color.setUsage(THREE.DynamicDrawUsage);
  return geometry;
}

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
  const facadeUvs = [];
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
      if (exclude(center.x, center.y, outer) || terrain.isWater?.(center.x, center.y)
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
      const facadeTile = Math.floor(Math.abs(center.x) / 83 + Math.abs(center.y) / 47) % 3;
      const facadeUv = [(facadeTile % 2 + 0.5) / 2, (Math.floor(facadeTile / 2) + 0.5) / 2];
      for (const triangle of roofTriangles) {
        for (const index of triangle.toReversed()) {
          const point = points[index];
          positions.push(point.x, roof, point.y);
          facadeUvs.push(...roofAtlasUv(point.x, point.y));
        }
      }
      for (const ring of rings) {
        for (let j = 0; j < ring.length; j++) {
          const a = ring[j];
          const b = ring[(j + 1) % ring.length];
          positions.push(a.x, low, a.y, b.x, low, b.y, a.x, roof, a.y,
            b.x, low, b.y, b.x, roof, b.y, a.x, roof, a.y);
          facadeUvs.push(...facadeUv, ...facadeUv, ...facadeUv,
            ...facadeUv, ...facadeUv, ...facadeUv);
        }
      }
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(facadeUvs, 2));
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

// Keep collision-relevant buildings visible when crossing a tile border.
function nearBuildingTile(mesh, position) {
  const box = mesh.geometry.boundingBox;
  const dx = Math.max(box.min.x - position.x, position.x - box.max.x, 0);
  const dz = Math.max(box.min.z - position.z, position.z - box.max.z, 0);
  return dx * dx + dz * dz <= 200 * 200;
}

export class GeographicBuildings {
  constructor({ origin, project, terrain, exclude, isRunwaySafetyArea, archive = source }) {
    this.origin = origin;
    this.project = project;
    this.terrain = terrain;
    this.isRunwaySafetyArea = isRunwaySafetyArea;
    this.exclude = (x, z, footprint) => exclude?.(x, z)
      || isRunwaySafetyArea?.(x, z)
      || footprint.some(point => isRunwaySafetyArea?.(point.x, point.y));
    this.archive = archive;
    this.group = new THREE.Group();
    this.group.name = 'Geographic buildings';
    const atlas = createCityFacadeAtlas([255, 218, 141]);
    this.atlas = atlas;
    this.material = new THREE.MeshLambertMaterial({
      map: atlas.map, emissiveMap: atlas.emissiveMap,
      emissive: 0xffffff, emissiveIntensity: 0, side: THREE.DoubleSide,
    });
    this.material.onBeforeCompile = cityFacadeUvShader;
    this.material.customProgramCacheKey = () => 'geo-city-metric-facade-v1';
    this.lightMaterial = new THREE.PointsMaterial({
      map: cityGlowTexture(), color: 0xffc688, size: 5, sizeAttenuation: false, vertexColors: true,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
    });
    this.silhouetteMaterial = new THREE.MeshLambertMaterial({
      color: 0xa99f94, vertexColors: true, alphaHash: true, opacity: 0,
    });
    this.overviewTiles = new Map();
    this.pendingOverview = null;
    this.overviewRetryAt = 0;
    this.tiles = new Map();
    this.landmarksVersion = 0;
    this.pending = null;
    this.retryAt = new Map();
  }

  tilesNear(position) {
    if (position.y - this.terrain.getHeight(position.x, position.z) >= 3500) return [];
    return this.tilesAround(position, zoom);
  }

  tilesAround(position, level) {
    const worldTiles = 2 ** level;
    const { latitude, longitude } = localToWgs84(position.x, position.z, this.origin);
    const center = wgs84ToTile(latitude, longitude, level);
    return neighbors.map(([dx, dy]) => {
      const x = (center.x + dx + worldTiles) % worldTiles;
      const y = center.y + dy;
      return { key: `${x}/${y}`, x, y };
    }).filter(tile => tile.y >= 0 && tile.y < worldTiles);
  }

  hasGround(tile, level) {
    return this.terrain.openWorld?.readyForTile(tile, level) ?? true;
  }

  update(position, cameraPosition = position, sunHeight = 1, elapsed = 1 / 60, reducedDetail = false) {
    if (this.terrain.isLoaded === false) return;
    const night = nightLightLevel(sunHeight);
    this.material.color.setScalar(1 - night * 0.9);
    this.material.emissiveIntensity = night * 0.75;
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
    for (const [key, { mesh }] of this.tiles) {
      if (mesh) mesh.visible = !reducedDetail || key === cameraTiles[0]?.key || key === aircraftTiles[0]?.key
        || nearBuildingTile(mesh, position) || nearBuildingTile(mesh, cameraPosition);
    }
    this.updateOverview(cameraPosition, night, elapsed, reducedDetail);
    if (this.pending) return;
    const now = performance.now();
    const tile = this.wantedTiles.find(candidate => !this.tiles.has(candidate.key)
      && now >= (this.retryAt.get(candidate.key) ?? 0) && this.hasGround(candidate, zoom));
    if (tile) void this.load(tile);
  }

  updateOverview(cameraPosition, night, elapsed, reducedDetail = false) {
    const height = cameraPosition.y - this.terrain.getHeight(cameraPosition.x, cameraPosition.z);
    const fade = 1 - THREE.MathUtils.smoothstep(height, 12500, 15500);
    this.lightMaterial.opacity = night * fade * 0.9;
    this.silhouetteMaterial.opacity = reducedDetail ? 0 : (1 - night) * fade;
    if (reducedDetail && this.lightMaterial.opacity === 0) {
      for (const tile of this.overviewTiles.values()) {
        if (tile?.points) tile.points.visible = false;
        if (tile?.silhouettes) tile.silhouettes.visible = false;
      }
      return;
    }
    const wanted = fade > 0 ? this.tilesAround(cameraPosition, overviewZoom) : [];
    const center = wanted[0]?.key;
    if (center !== this.overviewCenter) {
      this.overviewCenter = center;
      this.retainOverviewTiles(new Set(wanted.map(tile => tile.key)));
    }
    if (!wanted.length) return;

    for (const tile of this.overviewTiles.values()) {
      if (!tile) continue;
      const { points, silhouettes, detailKeys, footprintOffsets } = tile;
      points.visible = this.lightMaterial.opacity > 0;
      if (silhouettes) silhouettes.visible = this.silhouetteMaterial.opacity > 0;
      const { position, color } = points.geometry.attributes;
      const silhouetteColors = silhouettes?.geometry.attributes.color;
      let changed = false;
      let silhouettesChanged = false;
      for (let i = 0; i < position.count; i++) {
        const detail = this.tiles.get(detailKeys[i])?.mesh;
        const index = i * 4 + 3;
        const previous = color.array[index];
        let alpha = 1;
        if (detail?.visible) {
          const distance = Math.hypot(
            cameraPosition.x - position.getX(i),
            cameraPosition.y - position.getY(i),
            cameraPosition.z - position.getZ(i),
          );
          const target = THREE.MathUtils.smoothstep(distance, 800, 2200);
          alpha = Math.abs(target - previous) < 0.002 ? target
            : THREE.MathUtils.damp(previous, target, 4, elapsed);
        }
        if (alpha === previous) continue;
        color.array[index] = alpha;
        changed = true;
        const footprint = footprintOffsets[i];
        if (footprint >= 0) {
          const start = footprint * boxVertexCount;
          for (let v = start; v < start + boxVertexCount; v++) silhouetteColors.setW(v, alpha);
          silhouettesChanged = true;
        }
      }
      if (changed) color.needsUpdate = true;
      if (silhouettesChanged) silhouetteColors.needsUpdate = true;
    }

    if (this.pendingOverview || performance.now() < this.overviewRetryAt) return;
    const tile = wanted.find(candidate => !this.overviewTiles.has(candidate.key) && this.hasGround(candidate, overviewZoom));
    if (tile) void this.loadOverviewTile(tile);
  }

  retainOverviewTiles(wanted) {
    for (const [key, tile] of this.overviewTiles) {
      if (wanted.has(key)) continue;
      for (const object of [tile?.points, tile?.silhouettes]) {
        object?.removeFromParent();
        object?.geometry.dispose();
      }
      this.overviewTiles.delete(key);
    }
    if (this.pendingOverview && !wanted.has(this.pendingOverview.key)) this.pendingOverview.controller.abort();
  }

  async loadOverviewTile(tile) {
    const controller = new AbortController();
    this.pendingOverview = { key: tile.key, controller };
    try {
      const response = await this.archive.getZxy(overviewZoom, tile.x, tile.y, controller.signal);
      if (controller.signal.aborted) return;
      const overview = response && buildOverviewTile(response.data, tile, this.project, this.terrain, this.exclude);
      if (!overview) {
        this.overviewTiles.set(tile.key, null);
        return;
      }
      const points = new THREE.Points(overview.lights, this.lightMaterial);
      points.visible = this.lightMaterial.opacity > 0;
      this.group.add(points);
      const silhouettes = overview.silhouettes ? new THREE.Mesh(overview.silhouettes, this.silhouetteMaterial) : null;
      if (silhouettes) {
        silhouettes.visible = this.silhouetteMaterial.opacity > 0;
        this.group.add(silhouettes);
      }
      this.overviewTiles.set(tile.key, { points, silhouettes, detailKeys: overview.detailKeys, footprintOffsets: overview.footprintOffsets });
    } catch {
      if (!controller.signal.aborted) this.overviewRetryAt = performance.now() + 5000;
    } finally {
      this.pendingOverview = null;
    }
  }

  retainTiles(wanted) {
    const wantedKeys = new Set(wanted.map(tile => tile.key));
    let removedLandmarks = false;
    for (const [key, { mesh, landmarks }] of this.tiles) {
      if (wantedKeys.has(key)) continue;
      mesh?.removeFromParent();
      mesh?.geometry.dispose();
      this.tiles.delete(key);
      if (landmarks?.length) removedLandmarks = true;
    }
    if (removedLandmarks) this.landmarksVersion++;
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
      geometry?.computeBoundingBox();
      const mesh = geometry ? new THREE.Mesh(geometry, this.material) : null;
      if (mesh) {
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
      const landmarks = response?.data ? extractBuildingLandmarks(response.data, tile, zoom) : [];
      this.tiles.set(tile.key, { mesh, collisionCells, landmarks });
      if (landmarks.length) this.landmarksVersion++;
      this.retryAt.delete(tile.key);
    } catch {
      if (!controller.signal.aborted) this.retryAt.set(tile.key, performance.now() + 5000);
    } finally {
      this.pending = null;
    }
  }

  getLandmarks() {
    const landmarks = [];
    for (const entry of this.tiles.values()) {
      if (entry.landmarks?.length) landmarks.push(...entry.landmarks);
    }
    return landmarks;
  }

  checkCollision(probes) {
    if (!this.tiles.size) return null;
    for (const probe of probes) {
      const { pos, radius } = probe;
      if (this.isRunwaySafetyArea?.(pos.x, pos.z)) continue;
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
    this.retainOverviewTiles(new Set());
    this.group.removeFromParent();
    for (const { mesh, landmarks } of this.tiles.values()) {
      mesh?.geometry.dispose();
      if (landmarks?.length) this.landmarksVersion++;
    }
    if (this.terrain.geographicBuildingLayer === this) delete this.terrain.geographicBuildingLayer;
    this.group.clear();
    this.tiles.clear();
    this.retryAt.clear();
    this.atlas.map.dispose();
    this.atlas.emissiveMap.dispose();
    this.material.dispose();
    this.lightMaterial.map.dispose();
    this.lightMaterial.dispose();
    this.silhouetteMaterial.dispose();
  }
}

const frames = {
  incheon: INCHEON_PATCH.origin,
  jeju: JEJU_ORIGIN,
  lukla: luklaGrid.origin,
};

export function updateGeographicBuildings(sim, elapsed) {
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
      exclude: (x, z) => airport?.hasModeledBuilding?.(x, z),
      isRunwaySafetyArea: (x, z) => airport?.isRunwaySafetyArea?.(x, z),
    });
    terrain.geographicBuildingLayer = sim.geographicBuildingLayer;
    terrain.mesh.add(sim.geographicBuildingLayer.group);
  }
  sim.geographicBuildingLayer?.update(sim.position, sim.camera.position, sim.sky.sunPosition.y, elapsed,
    sim.renderQuality === 'ultraLow');
  setMapAttributionSource(
    'geographic-buildings-attribution',
    Boolean(sim.geographicBuildingLayer?.group.children.length || sim.geographicLandmarkLayer?.hasStreamedData),
  );
}
