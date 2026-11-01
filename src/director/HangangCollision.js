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
].map(([name, min, max]) => ({ name, box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)) }));

// Solid contact with the Han River bridges, Nodeulseom, its pavilion, banks and water.
// Free flight: no course, gates or flight envelope are judged here (#391).
export class HangangCollision {
  constructor(course = HANGANG_COURSE) {
    if (course.bridges.some(b => ![b.x, b.z, b.yaw].every(Number.isFinite))) throw new Error('Invalid Hangang course');
    this.course = course;
    this.bridges = course.bridges.map(b => {
      const transform = new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0, b.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw), new THREE.Vector3(1, 1, 1));
      return { ...b, inverse: transform.invert(), solids: bridgeSolids(b).map(s => ({ ...s,
        box: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...s.center), new THREE.Vector3(...s.size)) })) };
    });
    this.matrix = new THREE.Matrix4(); this.localMatrix = new THREE.Matrix4();
    this.p = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.unit = new THREE.Vector3(1, 1, 1);
    this.box = new THREE.Box3(); this.local = new THREE.Vector3();
    this.reset();
  }
  reset() { this.contact = null; this.previous = null; }
  // Pavilion cells store the highest surface in each square, so a box hits when it
  // dips below any cell it overlaps.
  pavilionHit(box) {
    const island = this.course.nodeulseom, field = island.pavilion.heights;
    if (box.min.y > field.top) return false;
    const cell = v => Math.floor(v / field.cell);
    const i0 = Math.max(0, cell(box.min.x - island.x - field.x0)), i1 = Math.min(field.cols - 1, cell(box.max.x - island.x - field.x0));
    const j0 = Math.max(0, cell(box.min.z - island.z - field.z0)), j1 = Math.min(field.rows - 1, cell(box.max.z - island.z - field.z0));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) if (field.heights[j * field.cols + i] >= box.min.y) return true;
    }
    return false;
  }
  // The island tapers upward, so test its footprint at the box's lowest point, where
  // it is widest. Its 24-sided mesh sits just inside this ellipse.
  nodeulseomHit(box) {
    const island = this.course.nodeulseom;
    if (!island) return null;
    if (this.pavilionHit(box)) return 'pavilion';
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
        this.box.copy(part.box).applyMatrix4(this.matrix).expandByScalar(0.15);
        const structure = this.box.min.y <= c.waterLevel || this.box.min.y <= hangangHeight(this.p.x, this.p.z)
          ? 'water' : this.nodeulseomHit(this.box);
        if (structure) { this.contact = { aircraftPart: part.name, structure, position: this.p.toArray() }; break; }
      }
      for (let i = 0; i < this.bridges.length && !this.contact; i++) {
        const bridge = this.bridges[i];
        this.local.copy(this.p).applyMatrix4(bridge.inverse);
        // Conservative broadphase includes the aircraft's furthest extremity.
        if (Math.abs(this.local.z) > 28) continue;
        this.localMatrix.multiplyMatrices(bridge.inverse, this.matrix);
        for (const part of parts) {
          this.box.copy(part.box).applyMatrix4(this.localMatrix).expandByScalar(0.15);
          const hit = bridge.solids.find(s => s.box.intersectsBox(this.box));
          if (hit) { this.contact = { bridge: bridge.id, aircraftPart: part.name, structure: hit.part, position: this.p.toArray() }; break; }
        }
      }
    }
    this.previous ??= { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.previous.p.copy(position); this.previous.q.copy(quaternion);
    return this.contact;
  }
}
