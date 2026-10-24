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
    const [metadata, binary] = await Promise.all([fetch(`${base}.json`), fetch(`${base}.bin`)]);
    if (!metadata.ok || !binary.ok) throw Error('Cockpit light-transfer files unavailable');
    const manifest = await metadata.json(), bytes = await binary.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== manifest.dataHash) throw Error('Cockpit light-transfer checksum mismatch');
    return new CockpitLightTransfer(manifest, new Float32Array(bytes));
  }

  bind(group) {
    group.updateWorldMatrix(true, true);
    const inverse = group.matrixWorld.clone().invert();
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    let matched = 0, vertices = 0;
    group.traverse(mesh => {
      if (!mesh.isMesh || !mesh.material.isMeshStandardMaterial || mesh.material.transparent ||
          mesh.userData.cockpitApertureShadow && mesh.name.endsWith('_SideWindowShadow')) return;
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
