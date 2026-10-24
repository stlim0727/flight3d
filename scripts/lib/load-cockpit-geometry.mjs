import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as THREE from 'three';

/** Geometry/material-only GLTF import. Uses the same shipped Draco decoder. */
export async function loadCockpitGeometry(filename) {
  const sandbox = { console, process, require: createRequire(import.meta.url),
    module: { exports: {} }, exports: {}, __dirname: '.', TextDecoder, setTimeout };
  vm.runInNewContext(fs.readFileSync('public/draco/gltf/draco_decoder.js', 'utf8'), sandbox);
  const module = await sandbox.module.exports({});
  const bytes = fs.readFileSync(filename), length = bytes.readUInt32LE(12);
  const asset = JSON.parse(bytes.subarray(20, 20 + length));
  const materials = asset.materials.map(m => {
    const p = m.pbrMetallicRoughness ?? {};
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color().fromArray(p.baseColorFactor ?? [1, 1, 1]),
      metalness: p.metallicFactor ?? 1, roughness: p.roughnessFactor ?? 1,
      side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      transparent: m.alphaMode === 'BLEND', opacity: p.baseColorFactor?.[3] ?? 1,
    });
  });
  const meshes = asset.meshes.map(mesh => mesh.primitives.map(primitive => {
    const ext = primitive.extensions.KHR_draco_mesh_compression;
    const view = asset.bufferViews[ext.bufferView];
    const start = 28 + length + (view.byteOffset ?? 0);
    const compressed = bytes.subarray(start, start + view.byteLength);
    const buffer = new module.DecoderBuffer();
    buffer.Init(new Int8Array(compressed), compressed.length);
    const decoder = new module.Decoder(), decoded = new module.Mesh();
    const status = decoder.DecodeBufferToMesh(buffer, decoded);
    if (!status.ok()) throw Error(status.error_msg());
    const geometry = new THREE.BufferGeometry();
    for (const [semantic, id] of Object.entries(ext.attributes)) {
      const attribute = decoder.GetAttributeByUniqueId(decoded, id);
      const values = new module.DracoFloat32Array();
      decoder.GetAttributeFloatForAllPoints(decoded, attribute, values);
      const data = Float32Array.from({ length: values.size() }, (_, i) => values.GetValue(i));
      const name = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', TANGENT: 'tangent' }[semantic];
      if (name) geometry.setAttribute(name, new THREE.BufferAttribute(data, attribute.num_components()));
      module.destroy(values);
    }
    const indices = [], face = new module.DracoInt32Array();
    for (let i = 0; i < decoded.num_faces(); i++) {
      decoder.GetFaceFromMesh(decoded, i, face);
      for (let k = 0; k < 3; k++) indices.push(face.GetValue(k));
    }
    geometry.setIndex(indices);
    for (const v of [face, decoded, decoder, buffer]) module.destroy(v);
    return { geometry, material: materials[primitive.material] };
  }));
  const nodes = asset.nodes.map(node => {
    const parts = node.mesh === undefined ? [] : meshes[node.mesh];
    const object = parts.length === 1
      ? new THREE.Mesh(parts[0].geometry, parts[0].material) : new THREE.Group();
    if (parts.length > 1) parts.forEach((part, i) => {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.name = `${node.name}_${i}`;
      object.add(mesh);
    });
    object.name = THREE.PropertyBinding.sanitizeNodeName(node.name ?? '');
    if (node.matrix) object.applyMatrix4(new THREE.Matrix4().fromArray(node.matrix));
    else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    return object;
  });
  asset.nodes.forEach((node, i) => (node.children ?? []).forEach(j => nodes[i].add(nodes[j])));
  const root = new THREE.Group();
  asset.scenes[asset.scene ?? 0].nodes.forEach(i => root.add(nodes[i]));
  return root;
}
