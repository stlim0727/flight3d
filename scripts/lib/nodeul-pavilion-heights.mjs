// Bakes the Nodeulseom pavilion collision heightfield from the shipped GLB, so HangangRun
// collides with the triangles players see rather than a bounding box.
import * as THREE from 'three';
import { pavilionMatrix } from '../../src/environment/nodeulPavilion.js';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAYS = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

export function readGlb(bytes) {
  const length = bytes.readUInt32LE(12);
  return { gltf: JSON.parse(bytes.subarray(20, 20 + length)), bin: bytes.subarray(28 + length) };
}

/** World-space triangles of an uncompressed GLB scene under `root`. */
export function readGlbTriangles(bytes, root = new THREE.Matrix4()) {
  const { gltf, bin } = readGlb(bytes);
  const read = index => {
    const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
    const size = COMPONENTS[accessor.type], Type = ARRAYS[accessor.componentType];
    const stride = view.byteStride ? view.byteStride / Type.BYTES_PER_ELEMENT : size;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const end = start + ((accessor.count - 1) * stride + size) * Type.BYTES_PER_ELEMENT;
    const data = new Type(bin.buffer.slice(bin.byteOffset + start, bin.byteOffset + end));
    return Array.from({ length: accessor.count * size }, (_, i) => data[Math.floor(i / size) * stride + i % size]);
  };
  const triangles = [];
  const visit = (index, parent) => {
    const node = gltf.nodes[index], local = new THREE.Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else local.compose(new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
      new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(node.scale ?? [1, 1, 1])));
    const world = parent.clone().multiply(local);
    for (const primitive of gltf.meshes[node.mesh]?.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4) throw new Error('Only triangle primitives are supported');
      const position = read(primitive.attributes.POSITION);
      const order = primitive.indices === undefined ? position.map((_, i) => i).slice(0, position.length / 3) : read(primitive.indices);
      for (let i = 0; i < order.length; i += 3) {
        triangles.push([0, 1, 2].map(k => new THREE.Vector3().fromArray(position, order[i + k] * 3).applyMatrix4(world)));
      }
    }
    node.children?.forEach(child => visit(child, world));
  };
  gltf.scenes[gltf.scene ?? 0].nodes.forEach(index => visit(index, root));
  return triangles;
}

/**
 * Island-relative grid of the highest surface in each `cell` metre square (world Y,
 * 0 where empty). Triangles are sampled at a quarter cell, which includes vertical walls.
 */
export function bakePavilionHeights(bytes, island, cell = 1) {
  const root = new THREE.Matrix4().makeTranslation(-island.x, 0, -island.z).multiply(pavilionMatrix(island));
  const triangles = readGlbTriangles(bytes, root);
  const bounds = new THREE.Box3().setFromPoints(triangles.flat());
  const x0 = Math.floor(bounds.min.x / cell) * cell, z0 = Math.floor(bounds.min.z / cell) * cell;
  const cols = Math.ceil((bounds.max.x - x0) / cell), rows = Math.ceil((bounds.max.z - z0) / cell);
  const heights = new Array(cols * rows).fill(0), ab = new THREE.Vector3(), ac = new THREE.Vector3(), p = new THREE.Vector3();
  for (const [a, b, c] of triangles) {
    const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (cell / 4)));
    ab.subVectors(b, a).divideScalar(n); ac.subVectors(c, a).divideScalar(n);
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        p.copy(a).addScaledVector(ab, i).addScaledVector(ac, j);
        const col = Math.min(cols - 1, Math.floor((p.x - x0) / cell)), row = Math.min(rows - 1, Math.floor((p.z - z0) / cell));
        heights[row * cols + col] = Math.max(heights[row * cols + col], p.y);
      }
    }
  }
  const rounded = heights.map(h => (h > 0 ? Math.ceil(h * 100) / 100 : 0));
  return { cell, x0, z0, cols, rows, top: Math.max(...rounded), heights: rounded };
}
