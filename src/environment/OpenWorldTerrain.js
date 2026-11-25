import * as THREE from 'three';
import { overtureBase as waterArchive, isWaterPolygon } from '../geospatial/overtureWater.js';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { applyFarSunShadow } from './FarSunShadow.js';
import { TileCacheManager } from './TileCacheManager.js';
import { localToWgs84, tileToWgs84, wgs84ToLocal, wgs84ToTile } from '../geospatial/TileCoordinateSystem.js';
import luklaGrid from '../config/luklaTerrainGrid.json' with { type: 'json' };
import { INCHEON_PATCH } from '../geospatial/incheon.js';
import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { getInsetsForRegion } from '../config/terrainInsets.js';
import { parisShowcaseInsets } from '../config/parisShowcase.js';
import { setMapAttributionSource } from '../ui/mapAttribution.js';
import { EARTH_RADIUS_M } from './AerialPerspective.js';
import { RENDER_QUALITY, resolveRenderQuality } from '../config/renderQuality.js';
import { authorityZonesFromBounds, createAuthorityZones, zoneDistance } from '@stlim0727/flightsim-core/terrain/AuthorityZones.js';

const zoom = 11;
const farZoom = 8;
const farSegments = 32;
const nearClipM = 45000;
const highAltitudeClipM = 100000;
const tilesAcross = 2 ** zoom;
const samples = 256;
const segments = 128;
const stride = segments + 1;
const sampleStep = samples / segments;
const isolatedHeightDelta = 180;
const elevationUrl = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

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
    if (!isWaterPolygon(feature)) continue;
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
const detailTileLimit = 6;
const highDetailTileLimit = 3;
const ultraDetailTileLimit = 1;
const defaultAnisotropy = 8;
const detailHoldMs = 1000;
const detailFadeMs = 350;
const detailEdgeWidth = 0.035;
const imageryNeighbors = [[-1, 0], [0, -1], [1, 0], [0, 1]];
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

function terrainMaterial(detail, distanceFade) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.terrainBaseMap = detail.base;
    shader.uniforms.terrainDetailEdges = detail.edges;
    shader.uniforms.terrainDetailCorners = detail.corners;
    shader.uniforms.terrainDetailMap = detail.map;
    shader.uniforms.terrainDetailBlend = detail.blend;
    shader.uniforms.terrainDistanceFade = distanceFade;
    shader.vertexShader = 'varying vec3 vTerrainViewPosition;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n vTerrainViewPosition = mvPosition.xyz;',
    );
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
      #include <clipping_planes_fragment>
      if (terrainDistanceFade > 0.0) {
        // Dither coverage so the ocean/sky shows through while terrain retains opaque depth writes.
        float distanceM = length(vTerrainViewPosition);
        if (distanceM > 26000.0) {
          float fade = terrainDistanceFade * smoothstep(26000.0, 32000.0, distanceM);
          float threshold = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (fade > threshold) discard;
        }
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      #ifdef USE_MAP
        if (terrainDetailBlend > 0.0) {
          diffuseColor = mix(diffuseColor, texture2D(terrainDetailMap, vMapUv), terrainDetailBlend);
        }
        vec4 edgeDistances = vec4(vMapUv.x, 1.0 - vMapUv.y, 1.0 - vMapUv.x, vMapUv.y);
        vec4 proximity = 1.0 - smoothstep(0.0, ${detailEdgeWidth}, edgeDistances);
        float centerX = 1.0 - proximity.x - proximity.z;
        float centerY = 1.0 - proximity.y - proximity.w;
        vec4 edgeWeights = proximity * vec4(centerY, centerX, centerY, centerX);
        vec4 cornerWeights = proximity * proximity.yzwx;
        float edgeBlend = dot(terrainDetailEdges, edgeWeights) + dot(terrainDetailCorners, cornerWeights);
        vec2 uvDx = dFdx(vMapUv);
        vec2 uvDy = dFdy(vMapUv);
        if (edgeBlend > 0.0) {
          diffuseColor = mix(diffuseColor, textureGrad(terrainBaseMap, vMapUv, uvDx, uvDy), edgeBlend);
        }
        // Restore natural micro-contrast and chroma of baked satellite imagery.
        float satLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(vec3(satLuma), diffuseColor.rgb, 1.14);
        diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.08));
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
      #include <lights_fragment_end>
      #ifdef USE_MAP
        // Satellite tiles already carry baked overhead illumination. Trim excess
        // ambient washout and direct over-exposure while keeping sunset/night/cloud shading.
        reflectedLight.indirectDiffuse *= 0.68;
        reflectedLight.directDiffuse *= 0.88;
      #endif
    `);
    shader.fragmentShader = `
      uniform sampler2D terrainBaseMap;
      uniform vec4 terrainDetailEdges;
      uniform vec4 terrainDetailCorners;
      uniform sampler2D terrainDetailMap;
      uniform float terrainDetailBlend;
      uniform float terrainDistanceFade;
      varying vec3 vTerrainViewPosition;
    ` + shader.fragmentShader;
  };
  return material;
}

function imageryTexture(image, anisotropy = defaultAnisotropy) {
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function parentImageryTexture(image, x, y, anisotropy) {
  const sourceWidth = image?.naturalWidth ?? image?.width;
  const sourceHeight = image?.naturalHeight ?? image?.height;
  if (typeof document !== 'undefined' && Number.isFinite(sourceWidth) && Number.isFinite(sourceHeight)
    && sourceWidth >= 2 && sourceHeight >= 2) {
    // Crop in pixel space so the base texture keeps identity UVs; the detail
    // atlas shares vMapUv and must not inherit the parent quadrant transform.
    const size = Math.min(sourceWidth, sourceHeight) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d').drawImage(image, (x % 2) * size, (y % 2) * size, size, size, 0, 0, size, size);
    return imageryTexture(canvas, anisotropy);
  }
  // Node/texture-only fallback where canvas drawing is unavailable.
  const texture = imageryTexture(image, anisotropy);
  texture.repeat.set(0.5, 0.5);
  texture.offset.set((x % 2) * 0.5, (y % 2 === 0) ? 0.5 : 0);
  return texture;
}

function installFarTerrainShader(material, opacity) {
  material.onBeforeCompile = shader => {
    shader.uniforms.farTerrainOpacity = opacity;
    shader.vertexShader = `
      varying float vFarTerrainHeight;
      varying vec3 vFarTerrainViewPosition;
    ` + shader.vertexShader
      .replace('#include <project_vertex>', `
        vFarTerrainHeight = transformed.y;
        vec2 offset = (modelMatrix * vec4(transformed, 1.0)).xz - cameraPosition.xz;
        transformed.y -= dot(offset, offset) / ${(2 * EARTH_RADIUS_M).toFixed(1)};
        #include <project_vertex>
        vFarTerrainViewPosition = mvPosition.xyz;
      `);
    shader.fragmentShader = `
      uniform float farTerrainOpacity;
      varying float vFarTerrainHeight;
      varying vec3 vFarTerrainViewPosition;
    ` + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        float distanceM = length(vFarTerrainViewPosition);
        float coverage = farTerrainOpacity * smoothstep(0.0, 15.0, vFarTerrainHeight)
          * smoothstep(22000.0, 26000.0, distanceM)
          * (1.0 - smoothstep(72000.0, 90000.0, distanceM));
        if (coverage <= 0.0) discard;
      `)
      .replace('#include <logdepthbuf_fragment>', `
        #include <logdepthbuf_fragment>
        #if defined(USE_LOGDEPTHBUF)
        // Reserve a depth range behind foreground scenery while retaining the order
        // of the backdrop's own surfaces. Both passes must compute identical depth.
        gl_FragDepth = 0.995 + 0.004 * clamp(-vFarTerrainViewPosition.z / ${highAltitudeClipM.toFixed(1)}, 0.0, 1.0);
        #endif
      `)
      .replace('#include <opaque_fragment>', `
        diffuseColor.a *= coverage;
        #include <opaque_fragment>
      `);
  };
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

// A runway strip is a rotated rectangle, so the axis-aligned subtractRectangle
// path cannot carve it out of a terrain triangle. Keep the half-plane outside
// each edge; the centroid decides which side is the strip interior.
function clipLine(polygon, nx, nz, limit) {
  const clipped = [];
  let a = polygon.at(-1);
  for (const b of polygon) {
    const da = nx * a[0] + nz * a[2] - limit;
    const db = nx * b[0] + nz * b[2] - limit;
    if ((da >= 0) !== (db >= 0)) {
      const weight = da / (da - db);
      clipped.push(a.map((value, index) => THREE.MathUtils.lerp(value, b[index], weight)));
    }
    if (db >= 0) clipped.push(b);
    a = b;
  }
  return clipped;
}

function subtractConvexPolygon(polygon, cut) {
  const cx = cut.reduce((sum, point) => sum + point[0], 0) / cut.length;
  const cz = cut.reduce((sum, point) => sum + point[1], 0) / cut.length;
  const outside = [];
  let inside = polygon;
  for (let i = 0; i < cut.length && inside.length; i++) {
    const a = cut[i];
    const b = cut[(i + 1) % cut.length];
    let nx = b[1] - a[1];
    let nz = -(b[0] - a[0]);
    const offset = nx * a[0] + nz * a[1];
    if (nx * cx + nz * cz > offset) {
      nx = -nx;
      nz = -nz;
    }
    const limit = nx * a[0] + nz * a[1];
    const piece = clipLine(inside, nx, nz, limit);
    if (piece.length >= 3) outside.push(piece);
    inside = clipLine(inside, -nx, -nz, -limit);
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

// Split clipped edges at every local mesh vertex so both sides interpolate
// the same piecewise-linear height, including between Mercator grid vertices.
function stitchLocalEdge(piece, local) {
  const { size, segments, geometry } = local;
  const half = size / 2;
  const step = size / segments;
  const width = segments + 1;
  const positions = geometry.attributes.position;
  const stitched = [];
  let joined = false;
  for (let i = 0; i < piece.length; i++) {
    const a = [...piece[i]];
    const b = piece[(i + 1) % piece.length];
    stitched.push(a);
    for (const axis of [0, 2]) {
      if (Math.abs(Math.abs(a[axis]) - half) > 1e-6) continue;
      const along = 2 - axis;
      const edge = a[axis] < 0 ? 0 : segments;
      const height = n => positions.getY(axis === 0 ? n * width + edge : edge * width + n);
      const index = value => THREE.MathUtils.clamp((value + half) / step, 0, segments);
      if (Math.abs(a[along]) <= half + 1e-6) {
        const t = index(a[along]);
        const n = Math.min(Math.floor(t), segments - 1);
        a[1] = THREE.MathUtils.lerp(height(n), height(n + 1), t - n);
        joined = true;
      }
      if (Math.abs(a[axis] - b[axis]) > 1e-6 || a[along] === b[along]) continue;
      const direction = Math.sign(b[along] - a[along]);
      const start = (a[along] + half) / step;
      const first = direction > 0
        ? Math.max(0, Math.floor(start) + 1)
        : Math.min(segments, Math.ceil(start) - 1);
      for (let n = first; n >= 0 && n <= segments; n += direction) {
        const value = -half + n * step;
        const fraction = (value - a[along]) / (b[along] - a[along]);
        if (fraction <= 1e-8 || fraction >= 1 - 1e-8) break;
        const vertex = a.map((item, j) => THREE.MathUtils.lerp(item, b[j], fraction));
        vertex[1] = height(n);
        stitched.push(vertex);
        joined = true;
      }
    }
  }
  return joined ? stitched : null;
}

export function buildOpenTerrainTile({ x, y, raster, east, south, southeast, water, project,
  protectedAreas = [], blendHeight, localSurface, runwayCutouts = [], level = zoom, subdivisions = segments }) {
  const bounds = projectedBounds(x, y, project, level);
  const segments = subdivisions;
  const stride = segments + 1;
  const sampleStep = samples / segments;
  const overlaps = protectedAreas.filter(([west, north, east, south]) =>
    west < bounds[2] && east > bounds[0] && north < bounds[3] && south > bounds[1]);
  const vertices = [];
  const indices = [];
  const cellOffsets = (localSurface && overlaps.length) || runwayCutouts.length
    ? new Uint32Array(segments ** 2 + 1) : null;
  const mapCoordinates = [];
  const colors = [];
  const groundColor = new THREE.Color();
  const rawHeights = [];
  const appendVertex = ([localX, height, localZ, u, v, wet, sourceHeight], rawHeight = sourceHeight ?? height) => {
    const index = vertices.length / 3;
    vertices.push(localX, height, localZ);
    rawHeights.push(rawHeight);
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
      const { latitude, longitude } = tileToWgs84(x + u, y + v, level);
      const [localX, localZ] = project(latitude, longitude);
      const wet = height <= 0 || (water?.[(Math.min(row * sampleStep, samples - 1) * samples + Math.min(col * sampleStep, samples - 1)) * 4 + 3] ?? 0) >= 128;
      appendVertex([localX, blendHeight?.(localX, localZ, height) ?? height, localZ, u, v, Number(wet)], height);
    }
  }
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      if (cellOffsets) cellOffsets[row * segments + col] = indices.length;
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
            mapCoordinates[index * 2], 1 - mapCoordinates[index * 2 + 1], Number(vertices[index * 3 + 1] <= 0), rawHeights[index]])];
          pieces = pieces.flatMap(piece => subtractRectangle(piece, area));
        }
        if (!pieces && runwayCutouts.length) {
          const xs = triangle.map(index => vertices[index * 3]);
          const zs = triangle.map(index => vertices[index * 3 + 2]);
          const touchesRunway = runwayCutouts.some(cut =>
            Math.max(...xs) >= cut.minX && Math.min(...xs) <= cut.maxX
            && Math.max(...zs) >= cut.minZ && Math.min(...zs) <= cut.maxZ);
          if (touchesRunway) {
            pieces = [triangle.map(index => [...vertices.slice(index * 3, index * 3 + 3),
              mapCoordinates[index * 2], 1 - mapCoordinates[index * 2 + 1], Number(vertices[index * 3 + 1] <= 0), rawHeights[index]])];
          }
        }
        if (pieces) for (const cut of runwayCutouts) {
          const xs = pieces.flatMap(piece => piece.map(vertex => vertex[0]));
          const zs = pieces.flatMap(piece => piece.map(vertex => vertex[2]));
          if (!xs.length || Math.max(...xs) < cut.minX || Math.min(...xs) > cut.maxX
            || Math.max(...zs) < cut.minZ || Math.min(...zs) > cut.maxZ) continue;
          pieces = pieces.flatMap(piece => subtractConvexPolygon(piece, cut.poly));
        }
        if (!pieces) indices.push(...triangle);
        else for (const piece of pieces) {
          const stitched = cellOffsets && localSurface && stitchLocalEdge(piece, localSurface);
          if (stitched) {
            // A center fan preserves the new edge segments when they are collinear.
            const center = appendVertex(piece[0].map((_, j) =>
              piece.reduce((sum, vertex) => sum + vertex[j], 0) / piece.length));
            const polygon = stitched.map(vertex => appendVertex(vertex));
            for (let i = 0; i < polygon.length; i++) {
              indices.push(center, polygon[i], polygon[(i + 1) % polygon.length]);
            }
          } else {
            const polygon = piece.map(vertex => appendVertex(vertex));
            for (let i = 1; i < polygon.length - 1; i++) indices.push(polygon[0], polygon[i], polygon[i + 1]);
          }
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('rawHeight', new THREE.Float32BufferAttribute(rawHeights, 1));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mapCoordinates, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  if (cellOffsets) cellOffsets[cellOffsets.length - 1] = indices.length;
  return { geometry, water, cellOffsets };
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

function heightOnTriangle(positions, x, z, a, b, c, heights) {
  const ax = positions.getX(a), az = positions.getZ(a);
  const bx = positions.getX(b) - ax, bz = positions.getZ(b) - az;
  const cx = positions.getX(c) - ax, cz = positions.getZ(c) - az;
  const determinant = bx * cz - bz * cx;
  const u = ((x - ax) * cz - (z - az) * cx) / determinant;
  const v = (bx * (z - az) - bz * (x - ax)) / determinant;
  if (!(u >= -0.0001 && v >= -0.0001 && u + v <= 1.0001)) return undefined;
  const yA = heights ? heights.getX(a) : positions.getY(a);
  const yB = heights ? heights.getX(b) : positions.getY(b);
  const yC = heights ? heights.getX(c) : positions.getY(c);
  return yA * (1 - u - v) + yB * u + yC * v;
}

export class OpenWorldTerrain {
  constructor({ origin, protectedAreas = [], insets = [], elevationCache, imageryCache, waterSource = waterArchive, localSurface, imageryBudget, world }) {
    this.origin = origin;
    this.protectedAreas = protectedAreas;
    this._authority = createAuthorityZones(authorityZonesFromBounds(protectedAreas || []));
    this.insets = insets;
    this.localSurface = localSurface;
    this.world = world;
    this._runwayVisibilityKey = '';
    this.elevationCache = elevationCache ?? new TileCacheManager({ urlTemplate: elevationUrl });
    this.imageryCache = imageryCache ?? new TileCacheManager({ enableBrowserCache: false, maxMemoryTiles: 128, maxConcurrent: 6 });
    this.waterSource = waterSource;
    this.imageryBudget = {
      detailTileLimit: imageryBudget?.detailTileLimit ?? detailTileLimit,
      highDetailTileLimit: imageryBudget?.highDetailTileLimit ?? highDetailTileLimit,
      ultraDetailTileLimit: imageryBudget?.ultraDetailTileLimit ?? ultraDetailTileLimit,
      anisotropy: imageryBudget?.anisotropy ?? defaultAnisotropy,
    };
    this.group = new THREE.Group();
    this.group.name = 'Streaming open-world terrain';
    this.tiles = new Map();
    this.rasters = new Map();
    this.pending = new Map();
    this.retry = new Map();
    this.wanted = [];
    this.distanceFade = { value: 0 };
    this.farGroup = new THREE.Group();
    this.farGroup.visible = false;
    this.group.add(this.farGroup);
    this.farTiles = new Map();
    this.farRetry = new Map();
    this.farOpacity = { value: 0 };
    this.detailWanted = new Map();
    this.pendingDetail = null;
    this.pendingImagery = null;
    this.pendingWater = null;
    this.project = (latitude, longitude) => wgs84ToLocal(latitude, longitude, origin);
    if (localSurface) {
      const sources = Array.isArray(localSurface.geometries)
        ? localSurface.geometries
        : [localSurface.geometry, localSurface.localTerraceGeometry].filter(Boolean);
      this.localImagery = projectLocalImagery(sources,
        (x, z) => this.coordinate(x, z));
    }
  }

  get tileZoom() { return zoom; }
  get farTileZoom() { return farZoom; }

  coordinate(x, z) {
    const { latitude, longitude } = localToWgs84(x, z, this.origin);
    return wgs84ToTile(latitude, longitude, zoom);
  }

  /** Runway strips in render-local metres, cut out of terrain before it can cover pavement. */
  runwayCutouts(bounds) {
    const world = this.world;
    if (!world?.regions?.size) return [];
    const cutouts = [];
    for (const [id, region] of world.regions) {
      const runways = region.terrain?.runways;
      if (!Array.isArray(runways) || !runways.length) continue;
      if (!this.runwayVisible(region)) continue;
      const offset = world.offsets.get(id);
      if (!offset) continue;
      const extent = region.extent;
      if (extent && (extent.minX + offset[0] > bounds[2] || extent.maxX + offset[0] < bounds[0]
        || extent.minZ + offset[1] > bounds[3] || extent.maxZ + offset[1] < bounds[1])) continue;
      for (const runway of runways) {
        const a = runway.ends?.[0]?.physical;
        const b = runway.ends?.[1]?.physical;
        const width = runway.widthM;
        if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.z)
          || !Number.isFinite(b.x) || !Number.isFinite(b.z)
          || !Number.isFinite(width) || width <= 0) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        if (!(length > 1e-6)) continue;
        // Inset leaves terrain beneath the pavement edge; the end overlap
        // keeps threshold samples strictly inside the cutout.
        const half = width / 2 - Math.min(0.25, width * 0.05);
        if (!(half > 0)) continue;
        const px = -dz / length * half;
        const pz = dx / length * half;
        const ux = dx / length, uz = dz / length;
        const start = [a.x - ux, a.z - uz];
        const finish = [b.x + ux, b.z + uz];
        const poly = [
          [start[0] + px, start[1] + pz], [start[0] - px, start[1] - pz],
          [finish[0] - px, finish[1] - pz], [finish[0] + px, finish[1] + pz],
        ].map(([px, pz]) => [px + offset[0], pz + offset[1]]);
        const xs = poly.map(point => point[0]);
        const zs = poly.map(point => point[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minZ = Math.min(...zs), maxZ = Math.max(...zs);
        if (maxX < bounds[0] || minX > bounds[2] || maxZ < bounds[1] || minZ > bounds[3]) continue;
        cutouts.push({ poly, minX, maxX, minZ, maxZ });
      }
    }
    return cutouts;
  }

  runwayVisible(region) {
    return region.mounted !== false && region.group?.visible !== false && region.mesh?.visible !== false;
  }

  runwayVisibilityKey() {
    const world = this.world;
    if (!world?.regions) return '';
    return [...world.regions]
      .filter(([, region]) => region.terrain?.runways?.length && this.runwayVisible(region))
      .map(([id]) => id)
      .sort()
      .join('|');
  }

  /** Reload tiles whose cutout set no longer matches visible runway meshes. */
  syncRunwayVisibility() {
    const key = this.runwayVisibilityKey();
    if (key === this._runwayVisibilityKey) return;
    this._runwayVisibilityKey = key;
    for (const [tileKey, entry] of this.tiles) {
      if (entry.runwayVisibilityKey === key) continue;
      const [x, y] = tileKey.split('/').map(Number);
      this.pending.get(tileKey)?.abort();
      void this.load({ x, y, key: tileKey });
    }
  }

  protects(x, z) {
    return this._authority.protects(x, z);
  }

  protectsTile(west, north, east, south) {
    return this._authority.zones.some(zone =>
      zoneDistance(west, north, zone) === 0 && zoneDistance(east, south, zone) === 0);
  }

  sample(x, z, { unblended = false } = {}) {
    if (this.protects(x, z)) return undefined;
    const { x: tx, y: ty, fx, fy } = this.coordinate(x, z);
    const tile = this.tiles.get(keyOf(wrapX(tx), ty));
    if (!tile) return undefined;
    const col = Math.min(segments - 1, Math.floor(fx * segments));
    const row = Math.min(segments - 1, Math.floor(fy * segments));
    const geometry = tile.fullGeometry ?? tile.mesh.geometry;
    const positions = geometry.attributes.position;
    const heights = unblended ? (geometry.attributes.rawHeight ?? null) : null;
    let height;
    for (let dz = -1; dz <= 1 && height === undefined; dz++) {
      for (let dx = -1; dx <= 1 && height === undefined; dx++) {
        if (row + dz < 0 || row + dz >= segments || col + dx < 0 || col + dx >= segments) continue;
        if (tile.cellOffsets) {
          const cell = (row + dz) * segments + col + dx;
          const indices = geometry.index.array;
          for (let i = tile.cellOffsets[cell]; i < tile.cellOffsets[cell + 1] && height === undefined; i += 3) {
            height = heightOnTriangle(positions, x, z, indices[i], indices[i + 1], indices[i + 2], heights);
          }
          continue;
        }
        const nw = (row + dz) * stride + col + dx;
        height = heightOnTriangle(positions, x, z, nw, nw + stride, nw + 1, heights)
          ?? heightOnTriangle(positions, x, z, nw + stride + 1, nw + 1, nw + stride, heights);
      }
    }
    if (height === undefined) return undefined;
    const pixel = (Math.floor(fy * samples) * samples + Math.floor(fx * samples)) * 4 + 3;
    const water = height <= 0 || (tile.water?.[pixel] ?? 0) >= 128;
    return { height: Math.max(0, height), water };
  }

  sampleRaw(x, z) {
    return this.sample(x, z, { unblended: true })?.height;
  }

  readyAt(x, z) {
    if (this.protects(x, z)) return true;
    const { x: tx, y: ty } = this.coordinate(x, z);
    return this.tiles.has(keyOf(wrapX(tx), ty));
  }

  invalidateArea([minX, minZ, maxX, maxZ]) {
    for (const [key, entry] of [...this.tiles.entries()]) {
      const [x, y] = key.split('/').map(Number);
      const bounds = projectedBounds(x, y, this.project);
      if (bounds[0] < maxX && bounds[2] > minX && bounds[1] < maxZ && bounds[3] > minZ) {
        this.pending.get(key)?.abort();
        void this.load({ x, y, key });
      }
    }
  }

  readyForTile(tile, level) {
    const [west, north, east, south] = projectedBounds(tile.x, tile.y, this.project, level);
    if (this.protectsTile(west, north, east, south)) return true;
    const children = 2 ** (level - zoom);
    const x = Math.floor(tile.x / children);
    const y = Math.floor(tile.y / children);
    return this.tiles.has(keyOf(wrapX(x), y));
  }

  setImageryQuality(renderQuality, maxAnisotropy = defaultAnisotropy) {
    const preset = RENDER_QUALITY[resolveRenderQuality(renderQuality)];
    const anisotropy = Math.max(1, Math.min(preset.terrainAnisotropy ?? defaultAnisotropy, maxAnisotropy || defaultAnisotropy));
    const next = {
      detailTileLimit: preset.terrainDetailTiles ?? detailTileLimit,
      highDetailTileLimit: preset.terrainHighDetailTiles ?? highDetailTileLimit,
      ultraDetailTileLimit: preset.terrainUltraDetailTiles ?? ultraDetailTileLimit,
      anisotropy,
    };
    const prev = this.imageryBudget;
    if (prev.detailTileLimit === next.detailTileLimit
      && prev.highDetailTileLimit === next.highDetailTileLimit
      && prev.ultraDetailTileLimit === next.ultraDetailTileLimit
      && prev.anisotropy === next.anisotropy) return;
    const anisotropyChanged = prev.anisotropy !== next.anisotropy;
    this.imageryBudget = next;
    this.nextImagerySelection = 0;
    if (anisotropyChanged) {
      for (const entry of this.tiles.values()) {
        for (const tex of [entry.baseMap, entry.detailMap, entry.previousDetailMap]) {
          if (tex) {
            tex.anisotropy = anisotropy;
            tex.needsUpdate = true;
          }
        }
      }
      for (const mesh of this.farTiles.values()) {
        if (mesh.material?.map) {
          mesh.material.map.anisotropy = anisotropy;
          mesh.material.map.needsUpdate = true;
        }
      }
    }
  }

  update(position, velocity, camera, viewportHeight, reducedGeometry = false) {
    this.syncRunwayVisibility();
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
          if (!this.localSurface && this.protectsTile(west, north, east, south)) continue;
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
    const now = performance.now();
    if (this.pending.size < 3) {
      const next = this.wanted.find(({ key }) =>
        !this.tiles.has(key) && !this.pending.has(key) && now >= (this.retry.get(key) ?? 0));
      if (next) void this.load(next);
    }
    this.updateFarTerrain(position, camera, now);
    this.distanceFade.value = reducedGeometry ? 1 : this.farTiles.size ? this.farOpacity.value : 0;
  }

  updateFarTerrain(position, camera, now) {
    const visibility = THREE.MathUtils.smoothstep(camera?.position.y ?? position.y, 7500, 11000);
    this.farOpacity.value = visibility;
    this.farGroup.visible = visibility > 0;
    if (!visibility) return;
    const { latitude, longitude } = localToWgs84(position.x, position.z, this.origin);
    const { x, y } = wgs84ToTile(latitude, longitude, farZoom);
    const center = keyOf(x, y);
    if (center !== this.farCenter) {
      this.farCenter = center;
      const limit = 2 ** farZoom;
      this.farWanted = new Map();
      // Center first, then the remaining eight tiles around it.
      for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0],
        [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const tx = (x + dx + limit) % limit, ty = y + dy;
        if (ty < 0 || ty >= limit - 1) continue;
        this.farWanted.set(keyOf(tx, ty), { x: tx, y: ty });
      }
      for (const key of this.farTiles.keys()) {
        if (!this.farWanted.has(key)) this.releaseFarTile(key);
      }
      for (const key of this.farRetry.keys()) {
        if (!this.farWanted.has(key)) this.farRetry.delete(key);
      }
    }
    if (this.farPending) return;
    for (const [key, { x, y }] of this.farWanted) {
      if (this.farTiles.has(key) || now < (this.farRetry.get(key) ?? 0)) continue;
      this.farPending = this.loadFarTile(key, x, y).finally(() => { this.farPending = null; });
      break;
    }
  }

  async loadFarTile(key, x, y) {
    try {
      const nextX = (x + 1) % (2 ** farZoom);
      const [raster, east, south, southeast, image] = await Promise.all([
        this.raster(x, y, farZoom), this.raster(nextX, y, farZoom),
        this.raster(x, y + 1, farZoom), this.raster(nextX, y + 1, farZoom),
        this.imageryCache.getTileImage(farZoom, x, y),
      ]);
      if (!this.farWanted.has(key)) return;
      if (!image) throw new Error('Far terrain imagery unavailable');
      const { geometry } = buildOpenTerrainTile({
        x, y, raster, east, south, southeast, project: this.project, level: farZoom, subdivisions: farSegments,
      });
      const depthMaterial = new THREE.MeshBasicMaterial({
        transparent: true, colorWrite: false, fog: false,
      });
      const material = new THREE.MeshLambertMaterial({
        map: imageryTexture(image, this.imageryBudget.anisotropy), transparent: true, depthWrite: false, depthFunc: THREE.EqualDepth,
      });
      installFarTerrainShader(depthMaterial, this.farOpacity);
      installFarTerrainShader(material, this.farOpacity);
      const depthMesh = new THREE.Mesh(geometry, depthMaterial);
      depthMesh.renderOrder = -2;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = -1;
      mesh.add(depthMesh);
      this.farTiles.set(key, mesh);
      this.farGroup.add(mesh);
      this.farRetry.delete(key);
    } catch {
      if (this.farWanted.has(key)) this.farRetry.set(key, performance.now() + 8000);
    }
  }

  releaseFarTile(key) {
    const mesh = this.farTiles.get(key);
    this.farTiles.delete(key);
    mesh.removeFromParent();
    mesh.geometry.dispose();
    mesh.children[0].material.dispose();
    mesh.material.map.dispose();
    mesh.material.dispose();
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
    let image = await this.imageryCache.getTileImage(zoom, x, y);
    let fromParent = false;
    if (!image) {
      // Cold-cache partial outage: use the z10 parent quadrant until the
      // preferred z11 tile succeeds on retry.
      const parent = await this.imageryCache.getTileImage(zoom - 1, Math.floor(x / 2), Math.floor(y / 2));
      if (parent) {
        image = parent;
        fromParent = true;
      }
    }
    if (this.tiles.get(key) !== entry) return;
    if (!image) {
      entry.imageryRetryAt = performance.now() + 8000;
      return;
    }
    entry.baseMap = fromParent
      ? parentImageryTexture(image, x, y, this.imageryBudget.anisotropy)
      : imageryTexture(image, this.imageryBudget.anisotropy);
    entry.baseFromParent = fromParent;
    entry.detail.base.value = entry.baseMap;
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
        const demPixels = entry.mesh.geometry.index?.count
          ? projectedTilePixels(entry.mesh, camera, viewportHeight) : 0;
        const localPixels = entry.localMesh
          ? projectedTilePixels(entry.localMesh, camera, viewportHeight) : 0;
        const pixels = Math.max(demPixels, localPixels);
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
      const budget = this.imageryBudget;
      // Reconcile resident selections against the active quality budget so
      // lowering render quality immediately shrinks retained detail tiles.
      if (wanted.size > 0) {
        const byPriority = [...wanted.entries()]
          .sort(([a], [b]) => (this.tiles.get(b)?.imageryPriority ?? 0) - (this.tiles.get(a)?.imageryPriority ?? 0));
        wanted.clear();
        let keptHigh = 0;
        let keptUltra = 0;
        for (const [key, level] of byPriority) {
          if (wanted.size >= budget.detailTileLimit) break;
          let capped = level;
          if (capped >= 14 && keptUltra >= budget.ultraDetailTileLimit) capped = 13;
          if (capped >= 13 && keptHigh >= budget.highDetailTileLimit) capped = 12;
          wanted.set(key, capped);
          if (capped >= 13) keptHigh++;
          if (capped >= 14) keptUltra++;
        }
      }
      let highDetailCount = 0;
      let ultraDetailCount = 0;
      for (const level of wanted.values()) {
        if (level >= 13) highDetailCount++;
        if (level >= 14) ultraDetailCount++;
      }
      for (const { key, entry, pixels } of visible) {
        const previous = wanted.get(key);
        if (!previous && wanted.size >= budget.detailTileLimit) continue;
        let level = 12;
        if (pixels >= 3 * samples && (ultraDetailCount < budget.ultraDetailTileLimit || previous >= 14)) {
          level = 14;
        } else if (pixels >= 1.8 * samples && (highDetailCount < budget.highDetailTileLimit || previous >= 13)) {
          level = 13;
        }
        if (previous >= level) continue;
        wanted.set(key, level);
        entry.detailLastVisibleAt = now;
        if (level >= 13 && !(previous >= 13)) highDetailCount++;
        if (level >= 14 && !(previous >= 14)) ultraDetailCount++;
      }
      if (this.insets?.length > 0 && camera?.position) {
        const camX = camera.position.x;
        const camZ = camera.position.z;
        for (const inset of this.insets) {
          const [minX, minZ, maxX, maxZ] = inset.bounds;
          const distToInset = Math.hypot(
            camX < minX ? minX - camX : camX > maxX ? camX - maxX : 0,
            camZ < minZ ? minZ - camZ : camZ > maxZ ? camZ - maxZ : 0
          );
          const approachDist = inset.approachDistanceM ?? 8000;
          if (distToInset <= approachDist) {
            for (const [key, entry] of this.tiles) {
              const b = entry.bounds;
              if (b && b[0] < maxX && b[2] > minX && b[1] < maxZ && b[3] > minZ) {
                if (!wanted.has(key) && wanted.size >= budget.detailTileLimit) continue;
                const current = wanted.get(key) ?? zoom;
                let targetLevel = distToInset <= approachDist * 0.5
                  ? (inset.maxDetailLevel ?? 14)
                  : (inset.minDetailLevel ?? 13);
                const needsUltra = targetLevel >= 14 && !(current >= 14);
                if (needsUltra && (budget.ultraDetailTileLimit <= 0 || ultraDetailCount >= budget.ultraDetailTileLimit)) {
                  targetLevel = 13;
                }
                const needsHigh = targetLevel >= 13 && !(current >= 13);
                if (needsHigh && (budget.highDetailTileLimit <= 0 || highDetailCount >= budget.highDetailTileLimit)) {
                  targetLevel = 12;
                }
                if (budget.detailTileLimit <= 0) targetLevel = zoom;
                if (current < targetLevel) {
                  wanted.set(key, targetLevel);
                  entry.detailLastVisibleAt = now;
                  if (targetLevel >= 13 && !(current >= 13)) highDetailCount++;
                  if (targetLevel >= 14 && !(current >= 14)) ultraDetailCount++;
                }
              }
            }
          }
        }
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

    this.updateImageryEdges(now);
    if (this.pendingDetail) return;
    const candidates = [...this.detailWanted.entries()]
      .sort(([a], [b]) => (this.tiles.get(b)?.imageryPriority ?? 0) - (this.tiles.get(a)?.imageryPriority ?? 0));
    for (const [key, level] of candidates) {
      const entry = this.tiles.get(key);
      if (!entry?.baseMap || entry.detailLevel >= level || now < (entry.detailRetryAt ?? 0)) continue;
      if (entry.detailMap && (entry.detail.blend.value < 1
        || (entry.detail.edges && !entry.detail.edges.value.toArray().every(value => value === 1)))) continue;
      this.pendingDetail = this.loadImageryDetail(key, entry, level).finally(() => { this.pendingDetail = null; });
      break;
    }
  }

  updateImageryEdges(now) {
    const step = Math.max(0, now - (this.detailEdgesUpdatedAt ?? now)) / detailFadeMs;
    this.detailEdgesUpdatedAt = now;
    for (const [key, entry] of this.tiles) {
      const edges = entry.detail?.edges?.value;
      if (!edges) continue;
      const [x, y] = key.split('/').map(Number);
      const level = entry.detailLevel;
      for (const [side, [dx, dy]] of imageryNeighbors.entries()) {
        const neighborKey = keyOf(wrapX(x + dx), y + dy);
        const neighbor = this.tiles.get(neighborKey);
        const opposite = neighbor?.detail?.edges?.value;
        // Process a shared edge once, then apply the same weight to both tiles.
        if (opposite && key > neighborKey) continue;
        const otherSide = (side + 2) % 4;
        let weight = 1;
        if (entry.detailMap && neighbor?.detailMap && level === neighbor.detailLevel) {
          const current = Math.max(edges.getComponent(side), opposite?.getComponent(otherSide) ?? 1);
          const ready = entry.detail.blend.value === 1 && neighbor.detail.blend.value === 1
            && !entry.previousDetailMap && !neighbor.previousDetailMap;
          const staying = this.detailWanted.get(key) === level && this.detailWanted.get(neighborKey) === level;
          weight = THREE.MathUtils.clamp(current + (ready && staying ? -step : step), 0, 1);
        }
        edges.setComponent(side, weight);
        opposite?.setComponent(otherSide, weight);
      }
    }
    // All four tiles touching a corner must fade to the same degree there.
    for (const [key, entry] of this.tiles) {
      const corners = entry.detail?.corners?.value;
      if (!corners) continue;
      const edges = entry.detail.edges.value;
      const [x, y] = key.split('/').map(Number);
      const neighboringEdges = imageryNeighbors.map(([dx, dy]) =>
        this.tiles.get(keyOf(wrapX(x + dx), y + dy))?.detail?.edges?.value);
      for (let side = 0; side < 4; side++) {
        const next = (side + 1) % 4;
        corners.setComponent(side, Math.max(
          edges.getComponent(side), edges.getComponent(next),
          neighboringEdges[side]?.getComponent(next) ?? 1,
          neighboringEdges[next]?.getComponent(side) ?? 1,
        ));
      }
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
    entry.detailMap = imageryTexture(canvas, this.imageryBudget.anisotropy);
    entry.detailLevel = level;
    entry.detail.map.value = entry.detailMap;
    entry.detail.blend.value = 0;
    entry.detailUpdatedAt = performance.now();
  }

  raster(x, y, level = zoom) {
    const key = `${level}/${x}/${y}`;
    const prior = this.rasters.get(key);
    if (prior) {
      this.rasters.delete(key);
      this.rasters.set(key, prior);
      return prior;
    }
    const request = this.elevationCache.getTileImage(level, x, y).then(image => {
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
    this.pending.get(key)?.abort();
    this.pending.set(key, controller);
    let entry = null;
    try {
      const waterData = this.fetchWater(tile, controller.signal);
      const [raster, east, south, southeast, water] = await Promise.all([
        this.raster(x, y), this.raster(wrapX(x + 1), y), this.raster(x, y + 1), this.raster(wrapX(x + 1), y + 1), waterData,
      ]);
      if (controller.signal.aborted || this.pending.get(key) !== controller) return;
      const local = this.localSurface;
      const half = local?.size / 2;
      const blendDistance = 1200;
      const world = this.world;
      const blendHeight = (px, pz, height) => {
        if (local) {
          const distance = Math.max(Math.abs(px), Math.abs(pz)) - half;
          if (distance < blendDistance) {
            return THREE.MathUtils.lerp(local.getNaturalHeight(px, pz), height,
              THREE.MathUtils.smoothstep(distance, 0, blendDistance));
          }
        }
        if (world?.regions) {
          for (const [id, reg] of world.regions) {
            if (!reg.terrain?.runways?.length) continue;
            const offset = world.offsets.get(id);
            if (!offset) continue;
            const lx = px - offset[0];
            const lz = pz - offset[1];
            const e = reg.extent;
            if (e && (lx < e.minX || lx > e.maxX || lz < e.minZ || lz > e.maxZ)) continue;
            const nearest = reg.terrain.nearest(lx, lz);
            if (nearest && nearest.hit.distance < 240) {
              const blend = THREE.MathUtils.smoothstep(nearest.hit.distance, 40, 240);
              return THREE.MathUtils.lerp(nearest.hit.elevationM, height, blend);
            }
          }
        }
        return height;
      };
      const bounds = projectedBounds(x, y, this.project);
      const cutouts = this.runwayCutouts(bounds);
      const { geometry, cellOffsets } = buildOpenTerrainTile({
        blendHeight, localSurface: local, runwayCutouts: cutouts,
        x, y, raster, east, south, southeast, water, project: this.project, protectedAreas: this.protectedAreas,
      });
      const detail = {
        map: { value: null },
        blend: { value: 0 },
        base: { value: null },
        edges: { value: new THREE.Vector4(1, 1, 1, 1) },
        corners: { value: new THREE.Vector4(1, 1, 1, 1) },
      };
      const material = terrainMaterial(detail, this.distanceFade);
      if (local) applyFarSunShadow(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      entry = { mesh, fullGeometry: geometry, cellOffsets, runwayCutouts: cutouts, runwayVisibilityKey: this.runwayVisibilityKey(), detail, water, raster, waterRetryAt: performance.now() + 8000, baseMap: null, detailLevel: zoom, bounds };
      if (this.localImagery) {
        const [west, north, eastEdge, southEdge] = bounds;
        const extent = local?.extent ?? (half > 0 ? { minX: -half, maxX: half, minZ: -half, maxZ: half } : null);
        const overlaps = !extent || (west < extent.maxX && eastEdge > extent.minX && north < extent.maxZ && southEdge > extent.minZ);
        if (overlaps) {
          const localGeometry = buildLocalImageryGeometry(this.localImagery, x, y);
          if (localGeometry) {
            entry.localMesh = new THREE.Mesh(localGeometry, material);
            entry.localMesh.receiveShadow = true;
            entry.localMesh.visible = false;
            mesh.add(entry.localMesh);
          }
        }
      }
      if (controller.signal.aborted || this.pending.get(key) !== controller) {
        this.releaseEntry(entry);
        return;
      }
      this.updateRenderGeometry(entry, key);
      const previous = this.tiles.get(key);
      if (previous?.baseMap) {
        entry.baseMap = previous.baseMap;
        entry.detail.base.value = previous.baseMap;
        this.applyImagery(entry, previous.baseMap);
        previous.baseMap = null;
      }
      if (previous?.detailMap) {
        entry.detailMap = previous.detailMap;
        entry.detailLevel = previous.detailLevel;
        entry.detail.map.value = previous.detailMap;
        entry.detail.blend.value = previous.detail.blend.value;
        entry.detailUpdatedAt = previous.detailUpdatedAt ?? performance.now();
        if (previous.detailLastVisibleAt !== undefined) {
          entry.detailLastVisibleAt = previous.detailLastVisibleAt;
        }
        previous.detailMap = null;
      }
      if (previous?.detail?.edges) {
        entry.detail.edges.value.copy(previous.detail.edges.value);
      }
      if (previous?.detail?.corners) {
        entry.detail.corners.value.copy(previous.detail.corners.value);
      }
      if (previous?.previousDetailMap) {
        entry.previousDetailMap = previous.previousDetailMap;
        previous.previousDetailMap = null;
      }
      this.tiles.set(key, entry);
      this.group.add(mesh);
      if (previous && previous !== entry) {
        this.releaseEntry(previous);
      }
      this.retry.delete(key);
    } catch {
      if (!controller.signal.aborted && this.pending.get(key) === controller) {
        this.retry.set(key, performance.now() + 4000);
      }
    } finally {
      if (this.pending.get(key) === controller) {
        this.pending.delete(key);
      }
    }
  }

  updateRenderGeometry(entry, key) {
    // Reduced tiles span ~4x more ground per triangle and could bridge a narrow
    // strip even after clipping, so keep the full mesh wherever a runway lives.
    const useReduced = this.reducedGeometry && key !== this.detailedKey && !entry.runwayCutouts?.length;
    if (useReduced && entry.reducedGeometry === undefined) {
      entry.reducedGeometry = buildReducedTerrainGeometry(entry.fullGeometry);
    }
    entry.mesh.geometry = (useReduced && entry.reducedGeometry) || entry.fullGeometry;
  }

  release(key, entry) {
    this.tiles.delete(key);
    this.releaseEntry(entry);
  }

  releaseEntry({ mesh, localMesh, fullGeometry, reducedGeometry, baseMap, detailMap, previousDetailMap, waterRequest }) {
    waterRequest?.abort();
    mesh.removeFromParent();
    (fullGeometry ?? mesh.geometry).dispose();
    reducedGeometry?.dispose();
    localMesh?.geometry.dispose();
    baseMap?.dispose();
    detailMap?.dispose();
    previousDetailMap?.dispose();
    mesh.material.dispose();
  }

  hasVisibleLocalMesh() {
    for (const entry of this.tiles.values()) {
      if (entry.localMesh?.visible) return true;
    }
    return false;
  }

  dispose() {
    for (const controller of this.pending.values()) controller.abort();
    for (const [key, entry] of this.tiles) this.release(key, entry);
    this.farWanted?.clear();
    for (const key of this.farTiles.keys()) this.releaseFarTile(key);
    this.elevationCache.dispose();
    this.imageryCache.dispose();
    this.rasters.clear();
    this.group.removeFromParent();
  }
}


const frames = {
  lukla: { origin: luklaGrid.origin },
  incheon: { origin: INCHEON_PATCH.origin, protectedAreas: [[-25000, -25000, 25000, 25000]] },
  jeju: { origin: JEJU_ORIGIN, protectedAreas: [[-3200, -1500, 3200, 1500]], insets: getInsetsForRegion('jeju') },
};

function setCorridorStreamersVisible(surface, visible) {
  if (surface?.corridorStreamer?.group) surface.corridorStreamer.group.visible = visible;
  if (surface?.regions) {
    for (const region of surface.regions.values()) {
      const streamer = region.terrain?.corridorStreamer ?? region.airport?.corridorStreamer;
      if (streamer?.group) streamer.group.visible = visible;
    }
  }
}

export function updateOpenWorldTerrain(sim) {
  const surface = sim.currentTerrain;
  const customOrigin = sim.world?.customOrigin ?? null;
  const frame = customOrigin
    ? { origin: customOrigin, protectedAreas: [], insets: parisShowcaseInsets(customOrigin) }
    : (Object.hasOwn(frames, sim.activeAirport) && frames[sim.activeAirport]);
  const originChanged = Boolean(
    surface?.openWorld && frame && (
      Math.abs(surface.openWorld.origin.latitude - frame.origin.latitude) > 1e-6
      || Math.abs(surface.openWorld.origin.longitude - frame.origin.longitude) > 1e-6
    )
  );
  if (sim.openWorldSurface !== surface || !frame || originChanged) {
    const previous = originChanged ? surface : sim.openWorldSurface;
    if (previous?.openWorld) {
      previous.openWorld.dispose();
      previous.openWorld = null;
      setCorridorStreamersVisible(previous, true);
    }
    sim.openWorldSurface = frame ? surface : null;
  }
  if (!frame) {
    setCorridorStreamersVisible(surface, true);
  }
  if (frame && surface?.mesh && (customOrigin || sim.activeAirport !== 'lukla' || surface.isLoaded)) {
    if (!surface.openWorld) {
      let localSurface = null;
      let protectedAreas = frame.protectedAreas;
      const airportMesh = customOrigin ? null : (surface.airportMesh ?? surface.anchorTerrain?.airportMesh);
      if (!customOrigin && sim.activeAirport === 'lukla') {
        const half = surface.size / 2;
        protectedAreas = [[-half, -half, half, half]];
        localSurface = surface;
      } else if (!customOrigin && airportMesh?.geometry) {
        localSurface = {
          geometry: airportMesh.geometry,
          extent: { minX: -3200, maxX: 3200, minZ: -1500, maxZ: 1500 },
        };
      }
      surface.openWorld = new OpenWorldTerrain({
        ...frame,
        protectedAreas,
        localSurface,
        world: sim.world,
      });
      surface.mesh.add(surface.openWorld.group);
    }
    if (surface.openWorld && !surface.openWorld.world && sim.world) {
      surface.openWorld.world = sim.world;
    }
    setCorridorStreamersVisible(surface, false);
    const height = sim.renderer?.getDrawingBufferSize?.(viewportSize)?.y;
    const maxAnisotropy = sim.renderer?.capabilities?.getMaxAnisotropy?.() ?? defaultAnisotropy;
    surface.openWorld.setImageryQuality(sim.renderQuality, maxAnisotropy);
    surface.openWorld.update(sim.position, sim.linearVelocity, sim.camera, height,
      sim.renderQuality === 'ultraLow');
  }
  const world = surface?.openWorld;
  const farVisible = Boolean(frame && world?.farOpacity.value && world.farTiles.size);
  if (sim.camera?.isPerspectiveCamera) {
    const far = farVisible ? highAltitudeClipM : nearClipM;
    if (sim.camera.far !== far) {
      sim.camera.far = far;
      sim.camera.updateProjectionMatrix();
    }
  }
  setMapAttributionSource('open-world-attribution', Boolean(world?.tiles.size || farVisible));
}
