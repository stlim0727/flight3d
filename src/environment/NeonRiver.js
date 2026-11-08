import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NEON_RIVER, riverCenter } from '../config/neonRiver.js';
import { createBridge, createBridgeMaterials } from './neonBridges.js';

// Half the side of the square of city ground, centred on the city.
const EXTENT = 12000;
const STEP = 100;

// A flat, upward-facing strip between x = left(z) and x = right(z) at height y. It is
// sampled every STEP along Z and cut into columns at most STEP wide across, so no
// triangle spans kilometres (near-plane 1/w interpolation).
function strip(left, right, y) {
  const vertices = [], indices = [];
  const rows = Math.round(2 * EXTENT / STEP);
  let widest = 0;
  for (let i = 0; i <= rows; i++) widest = Math.max(widest, right(EXTENT - i * STEP) - left(EXTENT - i * STEP));
  const columns = Math.max(1, Math.ceil(widest / STEP)), stride = columns + 1;
  for (let i = 0; i <= rows; i++) {
    const z = EXTENT - i * STEP, x0 = left(z), x1 = right(z);
    for (let j = 0; j <= columns; j++) vertices.push(x0 + (x1 - x0) * j / columns, y, z);
    if (i === rows) continue;
    for (let j = 0; j < columns; j++) {
      const a = i * stride + j, b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return indexed(vertices, indices);
}

// A vertical wall along x = at(z), from y0 up to y1, sampled every STEP along Z.
function wall(at, y0, y1) {
  const vertices = [], indices = [], rows = Math.round(2 * EXTENT / STEP);
  for (let i = 0; i <= rows; i++) {
    const z = EXTENT - i * STEP;
    vertices.push(at(z), y0, z, at(z), y1, z);
    if (i < rows) indices.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  return indexed(vertices, indices);
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

// The Neon Metropolis canal (#551): the city ground on both banks at street level, the
// water sunk between vertical quay walls, neon promenade strips along the walls' tops,
// and the three bridges. The street and the water meet only at the walls, so nothing
// overlaps.
export function createNeonRiver(river = NEON_RIVER) {
  const group = new THREE.Group();
  group.name = 'neon-river';
  const west = z => riverCenter(z, river) - river.halfWidth, east = z => riverCenter(z, river) + river.halfWidth;

  // Deep midnight indigo ground matching the horizon haze, open over the canal.
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x070312 });
  const ground = new THREE.Group();
  ground.name = 'neon-ground';
  ground.add(new THREE.Mesh(strip(() => -EXTENT, west, 0), groundMat), new THREE.Mesh(strip(east, () => EXTENT, 0), groundMat));
  group.add(ground);

  // Dark, glossy water that mirrors the night sky's glow, brightest toward the horizon.
  const water = new THREE.Mesh(strip(west, east, river.waterLevel), new THREE.MeshStandardMaterial({
    color: 0x081119, roughness: 0.14, metalness: 0, envMap: nightSkyEnvironment(),
  }));
  water.name = 'neon-river-water';
  water.receiveShadow = true;
  group.add(water);

  // Quay walls from the water up to the street.
  const walls = new THREE.Mesh(
    mergeGeometries([wall(west, river.waterLevel, 0), wall(east, river.waterLevel, 0)]),
    new THREE.MeshStandardMaterial({ color: 0x1b1626, roughness: 0.9, side: THREE.DoubleSide }));
  walls.name = 'neon-river-walls';
  walls.receiveShadow = true;
  group.add(walls);

  // Neon waterline ribbons along both walls, just off their faces, so the canal reads
  // from inside it.
  const waterline = new THREE.Mesh(mergeGeometries([
    wall(z => west(z) + 0.05, river.waterLevel + 0.4, river.waterLevel + 1),
    wall(z => east(z) - 0.05, river.waterLevel + 0.4, river.waterLevel + 1),
  ]), new THREE.MeshBasicMaterial({ color: 0x7a2cff, side: THREE.DoubleSide }));
  waterline.name = 'neon-river-waterline';
  group.add(waterline);

  // Neon promenade strips along the wall tops, on the street side.
  const edges = [[west, -1, 0xd9269e], [east, 1, 0x00f0ff]].map(([bank, side, color]) => {
    const mesh = new THREE.Mesh(side < 0 ? strip(z => bank(z) - 2.5, bank, 0.06) : strip(bank, z => bank(z) + 2.5, 0.06),
      new THREE.MeshBasicMaterial({ color }));
    mesh.name = `neon-river-bank-${side < 0 ? 'west' : 'east'}`;
    return mesh;
  });
  group.add(...edges);

  // Quay lights every 20 m along both wall tops, in each bank's promenade colour, so the
  // canal's course reads ahead from the water and from above (#581). Light only: they
  // stand flush with the promenade and have no collision.
  const positions = [], colors = [];
  for (const [bank, side, color] of [[west, -1, 0xff7ad6], [east, 1, 0x8ffaff]]) {
    const rgb = new THREE.Color(color);
    for (let z = -EXTENT; z <= EXTENT; z += 20) {
      positions.push(bank(z) + side, 0.5, z);
      colors.push(rgb.r, rgb.g, rgb.b);
    }
  }
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

