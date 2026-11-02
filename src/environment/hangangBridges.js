import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { APPROACH, approachSegments, archCentre, bridgeApproaches, bridgeOpening, bridgeSolids } from '../config/hangangCourse.js';

// Procedural bridge built from the same bridgeSolids() boxes HangangCollision uses.
// Arch ribs and approach ramps are the exception: their boxes bound a tube drawn through
// the same rings, and sloped slabs drawn over the same segments.
// Members are merged into one mesh per material, so a bridge costs a handful of draw
// calls instead of one per member.

const box = (center, size) => new THREE.BoxGeometry(...size).translate(...center);

// A box over [x0, x1] x [z0, z1] whose bottom and top run linearly from [b0, t0] at x0
// to [b1, t1] at x1: a stretch of sloped approach ramp.
function prism(x0, x1, z0, z1, [b0, t0], [b1, t1]) {
  if (x1 < x0) [x0, x1, b0, t0, b1, t1] = [x1, x0, b1, t1, b0, t0];
  const geometry = new THREE.BoxGeometry(1, 1, 1), position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const far = position.getX(i) > 0, top = position.getY(i) > 0;
    position.setXYZ(i, far ? x1 : x0, far ? (top ? t1 : b1) : (top ? t0 : b0), position.getZ(i) > 0 ? z1 : z0);
  }
  geometry.computeVertexNormals();
  return geometry;
}

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
  constructor(arch, deck, edge) { super(); Object.assign(this, { arch, deck, edge }); }
  getPoint(t, target = new THREE.Vector3()) { return target.set(...archCentre(this.arch, this.deck, this.edge, t)); }
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
  // Steel superstructure with emissive night glow
  const steel = new THREE.MeshStandardMaterial({
    color: bridge.color, roughness: 0.5, metalness: 0.45, emissive: bridge.glow, emissiveIntensity: 0.45,
  });
  const buckets = { steel: [], concrete: [], road: [], light: [], marker: [] };

  for (const solid of bridgeSolids(bridge)) {
    if (solid.render === false) continue;
    if (solid.part === 'rail') buckets.steel.push(...railing(solid));
    else buckets[solid.material ?? (solid.part === 'pier' ? 'concrete' : 'steel')].push(box(solid.center, solid.size));
  }

  for (const deck of bridge.decks) {
    // Road deck surface
    buckets.road.push(box([0, 40.03, deck.z], [bridge.length, 0.05, deck.width - 3]));
    // Upward floodlights at the foot of each pier's upstream and downstream faces
    for (const px of bridge.piers) for (const edge of [-1, 1]) buckets.light.push(box([px, 0.6, deck.z + edge * (deck.width / 2 - 3.4)], [3, 1, 1]));
    // Arch ribs, one tube segment per arch collision box.
    for (const arch of bridge.arches) {
      for (const edge of [-1, 1]) buckets.steel.push(new THREE.TubeGeometry(new ArchCurve(arch, deck, edge), arch.segments, arch.radius, 8, false));
    }
    // Approach ramps down to the bank (#429): a slab, road and parapet pair per collision
    // segment, so each stays inside its box.
    const half = deck.width / 2;
    for (const ramp of bridgeApproaches(bridge)) {
      for (const s of approachSegments(ramp)) {
        buckets.concrete.push(prism(s.x0, s.x1, deck.z - half, deck.z + half, [s.bottom0, s.top0], [s.bottom1, s.top1]));
        buckets.road.push(prism(s.x0, s.x1, deck.z - half + 1.5, deck.z + half - 1.5, [s.top0 + 0.005, s.top0 + 0.055], [s.top1 + 0.005, s.top1 + 0.055]));
        for (const edge of [-1, 1]) {
          const inner = deck.z + edge * (half - 0.4), outer = deck.z + edge * half;
          buckets.concrete.push(prism(s.x0, s.x1, Math.min(inner, outer), Math.max(inner, outer),
            [s.top0, s.top0 + APPROACH.parapet], [s.top1, s.top1 + APPROACH.parapet]));
        }
      }
    }
  }

  // Navigation clearance markers on the main span's pier caps, on the approach face of
  // the first deck the course meets. They have no collision proxy, so they must stay
  // outside the opening.
  const opening = bridgeOpening(bridge), approach = bridge.decks.at(-1);
  for (const x of [-1, 1]) buckets.marker.push(box([x * (opening.halfWidth + 2), 32.5, approach.z + approach.width / 2 - 0.3], [2, 2.4, 0.4]));

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
