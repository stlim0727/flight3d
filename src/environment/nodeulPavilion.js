import * as THREE from 'three';

// nodeul-pavilion.glb ships byte-for-byte as downloaded (CC BY 4.0), so placement and
// material fixes happen here. The collision heightfield is baked with the same matrix.
export function pavilionMatrix(island) {
  const { scale, yaw } = island.pavilion;
  return new THREE.Matrix4().compose(new THREE.Vector3(island.x, island.height, island.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
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
