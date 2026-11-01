import * as THREE from 'three';

// nodeul-pavilion.glb ships byte-for-byte as downloaded (CC BY 4.0), so placement and
// material fixes happen here. The collision heightfield is baked with the same matrix.
export function pavilionMatrix(island) {
  const { scale, yaw } = island.pavilion;
  return new THREE.Matrix4().compose(new THREE.Vector3(island.x, island.height, island.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
}

// HangangRun collides with the island and pavilion from course data whether or not
// their GLBs have loaded, so these stand-ins show the same solids until they do.
// The island mirrors scripts/build-hangang-assets.mjs; the pavilion draws one block
// per heightfield cell, which is exactly the surface HangangRun tests against.
export function createNodeulseomStandIns(island) {
  const islandGeo = new THREE.CylinderGeometry(island.topRadius, island.bottomRadius, island.height, 24);
  islandGeo.scale(1, 1, island.zScale);
  islandGeo.translate(island.x, island.height / 2, island.z);
  const islandMesh = new THREE.Mesh(islandGeo, new THREE.MeshStandardMaterial({ color: 0x18241b, roughness: 0.95 }));
  islandMesh.name = 'Nodeulseom island stand-in';

  const field = island.pavilion.heights;
  const cells = [];
  field.heights.forEach((top, k) => { if (top > island.height) cells.push(k); });
  const pavilion = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.8 }), cells.length);
  pavilion.name = 'Nodeul pavilion stand-in';
  const matrix = new THREE.Matrix4();
  cells.forEach((k, n) => {
    const top = field.heights[k];
    matrix.makeScale(field.cell, top - island.height, field.cell).setPosition(
      island.x + field.x0 + (k % field.cols + 0.5) * field.cell, (top + island.height) / 2,
      island.z + field.z0 + (Math.floor(k / field.cols) + 0.5) * field.cell);
    pavilion.setMatrixAt(n, matrix);
  });
  for (const mesh of [islandMesh, pavilion]) mesh.castShadow = mesh.receiveShadow = true;
  return { island: islandMesh, pavilion };
}

export function placeNodeulPavilion(object, island) {
  pavilionMatrix(island).decompose(object.position, object.quaternion, object.scale);
  // The source flags its whole facade material BLEND for <1% of texels; sorting the
  // entire building as transparent flickers, so cut those texels out instead.
  object.traverse(node => {
    if (node.material?.transparent) Object.assign(node.material, { transparent: false, alphaTest: 0.5, depthWrite: true });
  });
  return object;
}
