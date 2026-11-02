import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRIDGE_ARCH, BRIDGE_PIER_X, archCentre, bridgeSolids } from '../config/hangangCourse.js';

// Procedural bridge built from the same bridgeSolids() boxes HangangCollision uses.
// The arch is the exception: its boxes bound a tube drawn through the same rings.
// Members are merged into one mesh per material, so a bridge costs a handful of draw
// calls instead of one per member.

const box = (center, size) => new THREE.BoxGeometry(...size).translate(...center);

// Open railing (curb, posts, mid and top rails) kept inside the rail collision box.
function railing({ center: [, cy, cz], size: [length, height, width] }) {
  const base = cy - height / 2, parts = [
    box([0, base + 0.2, cz], [length, 0.4, width]),
    box([0, base + height * 0.55, cz], [length, 0.12, width * 0.5]),
    box([0, base + height - 0.1, cz], [length, 0.2, width]),
  ];
  for (let x = -length / 2 + 0.1; x < length / 2; x += 3) parts.push(box([x, cy, cz], [0.2, height, width * 0.5]));
  return parts;
}

class ArchCurve extends THREE.Curve {
  constructor(z) { super(); this.z = z; }
  getPoint(t, target = new THREE.Vector3()) { const [x, y] = archCentre(t); return target.set(x, y, this.z); }
  // TubeGeometry places rings by arc length; keep them at archCentre(i / segments),
  // the ends of the collision boxes' chords.
  getPointAt(u, target) { return this.getPoint(u, target); }
  getTangentAt(u, target) { return this.getTangent(u, target); }
}

export function createBridgeMaterials() {
  return {
    concrete: new THREE.MeshStandardMaterial({ color: 0x586066, roughness: 0.85 }),
    road: new THREE.MeshStandardMaterial({ color: 0x1f2428, roughness: 0.9 }),
    light: new THREE.MeshBasicMaterial({ color: 0xffb35a }),
    marker: new THREE.MeshStandardMaterial({ color: 0xffd044, emissive: 0xff9900, emissiveIntensity: 0.9 }),
  };
}

export function createBridge(bridge, materials) {
  const isArch = bridge.style === 'arch', isTower = bridge.style === 'tower';
  // Steel superstructure with emissive night glow
  const steel = new THREE.MeshStandardMaterial({
    color: bridge.color, roughness: 0.5, metalness: 0.45,
    emissive: isArch ? 0xcc3300 : isTower ? 0x0055bb : 0x223344, emissiveIntensity: 0.45,
  });
  const buckets = { steel: [], concrete: [], road: [], light: [], marker: [] };

  for (const solid of bridgeSolids(bridge)) {
    if (solid.render === false) continue;
    if (solid.part === 'rail') buckets.steel.push(...railing(solid));
    else buckets[solid.material ?? (solid.part === 'pier' ? 'concrete' : 'steel')].push(box(solid.center, solid.size));
  }

  // Road deck surface
  buckets.road.push(box([0, 40.03, 0], [1200, 0.05, 19]));

  // Upward floodlights at the foot of each pier's upstream and downstream faces
  for (const px of BRIDGE_PIER_X) for (const pz of [-7.6, 7.6]) buckets.light.push(box([px, 0.6, pz], [3, 1, 1]));

  // Above-deck arches (Central bridge), one tube segment per arch collision box.
  if (isArch) {
    for (const z of BRIDGE_ARCH.z) buckets.steel.push(new THREE.TubeGeometry(new ArchCurve(z), BRIDGE_ARCH.segments, BRIDGE_ARCH.radius, 8, false));
  }

  // Navigation clearance markers on the gate pier caps' approach faces. They have no
  // collision proxy, so they must stay outside the 100 x 34 m opening.
  for (const x of [-52, 52]) buckets.marker.push(box([x, 32.5, 10.7], [2, 2.4, 0.4]));

  const group = new THREE.Group();
  group.name = `Hangang bridge ${bridge.id}`;
  group.position.set(bridge.x, 0, bridge.z);
  group.rotation.y = bridge.yaw;
  for (const [name, geometries] of Object.entries(buckets)) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), name === 'steel' ? steel : materials[name]);
    for (const geometry of geometries) geometry.dispose();
    mesh.name = `${bridge.id} ${name}`;
    mesh.castShadow = name === 'steel' || name === 'concrete';
    mesh.receiveShadow = name !== 'light';
    group.add(mesh);
  }
  return group;
}
