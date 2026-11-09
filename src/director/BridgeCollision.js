import * as THREE from 'three';
import { NEON_ISLAND, NEON_RIVER, bridgeSolids, bridgeToWorld, isLand, islandShore, riverCenter, riverHalfWidth } from '../config/neonRiver.js';

// Conservative part envelopes in the C172 model frame. Covers fixed landing gear.
// These deliberately have a small safety margin; not triangle-exact contact.
const parts = [
  ['fuselage', [-0.65, -0.55, -2.9], [0.65, 1.1, 4.6]],
  ['wing', [-5.8, 0.70, -1.3], [5.8, 1.15, 1]],
  ['tail', [-2.1, 0.3, 3.1], [2.1, 0.85, 4.6]],
  ['fin', [-0.3, 0.5, 3], [0.3, 2.4, 4.6]],
  ['gear', [-1.3, -1.65, -1.8], [1.3, -0.3, 1]],
].map(([name, min, max]) => {
  const box = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
  return { name, box, center: box.getCenter(new THREE.Vector3()), half: box.getSize(new THREE.Vector3()).multiplyScalar(0.5) };
});
const PAD = 0.15;

// Separating-axis test of an oriented box against an axis-aligned box given by its min
// and max corners. The oriented box is { c: centre, h: half extents, r: rotation with
// r[i][j] = world axis i . box axis j, abs: |r| plus a small epsilon }.
function obbHitsBox(obb, min, max) {
  const a = [(max.x - min.x) / 2, (max.y - min.y) / 2, (max.z - min.z) / 2];
  const t = [obb.c.x - (min.x + max.x) / 2, obb.c.y - (min.y + max.y) / 2, obb.c.z - (min.z + max.z) / 2];
  const { h } = obb, R = obb.r, A = obb.abs;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(t[i]) > a[i] + h[0] * A[i][0] + h[1] * A[i][1] + h[2] * A[i][2]) return false;
  }
  for (let j = 0; j < 3; j++) {
    const tj = t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j];
    if (Math.abs(tj) > a[0] * A[0][j] + a[1] * A[1][j] + a[2] * A[2][j] + h[j]) return false;
  }
  for (let i = 0; i < 3; i++) {
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3;
    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3, j2 = (j + 2) % 3;
      const ra = a[i1] * A[i2][j] + a[i2] * A[i1][j], rb = h[j1] * A[i][j2] + h[j2] * A[i][j1];
      if (Math.abs(t[i2] * R[i1][j] - t[i1] * R[i2][j]) > ra + rb) return false;
    }
  }
  return true;
}

// Swept contact of the C172 with the canal for the bridge flight (#551): the three
// bridges (lamps, arch ribs, hangers and cables included), the water and the quay walls
// of the canal and the island's shore (#628).
// The towers are left to CollisionDetector. Free flight: no course, gates or flight
// envelope are judged here (#391).
export class BridgeCollision {
  constructor(river = NEON_RIVER, island = NEON_ISLAND) {
    if (river.bridges.some(b => !Number.isFinite(b.z))) throw new Error('Invalid Neon river');
    this.river = river; this.island = island;
    this.bridges = river.bridges.map(b => {
      const [x, z] = bridgeToWorld(b, 0, 0, river);
      const solids = bridgeSolids(b, river).map(s => ({ ...s,
        box: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...s.center), new THREE.Vector3(...s.size)) }));
      // Conservative broadphase: the widest solid along the river plus the aircraft's reach.
      const reach = Math.max(...solids.map(s => Math.max(-s.box.min.z, s.box.max.z))) + 10;
      return { id: b.id, inverse: new THREE.Matrix4().makeTranslation(-x, 0, -z), solids, reach };
    });
    this.matrix = new THREE.Matrix4(); this.localMatrix = new THREE.Matrix4();
    this.p = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.unit = new THREE.Vector3(1, 1, 1);
    this.box = new THREE.Box3(); this.local = new THREE.Vector3(); this.broad = new THREE.Box3(); this.reachBox = new THREE.Box3();
    this.bankMin = new THREE.Vector3(); this.bankMax = new THREE.Vector3();
    this.obb = { c: new THREE.Vector3(), h: [0, 0, 0], r: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], abs: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] };
    this.reset();
  }
  reset() { this.contact = null; this.previous = null; }
  // Sets this.obb to `part` posed by `matrix` (unit scale), padded like the part AABBs,
  // and returns its world AABB.
  orient(part, matrix) {
    const obb = this.obb, e = matrix.elements, target = this.reachBox;
    obb.c.copy(part.center).applyMatrix4(matrix);
    for (let j = 0; j < 3; j++) {
      obb.h[j] = part.half.getComponent(j) + PAD;
      for (let i = 0; i < 3; i++) { obb.r[i][j] = e[4 * j + i]; obb.abs[i][j] = Math.abs(e[4 * j + i]) + 1e-9; }
    }
    for (let i = 0; i < 3; i++) {
      const reach = obb.h[0] * obb.abs[i][0] + obb.h[1] * obb.abs[i][1] + obb.h[2] * obb.abs[i][2], c = obb.c.getComponent(i);
      target.min.setComponent(i, c - reach); target.max.setComponent(i, c + reach);
    }
    return target;
  }
  // The ground or wall the posed part touches: the water below it, or the land, which is
  // solid from far below up to the street (y = 0): the island on either side of the canal,
  // up to its north and south shores, and the runway causeway. The walls are taken as
  // straight along Z at the part's position.
  groundHit(reach) {
    const r = this.river, island = this.island, { x, z } = this.obb.c;
    if (reach.min.y > 0) return null;
    if (reach.min.y <= r.waterLevel && !isLand(x, z, r, island)) return 'water';
    const at = Math.max(-island.halfZ, Math.min(island.halfZ, z)), c = riverCenter(at, r), half = riverHalfWidth(at, r, island);
    const z0 = Math.max(reach.min.z - 1, -island.halfZ), z1 = Math.min(reach.max.z + 1, island.halfZ);
    const { causeway } = island;
    const land = [[islandShore(at, -1, island), c - half, z0, z1], [c + half, islandShore(at, 1, island), z0, z1],
      [causeway.west, island.west, -causeway.halfWidth, causeway.halfWidth]];
    for (const [x0, x1, za, zb] of land) {
      if (za > zb) continue;
      this.bankMin.set(x0, r.waterLevel - 100, za);
      this.bankMax.set(x1, 0, zb);
      if (obbHitsBox(this.obb, this.bankMin, this.bankMax)) return 'wall';
    }
    return null;
  }
  // Returns the first contact, then keeps it until reset().
  update(position, quaternion) {
    if (this.contact) return this.contact;
    // Malformed samples are skipped; the next valid one is tested on its own.
    if (![...position.toArray(), ...quaternion.toArray()].every(Number.isFinite) ||
        Math.abs(quaternion.lengthSq() - 1) > 0.01) { this.previous = null; return null; }
    let previous = this.previous;
    // Subdivide both translation and rotation; padding covers between-sample motion.
    let count = previous ? Math.ceil(Math.max(1, previous.p.distanceTo(position) / 0.2, previous.q.angleTo(quaternion) / 0.015)) : 1;
    // A jump this large is a respawn or teleport, not flight; test only the new pose.
    if (count > 512) { previous = null; count = 1; }
    for (let sample = 1; sample <= count && !this.contact; sample++) {
      if (previous) { this.p.copy(previous.p).lerp(position, sample / count); this.q.copy(previous.q).slerp(quaternion, sample / count); }
      else { this.p.copy(position); this.q.copy(quaternion); }
      this.matrix.compose(this.p, this.q, this.unit);
      for (const part of parts) {
        const structure = this.groundHit(this.orient(part, this.matrix));
        if (structure) { this.contact = { aircraftPart: part.name, structure, position: this.p.toArray() }; break; }
      }
      for (let i = 0; i < this.bridges.length && !this.contact; i++) {
        const bridge = this.bridges[i];
        this.local.copy(this.p).applyMatrix4(bridge.inverse);
        if (Math.abs(this.local.z) > bridge.reach) continue;
        this.localMatrix.multiplyMatrices(bridge.inverse, this.matrix);
        // Narrow the bridge's solids to those near the whole aircraft, then test each
        // part against them in order.
        this.broad.makeEmpty();
        for (const part of parts) this.broad.union(this.box.copy(part.box).applyMatrix4(this.localMatrix));
        this.broad.expandByScalar(PAD);
        const near = bridge.solids.filter(s => s.box.intersectsBox(this.broad));
        for (let k = 0; k < parts.length && near.length; k++) {
          const part = parts[k];
          this.box.copy(part.box).applyMatrix4(this.localMatrix).expandByScalar(PAD);
          const hit = near.find(s => s.box.intersectsBox(this.box));
          if (hit) { this.contact = { bridge: bridge.id, aircraftPart: part.name, structure: hit.part, position: this.p.toArray() }; break; }
        }
      }
    }
    this.previous ??= { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.previous.p.copy(position); this.previous.q.copy(quaternion);
    return this.contact;
  }
}
