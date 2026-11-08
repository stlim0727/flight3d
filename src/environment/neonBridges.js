import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NEON_RIVER, RAMP, bridgeRamps, bridgeSolids, rampSegments, riverCenter } from '../config/neonRiver.js';
import { applyLogDepthOffset } from './RunwayMarkings.js';

// Procedural Neon Metropolis bridges (#551) built from the same bridgeSolids() boxes
// BridgeCollision and the city collision use. Railings, ramps and tubes (arch ribs and
// cables) are drawn inside their boxes. Members are merged into one mesh per material,
// so a bridge costs a handful of draw calls.

const box = (center, size) => new THREE.BoxGeometry(...size).translate(...center);

// A box over [x0, x1] x [z0, z1] whose bottom and top run linearly from [b0, t0] at x0
// to [b1, t1] at x1: a stretch of sloped ramp.
function prism(x0, x1, z0, z1, [b0, t0], [b1, t1]) {
  if (x1 < x0) [x0, x1, b0, t0, b1, t1] = [x1, x0, b1, t1, b0, t0];
  const geometry = new THREE.BoxGeometry(1, 1, 1), position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const far = position.getX(i) > 0, high = position.getY(i) > 0;
    position.setXYZ(i, far ? x1 : x0, far ? (high ? t1 : b1) : (high ? t0 : b0), position.getZ(i) > 0 ? z1 : z0);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Open railing (curb, mid and top rails, posts) kept inside the rail collision box.
function railing({ center: [, cy, cz], size: [length, height, width] }) {
  const base = cy - height / 2, parts = [
    box([0, base + 0.15, cz], [length, 0.3, width]),
    box([0, base + height * 0.55, cz], [length, 0.1, width * 0.5]),
    box([0, base + height - 0.08, cz], [length, 0.16, width]),
  ];
  for (let x = -length / 2 + 0.1; x < length / 2; x += 3) parts.push(box([x, cy, cz], [0.15, height, width * 0.5]));
  return parts;
}

// A cylinder of radius r from a to b, which stays inside the box that pads a-b by r.
function tube({ a, b, r }) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), length = from.distanceTo(to);
  const geometry = new THREE.CylinderGeometry(r, r, length, 8, 1);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
  return geometry.translate(...from.add(to).multiplyScalar(0.5).toArray());
}

export function createBridgeMaterials() {
  return {
    concrete: new THREE.MeshStandardMaterial({ color: 0x2a2838, roughness: 0.85 }),
    road: applyLogDepthOffset(new THREE.MeshStandardMaterial({ color: 0x14121c, roughness: 0.9 }), 2),
    light: new THREE.MeshBasicMaterial({ color: 0xffd28a }),
  };
}

export function createBridge(bridge, materials, river = NEON_RIVER) {
  const steel = new THREE.MeshStandardMaterial({ color: bridge.color, roughness: 0.45, metalness: 0.5, emissive: bridge.glow, emissiveIntensity: 0.35 });
  const neon = new THREE.MeshBasicMaterial({ color: bridge.glow });
  const buckets = { steel: [], concrete: [], road: [], light: [], neon: [] };

  for (const solid of bridgeSolids(bridge, river)) {
    if (solid.part === 'rail') buckets.steel.push(...railing(solid));
    else if (solid.tube) buckets[solid.material].push(tube(solid.tube));
    else if (solid.render !== false) buckets[solid.material ?? 'steel'].push(box(solid.center, solid.size));
  }
  // Road surface on the deck, and the ramps' embankment, road and parapets per segment.
  const half = bridge.width / 2;
  buckets.road.push(box([0, bridge.top + 0.03, 0], [2 * (river.halfWidth + 12), 0.05, bridge.width - 2]));
  for (const ramp of bridgeRamps(bridge, river)) {
    for (const s of rampSegments(ramp)) {
      buckets.concrete.push(prism(s.x0, s.x1, -half, half, [-0.5, s.top0], [-0.5, s.top1]));
      buckets.road.push(prism(s.x0, s.x1, -half + 1, half - 1, [s.top0 + 0.005, s.top0 + 0.055], [s.top1 + 0.005, s.top1 + 0.055]));
      for (const edge of [-1, 1]) {
        const inner = edge * (half - 0.4), outer = edge * half;
        buckets.concrete.push(prism(s.x0, s.x1, Math.min(inner, outer), Math.max(inner, outer), [s.top0, s.top0 + RAMP.parapet], [s.top1, s.top1 + RAMP.parapet]));
      }
    }
  }

  const group = new THREE.Group();
  group.name = `Neon bridge ${bridge.id}`;
  group.position.set(riverCenter(bridge.z, river), 0, bridge.z);
  for (const [name, geometries] of Object.entries(buckets)) {
    if (!geometries.length) continue;
    const material = name === 'steel' ? steel : name === 'neon' ? neon : materials[name];
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    for (const geometry of geometries) geometry.dispose();
    mesh.name = `${bridge.id} ${name}`;
    mesh.castShadow = name === 'steel' || name === 'concrete';
    mesh.receiveShadow = name !== 'light' && name !== 'neon';
    group.add(mesh);
  }
  return group;
}
