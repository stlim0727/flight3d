// Original exterior-only maritime assets. Regenerate with Node; no DCC or downloads.
import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mkdir, writeFile } from 'node:fs/promises';

const output = new URL('../public/models/ships/', import.meta.url);
await mkdir(output, { recursive: true });
const palette = [0x9c3038, 0x1b3645, 0xe5e6df, 0x273e48, 0xd99a38, 0x367e91, 0x41725c, 0x97a6aa];
const definitions = {
  cargo: [220, 34, 12, 6],
  cruise: [190, 30, 9, 5],
  tanker: [180, 28, 8, 5],
  speedboat: [22, 5, 1.2, 1]
};

function build(type, [length, width, deck, draft]) {
  const bins = palette.map(() => []);
  const add = (geo, material, x = 0, y = 0, z = 0) => {
    geo.translate(x, y, z);
    geo.deleteAttribute('uv');
    bins[material].push(geo.index ? geo.toNonIndexed() : geo);
  };
  const box = (m, x, y, z, w, h, l) => add(new T.BoxGeometry(w, h, l), m, x, y, z);
  const tube = (m, x, y, z, r, h, alongZ = false) => {
    const geo = new T.CylinderGeometry(r, r, h, 8);
    if (alongZ) geo.rotateX(Math.PI / 2);
    add(geo, m, x, y, z);
  };
  // Lofted chine hull: pointed raised bow, flared waterline, narrower keel,
  // transom stern. Only the exterior shell and weather deck are authored.
  const stations = [
    [-0.5, 0.015],
    [-0.45, 0.42],
    [-0.34, 0.86],
    [-0.2, 1],
    [0.29, 1],
    [0.44, 0.88],
    [0.5, 0.72]
  ];
  const vertices = [];
  for (const [z, w] of stations) {
    const rise = z < -0.34 ? (-z - 0.34) * deck * 0.65 : 0;
    vertices.push(
      [-w * width * 0.28, -draft, z * length],
      [-w * width * 0.5, 0, z * length],
      [-w * width * 0.5, deck + rise, z * length],
      [w * width * 0.5, deck + rise, z * length],
      [w * width * 0.5, 0, z * length],
      [w * width * 0.28, -draft, z * length]
    );
  }
  const points = [];
  const tri = (a, b, c) => points.push(...vertices[a], ...vertices[c], ...vertices[b]);
  for (let s = 0; s < stations.length - 1; s++)
    for (let j = 0; j < 6; j++) {
      const a = s * 6 + j,
        b = s * 6 + ((j + 1) % 6),
        c = b + 6,
        d = a + 6;
      tri(a, b, d);
      tri(b, c, d);
    }
  for (let j = 1; j < 5; j++) {
    tri(0, j + 1, j);
    const n = (stations.length - 1) * 6;
    tri(n, n + j, n + j + 1);
  }
  const hull = new T.BufferGeometry();
  hull.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  hull.computeVertexNormals();
  add(hull, type === 'cargo' ? 0 : type === 'tanker' ? 6 : type === 'speedboat' ? 5 : 1);
  box(3, 0, deck + 0.12, 0, width * 0.89, 0.24, length * 0.72);
  const windows = (y, z, w, l) => {
    for (const side of [-1, 1])
      for (let p = -l / 2; p < l / 2; p += type === 'speedboat' ? 1 : 4)
        box(
          1,
          side * (w / 2 + 0.025),
          y,
          z + p,
          0.08,
          type === 'speedboat' ? 0.6 : 1.25,
          type === 'speedboat' ? 0.65 : 2.4
        );
  };
  const rails = (y, z, w, l) => {
    for (const side of [-1, 1]) {
      box(7, (side * w) / 2, y + 1, z, 0.12, 0.12, l);
      for (let p = -l / 2; p <= l / 2; p += 6)
        box(7, (side * w) / 2, y + 0.5, z + p, 0.12, 1, 0.12);
    }
  };
  if (type === 'cargo') {
    for (let row = 0; row < 9; row++)
      for (let col = 0; col < 7; col++)
        for (let tier = 0; tier < 3 + ((row + col) % 2); tier++) {
          const m = [0, 4, 5, 6][(row * 7 + col * 3 + tier) % 4],
            x = (col - 3) * 3.6,
            y = deck + 1.6 + tier * 2.8,
            z = -67 + row * 13;
          box(m, x, y, z, 3.2, 2.6, 12);
          // Low-cost corrugation silhouette and container door locking bars.
          for (const side of [-1, 1])
            if (col === (side < 0 ? 0 : 6)) {
              for (let p = -5; p <= 5; p += 2) box(m, x + side * 1.63, y, z + p, 0.12, 2.5, 0.18);
            }
          if (row === 8) {
            box(7, x - 0.8, y, z + 6.04, 0.07, 2.4, 0.07);
            box(7, x + 0.8, y, z + 6.04, 0.07, 2.4, 0.07);
          }
        }
    box(2, 0, 23, 77, 24, 22, 23);
    box(2, 0, 32, 75, 34, 3, 9);
    windows(32, 75, 34, 9);
    tube(3, 0, 39, 77, 0.4, 14);
    box(7, 0, 44, 77, 10, 0.25, 0.25);
    box(0, 0, 34, 94, 6, 10, 6);
    box(1, 0, 39, 94, 6.2, 1, 6.2);
    rails(deck + 0.25, 0, 30, 155);
  } else if (type === 'cruise') {
    for (let d = 0; d < 6; d++) {
      const w = 27 - d * 0.65,
        l = 155 - d * 8,
        z = 3 + d * 2,
        y = deck + 1.7 + d * 3.4;
      box(2, 0, y, z, w, 3.4, l);
      windows(y, z, w, l - 6);
      rails(y + 1.7, z, w, l - 4);
    }
    for (const z of [-20, 17]) {
      box(2, 0, 30, z, 10, 1, 19);
      box(5, 0, 30.52, z, 8, 0.08, 16);
    }
    box(0, 0, 32, 48, 7, 10, 12);
    box(1, 0, 37.1, 48, 7.2, 0.4, 12.2);
    for (const side of [-1, 1])
      for (let z = -40; z <= 50; z += 18) {
        box(4, side * 14, 13, z, 2, 2.2, 9);
        box(2, side * 14, 14.2, z, 1.8, 0.4, 7);
      }
    tube(7, 0, 35, -52, 0.25, 9);
  } else if (type === 'tanker') {
    for (const x of [-5, 0, 5]) tube(7, x, deck + 1, -12, 0.42, 120, true);
    for (let z = -60; z < 45; z += 17) {
      tube(7, 0, deck + 1.2, z, 2.4, 1.5);
      box(4, 0, deck + 2.2, z, 5, 0.25, 0.25);
    }
    box(2, 0, 17, 65, 22, 18, 22);
    box(2, 0, 26, 62, 26, 3, 8);
    windows(26, 62, 26, 8);
    box(0, 0, 29, 73, 5, 8, 6);
    box(1, 0, 33.2, 73, 5.2, 0.6, 6.2);
    tube(7, 0, 32, 60, 0.25, 10);
    rails(deck + 0.25, -10, 25, 132);
  } else {
    box(2, 0, 1.4, 1, 4.3, 0.5, 14);
    const cabin = new T.BoxGeometry(3.3, 2, 6);
    cabin.rotateX(-0.08);
    add(cabin, 2, 0, 2.5, 1.3);
    windows(2.7, 1.3, 3.3, 5);
    box(1, 0, 2.9, -1.77, 3, 0.9, 0.12);
    box(2, 0, 3.65, 1.1, 3.7, 0.25, 6.5);
    box(4, 0, 1.8, 6.4, 2.6, 0.5, 2);
    box(7, 0, 0.9, 10, 3.5, 0.2, 2);
  }
  return bins
    .map((pieces, i) =>
      pieces.length ? { geometry: mergeVertices(mergeGeometries(pieces)), material: i } : null
    )
    .filter(Boolean);
}

// Minimal deterministic glTF 2 binary writer; vertex colors/textures unnecessary.
function glb(parts, type) {
  const chunks = [],
    views = [],
    accessors = [],
    meshes = [];
  let offset = 0;
  const attribute = (array, type) => {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const index = views.length;
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
      target: type === 'SCALAR' ? 34963 : 34962
    });
    chunks.push(bytes);
    offset += bytes.length;
    const a = {
      bufferView: index,
      componentType: type === 'SCALAR' ? 5125 : 5126,
      count: array.length / (type === 'SCALAR' ? 1 : 3),
      type
    };
    if (type === 'VEC3') {
      a.min = [Infinity, Infinity, Infinity];
      a.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < array.length; i++) {
        const k = i % 3;
        a.min[k] = Math.min(a.min[k], array[i]);
        a.max[k] = Math.max(a.max[k], array[i]);
      }
    }
    accessors.push(a);
    return accessors.length - 1;
  };
  for (const { geometry, material } of parts)
    meshes.push({
      name: `${type}-material-${material}`,
      primitives: [
        {
          attributes: {
            POSITION: attribute(geometry.attributes.position.array, 'VEC3'),
            NORMAL: attribute(geometry.attributes.normal.array, 'VEC3')
          },
          indices: attribute(new Uint32Array(geometry.index.array), 'SCALAR'),
          material
        }
      ]
    });
  const json = {
    asset: { version: '2.0', generator: 'Flight3d original ship builder' },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((_, i) => ({ mesh: i })),
    meshes,
    materials: palette.map((hex, i) => ({
      name: `ship-palette-${i}`,
      pbrMetallicRoughness: {
        baseColorFactor: [...new T.Color(hex).toArray(), 1],
        metallicFactor: i === 7 ? 0.5 : 0.05,
        roughnessFactor: i === 1 ? 0.3 : 0.72
      }
    })),
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors
  };
  let jsonBytes = Buffer.from(JSON.stringify(json));
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 32)]);
  const bin = Buffer.concat(chunks),
    header = Buffer.alloc(12),
    jh = Buffer.alloc(8),
    bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonBytes.length + bin.length, 8);
  jh.writeUInt32LE(jsonBytes.length);
  jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBytes, bh, bin]);
}

const manifest = {};
for (const [type, dimensions] of Object.entries(definitions)) {
  const parts = build(type, dimensions),
    bounds = new T.Box3();
  for (const { geometry } of parts) {
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox);
  }
  const bytes = glb(parts, type);
  await writeFile(new URL(`${type}.glb`, output), bytes);
  manifest[type] = {
    url: `models/ships/${type}.glb`,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    bytes: bytes.length,
    triangles: parts.reduce((s, p) => s + p.geometry.index.count / 3, 0),
    drawCalls: parts.length
  };
}
await writeFile(
  new URL('../src/environment/shipAssetManifest.json', import.meta.url),
  JSON.stringify(manifest, null, 2) + '\n'
);
console.log(manifest);
