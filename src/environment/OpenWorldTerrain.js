import * as THREE from 'three';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { TileCacheManager } from './TileCacheManager.js';
import { localToWgs84, tileToWgs84, wgs84ToLocal, wgs84ToTile } from '../geospatial/TileCoordinateSystem.js';
import { INCHEON_PATCH } from '../geospatial/incheon.js';
import { JEJU_ORIGIN, CHUJA_EMERGENCY_STRIP } from '../geospatial/CorridorCoordinateSystem.js';

const zoom = 11;
const tilesAcross = 2 ** zoom;
const samples = 256;
const segments = 128;
const stride = segments + 1;
const elevationUrl = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const waterArchive = new PMTiles(
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-11-18.0/base.pmtiles',
);

const keyOf = (x, y) => `${x}/${y}`;
const wrapX = x => (x + tilesAcross) % tilesAcross;
const contains = ([west, north, east, south], x, z) => x >= west && x <= east && z >= north && z <= south;

function projectedBounds(x, y, project) {
  const corners = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].map(([tx, ty]) => {
    const { latitude, longitude } = tileToWgs84(tx, ty, zoom);
    return project(latitude, longitude);
  });
  const xs = corners.map(point => point[0]);
  const zs = corners.map(point => point[1]);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}


export function decodeTerrarium(rgba) {
  const heights = new Float32Array(rgba.length / 4);
  for (let i = 0, j = 0; i < heights.length; i++, j += 4) {
    heights[i] = rgba[j] * 256 + rgba[j + 1] + rgba[j + 2] / 256 - 32768;
  }
  return heights;
}

function tileContext() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = samples;
  return canvas.getContext('2d', { willReadFrequently: true });
}

function readWaterMask(data) {
  const context = tileContext();
  const layer = new VectorTile(new PbfReader(data)).layers.water;
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const feature = layer.feature(i);
    if (feature.type !== 3 || feature.properties.is_intermittent
      || feature.properties.class === 'swimming_pool') continue;
    const scale = samples / feature.extent;
    context.beginPath();
    for (const ring of feature.loadGeometry()) {
      if (!ring.length) continue;
      context.moveTo(ring[0].x * scale, ring[0].y * scale);
      for (let j = 1; j < ring.length; j++) context.lineTo(ring[j].x * scale, ring[j].y * scale);
      context.closePath();
    }
    context.fill('evenodd');
  }
  return context.getImageData(0, 0, samples, samples).data;
}

function imageryTexture(image) {
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function clipSide(polygon, axis, limit, direction) {
  const clipped = [];
  let a = polygon.at(-1);
  for (const b of polygon) {
    const da = (a[axis] - limit) * direction;
    const db = (b[axis] - limit) * direction;
    if ((da >= 0) !== (db >= 0)) {
      const weight = da / (da - db);
      clipped.push(a.map((value, index) => THREE.MathUtils.lerp(value, b[index], weight)));
    }
    if (db >= 0) clipped.push(b);
    a = b;
  }
  return clipped;
}

function subtractRectangle(polygon, [west, north, east, south]) {
  const bounds = [[0, west, -1], [0, east, 1], [2, north, -1], [2, south, 1]];
  const outside = [];
  let inside = polygon;
  for (const [axis, limit, side] of bounds) {
    if (!inside.length) break;
    const piece = clipSide(inside, axis, limit, side);
    if (piece.length >= 3) outside.push(piece);
    inside = clipSide(inside, axis, limit, -side);
  }
  return outside;
}

export function buildOpenTerrainTile({ x, y, raster, east, south, southeast, water, project, protectedAreas = [] }) {
  const bounds = projectedBounds(x, y, project);
  const overlaps = protectedAreas.filter(([west, north, east, south]) =>
    west < bounds[2] && east > bounds[0] && north < bounds[3] && south > bounds[1]);
  const vertices = [];
  const indices = [];
  const mapCoordinates = [];
  const colors = [];
  const groundColor = new THREE.Color();
  const appendVertex = ([localX, height, localZ, u, v, wet]) => {
    const index = vertices.length / 3;
    vertices.push(localX, height, localZ);
    mapCoordinates.push(u, 1 - v);
    groundColor.set(wet >= 0.5 ? 0x426982 : height > 550 ? 0x637153 : 0x78816a);
    colors.push(groundColor.r, groundColor.g, groundColor.b);
    return index;
  };
  const data = [raster, east, south, southeast];
  for (let row = 0; row < stride; row++) {
    for (let col = 0; col < stride; col++) {
      const u = col / segments;
      const v = row / segments;
      const source = data[Number(u === 1) + 2 * Number(v === 1)];
      const height = source[(row * 2) % samples * samples + (col * 2) % samples];
      const { latitude, longitude } = tileToWgs84(x + u, y + v, zoom);
      const [localX, localZ] = project(latitude, longitude);
      const wet = height <= 0 || (water?.[(Math.min(row * 2, 255) * samples + Math.min(col * 2, 255)) * 4 + 3] ?? 0) >= 128;
      appendVertex([localX, height, localZ, u, v, Number(wet)]);
    }
  }
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const nw = row * stride + col;
      for (const triangle of [[nw, nw + stride, nw + 1], [nw + stride + 1, nw + 1, nw + stride]]) {
        let pieces = null;
        for (const area of overlaps) {
          const xs = triangle.map(index => vertices[index * 3]);
          const zs = triangle.map(index => vertices[index * 3 + 2]);
          if (Math.max(...xs) <= area[0] || Math.min(...xs) >= area[2]
            || Math.max(...zs) <= area[1] || Math.min(...zs) >= area[3]) continue;
          if (triangle.every((_, i) => contains(area, xs[i], zs[i]))) {
            pieces = [];
            break;
          }
          pieces ??= [triangle.map(index => [...vertices.slice(index * 3, index * 3 + 3),
            mapCoordinates[index * 2], 1 - mapCoordinates[index * 2 + 1], Number(vertices[index * 3 + 1] <= 0)])];
          pieces = pieces.flatMap(piece => subtractRectangle(piece, area));
        }
        if (!pieces) indices.push(...triangle);
        else for (const piece of pieces) {
          const polygon = piece.map(appendVertex);
          for (let i = 1; i < polygon.length - 1; i++) indices.push(polygon[0], polygon[i], polygon[i + 1]);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mapCoordinates, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return { geometry, water };
}

function heightOnTriangle(positions, x, z, a, b, c) {
  const ax = positions.getX(a), az = positions.getZ(a);
  const bx = positions.getX(b) - ax, bz = positions.getZ(b) - az;
  const cx = positions.getX(c) - ax, cz = positions.getZ(c) - az;
  const determinant = bx * cz - bz * cx;
  const u = ((x - ax) * cz - (z - az) * cx) / determinant;
  const v = (bx * (z - az) - bz * (x - ax)) / determinant;
  return u >= -0.0001 && v >= -0.0001 && u + v <= 1.0001
    ? positions.getY(a) * (1 - u - v) + positions.getY(b) * u + positions.getY(c) * v
    : undefined;
}

export class OpenWorldTerrain {
  constructor({ origin, protectedAreas = [], elevationCache, imageryCache, waterSource = waterArchive }) {
    this.origin = origin;
    this.protectedAreas = protectedAreas;
    this.elevationCache = elevationCache ?? new TileCacheManager({ urlTemplate: elevationUrl });
    this.imageryCache = imageryCache ?? new TileCacheManager({ enableBrowserCache: false });
    this.waterSource = waterSource;
    this.group = new THREE.Group();
    this.group.name = 'Streaming open-world terrain';
    this.tiles = new Map();
    this.rasters = new Map();
    this.pending = new Map();
    this.retry = new Map();
    this.wanted = [];
    this.detailWanted = new Map();
    this.pendingDetail = null;
    this.project = (latitude, longitude) => wgs84ToLocal(latitude, longitude, origin);
  }

  coordinate(x, z) {
    const { latitude, longitude } = localToWgs84(x, z, this.origin);
    return wgs84ToTile(latitude, longitude, zoom);
  }

  protects(x, z) {
    return this.protectedAreas.some(area => contains(area, x, z));
  }

  sample(x, z) {
    if (this.protects(x, z)) return undefined;
    const { x: tx, y: ty, fx, fy } = this.coordinate(x, z);
    const tile = this.tiles.get(keyOf(wrapX(tx), ty));
    if (!tile) return undefined;
    const col = Math.min(segments - 1, Math.floor(fx * segments));
    const row = Math.min(segments - 1, Math.floor(fy * segments));
    const positions = tile.mesh.geometry.attributes.position;
    let height;
    for (let dz = -1; dz <= 1 && height === undefined; dz++) {
      for (let dx = -1; dx <= 1 && height === undefined; dx++) {
        if (row + dz < 0 || row + dz >= segments || col + dx < 0 || col + dx >= segments) continue;
        const nw = (row + dz) * stride + col + dx;
        height = heightOnTriangle(positions, x, z, nw, nw + stride, nw + 1)
          ?? heightOnTriangle(positions, x, z, nw + stride + 1, nw + 1, nw + stride);
      }
    }
    if (height === undefined) return undefined;
    const pixel = (Math.floor(fy * samples) * samples + Math.floor(fx * samples)) * 4 + 3;
    const water = height <= 0 || (tile.water?.[pixel] ?? 0) >= 128;
    return { height: Math.max(0, height), water };
  }

  readyAt(x, z) {
    if (this.protects(x, z)) return true;
    const { x: tx, y: ty } = this.coordinate(x, z);
    return this.tiles.has(keyOf(wrapX(tx), ty));
  }

  update(position, velocity) {
    const center = this.coordinate(position.x, position.z);
    const forward = this.coordinate(position.x + velocity.x * 65, position.z + velocity.z * 65);
    const selection = `${center.x}/${center.y}:${forward.x}/${forward.y}`;
    if (selection !== this.selection) {
      this.selection = selection;
      const candidates = [];
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = wrapX(center.x + dx), y = center.y + dz;
          if (y < 0 || y >= tilesAcross - 1) continue;
          const [west, north, east, south] = projectedBounds(x, y, this.project);
          if (this.protectedAreas.some(area => contains(area, west, north) && contains(area, east, south))) continue;
          candidates.push({ x, y, key: keyOf(x, y),
            order: dx ** 2 + dz ** 2 - (x === forward.x && y === forward.y ? 0.5 : 0) });
        }
      }
      this.wanted = candidates.sort((a, b) => a.order - b.order);
      const keys = new Set(this.wanted.map(tile => tile.key));
      for (const [key, entry] of this.tiles) if (!keys.has(key)) this.release(key, entry);
      for (const [key, controller] of this.pending) if (!keys.has(key)) controller.abort();
      for (const key of this.retry.keys()) if (!keys.has(key)) this.retry.delete(key);
    }
    this.updateImageryDetail(center, position.y - (this.sample(position.x, position.z)?.height ?? 0));
    if (this.pending.size >= 3) return;
    const now = performance.now();
    const next = this.wanted.find(({ key }) =>
      !this.tiles.has(key) && !this.pending.has(key) && now >= (this.retry.get(key) ?? 0));
    if (next) void this.load(next);
  }

  updateImageryDetail(center, height) {
    const selection = height < 3500 ? keyOf(wrapX(center.x), center.y) : null;
    if (selection !== this.detailSelection) {
      this.detailSelection = selection;
      this.detailWanted.clear();
      if (selection) {
        this.detailWanted.set(selection, 13);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          this.detailWanted.set(keyOf(wrapX(center.x + dx), center.y + dy), 12);
        }
      }
      for (const [key, entry] of this.tiles) {
        if (!entry.detailMap || this.detailWanted.get(key) >= entry.detailLevel) continue;
        entry.detailMap.dispose();
        entry.detailMap = null;
        entry.detailLevel = zoom;
        this.applyImagery(entry, entry.baseMap);
      }
    }

    if (this.pendingDetail || this.pending.size) return;
    const now = performance.now();
    for (const [key, level] of this.detailWanted) {
      const entry = this.tiles.get(key);
      if (!entry?.baseMap || entry.detailLevel >= level || now < (entry.detailRetryAt ?? 0)) continue;
      this.pendingDetail = this.loadImageryDetail(key, entry, level).finally(() => { this.pendingDetail = null; });
      break;
    }
  }

  applyImagery(entry, map) {
    const material = entry.mesh.material;
    material.map = map;
    material.vertexColors = !map;
    material.needsUpdate = true;
  }

  async loadImageryDetail(key, entry, level) {
    const [x, y] = key.split('/').map(Number);
    const count = 2 ** (level - zoom);
    const images = await Promise.all(Array.from({ length: count * count }, (_, i) =>
      this.imageryCache.getTileImage(level, x * count + i % count, y * count + Math.floor(i / count))));
    if (this.tiles.get(key) !== entry || this.detailWanted.get(key) !== level) return;
    if (images.some(image => !image || image.width !== samples || image.height !== samples)) {
      entry.detailRetryAt = performance.now() + 15000;
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = samples * count;
    const context = canvas.getContext('2d');
    for (const [i, image] of images.entries()) {
      context.drawImage(image, (i % count) * samples, Math.floor(i / count) * samples);
    }
    entry.detailMap?.dispose();
    entry.detailMap = imageryTexture(canvas);
    entry.detailLevel = level;
    this.applyImagery(entry, entry.detailMap);
  }

  raster(x, y) {
    const key = keyOf(x, y);
    const prior = this.rasters.get(key);
    if (prior) {
      this.rasters.delete(key);
      this.rasters.set(key, prior);
      return prior;
    }
    const request = this.elevationCache.getTileImage(zoom, x, y).then(image => {
      if (!image || image.width !== samples || image.height !== samples) throw new Error('Elevation tile unavailable');
      const context = tileContext();
      context.drawImage(image, 0, 0);
      return decodeTerrarium(context.getImageData(0, 0, samples, samples).data);
    }).catch(error => {
      if (this.rasters.get(key) === request) this.rasters.delete(key);
      throw error;
    });
    this.rasters.set(key, request);
    if (this.rasters.size > 64) this.rasters.delete(this.rasters.keys().next().value);
    return request;
  }

  async load(tile) {
    const { x, y, key } = tile;
    const controller = new AbortController();
    this.pending.set(key, controller);
    try {
      const waterData = this.waterSource.getZxy(zoom, x, y, AbortSignal.any([controller.signal, AbortSignal.timeout(4500)]))
        .then(result => result && readWaterMask(result.data)).catch(() => undefined);
      const [raster, east, south, southeast, water] = await Promise.all([
        this.raster(x, y), this.raster(wrapX(x + 1), y), this.raster(x, y + 1), this.raster(wrapX(x + 1), y + 1), waterData,
      ]);
      if (controller.signal.aborted) return;
      const { geometry } = buildOpenTerrainTile({
        x, y, raster, east, south, southeast, water, project: this.project, protectedAreas: this.protectedAreas,
      });
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      const entry = { mesh, water, baseMap: null, detailLevel: zoom };
      this.tiles.set(key, entry);
      this.group.add(mesh);
      this.retry.delete(key);
      if (!geometry.index.count) return;
      const image = await this.imageryCache.getTileImage(zoom, x, y);
      if (!image || this.tiles.get(key)?.mesh !== mesh) return;
      entry.baseMap = imageryTexture(image);
      this.applyImagery(entry, entry.baseMap);
    } catch {
      if (!controller.signal.aborted) this.retry.set(key, performance.now() + 4000);
    } finally {
      this.pending.delete(key);
    }
  }

  release(key, { mesh, baseMap, detailMap }) {
    this.tiles.delete(key);
    mesh.removeFromParent();
    mesh.geometry.dispose();
    baseMap?.dispose();
    detailMap?.dispose();
    mesh.material.dispose();
  }

  dispose() {
    for (const controller of this.pending.values()) controller.abort();
    for (const [key, entry] of this.tiles) this.release(key, entry);
    this.elevationCache.dispose();
    this.imageryCache.dispose();
    this.rasters.clear();
    this.group.removeFromParent();
  }
}

const chuja = wgs84ToLocal(CHUJA_EMERGENCY_STRIP.center.latitude, CHUJA_EMERGENCY_STRIP.center.longitude, JEJU_ORIGIN);
const frames = {
  incheon: { origin: INCHEON_PATCH.origin, protectedAreas: [[-25000, -25000, 25000, 25000]] },
  jeju: { origin: JEJU_ORIGIN, protectedAreas: [
    [-36260, -12000, 43740, 44000],
    [chuja[0] - 2500, chuja[1] - 2500, chuja[0] + 2500, chuja[1] + 2500],
  ] },
};

export function updateOpenWorldTerrain(sim) {
  const surface = sim.currentTerrain;
  const frame = Object.hasOwn(frames, sim.activeAirport) && frames[sim.activeAirport];
  if (sim.openWorldSurface !== surface || !frame) {
    const previous = sim.openWorldSurface;
    if (previous?.openWorld) {
      previous.openWorld.dispose();
      previous.openWorld = null;
      if (previous.corridorStreamer) previous.corridorStreamer.group.visible = true;
    }
    sim.openWorldSurface = frame ? surface : null;
  }
  if (frame && surface?.mesh) {
    if (!surface.openWorld) {
      surface.openWorld = new OpenWorldTerrain(frame);
      surface.mesh.add(surface.openWorld.group);
      if (surface.corridorStreamer) surface.corridorStreamer.group.visible = false;
    }
    surface.openWorld.update(sim.position, sim.linearVelocity);
  }
  const attribution = document.getElementById('open-world-attribution');
  if (attribution) attribution.hidden = !surface?.openWorld?.tiles.size;
}
