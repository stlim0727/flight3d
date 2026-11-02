import * as THREE from 'three';
import { HANGANG_COURSE, bridgeSolids, hangangHeight } from '../config/hangangCourse.js';

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

// Solid contact with the Han River bridges (deck lamps and arches included), Nodeulseom,
// its pavilion, banks and water.
// Free flight: no course, gates or flight envelope are judged here (#391).
export class HangangCollision {
  constructor(course = HANGANG_COURSE) {
    if (course.bridges.some(b => ![b.x, b.z, b.yaw].every(Number.isFinite))) throw new Error('Invalid Hangang course');
    this.course = course;
    this.bridges = course.bridges.map(b => {
      const transform = new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0, b.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw), new THREE.Vector3(1, 1, 1));
      const solids = bridgeSolids(b).map(s => ({ ...s,
        box: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...s.center), new THREE.Vector3(...s.size)) }));
      // Conservative broadphase: the widest solid plus the aircraft's furthest extremity.
      const reach = Math.max(...solids.map(s => Math.max(-s.box.min.z, s.box.max.z))) + 10;
      return { ...b, inverse: transform.invert(), solids, reach };
    });
    this.matrix = new THREE.Matrix4(); this.localMatrix = new THREE.Matrix4();
    this.p = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.unit = new THREE.Vector3(1, 1, 1);
    this.box = new THREE.Box3(); this.local = new THREE.Vector3(); this.reach = new THREE.Box3();
    this.cellMin = new THREE.Vector3(); this.cellMax = new THREE.Vector3(); this.broad = new THREE.Box3();
    this.obb = { c: new THREE.Vector3(), h: [0, 0, 0], r: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], abs: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] };
    this.reset();
  }
  reset() { this.contact = null; this.previous = null; }
  // Sets this.obb to `part` posed by `matrix` (unit scale), padded like the part AABBs,
  // and returns its world AABB.
  orient(part, matrix, target = this.reach) {
    const obb = this.obb, e = matrix.elements;
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
  // Pavilion cells store the highest surface in each square, so a part hits when it
  // dips below any cell it overlaps. With an oriented box, its world AABB only selects
  // candidate cells: a banked wing's AABB reaches lower than the wing itself (#395).
  pavilionHit(box, obb = null) {
    const island = this.course.nodeulseom, field = island.pavilion.heights;
    if (box.min.y > field.top) return false;
    const cell = v => Math.floor(v / field.cell);
    const i0 = Math.max(0, cell(box.min.x - island.x - field.x0)), i1 = Math.min(field.cols - 1, cell(box.max.x - island.x - field.x0));
    const j0 = Math.max(0, cell(box.min.z - island.z - field.z0)), j1 = Math.min(field.rows - 1, cell(box.max.z - island.z - field.z0));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const top = field.heights[j * field.cols + i];
        if (top < box.min.y) continue;
        if (!obb) return true;
        // The cell's solid column, from below the part up to the cell's highest surface.
        this.cellMin.set(island.x + field.x0 + i * field.cell, box.min.y - 1, island.z + field.z0 + j * field.cell);
        this.cellMax.set(this.cellMin.x + field.cell, top, this.cellMin.z + field.cell);
        if (obbHitsBox(obb, this.cellMin, this.cellMax)) return true;
      }
    }
    return false;
  }
  // The island tapers upward, so test its footprint at the box's lowest point, where
  // it is widest. Its 24-sided mesh sits just inside this ellipse.
  nodeulseomHit(box, obb = null, reach = box) {
    const island = this.course.nodeulseom;
    if (!island) return null;
    if (this.pavilionHit(obb ? reach : box, obb)) return 'pavilion';
    if (box.min.y > island.height) return null;
    const r = island.bottomRadius + (island.topRadius - island.bottomRadius) * Math.max(0, box.min.y) / island.height;
    const dx = Math.max(box.min.x - island.x, 0, island.x - box.max.x) / r;
    const dz = Math.max(box.min.z - island.z, 0, island.z - box.max.z) / (r * island.zScale);
    return dx * dx + dz * dz <= 1 ? 'island' : null;
  }
  // Returns the first contact, then keeps it until reset().
  update(position, quaternion) {
    if (this.contact) return this.contact;
    // Malformed samples are skipped; the next valid one is tested on its own.
    if (![...position.toArray(), ...quaternion.toArray()].every(Number.isFinite) ||
        Math.abs(quaternion.lengthSq() - 1) > 0.01) { this.previous = null; return null; }
    const c = this.course;
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
        this.box.copy(part.box).applyMatrix4(this.matrix).expandByScalar(PAD);
        const structure = this.box.min.y <= c.waterLevel || this.box.min.y <= hangangHeight(this.p.x, this.p.z)
          ? 'water' : this.nodeulseomHit(this.box, this.obb, this.orient(part, this.matrix));
        if (structure) { this.contact = { aircraftPart: part.name, structure, position: this.p.toArray() }; break; }
      }
      for (let i = 0; i < this.bridges.length && !this.contact; i++) {
        const bridge = this.bridges[i];
        this.local.copy(this.p).applyMatrix4(bridge.inverse);
        if (Math.abs(this.local.z) > bridge.reach) continue;
        this.localMatrix.multiplyMatrices(bridge.inverse, this.matrix);
        // Narrow the bridge's solids (lamps and arch segments included) to those near
        // the whole aircraft, then test each part against them in order.
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
