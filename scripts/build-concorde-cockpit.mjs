// Extract the flight deck from Henry Chi's "Concorde free with interior"
// (CC BY 4.0) and fit it inside the shipped manilov.ap exterior.
//
// Regenerate:
//   1. Download the glTF (GLB) from
//      https://sketchfab.com/3d-models/concorde-free-with-interior-16bd3e8a17b345caace9449331709f2e
//   2. node scripts/build-concorde-cockpit.mjs <path/to/concorde_free_with_interior.glb>
//
// Output: public/models/concorde-cockpit.glb, one vertex-coloured mesh (one draw call).
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONCORDE_MODEL_MATRIX, CONCORDE_FUSELAGE_MESH } from '../src/aircraft/Concorde.js';

// GLTFExporter uses the browser FileReader API for its binary buffer.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); });
  }
};

export const COCKPIT_SOURCE = Object.freeze({
  title: 'Concorde free with interior',
  author: 'Henry Chi (https://sketchfab.com/henrychi)',
  source: 'https://sketchfab.com/3d-models/concorde-free-with-interior-16bd3e8a17b345caace9449331709f2e',
  license: 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)'
});

/**
 * Source frame: below its Sketchfab Z-up root the SketchUp model runs +X aft,
 * +Y up, +Z port in arbitrary units. Scale to the real 61.66 m length and put
 * its nose tip and symmetry plane on the exterior's aircraft frame.
 */
const SOURCE_SCALE = 61.66 / 855.54;
const SOURCE_MATRIX = new THREE.Matrix4().makeTranslation(2.58, -1.76, -9.99)
  .multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2))
  .multiply(new THREE.Matrix4().makeScale(SOURCE_SCALE, SOURCE_SCALE, SOURCE_SCALE));

/** Flight-deck region in the source after SOURCE_MATRIX (metres, aircraft frame). */
const DECK_REGION = new THREE.Box3(new THREE.Vector3(-1.8, -0.6, -23.9), new THREE.Vector3(1.4, 1.3, -18.6));
/** Exterior skin, livery, glass and wing materials stay with the source airframe. */
const SKIN_MATERIALS = new Set(['FrontColor', 'M_0102_RoyalBlue', 'Translucent_Glass_Gray', 'Translucent_Glass_Gold', 'Color_000']);
/** The carpet is the only textured material; use a neutral grey in place of the image. */
const CARPET_COLOUR = [0.36, 0.37, 0.39];

/**
 * The source deck is wider and sits further aft than the exterior's nose.
 * Centre it, narrow it 15%, raise it 0.15 m and move it 0.3 m forward. The
 * exterior windscreen starts right behind the nose hinge, whose upper skin
 * (y 0.65) the pilot must see over, so the deck sits high in the section.
 */
export const DECK_FIT = new THREE.Matrix4().makeTranslation(0, 0.15, -0.3)
  .multiply(new THREE.Matrix4().makeScale(0.85, 1, 1))
  .multiply(new THREE.Matrix4().makeTranslation(0.2, 0, 0));

function readGlb(path) {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binaryStart = 28 + jsonLength;
  const accessor = index => {
    const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
    const start = binaryStart + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (a.componentType === 5126) {
      const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const stride = (view.byteStride ?? size * 4) / 4;
      return Float32Array.from({ length: a.count * size }, (_, i) => bytes.readFloatLE(start + (Math.floor(i / size) * stride + i % size) * 4));
    }
    const width = a.componentType === 5125 ? 4 : 2;
    return Array.from({ length: a.count }, (_, i) => width === 4 ? bytes.readUInt32LE(start + i * 4) : bytes.readUInt16LE(start + i * 2));
  };
  return { gltf, accessor };
}

/** Yield every mesh primitive as a world-space geometry with its material. */
function* primitives(path, matrix, discardDisplayRoot) {
  const { gltf, accessor } = readGlb(path);
  const stack = gltf.scenes[gltf.scene ?? 0].nodes.map(index => ({ index, parent: new THREE.Matrix4(), root: true }));
  while (stack.length) {
    const { index, parent, root } = stack.pop();
    const node = gltf.nodes[index];
    const local = new THREE.Matrix4();
    if (!(root && discardDisplayRoot) && node.matrix) local.fromArray(node.matrix);
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(accessor(primitive.attributes.POSITION), 3));
        if (primitive.indices !== undefined) geometry.setIndex(accessor(primitive.indices));
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(matrix, world));
        yield { name: node.name, geometry, material: gltf.materials[primitive.material] ?? {} };
      }
    }
    for (const child of node.children ?? []) stack.push({ index: child, parent: world, root: false });
  }
}

/**
 * Interior envelope of the exterior fuselage: per 0.25 m station, the skin's
 * half-width and vertical extent, read as an ellipse. A deck vertex must lie
 * `margin` metres inside it so nothing pokes through the exterior.
 */
export function fuselageEnvelope(exteriorPath, margin = 0.06) {
  let skin;
  for (const part of primitives(exteriorPath, CONCORDE_MODEL_MATRIX, true)) {
    if (part.name === CONCORDE_FUSELAGE_MESH) skin = part.geometry;
  }
  const stations = new Map();
  const position = skin.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const key = Math.round(position.getZ(i) / 0.25);
    const s = stations.get(key) ?? { halfWidth: 0, minY: Infinity, maxY: -Infinity };
    s.halfWidth = Math.max(s.halfWidth, Math.abs(position.getX(i)));
    s.minY = Math.min(s.minY, position.getY(i));
    s.maxY = Math.max(s.maxY, position.getY(i));
    stations.set(key, s);
  }
  const at = z => {
    const key = Math.round(z / 0.25);
    // Stations without vertices borrow the tighter neighbour.
    for (let d = 0; d < 6; d++) {
      const options = [stations.get(key - d), stations.get(key + d)].filter(Boolean);
      if (options.length) return options.reduce((a, b) => (a.halfWidth < b.halfWidth ? a : b));
    }
    return null;
  };
  const ellipse = z => {
    const s = at(z);
    return s && { a: s.halfWidth - margin, b: (s.maxY - s.minY) / 2 - margin, cy: (s.maxY + s.minY) / 2 };
  };
  return {
    ellipse,
    contains(point) {
      const e = ellipse(point.z);
      return Boolean(e) && e.a > 0 && e.b > 0 && (point.x / e.a) ** 2 + ((point.y - e.cy) / e.b) ** 2 <= 1;
    }
  };
}

/** Glareshield height: the bulkhead closes the section below it (aircraft metres). */
export const WINDSCREEN_SILL_Y = 0.55;
/** Forward bulkhead under the glareshield; hides the empty nose structure below the windows. */
export const FORWARD_BULKHEAD_Z = -23.3;
const BULKHEAD_COLOUR = [0.16, 0.17, 0.19];

/** Fill the fuselage section at `z` below `sillY` with a flat wall facing aft. */
export function bulkheadTriangles(envelope, z = FORWARD_BULKHEAD_Z, sillY = WINDSCREEN_SILL_Y, segments = 48) {
  const { a, b, cy } = envelope.ellipse(z);
  const outline = [];
  for (let i = 0; i <= segments; i++) {
    const angle = Math.PI + (i / segments) * Math.PI * 2; // start on the port side, sweep under the floor
    const x = a * Math.cos(angle), y = cy + b * Math.sin(angle);
    if (y <= sillY) outline.push([x, y]);
  }
  const triangles = [];
  const centre = [0, (cy - b + sillY) / 2];
  const ring = [...outline, outline[0]];
  for (let i = 0; i < ring.length - 1; i++) {
    triangles.push([...centre, z], [...ring[i], z], [...ring[i + 1], z]);
  }
  return triangles;
}

export function buildCockpitGeometry(sourcePath, exteriorPath) {
  const envelope = fuselageEnvelope(exteriorPath);
  const positions = [], colours = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), centroid = new THREE.Vector3();
  for (const part of primitives(sourcePath, SOURCE_MATRIX, false)) {
    if (SKIN_MATERIALS.has(part.material.name)) continue;
    const colour = part.material.pbrMetallicRoughness?.baseColorTexture
      ? CARPET_COLOUR
      : (part.material.pbrMetallicRoughness?.baseColorFactor ?? [0.8, 0.8, 0.8]).slice(0, 3);
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i += 3) {
      a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
      centroid.copy(a).add(b).add(c).divideScalar(3);
      if (!DECK_REGION.containsPoint(centroid)) continue;
      for (const v of [a, b, c]) v.applyMatrix4(DECK_FIT);
      if (![a, b, c].every(v => envelope.contains(v))) continue;
      positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      for (let k = 0; k < 3; k++) colours.push(...colour);
    }
  }
  for (const vertex of bulkheadTriangles(envelope)) {
    positions.push(...vertex);
    colours.push(...BULKHEAD_COLOUR);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  // Flat-shaded at runtime: no normals to ship, and shared corners collapse into an index.
  const indexed = mergeVertices(geometry, 1e-4);
  indexed.computeBoundingBox();
  return indexed;
}

async function main([sourcePath, outputPath = 'public/models/concorde-cockpit.glb']) {
  if (!sourcePath) throw new Error('usage: node scripts/build-concorde-cockpit.mjs <concorde_free_with_interior.glb> [output.glb]');
  const geometry = buildCockpitGeometry(sourcePath, 'public/models/concorde.glb');
  const material = new THREE.MeshStandardMaterial({ name: 'Concorde-flight-deck', vertexColors: true, roughness: 0.82, metalness: 0.05, side: THREE.DoubleSide, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ConcordeFlightDeck';
  const scene = new THREE.Scene();
  scene.name = 'ConcordeFlightDeck';
  scene.userData = { ...COCKPIT_SOURCE, note: 'Flight deck extracted, recoloured and fitted inside the manilov.ap exterior by Flight3d contributors.' };
  scene.add(mesh);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  await writeFile(outputPath, Buffer.from(glb));
  console.log(`${outputPath}: ${geometry.index.count / 3} triangles, ${geometry.attributes.position.count} vertices, ${glb.byteLength} bytes`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build-concorde-cockpit.mjs')) {
  await main(process.argv.slice(2));
}
