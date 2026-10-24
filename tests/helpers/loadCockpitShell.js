import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as THREE from 'three';

// Decode the shipped shell without DOM textures or a browser/worker. Use the
// repository's own decoder so the asset regression needs no new dependency.
export async function loadCockpitShell() {
  const sandbox = { console, process, require: createRequire(import.meta.url),
    module: { exports: {} }, exports: {}, __dirname: '.', TextDecoder, setTimeout };
  vm.runInNewContext(fs.readFileSync(new URL('../../public/draco/gltf/draco_decoder.js', import.meta.url), 'utf8'), sandbox);
  const decoderModule = await sandbox.module.exports({});
  const bytes = fs.readFileSync(new URL('../../public/models/b737-cockpit-medium.glb', import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const asset = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const root = new THREE.Group();
  root.rotation.y = Math.PI;
  root.position.set(0, -1.31, -11.43);

  const nodes = asset.nodes.map(node => {
    const object = new THREE.Group();
    object.name = node.name;
    if (node.matrix) object.applyMatrix4(new THREE.Matrix4().fromArray(node.matrix));
    else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    if (node.mesh === undefined || !node.name.startsWith('Body')) return object;
    for (const primitive of asset.meshes[node.mesh].primitives) {
      const extension = primitive.extensions.KHR_draco_mesh_compression;
      const view = asset.bufferViews[extension.bufferView];
      const start = 28 + jsonLength + (view.byteOffset ?? 0);
      const compressed = bytes.subarray(start, start + view.byteLength);
      const buffer = new decoderModule.DecoderBuffer();
      buffer.Init(new Int8Array(compressed), compressed.length);
      const decoder = new decoderModule.Decoder(), decoded = new decoderModule.Mesh();
      const status = decoder.DecodeBufferToMesh(buffer, decoded);
      if (!status.ok()) throw Error(status.error_msg());
      const attribute = decoder.GetAttributeByUniqueId(decoded, extension.attributes.POSITION);
      const values = new decoderModule.DracoFloat32Array();
      decoder.GetAttributeFloatForAllPoints(decoded, attribute, values);
      const positions = Float32Array.from({ length: values.size() }, (_, i) => values.GetValue(i));
      const indices = [], face = new decoderModule.DracoInt32Array();
      for (let i = 0; i < decoded.num_faces(); i++) {
        decoder.GetFaceFromMesh(decoded, i, face);
        for (let k = 0; k < 3; k++) indices.push(face.GetValue(k));
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      mesh.name = node.name;
      object.add(mesh);
      for (const allocation of [face, values, decoded, decoder, buffer]) decoderModule.destroy(allocation);
    }
    return object;
  });
  asset.nodes.forEach((node, i) => (node.children ?? []).forEach(child => nodes[i].add(nodes[child])));
  asset.scenes[asset.scene ?? 0].nodes.forEach(i => root.add(nodes[i]));
  root.updateMatrixWorld(true);
  return root;
}
