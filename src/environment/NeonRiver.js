import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NEON_ISLAND, NEON_RIVER, islandRows, islandShore, landOutline, riverCenter, riverHalfWidth } from '../config/neonRiver.js';
import { createBridge, createBridgeMaterials } from './neonBridges.js';

// Half the side of the square of sea, centred on the city.
const EXTENT = 12000;
const STEP = 100;
const SEA_ROWS = Array.from({ length: 2 * EXTENT / STEP + 1 }, (_, i) => EXTENT - i * STEP);

// A flat, upward-facing strip between x = left(z) and x = right(z) at height y, sampled
// at `rows` (descending Z, at most STEP apart) and cut into columns at most STEP wide
// across, so no triangle spans kilometres (near-plane 1/w interpolation).
function strip(left, right, y, rows = SEA_ROWS) {
  const vertices = [], indices = [];
  const widest = Math.max(...rows.map(z => right(z) - left(z)));
  const columns = Math.max(1, Math.ceil(widest / STEP)), stride = columns + 1;
  rows.forEach((z, i) => {
    const x0 = left(z), x1 = right(z);
    for (let j = 0; j <= columns; j++) vertices.push(x0 + (x1 - x0) * j / columns, y, z);
    if (i === rows.length - 1) return;
    for (let j = 0; j < columns; j++) {
      const a = i * stride + j, b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  });
  return indexed(vertices, indices);
}

// A vertical wall around the closed loop of [x, z] `points`, from y0 up to y1.
function wall(points, y0, y1) {
  const vertices = [], indices = [], n = points.length;
  points.forEach(([x, z], i) => {
    vertices.push(x, y0, z, x, y1, z);
    const j = (i + 1) % n;
    indices.push(2 * i, 2 * i + 1, 2 * j, 2 * i + 1, 2 * j + 1, 2 * j);
  });
  return indexed(vertices, indices);
}

// The counter-clockwise loop `points` moved `d` metres out over the water (negative:
// inland), each point along the normal of its neighbours' chord.
export function offsetShore(points, d) {
  const n = points.length;
  return points.map(([x, z], i) => {
    const [xa, za] = points[(i + n - 1) % n], [xb, zb] = points[(i + 1) % n], length = Math.hypot(xb - xa, zb - za);
    return [x + d * (zb - za) / length, z - d * (xb - xa) / length];
  });
}

// A flat, upward-facing band at height y between the counter-clockwise loop `points` and
// its copy `width` metres inland.
function band(points, width, y) {
  const inner = offsetShore(points, -width), vertices = [], indices = [], n = points.length;
  points.forEach(([x, z], i) => {
    vertices.push(x, y, z, inner[i][0], y, inner[i][1]);
    const j = (i + 1) % n;
    indices.push(2 * i, 2 * i + 1, 2 * j, 2 * j, 2 * i + 1, 2 * j + 1);
  });
  return indexed(vertices, indices);
}

// Points every `spacing` metres along the closed loop `points`.
function along(points, spacing) {
  const out = [];
  let next = 0;
  points.forEach(([x0, z0], i) => {
    const [x1, z1] = points[(i + 1) % points.length], length = Math.hypot(x1 - x0, z1 - z0);
    for (; next < length; next += spacing) out.push([x0 + (x1 - x0) * next / length, z0 + (z1 - z0) * next / length]);
    next -= length;
  });
  return out;
}

// An equirectangular copy of NeonCity's stylized sky dome (initStylizedSky) for the water
// to mirror (#581). The scene's environment is a daytime HDR that Neon Metropolis dims to
// 3%, which left the glossy water black. Row 0 is the nadir; below the horizon is the
// midnight ground.
function nightSkyEnvironment(width = 64, height = 32) {
  const horizon = [0.48, 0.04, 0.46], mid = [0.20, 0.03, 0.32], top = [0.03, 0.01, 0.10], ground = [0.027, 0.012, 0.07];
  const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const h = Math.sin(Math.PI * ((row + 0.5) / height - 0.5));
    const t = Math.min(1, Math.max(0, (h + 0.05) / 0.95));
    const color = h < 0 ? ground : t < 0.4 ? mix(horizon, mid, t / 0.4) : mix(mid, top, (t - 0.4) / 0.6);
    for (let column = 0; column < width; column++) data.set([...color.map(v => Math.round(v * 255)), 255], (row * width + column) * 4);
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// A soft round glow for point lights.
function glowTexture(size = 16) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      data.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - r) ** 2)], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function indexed(vertices, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// The Neon Metropolis island and canal (#551, #628): the city ground at street level on
// both banks and on the runway's causeway, the sea all around at the canal's water level,
// vertical quay walls along every shore, neon promenade strips along their tops, and the
// three bridges. The street and the water meet only at the walls; the sea runs on under
// the island, 14 m below the street.
export function createNeonRiver(river = NEON_RIVER, island = NEON_ISLAND) {
  const group = new THREE.Group();
  group.name = 'neon-river';
  const rows = islandRows(river, island), { causeway } = island;
  const west = z => riverCenter(z, river) - riverHalfWidth(z, river, island);
  const east = z => riverCenter(z, river) + riverHalfWidth(z, river, island);
  const shores = [-1, 1].map(side => landOutline(side, river, island));

  // Deep midnight indigo ground matching the horizon haze, open over the canal.
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x070312 });
  const ground = new THREE.Group();
  ground.name = 'neon-ground';
  ground.add(
    new THREE.Mesh(strip(z => islandShore(z, -1, island), west, 0, rows), groundMat),
    new THREE.Mesh(strip(east, z => islandShore(z, 1, island), 0, rows), groundMat),
    new THREE.Mesh(strip(() => causeway.west, () => island.west, 0, [causeway.halfWidth, 0, -causeway.halfWidth]), groundMat));
  group.add(ground);

  // Dark, glossy water that mirrors the night sky's glow, brightest toward the horizon:
  // the canal and the sea it opens into.
  const water = new THREE.Mesh(strip(() => -EXTENT, () => EXTENT, river.waterLevel), new THREE.MeshStandardMaterial({
    color: 0x081119, roughness: 0.14, metalness: 0, envMap: nightSkyEnvironment(),
  }));
  water.name = 'neon-river-water';
  water.receiveShadow = true;
  group.add(water);

  // Quay walls from the water up to the street, around both banks.
  const walls = new THREE.Mesh(
    mergeGeometries(shores.map(shore => wall(shore, river.waterLevel, 0))),
    new THREE.MeshStandardMaterial({ color: 0x1b1626, roughness: 0.9, side: THREE.DoubleSide }));
  walls.name = 'neon-river-walls';
  walls.receiveShadow = true;
  group.add(walls);

  // Neon waterline ribbons along every wall, just off their faces, so the canal and the
  // shore read from the water.
  const waterline = new THREE.Mesh(
    mergeGeometries(shores.map(shore => wall(offsetShore(shore, 0.05), river.waterLevel + 0.4, river.waterLevel + 1))),
    new THREE.MeshBasicMaterial({ color: 0x7a2cff, side: THREE.DoubleSide }));
  waterline.name = 'neon-river-waterline';
  group.add(waterline);

  // Neon promenade strips along the wall tops, on the street side: pink around the west
  // bank and the causeway, cyan around the east bank.
  const edges = [[-1, 0xd9269e], [1, 0x00f0ff]].map(([side, color], i) => {
    const mesh = new THREE.Mesh(band(shores[i], 2.5, 0.06), new THREE.MeshBasicMaterial({ color }));
    mesh.name = `neon-river-bank-${side < 0 ? 'west' : 'east'}`;
    return mesh;
  });
  group.add(...edges);

  // Quay lights every 20 m along every wall top, in each bank's promenade colour, so the
  // canal's course and the island's shore read ahead from the water and from above
  // (#581). Light only: they stand flush with the promenade and have no collision.
  const positions = [], colors = [];
  [0xff7ad6, 0x8ffaff].forEach((color, i) => {
    const rgb = new THREE.Color(color);
    for (const [x, z] of along(offsetShore(shores[i], -1), 20)) {
      positions.push(x, 0.5, z);
      colors.push(rgb.r, rgb.g, rgb.b);
    }
  });
  const lightGeometry = new THREE.BufferGeometry();
  lightGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  lightGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const quayLights = new THREE.Points(lightGeometry, new THREE.PointsMaterial({
    size: 6, map: glowTexture(), vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  quayLights.name = 'neon-river-quay-lights';
  group.add(quayLights);

  const materials = createBridgeMaterials();
  const bridges = river.bridges.map(bridge => {
    const bridgeGroup = createBridge(bridge, materials, river);
    group.add(bridgeGroup);
    return bridgeGroup;
  });
  return { group, ground, water, walls, waterline, quayLights, bridges };
}
