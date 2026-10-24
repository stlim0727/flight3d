import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Batch only opaque, compatible static surfaces. Moving pivots, hidden parts and
// special geometry keep their original render semantics.
export function batchStaticCockpit(model, movingRoots = []) {
  model.updateMatrixWorld(true);
  const inverse = model.matrixWorld.clone().invert();
  const moving = new Set(movingRoots);
  const buckets = new Map();
  model.traverse(mesh => {
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.userData.cockpitApertureShadow ||
        Array.isArray(mesh.material) || mesh.material.transparent ||
        Object.keys(mesh.geometry.morphAttributes).length ||
        mesh.geometry.drawRange.start !== 0 || mesh.geometry.drawRange.count !== Infinity) return;
    for (let node = mesh; node; node = node.parent) {
      if (!node.visible || moving.has(node)) return;
      if (node === model) break;
    }
    const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    if (transform.determinant() === 0) return;
    const attributes = Object.entries(mesh.geometry.attributes).sort(([a], [b]) => a.localeCompare(b));
    if (attributes.some(([, a]) => a.isInterleavedBufferAttribute)) return;
    const key = [mesh.material.id, mesh.castShadow, mesh.receiveShadow, mesh.renderOrder,
      mesh.layers.mask, !!mesh.geometry.index,
      ...attributes.map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`)].join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ mesh, transform });
  });
  let removed = 0;
  for (const entries of buckets.values()) {
    if (entries.length < 2) continue;
    const geometries = entries.map(({ mesh, transform }) => bakeGeometry(mesh.geometry, transform));
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach(g => g.dispose());
    if (!geometry) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const source = entries[0].mesh;
    const batch = new THREE.Mesh(geometry, source.material);
    batch.name = 'GLTF_Static_Batch';
    batch.castShadow = source.castShadow;
    batch.receiveShadow = source.receiveShadow;
    batch.renderOrder = source.renderOrder;
    batch.layers.mask = source.layers.mask;
    model.add(batch);
    // Keep empty nodes in place: descendants can carry independent transforms.
    for (const { mesh } of entries) {
      if (mesh.children.length === 0) mesh.removeFromParent();
      else mesh.geometry = new THREE.BufferGeometry();
    }
    removed += entries.length - 1;
  }
  return removed;
}

function bakeGeometry(source, transform) {
  let geometry = source.clone().applyMatrix4(transform);
  if (transform.determinant() < 0) {
    // WebGL reverses front-face winding for mirrored objects. Once transforms
    // are baked into a positive-scale batch, preserve that winding explicitly.
    if (!geometry.index) geometry.setIndex(Array.from(
      { length: geometry.attributes.position.count }, (_, i) => i
    ));
    const index = geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      index.setX(i, index.getX(i + 2));
      index.setX(i + 2, a);
    }
    const tangent = geometry.getAttribute('tangent');
    if (tangent) for (let i = 0; i < tangent.count; i++) tangent.setW(i, -tangent.getW(i));
    if (!source.index) {
      const indexed = geometry;
      geometry = indexed.toNonIndexed();
      indexed.dispose();
    }
  }
  return geometry;
}
