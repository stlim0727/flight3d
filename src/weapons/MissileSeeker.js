import * as THREE from 'three';
import { infraredSignalQuality } from './InfraredSignal.js';
import { radarSignalQuality } from './RadarSignal.js';

/** Height-field LOS at <=150 m spacing; narrow ridges, buildings and clouds
 * are outside this bounded model. Missing terrain means a clear-space fixture.
 */
export function seekerCanObserve(spec, observer, target, world, halfAngleDeg = spec.gimbalDeg) {
  if (!target?.alive || (target.type === 'chaff' && spec.seekerType !== 'ACTIVE_RADAR')) return false;
  const from = observer.position, to = target.position;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const range = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(range) || range < 1 || range > spec.seekerRangeM) return false;
  const q = observer.quaternion;
  const norm = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-3) return false;
  const fx = -2 * (q.x * q.z + q.w * q.y);
  const fy = -2 * (q.y * q.z - q.w * q.x);
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  if ((fx * dx + fy * dy + fz * dz) / range < Math.cos(halfAngleDeg * Math.PI / 180)) return false;
  if (world?.terrainHeight) {
    const steps = Math.ceil(range / 150);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ground = world.terrainHeight(from.x + dx * t, from.z + dz * t);
      if (!Number.isFinite(ground) || ground >= from.y + dy * t) return false;
    }
  }
  // Explicit callbacks override the default channel model for controlled sensor
  // fixtures/extensions. Default channels use their respective signal models.
  const quality = world?.seekerSignalQuality
    ? world.seekerSignalQuality({ type: spec.seekerType, observer, target, rangeM: range })
    : spec.seekerType === 'IR' ? infraredSignalQuality(observer, target, range)
      : spec.seekerType === 'ACTIVE_RADAR' ? radarSignalQuality(observer, target, range, world) : 0;
  return Number.isFinite(quality) && quality >= spec.seekerMinSignalQuality;
}

/** Only confirmed observations enter estimate. Hidden truth is used by the
 * geometric observation gate and physical collisions, never directly by PN.
 */
export class MissileSeeker {
  constructor(spec) {
    this.spec = spec;
    this.estimate = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
    this.reset();
  }

  reset() {
    this.state = 'search';
    this.target = null;
    this.pendingTarget = null;
    this.confirmationSeconds = 0;
    this.observationAgeSeconds = 0;
    this.hasEstimate = false;
    this.everTracked = false;
    this.estimate.position.set(0, 0, 0);
    this.estimate.velocity.set(0, 0, 0);
  }

  seed(target, observer, world) {
    if (!seekerCanObserve(this.spec, observer, target, world)) return false;
    this._measure(target);
    return true;
  }

  update(dt, observer, targets, world) {
    if (dt <= 0) return;
    let observed = null;
    if (targets.includes(this.target) && seekerCanObserve(this.spec, observer, this.target, world)) {
      observed = this.target;
    } else {
      let nearest = Infinity;
      for (const candidate of targets) {
        if (candidate === this.target || !seekerCanObserve(this.spec, observer, candidate, world)) continue;
        const range = observer.position.distanceToSquared(candidate.position);
        if (range < nearest) { observed = candidate; nearest = range; }
      }
    }
    // A competing return must lie near the current line of sight and range.
    // The Gaussian resolution weights are deterministic model assumptions.
    if (observed && this.spec.seekerType === 'ACTIVE_RADAR' && !world?.seekerSignalQuality) {
      const reference = observed;
      const origin = observer.position;
      const line = reference.position.clone().sub(origin);
      const referenceRange = line.length();
      let strongest = radarSignalQuality(observer, reference, referenceRange, world);
      for (const candidate of targets) {
        if (candidate === reference || (reference.type !== 'chaff' && candidate.type !== 'chaff')
          || !seekerCanObserve(this.spec, observer, candidate, world)) continue;
        const other = candidate.position.clone().sub(origin);
        const range = other.length();
        const angle = line.angleTo(other);
        const rangeOffset = (range - referenceRange) / 300;
        const weight = Math.exp(-0.5 * ((angle / 0.05) ** 2 + rangeOffset ** 2));
        const quality = radarSignalQuality(observer, candidate, range, world) * weight;
        if (quality > strongest) { observed = candidate; strongest = quality; }
      }
    }
    if (observed && this.state === 'track' && observed === this.target) {
      this._measure(observed);
      return;
    }
    this.confirmationSeconds = observed
      ? (observed === this.pendingTarget ? this.confirmationSeconds + dt : dt) : 0;
    this.pendingTarget = observed;
    if (observed && this.confirmationSeconds + 1e-9 >= this.spec.seekerAcquireSeconds) {
      this._measure(observed);
      return;
    }
    if (this.hasEstimate) {
      this.observationAgeSeconds += dt;
      if (this.observationAgeSeconds <= this.spec.seekerMemorySeconds + 1e-9) {
        this.estimate.position.addScaledVector(this.estimate.velocity, dt);
        this.state = 'memory';
        return;
      }
      this.hasEstimate = false;
      this.target = null;
    }
    this.state = observed ? 'acquire' : this.everTracked ? 'lost' : 'search';
  }

  _measure(target) {
    this.estimate.position.copy(target.position);
    this.estimate.velocity.copy(target.velocity);
    this.target = target;
    this.hasEstimate = true;
    this.everTracked = true;
    this.observationAgeSeconds = 0;
    this.confirmationSeconds = 0;
    this.pendingTarget = null;
    this.state = 'track';
  }
}
