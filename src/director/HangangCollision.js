import * as THREE from 'three';
import { HANGANG_COURSE, bridgeSolids, isRiver, worldToCourse } from '../config/hangangCourse.js';

// Conservative part envelopes in the C172 model frame. Covers fixed landing gear.
// These deliberately have a small safety margin; not triangle-exact contact.
const parts = [
  ['fuselage', [-0.65, -0.55, -2.9], [0.65, 1.1, 4.6]],
  ['wing', [-5.8, 0.70, -1.3], [5.8, 1.15, 1]],
  ['tail', [-2.1, 0.3, 3.1], [2.1, 0.85, 4.6]],
  ['fin', [-0.3, 0.5, 3], [0.3, 2.4, 4.6]],
  ['gear', [-1.3, -1.65, -1.8], [1.3, -0.3, 1]],
].map(([name, min, max]) => ({ name, box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)) }));
const PAD = 0.15;

// Swept contact of the C172 with the river bridges (deck lamps and arches included), the
// water and the ground, for the bridge flight. Poses are in the Neon Metropolis world; each
// bridge is placed by the course frame and then its own transform. The towers are left to
// CollisionDetector. Free flight: no course, gates or flight envelope are judged here (#391).
export class HangangCollision {
  constructor(course = HANGANG_COURSE) {
    if (course.bridges.some(b => ![b.x, b.z, b.yaw].every(Number.isFinite))) throw new Error('Invalid Hangang course');
    this.course = course;
    const yAxis = new THREE.Vector3(0, 1, 0), unit = new THREE.Vector3(1, 1, 1);
    const frame = new THREE.Matrix4().compose(new THREE.Vector3(course.frame.x, 0, course.frame.z),
      new THREE.Quaternion().setFromAxisAngle(yAxis, course.frame.yaw), unit);
    this.bridges = course.bridges.map(b => {
      const transform = frame.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0, b.z),
        new THREE.Quaternion().setFromAxisAngle(yAxis, b.yaw), unit));
      const solids = bridgeSolids(b).map(s => ({ ...s,
        box: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...s.center), new THREE.Vector3(...s.size)) }));
      // Conservative broadphase: the widest solid plus the aircraft's furthest extremity.
      const reach = Math.max(...solids.map(s => Math.max(-s.box.min.z, s.box.max.z))) + 10;
      return { ...b, inverse: transform.invert(), solids, reach };
    });
    this.matrix = new THREE.Matrix4(); this.localMatrix = new THREE.Matrix4();
    this.p = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.unit = new THREE.Vector3(1, 1, 1);
    this.box = new THREE.Box3(); this.local = new THREE.Vector3(); this.broad = new THREE.Box3();
    this.reset();
  }
  reset() { this.contact = null; this.previous = null; }
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
        // Water and city ground are both at the water level.
        if (this.box.min.y <= c.waterLevel) {
          const structure = isRiver(...worldToCourse(this.p.x, this.p.z, c.frame), c) ? 'water' : 'ground';
          this.contact = { aircraftPart: part.name, structure, position: this.p.toArray() }; break;
        }
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
