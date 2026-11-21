import * as THREE from 'three';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { TileCacheManager } from './TileCacheManager.js';
import { localToWgs84, tileToWgs84, wgs84ToLocal, wgs84ToTile } from '../geospatial/TileCoordinateSystem.js';
import luklaGrid from '../config/luklaTerrainGrid.json' with { type: 'json' };
import { INCHEON_PATCH } from '../geospatial/incheon.js';
import { JEJU_ORIGIN, CHUJA_EMERGENCY_STRIP } from '../geospatial/CorridorCoordinateSystem.js';
import { setMapAttributionSource } from '../ui/mapAttribution.js';

const zoom = 11;
const tilesAcross = 2 ** zoom;
const samples = 256;
const segments = 128;
const stride = segments + 1;
const sampleStep = samples / segments;
const isolatedHeightDelta = 180;
const elevationUrl = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const waterArchive = new PMTiles(
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-11-18.0/base.pmtiles',
);

const keyOf = (x, y) => `${x}/${y}`;
const wrapX = x => (x + tilesAcross) % tilesAcross;
const contains = ([west, north, east, south], x, z) => x >= west && x <= east && z >= north && z <= south;

function projectedBounds(x, y, project, level = zoom) {
  const corners = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].map(([tx, ty]) => {
    const { latitude, longitude } = tileToWgs84(tx, ty, level);
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

function repairElevationSpikes(heights) {
  const repaired = heights.slice();
  const neighbors = [];
  // Compare the same samples the mesh uses. Read from the original raster so
  // a repair cannot propagate through nearby samples or depend on tile order.
  // Leave raster edges intact because their neighborhoods cross tile boundaries.
  for (let row = sampleStep; row < samples - sampleStep; row += sampleStep) {
    for (let col = sampleStep; col < samples - sampleStep; col += sampleStep) {
      const index = row * samples + col;
      const height = heights[index];
      let lower = 0, higher = 0;
      neighbors.length = 0;
      for (let dy = -sampleStep; dy <= sampleStep; dy += sampleStep) {
        for (let dx = -sampleStep; dx <= sampleStep; dx += sampleStep) {
          if (dx === 0 && dy === 0) continue;
          const neighbor = heights[index + dy * samples + dx];
          neighbors.push(neighbor);
          if (height - neighbor > isolatedHeightDelta) lower++;
          if (neighbor - height > isolatedHeightDelta) higher++;
        }
      }
      const consensus = Math.ceil(neighbors.length * 0.75);
      if (lower < consensus && higher < consensus) continue;
      neighbors.sort((a, b) => a - b);
      const middle = Math.floor(neighbors.length / 2);
      repaired[index] = (neighbors[middle - 1] + neighbors[middle]) / 2;
    }
  }
  return repaired;
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

const viewportSize = new THREE.Vector2();
const viewProjection = new THREE.Matrix4();
const imageryFrustum = new THREE.Frustum();
const detailTileLimit = 5;
const detailHoldMs = 1000;
const detailFadeMs = 350;
const tileSphere = new THREE.Sphere();
const viewCenter = new THREE.Vector3();

function projectedTilePixels(mesh, camera, viewportHeight) {
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  mesh.updateWorldMatrix(true, false);
  tileSphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
  if (!imageryFrustum.intersectsSphere(tileSphere)) return 0;
  viewCenter.copy(tileSphere.center).applyMatrix4(camera.matrixWorldInverse);
  const depth = Math.max(camera.near, -viewCenter.z);
  return Math.min(viewportHeight * 2, tileSphere.radius * camera.projectionMatrix.elements[5] * viewportHeight / depth);
}

function terrainMaterial(detail) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.terrainDetailMap = detail.map;
    shader.uniforms.terrainDetailBlend = detail.blend;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      #ifdef USE_MAP
        if (terrainDetailBlend > 0.0) {
          diffuseColor = mix(diffuseColor, texture2D(terrainDetailMap, vMapUv), terrainDetailBlend);
        }
      #endif
    `);
    shader.fragmentShader = 'uniform sampler2D terrainDetailMap;\nuniform float terrainDetailBlend;\n' + shader.fragmentShader;
  };
  return material;
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

function projectLocalImagery(sources, coordinate) {
  return sources.map(source => {
    const { position, normal } = source.attributes;
    const vertices = Array.from({ length: position.count }, (_, i) => {
      const px = position.getX(i), pz = position.getZ(i);
      const tile = coordinate(px, pz);
      return [px, position.getY(i), pz, tile.x + tile.fx, tile.y + tile.fy,
        normal.getX(i), normal.getY(i), normal.getZ(i)];
    });
    return { vertices, triangles: source.index.array };
  });
}

// Keep the local DEM and terrace triangles, with the same Mercator UVs as
// the surrounding tile. Both meshes share that tile's imagery and LOD.
export function buildLocalImageryGeometry(sources, x, y) {
  const positions = [], normals = [], uvs = [], indices = [];
  const bounds = [[3, x, 1], [3, x + 1, -1], [4, y, 1], [4, y + 1, -1]];
  for (const { vertices, triangles } of sources) {
    for (let i = 0; i < triangles.length; i += 3) {
      let polygon = [vertices[triangles[i]], vertices[triangles[i + 1]], vertices[triangles[i + 2]]];
      for (const [axis, limit, side] of bounds) {
        if (!polygon.length) break;
        if (polygon.some(vertex => (vertex[axis] - limit) * side < 0)) {
          polygon = clipSide(polygon, axis, limit, side);
        }
      }
      if (polygon.length < 3) continue;
      const first = positions.length / 3;
      for (const [px, py, pz, u, v, nx, ny, nz] of polygon) {
        positions.push(px, py, pz);
        uvs.push(u - x, y + 1 - v);
        normals.push(nx, ny, nz);
      }
      for (let j = 1; j < polygon.length - 1; j++) indices.push(first, first + j, first + j + 1);
    }
  }
  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

export function buildOpenTerrainTile({ x, y, raster, east, south, southeast, water, project, protectedAreas = [], blendHeight }) {
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
      const height = source[(row * sampleStep) % samples * samples + (col * sampleStep) % samples];
      const { latitude, longitude } = tileToWgs84(x + u, y + v, zoom);
      const [localX, localZ] = project(latitude, longitude);
      const wet = height <= 0 || (water?.[(Math.min(row * sampleStep, samples - 1) * samples + Math.min(col * sampleStep, samples - 1)) * 4 + 3] ?? 0) >= 128;
      appendVertex([localX, blendHeight?.(localX, localZ, height) ?? height, localZ, u, v, Number(wet)]);
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

// Keep every boundary sample so reduced tiles join full-resolution neighbors.
export function buildReducedTerrainGeometry(full) {
  if (full.attributes.position.count !== stride * stride || full.index.count !== segments * segments * 6) return null;
  const step = 4;
  const indices = [];
  for (let row = 0; row < segments; row += step) {
    for (let col = 0; col < segments; col += step) {
      const nw = row * stride + col;
      const sw = nw + step * stride;
      const se = sw + step;
      const ne = nw + step;
      if (row > 0 && col > 0 && row + step < segments && col + step < segments) {
        indices.push(nw, sw, ne, se, ne, sw);
        continue;
      }
      const ring = [nw];
      if (col === 0) for (let i = 1; i < step; i++) ring.push(nw + i * stride);
      ring.push(sw);
      if (row + step === segments) for (let i = 1; i < step; i++) ring.push(sw + i);
      ring.push(se);
      if (col + step === segments) for (let i = 1; i < step; i++) ring.push(se - i * stride);
      ring.push(ne);
      if (row === 0) for (let i = 1; i < step; i++) ring.push(ne - i);
      const center = nw + (step / 2) * (stride + 1);
      for (let i = 0; i < ring.length; i++) indices.push(center, ring[i], ring[(i + 1) % ring.length]);
    }
  }
  const reduced = new THREE.BufferGeometry();
  reduced.setIndex(indices);
  for (const [name, attribute] of Object.entries(full.attributes)) reduced.setAttribute(name, attribute);
  return reduced;
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
  constructor({ origin, protectedAreas = [], elevationCache, imageryCache, waterSource = waterArchive, localSurface }) {
    this.origin = origin;
    this.protectedAreas = protectedAreas;
    this.localSurface = localSurface;
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
    this.pendingImagery = null;
    this.pendingWater = null;
    this.project = (latitude, longitude) => wgs84ToLocal(latitude, longitude, origin);
    if (localSurface) {
      this.localImagery = projectLocalImagery([localSurface.geometry, localSurface.localTerraceGeometry],
        (x, z) => this.coordinate(x, z));
    }
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
    const positions = (tile.fullGeometry ?? tile.mesh.geometry).attributes.position;
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

  readyForTile(tile, level) {
    const [west, north, east, south] = projectedBounds(tile.x, tile.y, this.project, level);
    if (this.protectedAreas.some(area => contains(area, west, north) && contains(area, east, south))) return true;
    const children = 2 ** (level - zoom);
    const x = Math.floor(tile.x / children);
    const y = Math.floor(tile.y / children);
    return this.tiles.has(keyOf(wrapX(x), y));
  }

  update(position, velocity, camera, viewportHeight, reducedGeometry = false) {
    const center = this.coordinate(position.x, position.z);
    const detailedKey = reducedGeometry ? keyOf(wrapX(center.x), center.y) : null;
    if (this.reducedGeometry !== reducedGeometry || this.detailedKey !== detailedKey) {
      this.reducedGeometry = reducedGeometry;
      this.detailedKey = detailedKey;
      for (const [key, entry] of this.tiles) this.updateRenderGeometry(entry, key);
    }
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
          if (!this.localSurface && this.protectedAreas.some(area => contains(area, west, north) && contains(area, east, south))) continue;
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
    this.updateImageryDetail(camera, viewportHeight);
    this.updateTileResources();
    if (this.pending.size >= 3) return;
    const now = performance.now();
    const next = this.wanted.find(({ key }) =>
      !this.tiles.has(key) && !this.pending.has(key) && now >= (this.retry.get(key) ?? 0));
    if (next) void this.load(next);
  }

  updateTileResources() {
    const now = performance.now();
    if (!this.pendingImagery) {
      const tile = [...this.wanted].sort((a, b) => (this.tiles.get(b.key)?.imageryPriority ?? 0)
        - (this.tiles.get(a.key)?.imageryPriority ?? 0)).find(({ key }) => {
        const entry = this.tiles.get(key);
        return (entry?.mesh.geometry.index?.count || entry?.localMesh) && !entry.baseMap && now >= (entry.imageryRetryAt ?? 0);
      });
      if (tile) {
        this.pendingImagery = this.loadBaseImagery(tile, this.tiles.get(tile.key))
          .finally(() => { this.pendingImagery = null; });
      }
    }
    if (!this.pendingWater) {
      const tile = this.wanted.find(({ key }) => {
        const entry = this.tiles.get(key);
        return entry && entry.water === undefined && now >= entry.waterRetryAt;
      });
      if (tile) {
        this.pendingWater = this.retryWater(tile, this.tiles.get(tile.key))
          .finally(() => { this.pendingWater = null; });
      }
    }
  }

  async loadBaseImagery({ x, y, key }, entry) {
    const image = await this.imageryCache.getTileImage(zoom, x, y);
    if (this.tiles.get(key) !== entry) return;
    if (!image) {
      entry.imageryRetryAt = performance.now() + 8000;
      return;
    }
    entry.baseMap = imageryTexture(image);
    this.applyImagery(entry, entry.baseMap);
  }

  async fetchWater({ x, y }, signal) {
    try {
      const result = await this.waterSource.getZxy(zoom, x, y, AbortSignal.any([signal, AbortSignal.timeout(4500)]));
      // null is a successful lookup without a tile, undefined means retryable failure.
      return result ? readWaterMask(result.data) : null;
    } catch {
      return undefined;
    }
  }

  async retryWater(tile, entry) {
    const controller = new AbortController();
    entry.waterRequest = controller;
    const water = await this.fetchWater(tile, controller.signal);
    if (this.tiles.get(tile.key) !== entry) return;
    entry.waterRequest = null;
    entry.water = water;
    entry.waterRetryAt = performance.now() + 8000;
  }

  updateImageryDetail(camera, viewportHeight, now = performance.now()) {
    if (!camera?.isPerspectiveCamera || !viewportHeight) return;
    if (now >= (this.nextImagerySelection ?? 0)) {
      this.nextImagerySelection = now + 200;
      camera.updateWorldMatrix(true, false);
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      imageryFrustum.setFromProjectionMatrix(viewProjection);
      const visible = [];
      const wanted = new Map();
      for (const [key, entry] of this.tiles) {
        const pixels = entry.localMesh || entry.mesh.geometry.index?.count
          ? projectedTilePixels(entry.mesh, camera, viewportHeight) : 0;
        entry.imageryPriority = pixels;
        const previous = this.detailWanted.get(key);
        if (previous) {
          if (pixels >= samples * 0.65) entry.detailLastVisibleAt = now;
          if (now - entry.detailLastVisibleAt < detailHoldMs) wanted.set(key, previous);
        }
        if (pixels >= samples * 0.85) visible.push({ key, entry, pixels });
      }
      visible.sort((a, b) => b.pixels - a.pixels);
      // Ranking controls new requests. A resident tile keeps its detail while
      // it is still useful, even if another tile grows larger on screen.
      let hasHighDetail = [...wanted.values()].includes(13);
      for (const { key, entry, pixels } of visible) {
        const previous = wanted.get(key);
        if (!previous && wanted.size >= detailTileLimit) continue;
        const level = !hasHighDetail && pixels >= 2 * samples ? 13 : 12;
        if (previous >= level) continue;
        wanted.set(key, level);
        entry.detailLastVisibleAt = now;
        hasHighDetail ||= level === 13;
      }
      this.detailWanted = wanted;
    }

    for (const [key, entry] of this.tiles) {
      if (!entry.detailMap) continue;
      const wanted = this.detailWanted.get(key) >= entry.detailLevel;
      const elapsed = Math.max(0, now - entry.detailUpdatedAt);
      const blend = entry.detail.blend;
      const fadingIn = wanted || entry.previousDetailMap;
      blend.value = THREE.MathUtils.clamp(blend.value + (fadingIn ? 1 : -1) * elapsed / detailFadeMs, 0, 1);
      if (entry.previousDetailMap && blend.value === 1) {
        this.applyImagery(entry, entry.baseMap);
        entry.previousDetailMap.dispose();
        entry.previousDetailMap = null;
      }
      entry.detailUpdatedAt = now;
      if (!wanted && blend.value === 0) {
        entry.detailMap.dispose();
        entry.detailMap = null;
        entry.detail.map.value = entry.baseMap;
        entry.detailLevel = zoom;
      }
    }

    if (this.pendingDetail) return;
    for (const [key, level] of this.detailWanted) {
      const entry = this.tiles.get(key);
      if (!entry?.baseMap || entry.detailLevel >= level || now < (entry.detailRetryAt ?? 0)) continue;
      if (entry.detailMap && entry.detail.blend.value < 1) continue;
      this.pendingDetail = this.loadImageryDetail(key, entry, level).finally(() => { this.pendingDetail = null; });
      break;
    }
  }

  applyImagery(entry, map) {
    const material = entry.mesh.material;
    material.map = map;
    material.vertexColors = !map;
    material.needsUpdate = true;
    if (entry.localMesh) entry.localMesh.visible = Boolean(map);
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
    if (entry.detailMap) {
      entry.previousDetailMap = entry.detailMap;
      this.applyImagery(entry, entry.previousDetailMap);
    }
    entry.detailMap = imageryTexture(canvas);
    entry.detailLevel = level;
    entry.detail.map.value = entry.detailMap;
    entry.detail.blend.value = 0;
    entry.detailUpdatedAt = performance.now();
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
      return repairElevationSpikes(decodeTerrarium(context.getImageData(0, 0, samples, samples).data));
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
      const waterData = this.fetchWater(tile, controller.signal);
      const [raster, east, south, southeast, water] = await Promise.all([
        this.raster(x, y), this.raster(wrapX(x + 1), y), this.raster(x, y + 1), this.raster(wrapX(x + 1), y + 1), waterData,
      ]);
      if (controller.signal.aborted) return;
      const local = this.localSurface;
      const half = local?.size / 2;
      const blendDistance = 1200;
      const blendHeight = local ? (px, pz, height) => {
        const distance = Math.max(Math.abs(px), Math.abs(pz)) - half;
        if (distance >= blendDistance) return height;
        return THREE.MathUtils.lerp(local.getNaturalHeight(px, pz), height,
          THREE.MathUtils.smoothstep(distance, 0, blendDistance));
      } : undefined;
      const { geometry } = buildOpenTerrainTile({
        blendHeight,
        x, y, raster, east, south, southeast, water, project: this.project, protectedAreas: this.protectedAreas,
      });
      const detail = { map: { value: null }, blend: { value: 0 } };
      const material = terrainMaterial(detail);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      const entry = { mesh, fullGeometry: geometry, detail, water, waterRetryAt: performance.now() + 8000, baseMap: null, detailLevel: zoom };
      if (local) {
        const [west, north, eastEdge, southEdge] = projectedBounds(x, y, this.project);
        if (west < half && eastEdge > -half && north < half && southEdge > -half) {
          const localGeometry = buildLocalImageryGeometry(this.localImagery, x, y);
          if (localGeometry) {
            entry.localMesh = new THREE.Mesh(localGeometry, material);
            entry.localMesh.receiveShadow = true;
            entry.localMesh.visible = false;
            mesh.add(entry.localMesh);
          }
        }
      }
      this.updateRenderGeometry(entry, key);
      this.tiles.set(key, entry);
      this.group.add(mesh);
      this.retry.delete(key);
    } catch {
      if (!controller.signal.aborted) this.retry.set(key, performance.now() + 4000);
    } finally {
      this.pending.delete(key);
    }
  }

  updateRenderGeometry(entry, key) {
    const useReduced = this.reducedGeometry && key !== this.detailedKey;
    if (useReduced && entry.reducedGeometry === undefined) {
      entry.reducedGeometry = buildReducedTerrainGeometry(entry.fullGeometry);
    }
    entry.mesh.geometry = (useReduced && entry.reducedGeometry) || entry.fullGeometry;
  }

  release(key, { mesh, localMesh, fullGeometry, reducedGeometry, baseMap, detailMap, previousDetailMap, waterRequest }) {
    waterRequest?.abort();
    this.tiles.delete(key);
    mesh.removeFromParent();
    (fullGeometry ?? mesh.geometry).dispose();
    reducedGeometry?.dispose();
    localMesh?.geometry.dispose();
    baseMap?.dispose();
    detailMap?.dispose();
    previousDetailMap?.dispose();
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
  lukla: { origin: luklaGrid.origin },
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
  if (frame && surface?.mesh && (sim.activeAirport !== 'lukla' || surface.isLoaded)) {
    if (!surface.openWorld) {
      const half = surface.size / 2;
      surface.openWorld = new OpenWorldTerrain(sim.activeAirport === 'lukla'
        ? { ...frame, protectedAreas: [[-half, -half, half, half]], localSurface: surface }
        : frame);
      surface.mesh.add(surface.openWorld.group);
      if (surface.corridorStreamer) surface.corridorStreamer.group.visible = false;
    }
    const height = sim.renderer?.getDrawingBufferSize?.(viewportSize)?.y;
    surface.openWorld.update(sim.position, sim.linearVelocity, sim.camera, height,
      sim.renderQuality === 'ultraLow');
  }
  setMapAttributionSource('open-world-attribution', Boolean(surface?.openWorld?.tiles.size));
}
