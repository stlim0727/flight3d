import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { nightLightLevel } from './AirportNightLighting.js';
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
const lampPoleHeight = 6;
const nearLampRange = 1600;
const farLampRange = 3000;
const maxNearLamps = 1500;
const maxFarLamps = 4000;
const lampSpacing = { motorway: 48, trunk: 44, primary: 40, secondary: 34, tertiary: 30 };
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

/** Both sides of a run, spaced by road class; positions are the pole bases. */
export function roadLamps(points, width, heightAt, spacing) {
  if (points.length < 2 || !Number.isFinite(spacing)) return [];
  const lamps = [];
  let carried = spacing / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (!length) continue;
    let along = carried;
    while (along <= length) {
      const t = along / length;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      const y = heightAt(x, z);
      if (Number.isFinite(y)) {
        const offset = (width / 2 + 1.2) / length;
        lamps.push(
          new THREE.Vector3(x - dz * offset, y, z + dx * offset),
          new THREE.Vector3(x + dz * offset, y, z - dx * offset),
        );
      }
      along += spacing;
    }
    carried = along - length;
  }
  return lamps;
}

/**
 * Build one draped ribbon mesh. Surface sections of bridge, tunnel, covered and
 * level-separated segments are deliberately omitted until span handling exists.
 * Lamp bases are collected in the optional array when night lighting is active.
 */
export function buildGeographicRoadTile(data, tile, project, terrain, exclude = () => false, lamps = null) {
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
        if (lamps) lamps.push(...roadLamps(run, width, (x, z) => terrain.getHeight(x, z), lampSpacing[properties.class]));
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

function lampGlowTexture() {
  const size = 16;
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const alpha = Math.round(Math.max(0, 1 - Math.hypot(x - 7.5, y - 7.5) / 7.5) * 255);
      bytes.set([255, 224, 178, alpha], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function lampGeometry() {
  const pole = new THREE.CylinderGeometry(0.12, 0.2, lampPoleHeight, 5);
  pole.translate(0, lampPoleHeight / 2, 0);
  const head = new THREE.SphereGeometry(0.42, 6, 4);
  head.translate(0, lampPoleHeight, 0);
  const poleColors = new Float32Array(pole.attributes.position.count * 3).fill(0.16);
  const headColors = new Float32Array(head.attributes.position.count * 3).fill(1);
  pole.setAttribute('color', new THREE.BufferAttribute(poleColors, 3));
  head.setAttribute('color', new THREE.BufferAttribute(headColors, 3));
  const geometry = mergeGeometries([pole, head]);
  pole.dispose();
  head.dispose();
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
    this.lamps = new Map();
    this.pending = null;
    this.retryAt = new Map();
    this.lightsDirty = true;

    this.lampMesh = new THREE.InstancedMesh(lampGeometry(), new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, fog: false, depthWrite: false,
    }), maxNearLamps);
    this.lampMesh.name = 'Streamed road lamps';
    this.lampMesh.frustumCulled = false;
    this.lampMesh.count = 0;
    this.group.add(this.lampMesh);

    this.glow = lampGlowTexture();
    this.lampPointsMaterial = new THREE.PointsMaterial({
      map: this.glow, color: 0xffc688, size: 3, sizeAttenuation: false, vertexColors: true,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
    });
    this.lampPoints = new THREE.Points(new THREE.BufferGeometry(), this.lampPointsMaterial);
    this.lampPoints.name = 'Streamed road lamp glow';
    this.lampPoints.frustumCulled = false;
    this.group.add(this.lampPoints);
    this.matrix = new THREE.Matrix4();
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

  update(position, cameraPosition = position, sunHeight = 1) {
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
    this.updateLights(cameraPosition, sunHeight);
    if (this.pending) return;
    const now = performance.now();
    const tile = this.wantedTiles.find(candidate => !this.tiles.has(candidate.key)
      && now >= (this.retryAt.get(candidate.key) ?? 0) && this.hasGround(candidate));
    if (tile) void this.load(tile);
  }

  rebuildLights(cameraPosition) {
    const seen = new Set();
    const near = [];
    const far = [];
    for (const [key, lamps] of this.lamps) {
      if (!this.tiles.has(key)) continue;
      for (const lamp of lamps) {
        const id = `${Math.round(lamp.x)}/${Math.round(lamp.z)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const distance = Math.hypot(cameraPosition.x - lamp.x, cameraPosition.z - lamp.z);
        if (distance <= nearLampRange && near.length < maxNearLamps) near.push(lamp);
        if (distance <= farLampRange && far.length < maxFarLamps) far.push(lamp);
      }
    }
    const positions = new Float32Array(far.length * 3);
    const colors = new Float32Array(far.length * 4).fill(1);
    far.forEach((lamp, i) => {
      positions.set([lamp.x, lamp.y + lampPoleHeight, lamp.z], i * 3);
    });
    this.lampPoints.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geometry.attributes.color.setUsage(THREE.DynamicDrawUsage);
    this.lampPoints.geometry = geometry;
    this.nearLamps = near;
    this.farLamps = far;
    this.lampMatricesDirty = true;
    this.lightsDirty = false;
  }

  updateLights(cameraPosition, sunHeight) {
    const night = nightLightLevel(sunHeight);
    const agl = cameraPosition.y - this.terrain.getHeight(cameraPosition.x, cameraPosition.z);
    const fade = 1 - THREE.MathUtils.smoothstep(agl, 2500, 4000);
    this.lampPointsMaterial.opacity = night * fade * 0.55;
    this.lampPoints.visible = this.lampPointsMaterial.opacity > 0.01;
    this.lampMesh.material.opacity = night;
    this.lampMesh.visible = this.lampPoints.visible && agl < 2200;
    if (!this.lampPoints.visible && !this.lampMesh.visible) return;
    if (this.lightsDirty || !this.lampCentre
      || Math.hypot(cameraPosition.x - this.lampCentre.x, cameraPosition.z - this.lampCentre.z) > 75) {
      this.lampCentre = { x: cameraPosition.x, z: cameraPosition.z };
      this.rebuildLights(cameraPosition);
    }
    if (this.lampMatricesDirty) {
      this.lampMesh.count = this.nearLamps.length;
      this.nearLamps.forEach((lamp, i) => {
        this.matrix.makeTranslation(lamp.x, lamp.y, lamp.z);
        this.lampMesh.setMatrixAt(i, this.matrix);
      });
      this.lampMesh.instanceMatrix.needsUpdate = true;
      this.lampMatricesDirty = false;
    }
    const colors = this.lampPoints.geometry.attributes.color;
    if (!colors) return;
    let changed = false;
    this.farLamps.forEach((lamp, i) => {
      const distance = Math.hypot(cameraPosition.x - lamp.x, cameraPosition.z - lamp.z);
      const alpha = THREE.MathUtils.smoothstep(distance, nearLampRange, farLampRange);
      if (Math.abs(colors.array[i * 4 + 3] - alpha) < 0.002) return;
      colors.array[i * 4 + 3] = alpha;
      changed = true;
    });
    if (changed) colors.needsUpdate = true;
  }

  retainTiles(wanted) {
    const wantedKeys = new Set(wanted.map(tile => tile.key));
    for (const [key, mesh] of this.tiles) {
      if (wantedKeys.has(key)) continue;
      mesh?.removeFromParent();
      mesh?.geometry.dispose();
      this.tiles.delete(key);
      this.lamps.delete(key);
      this.lightsDirty = true;
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
      const lamps = [];
      const geometry = response && buildGeographicRoadTile(response.data, tile, this.project, this.terrain, this.exclude, lamps);
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.tiles.set(tile.key, mesh);
      } else {
        this.tiles.set(tile.key, null);
      }
      this.lamps.set(tile.key, lamps);
      this.lightsDirty = true;
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
    this.lamps.clear();
    this.retryAt.clear();
    this.material.dispose();
    this.lampMesh.geometry.dispose();
    this.lampMesh.material.dispose();
    this.lampPoints.geometry.dispose();
    this.lampPointsMaterial.dispose();
    this.glow.dispose();
  }
}

const frames = {
  incheon: INCHEON_PATCH.origin,
  jeju: JEJU_ORIGIN,
  lukla: luklaGrid.origin,
};

export function updateGeographicRoads(sim, elapsed) {
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
  sim.geographicRoadLayer?.update(sim.position, sim.camera.position, sim.sky.sunPosition.y, elapsed);
  const attribution = document.getElementById('geographic-roads-attribution');
  if (attribution) attribution.hidden = !sim.geographicRoadLayer?.tiles.size;
}
