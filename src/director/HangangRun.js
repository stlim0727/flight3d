import * as THREE from 'three';
import { HANGANG_COURSE, bridgeSolids, hangangHeight, riverCenter } from '../config/hangangCourse.js';

// Conservative part envelopes in the C172 model frame. Covers fixed landing gear.
// These deliberately have a small safety margin; not triangle-exact contact.
const parts = [
  ['fuselage', [-0.65, -0.55, -2.9], [0.65, 1.1, 4.6]],
  ['wing', [-5.8, 0.70, -1.3], [5.8, 1.15, 1]],
  ['tail', [-2.1, 0.3, 3.1], [2.1, 0.85, 4.6]],
  ['fin', [-0.3, 0.5, 3], [0.3, 2.4, 4.6]],
  ['gear', [-1.3, -1.65, -1.8], [1.3, -0.3, 1]],
].map(([name, min, max]) => ({ name, box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)) }));

export class HangangRun {
  constructor(course = HANGANG_COURSE) {
    if (!course.bridges.length || new Set(course.bridges.map(b => b.id)).size !== course.bridges.length ||
        course.bridges.some(b => ![b.x, b.z, b.yaw].every(Number.isFinite))) throw new Error('Invalid Hangang course');
    this.course = course;
    this.bridges = course.bridges.map(b => {
      const transform = new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0, b.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw), new THREE.Vector3(1, 1, 1));
      return { ...b, inverse: transform.invert(), solids: bridgeSolids(b).map(s => ({ ...s,
        box: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...s.center), new THREE.Vector3(...s.size)) })) };
    });
    this.matrix = new THREE.Matrix4(); this.localMatrix = new THREE.Matrix4();
    this.p = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.unit = new THREE.Vector3(1, 1, 1);
    this.box = new THREE.Box3(); this.envelope = new THREE.Box3(); this.local = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.reset();
  }
  reset() {
    this.status = 'running'; this.phase = 'approach'; this.index = 0; this.armed = false; this.invalidGate = false;
    this.previous = null; this.elapsed = 0; this.goodTime = 0; this.excursion = 0;
    this.recovery = 0; this.reason = ''; this.contact = null; this.warning = false;
    this.clearances = this.bridges.map(() => null); this.track = []; this.trackClock = 0;
  }
  fail(reason, contact = null) { if (contact) this.contact = contact; if (this.status === 'running') { this.status = 'failed'; this.reason = reason; } }
  get maintenancePercent() { return this.elapsed ? Math.round(100 * this.goodTime / this.elapsed) : 100; }
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
  update(position, quaternion, velocity, dt, { stalled = false, autopilot = false } = {}) {
    if (this.contact) return;
    if (![...position.toArray(), ...quaternion.toArray(), ...velocity.toArray(), dt].every(Number.isFinite) ||
        dt <= 0 || dt > 0.25 || Math.abs(quaternion.lengthSq() - 1) > 0.01) { this.fail('invalid'); return; }
    if (autopilot) { this.fail('autopilot'); return; }
    const c = this.course;
    const previous = this.previous;
    // Subdivide both translation and rotation; padding covers between-sample motion.
    const count = previous ? Math.ceil(Math.max(1, previous.p.distanceTo(position) / 0.2, previous.q.angleTo(quaternion) / 0.015)) : 1;
    if (count > 512) { this.fail('invalid'); return; }
    for (let sample = 1; sample <= count && !this.contact; sample++) {
      if (previous) { this.p.copy(previous.p).lerp(position, sample / count); this.q.copy(previous.q).slerp(quaternion, sample / count); }
      else { this.p.copy(position); this.q.copy(quaternion); }
      this.matrix.compose(this.p, this.q, this.unit);
      for (const part of parts) {
        this.box.copy(part.box).applyMatrix4(this.matrix).expandByScalar(0.15);
        const structure = this.box.min.y <= c.waterLevel || this.box.min.y <= hangangHeight(this.p.x, this.p.z)
          ? 'water' : this.nodeulseomHit(this.box);
        if (structure) { this.fail('contact', { aircraftPart: part.name, structure, position: this.p.toArray() }); break; }
      }
      for (let i = 0; i < this.bridges.length && !this.contact; i++) {
        const bridge = this.bridges[i];
        this.local.copy(this.p).applyMatrix4(bridge.inverse);
        // Conservative broadphase includes the aircraft's furthest extremity.
        if (Math.abs(this.local.z) > 28) continue;
        this.localMatrix.multiplyMatrices(bridge.inverse, this.matrix);
        this.envelope.makeEmpty();
        for (const part of parts) {
          this.box.copy(part.box).applyMatrix4(this.localMatrix).expandByScalar(0.15);
          this.envelope.union(this.box);
          const hit = bridge.solids.find(s => s.box.intersectsBox(this.box));
          if (hit) { this.fail('contact', { bridge: bridge.id, aircraftPart: part.name, structure: hit.part, position: this.p.toArray() }); break; }
        }
        if (this.status !== 'running' || i !== this.index) continue;
        const gate = this.envelope;
        if (gate.min.z > 11) this.armed = true;
        if (gate.min.z <= 11 && gate.max.z >= -11) {
          const gap = Math.min(gate.min.x + 50, 50 - gate.max.x, 34 - gate.max.y, gate.min.y);
          if (gap <= 0 || !this.armed) this.invalidGate = true;
          if (!this.invalidGate) {
            this.phase = 'passing';
            this.clearances[i] = Math.min(this.clearances[i] ?? Infinity, gap);
          }
        }
        if (this.phase === 'passing' && !this.invalidGate && gate.max.z < -11) {
          this.index++; this.armed = false; this.invalidGate = false;
          this.phase = this.index === this.bridges.length ? 'recovery' : 'approach';
        }
      }
    }
    this.previous ??= { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.previous.p.copy(position); this.previous.q.copy(quaternion);
    if (this.status !== 'running') return;
    const target = this.bridges[Math.min(this.index, this.bridges.length - 1)];
    this.local.copy(position).applyMatrix4(target.inverse);
    const localVelocity = velocity.clone().transformDirection(target.inverse);
    if (this.index < this.bridges.length && this.local.z < -28) this.fail('route');
    if (localVelocity.z >= 0 || Math.abs(position.x - riverCenter(position.z)) > 440) this.fail('route');
    this.euler.setFromQuaternion(quaternion, 'YXZ');
    const height = position.y - c.waterLevel;
    const nearGate = this.index < this.bridges.length && Math.abs(this.local.z) < 180;
    const stable = height >= c.minHeight && height <= c.maxHeight && Math.abs(velocity.y) <= c.maxVerticalSpeed &&
      velocity.length() >= c.minSpeedMs && velocity.length() <= c.maxSpeedMs && !stalled &&
      Math.abs(THREE.MathUtils.radToDeg(this.euler.z)) <= (nearGate || this.phase === 'recovery' ? c.maxBankDeg : 30);
    this.elapsed += dt; if (stable) this.goodTime += dt;
    this.warning = !stable;
    this.excursion = stable ? 0 : this.excursion + dt;
    if (this.excursion >= c.excursionLimitSec) this.fail('envelope');
    if (this.elapsed > 240) this.fail('timeout');
    if (this.phase === 'recovery') {
      this.recovery = stable ? this.recovery + dt : 0;
      if (this.status === 'running' && this.local.z < -c.finishDistanceM && this.recovery >= c.recoverySec) this.status = 'complete';
    }
    this.trackClock += dt;
    if (this.trackClock >= 0.5) { this.track.push({ position: position.toArray(), speed: velocity.length(), verticalSpeed: velocity.y, bank: this.euler.z }); this.trackClock = 0; }
  }
}
