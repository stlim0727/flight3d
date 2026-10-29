import * as THREE from 'three';
import { receiverKey, sunWeights, solveFloodOutputs, TRANSFER_COLUMNS,
  TRANSFER_VERSION } from './CockpitTransferModel.js';

export class CockpitLightTransfer {
  constructor(manifest, coefficients) {
    if (manifest.version !== TRANSFER_VERSION || manifest.columns !== TRANSFER_COLUMNS ||
        !manifest.keys?.length || !manifest.controls?.length ||
        coefficients.length !== manifest.keys.length * TRANSFER_COLUMNS ||
        !coefficients.every(v => Number.isFinite(v) && v >= -1e-6)) {
      throw Error('Invalid cockpit light-transfer bake');
    }
    this.manifest = manifest;
    this.coefficients = coefficients;
    this.lookup = new Map(manifest.keys.map((key, i) => [key, i]));
    this.width = 256;
    this.height = Math.ceil((manifest.keys.length + 1) / this.width);
    this.pixels = new Float32Array(this.width * this.height * 4);
    // Hemispherical accessibility is an approximation for rough environment
    // reflections, separate from the solved diffuse irradiance in RGB.
    for (let i = 0; i < manifest.keys.length; i++) this.pixels[i * 4 + 3] = Math.max(0, Math.min(1, coefficients[i * TRANSFER_COLUMNS]));
    this.texture = new THREE.DataTexture(this.pixels, this.width, this.height,
      THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.uniforms = { deckTransfer: { value: this.texture } };
    this.outputs = manifest.floodMaximum.slice();
    this.daylight = new Float32Array(manifest.keys.length * 3);
    this.floodLuma = manifest.floodColors.map(c => c[0] * .2126 + c[1] * .7152 + c[2] * .0722);
    this.rows = manifest.controls.map(({ index }) => this.floodLuma.map((luma, j) =>
      coefficients[index * TRANSFER_COLUMNS + 1 + j] * luma));
  }

  static async load(variant) {
    const base = `${import.meta.env?.BASE_URL ?? '/'}lighting/cockpit-${variant}`;
    const [metadata, binary, bindingMetadata, bindingBinary] = await Promise.all([
      fetch(`${base}.json`), fetch(`${base}.bin`),
      fetch(`${base}-binding.json`), fetch(`${base}-binding.uvpack`),
    ]);
    if (![metadata, binary, bindingMetadata, bindingBinary].every(response => response.ok)) {
      throw Error('Cockpit light-transfer files unavailable');
    }
    const [manifest, bytes, binding, compressed] = await Promise.all([
      metadata.json(), binary.arrayBuffer(), bindingMetadata.json(), bindingBinary.arrayBuffer(),
    ]);
    const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
      b => b.toString(16).padStart(2, '0')).join('');
    if (await hash(bytes) !== manifest.dataHash || await hash(compressed) !== binding.dataHash ||
        binding.transferHash !== manifest.dataHash || binding.assetHash !== manifest.assetHash) {
      throw Error('Cockpit light-transfer checksum mismatch');
    }
    const decoded = await new Response(new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const transfer = new CockpitLightTransfer(manifest, new Float32Array(bytes));
    transfer.binding = binding;
    transfer.bindingUV = new Float32Array(decoded);
    return transfer;
  }

  /** Attach offline attributes to the final batched geometry, in neutral pose. */
  bindPrecomputed(group) {
    const meshes = [];
    group.traverse(mesh => {
      if (this.isReceiver(mesh)) meshes.push(mesh);
    });
    const binding = this.binding, uv = this.bindingUV;
    if (binding?.version !== 1 || binding.coverage !== 1 || !meshes.length ||
        binding.meshes?.length !== meshes.length || uv?.length !== binding.values) {
      throw Error('Invalid cockpit vertex binding');
    }
    let offset = 0;
    // Validate the complete layout before changing any geometry.
    meshes.forEach((mesh, i) => {
      const count = mesh.geometry.attributes.position.count;
      if (binding.meshes[i].name !== mesh.name || binding.meshes[i].count !== count) {
        throw Error('Cockpit vertex binding/geometry mismatch');
      }
      offset += count * 4;
    });
    if (offset !== uv.length || !uv.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw Error('Invalid cockpit vertex UV data');
    }
    offset = 0;
    meshes.forEach(mesh => {
      const end = offset + mesh.geometry.attributes.position.count * 4;
      const geometry = mesh.geometry.clone();
      geometry.setAttribute('deckTransferUV', new THREE.BufferAttribute(uv.subarray(offset, end), 4));
      mesh.geometry = geometry;
      offset = end;
    });
    this.coverage = binding.coverage;
  }

  isReceiver(mesh) {
    return mesh.isMesh && mesh.material.isMeshStandardMaterial && !mesh.material.transparent &&
      !(mesh.userData.cockpitApertureShadow && mesh.name.endsWith('_SideWindowShadow'));
  }

  bind(group) {
    group.updateWorldMatrix(true, true);
    const inverse = group.matrixWorld.clone().invert();
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    let matched = 0, vertices = 0;
    group.traverse(mesh => {
      if (!this.isReceiver(mesh)) return;
      const geometry = mesh.geometry.clone();
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(transform);
      const uvs = [];
      for (let i = 0; i < geometry.attributes.position.count; i++) {
        p.fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(transform);
        n.fromBufferAttribute(geometry.attributes.normal, i).applyNormalMatrix(normalMatrix);
        const front = this.lookup.get(receiverKey(p, n));
        const back = this.lookup.get(receiverKey(p, n.clone().negate())) ?? front;
        vertices++;
        if (front !== undefined) matched++;
        for (const id of [front, back]) {
          const index = id ?? this.manifest.keys.length; // Black sentinel for an unbaked vertex.
          uvs.push((index % this.width + .5) / this.width, (Math.floor(index / this.width) + .5) / this.height);
        }
      }
      geometry.setAttribute('deckTransferUV', new THREE.Float32BufferAttribute(uvs, 4));
      mesh.geometry = geometry;
    });
    this.coverage = vertices ? matched / vertices : 0;
    if (this.coverage < .98) throw Error(`Cockpit bake/geometry mismatch (${this.coverage})`);
  }

  update({ ambientColor, ambientIntensity, sunColor, sunIntensity, sunDirection, dt = 0 }) {
    const signature = [...ambientColor.toArray(), ambientIntensity, ...sunColor.toArray(),
      sunIntensity, ...sunDirection.toArray()].map(v => Math.round(v * 1000)).join(',');
    const changed = signature !== this.signature;
    const settled = this.targets && this.outputs.every((v, j) => Math.abs(v - this.targets[j]) < 1e-4);
    if (!changed && settled) return;
    this.signature = signature;
    const daylight = this.daylight;
    const coefficients = this.coefficients, count = this.manifest.keys.length;
    if (changed) {
      const weights = sunWeights(sunDirection);
      const weightedSun = new Float64Array(weights.length);
      for (let j = 0; j < weights.length; j++) weightedSun[j] = weights[j][1] * sunIntensity;
      for (let i = 0; i < count; i++) {
        const base = i * TRANSFER_COLUMNS;
        const sky = coefficients[base] * ambientIntensity / Math.PI;
        let bounce = 0;
        // Keep the hot matrix product allocation-free; destructuring per receiver
        // otherwise creates hundreds of thousands of iterators during a bank.
        for (let j = 0; j < weightedSun.length; j++) bounce += coefficients[base + 4 + j] * weightedSun[j];
        daylight[i * 3] = sky * ambientColor.r + bounce * sunColor.r;
        daylight[i * 3 + 1] = sky * ambientColor.g + bounce * sunColor.g;
        daylight[i * 3 + 2] = sky * ambientColor.b + bounce * sunColor.b;
      }
      const sunLuma = sunColor.r * .2126 + sunColor.g * .7152 + sunColor.b * .0722;
      const received = this.manifest.controls.map(({ index, sun }) =>
        daylight[index * 3] * .2126 + daylight[index * 3 + 1] * .7152 + daylight[index * 3 + 2] * .0722 +
        weights.reduce((s, [j, w]) => s + sun[j] * w, 0) * sunIntensity * sunLuma);
      this.targets = solveFloodOutputs(this.rows, received, this.manifest.floodMaximum);
    }
    const blend = 1 - Math.exp(-Math.max(0, dt) / .3);
    this.outputs = this.outputs.map((v, j) => v + (this.targets[j] - v) * blend);
    const colors = this.manifest.floodColors, outputs = this.outputs;
    const red = colors.map((c, j) => c[0] * outputs[j]);
    const green = colors.map((c, j) => c[1] * outputs[j]);
    const blue = colors.map((c, j) => c[2] * outputs[j]);
    for (let i = 0; i < count; i++) {
      const base = i * TRANSFER_COLUMNS;
      let r = daylight[i * 3], g = daylight[i * 3 + 1], b = daylight[i * 3 + 2];
      for (let j = 0; j < 3; j++) {
        const coefficient = coefficients[base + 1 + j];
        r += coefficient * red[j]; g += coefficient * green[j]; b += coefficient * blue[j];
      }
      this.pixels[i * 4] = Math.max(0, r);
      this.pixels[i * 4 + 1] = Math.max(0, g);
      this.pixels[i * 4 + 2] = Math.max(0, b);
    }
    this.texture.needsUpdate = true;
  }

  dispose() { this.texture.dispose(); }
}
