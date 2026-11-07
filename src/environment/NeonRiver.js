import * as THREE from 'three';
import { HANGANG_COURSE, riverCenter } from '../config/hangangCourse.js';
import { createBridge, createBridgeMaterials } from './hangangBridges.js';

// Half the side of the square of city ground around the river, in the course frame.
const EXTENT = 12000;
const STEP = 100;

// A flat, upward-facing strip in the course frame between across-river offsets left(z)
// and right(z), at height y. It is sampled every STEP along the river and cut into
// `columns` across it, so no triangle spans kilometres (near-plane 1/w interpolation).
function strip(left, right, y, columns) {
  const vertices = [], indices = [];
  const rows = Math.round(2 * EXTENT / STEP), stride = columns + 1;
  for (let i = 0; i <= rows; i++) {
    const z = EXTENT - i * STEP, x0 = left(z), x1 = right(z);
    for (let j = 0; j <= columns; j++) vertices.push(x0 + (x1 - x0) * j / columns, y, z);
    if (i === rows) continue;
    for (let j = 0; j < columns; j++) {
      const a = i * stride + j, b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// The Neon Metropolis river (#551): the city ground on both banks, the water between
// them and the bridges, all in one group placed at the course frame. Water and ground
// are both at the city's ground height, so they share edges instead of overlapping.
export function createNeonRiver(course = HANGANG_COURSE) {
  const group = new THREE.Group();
  group.name = 'neon-river';
  group.position.set(course.frame.x, 0, course.frame.z);
  group.rotation.y = course.frame.yaw;
  const north = z => riverCenter(z) + course.halfWidth, south = z => riverCenter(z) - course.halfWidth;

  // Deep midnight indigo ground matching the horizon haze, open over the river.
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x070312 });
  const ground = new THREE.Group();
  ground.name = 'neon-ground';
  const columns = Math.ceil(EXTENT / STEP);
  ground.add(new THREE.Mesh(strip(north, () => EXTENT, 0, columns), groundMat),
    new THREE.Mesh(strip(() => -EXTENT, south, 0, columns), groundMat));
  group.add(ground);

  // Dark, glossy water that mirrors the skyline glow.
  const water = new THREE.Mesh(strip(south, north, course.waterLevel, Math.ceil(2 * course.halfWidth / STEP)), new THREE.MeshStandardMaterial({
    color: 0x081119, roughness: 0.14, metalness: 0.68,
  }));
  water.name = 'neon-river-water';
  water.receiveShadow = true;
  group.add(water);

  // Neon promenade strips along both banks, drawn on the ground just outside the water.
  const edges = [[north, 1, 0x00f0ff], [south, -1, 0xd9269e]].map(([bank, side, color]) => {
    const mesh = new THREE.Mesh(side > 0 ? strip(bank, z => bank(z) + 2.5, 0.06, 1) : strip(z => bank(z) - 2.5, bank, 0.06, 1),
      new THREE.MeshBasicMaterial({ color }));
    mesh.name = `neon-river-bank-${side > 0 ? 'north' : 'south'}`;
    return mesh;
  });
  group.add(...edges);

  const materials = createBridgeMaterials();
  const bridges = course.bridges.map(bridge => {
    const bridgeGroup = createBridge(bridge, materials);
    group.add(bridgeGroup);
    return bridgeGroup;
  });
  return { group, ground, water, bridges };
}
