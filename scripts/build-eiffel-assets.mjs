// Generate the dedicated Eiffel Tower GLB. Regenerate: node scripts/build-eiffel-assets.mjs
// Coordinates: ground centre at (0, 0, 0), +y up, total height 330 m including antenna.
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';

// GLTFExporter uses the browser FileReader API for its binary buffer.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); });
  }
};

const materials = {
  iron: new T.MeshStandardMaterial({ name: 'painted-iron', color: 0x766b60, metalness: .35, roughness: .68 }),
  deck: new T.MeshStandardMaterial({ name: 'observation-decks', color: 0x9a8e80, metalness: .25, roughness: .7 }),
  antenna: new T.MeshStandardMaterial({ name: 'antenna', color: 0xc0bdb6, metalness: .6, roughness: .4 }),
};
const kit = new T.Group();
kit.name = 'Flight3dEiffelTower';
let parts;
const up = new T.Vector3(0, 1, 0);

function add(geometry, material = 'iron') {
  (parts[material] ??= []).push(geometry);
}
/** Slender iron member between two points. */
function beam(a, b, radius, material = 'iron', segments = 6) {
  const from = new T.Vector3(...a), to = new T.Vector3(...b);
  const direction = to.clone().sub(from);
  const length = direction.length();
  if (length < 0.01) return;
  const geometry = new T.CylinderGeometry(radius, radius, length, segments);
  geometry.applyQuaternion(new T.Quaternion().setFromUnitVectors(up, direction.normalize()));
  geometry.translate(...from.clone().add(to).multiplyScalar(.5).toArray());
  add(geometry, material);
}
function box(width, height, depth, x, y, z, material = 'deck') {
  const geometry = new T.BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  add(geometry, material);
}
function cylinder(top, bottom, height, segments, y, material = 'iron') {
  const geometry = new T.CylinderGeometry(top, bottom, height, segments);
  geometry.translate(0, y, 0);
  add(geometry, material);
}

const tiers = [[0, 57], [57, 115], [115, 276], [276, 300]];
const halfWidth = y => y <= 57 ? 62 - 47 * (y / 57)
  : y <= 115 ? 15 - 5 * ((y - 57) / 58)
    : y <= 276 ? 10 - 5 * ((y - 115) / 161)
      : 5 - 2.5 * ((y - 276) / 24);
const corners = y => {
  const h = halfWidth(y);
  return [[h, h], [-h, h], [-h, -h], [h, -h]].map(([x, z]) => [x, y, z]);
};

function legs(detail) {
  for (const [base, top] of tiers) {
    const steps = detail === 'near' ? 5 : detail === 'mid' ? 3 : 2;
    for (const c of [0, 1, 2, 3]) {
      for (let step = 0; step < steps; step++) {
        const y0 = base + (top - base) * step / steps;
        const y1 = base + (top - base) * (step + 1) / steps;
        beam(corners(y0)[c], corners(y1)[c], detail === 'far' ? 2.2 : detail === 'mid' ? 1.6 : 1.1);
      }
    }
  }
}

function arch(detail) {
  const segments = detail === 'far' ? 6 : 10;
  for (let face = 0; face < 4; face++) {
    const a = corners(8)[face], b = corners(8)[(face + 1) % 4];
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const [ax, , az] = a, [bx, , bz] = b;
      points.push([ax * (1 - t) + bx * t, 8 + 24 * Math.sin(Math.PI * t), az * (1 - t) + bz * t]);
    }
    for (let i = 0; i < segments; i++) beam(points[i], points[i + 1], detail === 'far' ? 1.7 : 1.1);
  }
}

function bracing(detail) {
  for (const [base, top] of tiers) {
    for (let face = 0; face < 4; face++) {
      const next = (face + 1) % 4;
      const a0 = corners(base + 6)[face], b0 = corners(base + 6)[next];
      const a1 = corners(top - 6)[face], b1 = corners(top - 6)[next];
      beam(a0, b1, detail === 'mid' ? 1.05 : .55);
      beam(b0, a1, detail === 'mid' ? 1.05 : .55);
      if (detail === 'near') {
        const steps = Math.max(3, Math.round((top - base) / 14));
        for (let i = 0; i < steps; i++) {
          const y0 = base + 6 + (top - base - 12) * i / steps;
          const y1 = base + 6 + (top - base - 12) * (i + 1) / steps;
          if (i % 2 === 0) {
            beam(corners(y0)[face], corners(y1)[next], .34);
            beam(corners(y0)[next], corners(y1)[face], .34);
          }
          beam(corners(y0)[face], corners(y0)[next], .32);
        }
      }
    }
  }
}

function decks(detail) {
  for (const [y, width, thickness] of [[57, 74, 3.2], [115, 46, 2.8], [276, 22, 1.8], [300, 12, 1.4]]) {
    box(width, thickness, width, 0, y, 0);
    for (const x of [-width / 2, width / 2]) box(.45, thickness + 2.6, width, x, y + 1.3, 0, 'iron');
    for (const z of [-width / 2, width / 2]) box(width, thickness + 2.6, .45, 0, y + 1.3, z, 'iron');
    if (detail === 'near') {
      const count = Math.round(width / 5);
      for (let i = 0; i <= count; i++) {
        const t = -width / 2 + width * i / count;
        for (const edge of [-1, 1]) {
          box(.16, 1.4, .16, t, y + thickness / 2 + .7, edge * width / 2, 'iron');
          box(.16, 1.4, .16, edge * width / 2, y + thickness / 2 + .7, t, 'iron');
        }
      }
    }
  }
  cylinder(.35, .9, 30, 8, 315, 'antenna');
  if (detail !== 'far') {
    for (const y of [305, 313, 321, 328]) {
      const h = halfWidth(Math.min(y, 300));
      beam([h, y, 0], [-h, y, 0], .12, 'antenna', 4);
      beam([0, y, h], [0, y, -h], .12, 'antenna', 4);
    }
  }
}

function module(name, detail) {
  parts = {};
  legs(detail);
  arch(detail);
  if (detail !== 'far') bracing(detail);
  decks(detail);
  const group = new T.Group();
  group.name = name;
  for (const [material, geometries] of Object.entries(parts)) {
    const mesh = new T.Mesh(mergeGeometries(geometries), materials[material]);
    mesh.name = `${name}-${material}`;
    group.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
  kit.add(group);
  return group;
}

const levels = [module('EiffelFar', 'far'), module('EiffelMid', 'mid'), module('EiffelNear', 'near')];
for (const level of levels) {
  const bounds = new T.Box3().setFromObject(level);
  const size = bounds.getSize(new T.Vector3());
  if (bounds.max.y < 329 || bounds.max.y > 331 || bounds.min.y < -4
    || size.x < 115 || size.x > 135) {
    throw new Error(`${level.name} bounds unexpected: ${size.toArray().map(n => n.toFixed(1)).join(' × ')}`);
  }
}
const result = await new GLTFExporter().parseAsync(kit, { binary: true });
await mkdir('public/models/landmarks', { recursive: true });
await writeFile('public/models/landmarks/eiffel-tower.glb', Buffer.from(result));
console.log(`eiffel-tower.glb: ${result.byteLength} bytes, ${levels.length} LODs, 330 m tall`);
