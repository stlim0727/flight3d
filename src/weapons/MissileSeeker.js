import * as THREE from 'three';
import { infraredSignalQuality } from './InfraredSignal.js';
import { radarSignalQuality } from './RadarSignal.js';

/**
 * Detailed evaluation of seeker visibility conditions.
 * Returns both the boolean result and the first failing constraint reason.
 */
export function evaluateSeekerObservation(spec, observer, target, world, halfAngleDeg = spec.gimbalDeg) {
  if (!target?.alive) {
    return { canObserve: false, lossReason: 'target_destroyed', rangeM: 0, signalQuality: 0, minSignalQuality: spec.seekerMinSignalQuality, aspectAngleDeg: 0 };
  }
  if ((target.type === 'chaff' && spec.seekerType !== 'ACTIVE_RADAR')
    || (target.type === 'flare' && spec.seekerType !== 'IR')) {
    return { canObserve: false, lossReason: 'incompatible_decoy', rangeM: 0, signalQuality: 0, minSignalQuality: spec.seekerMinSignalQuality, aspectAngleDeg: 0 };
  }
  const from = observer.position, to = target.position;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const range = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(range) || range < 1 || range > spec.seekerRangeM) {
    return { canObserve: false, lossReason: 'range_limit', rangeM: range, signalQuality: 0, minSignalQuality: spec.seekerMinSignalQuality, aspectAngleDeg: 0 };
  }
  const q = observer.quaternion;
  const norm = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-3) {
    return { canObserve: false, lossReason: 'invalid_geometry', rangeM: range, signalQuality: 0, minSignalQuality: spec.seekerMinSignalQuality, aspectAngleDeg: 0 };
  }
  const fx = -2 * (q.x * q.z + q.w * q.y);
  const fy = -2 * (q.y * q.z - q.w * q.x);
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const dot = (fx * dx + fy * dy + fz * dz) / range;
  const clampedDot = Math.max(-1, Math.min(1, dot));
  const angleDeg = Math.acos(clampedDot) * (180 / Math.PI);
  if (clampedDot < Math.cos(halfAngleDeg * Math.PI / 180)) {
    return { canObserve: false, lossReason: 'fov_limit', rangeM: range, signalQuality: 0, minSignalQuality: spec.seekerMinSignalQuality, aspectAngleDeg: angleDeg };
  }
  if (world?.terrainHeight) {
    const steps = Math.ceil(range / 150);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ground = world.terrainHeight(from.x + dx * t, from.z + dz * t);
      if (!Number.isFinite(ground) || ground >= from.y + dy * t) {
        return { canObserve: false, lossReason: 'terrain_occlusion', rangeM: range, signalQuality: 0, minSignalQuality: spec.seekerMinSignalQuality, aspectAngleDeg: angleDeg };
      }
    }
  }
  const quality = world?.seekerSignalQuality
    ? world.seekerSignalQuality({ type: spec.seekerType, observer, target, rangeM: range })
    : spec.seekerType === 'IR' ? infraredSignalQuality(observer, target, range)
      : spec.seekerType === 'ACTIVE_RADAR' ? radarSignalQuality(observer, target, range, world) : 0;
  if (!Number.isFinite(quality) || quality < spec.seekerMinSignalQuality) {
    return { canObserve: false, lossReason: 'low_signal', rangeM: range, signalQuality: quality, minSignalQuality: spec.seekerMinSignalQuality, aspectAngleDeg: angleDeg };
  }
  return { canObserve: true, lossReason: null, rangeM: range, signalQuality: quality, minSignalQuality: spec.seekerMinSignalQuality, aspectAngleDeg: angleDeg };
}

/** Height-field LOS at <=150 m spacing; narrow ridges, buildings and clouds
 * are outside this bounded model. Missing terrain means a clear-space fixture.
 */
export function seekerCanObserve(spec, observer, target, world, halfAngleDeg = spec.gimbalDeg) {
  return evaluateSeekerObservation(spec, observer, target, world, halfAngleDeg).canObserve;
}

/** Only confirmed observations enter estimate. Hidden truth is used by the
 * geometric observation gate and physical collisions, never directly by PN.
 */
export class MissileSeeker {
  constructor(spec) {
    this.spec = spec;
    this.estimate = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
    this.lastObservation = null;
    this.seekerEvents = [];
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
    this.lastObservation = null;
    this.seekerEvents = [];
  }

  seed(target, observer, world) {
    const evalResult = evaluateSeekerObservation(this.spec, observer, target, world);
    this.lastObservation = evalResult;
    if (!evalResult.canObserve) return false;
    this._measure(target);
    return true;
  }

  update(dt, observer, targets, world) {
    if (dt <= 0) return;
    const prevState = this.state;
    const prevTarget = this.target;

    let observed = null;
    let observedEval = null;

    if (targets.includes(this.target)) {
      const evalResult = evaluateSeekerObservation(this.spec, observer, this.target, world);
      if (evalResult.canObserve) {
        observed = this.target;
        observedEval = evalResult;
      } else {
        this.lastObservation = evalResult;
      }
    }
    if (!observed) {
      let nearest = Infinity;
      for (const candidate of targets) {
        if (candidate === this.target) continue;
        const evalResult = evaluateSeekerObservation(this.spec, observer, candidate, world);
        if (!evalResult.canObserve) continue;
        const range = observer.position.distanceToSquared(candidate.position);
        if (range < nearest) {
          observed = candidate;
          observedEval = evalResult;
          nearest = range;
        }
      }
    }
    // Competing returns are weighted by angular separation; radar also uses range.
    // The Gaussian resolution weights are deterministic model assumptions.
    if (observed && (this.spec.seekerType === 'ACTIVE_RADAR' || this.spec.seekerType === 'IR') && !world?.seekerSignalQuality) {
      const isIR = this.spec.seekerType === 'IR';
      const decoyType = isIR ? 'flare' : 'chaff';
      const qualityAt = (contact, range) => isIR ? infraredSignalQuality(observer, contact, range)
        : radarSignalQuality(observer, contact, range, world);
      const reference = observed;
      const origin = observer.position;
      const line = reference.position.clone().sub(origin);
      const referenceRange = line.length();
      let strongest = qualityAt(reference, referenceRange);
      for (const candidate of targets) {
        if (candidate === reference || (reference.type !== decoyType && candidate.type !== decoyType)
          || !seekerCanObserve(this.spec, observer, candidate, world)) continue;
        const other = candidate.position.clone().sub(origin);
        const range = other.length();
        const angle = line.angleTo(other);
        const rangeOffset = isIR ? 0 : (range - referenceRange) / 300;
        const weight = Math.exp(-0.5 * ((angle / 0.05) ** 2 + rangeOffset ** 2));
        const quality = qualityAt(candidate, range) * weight;
        if (quality > strongest) {
          const decoyEval = evaluateSeekerObservation(this.spec, observer, candidate, world);
          observed = candidate;
          observedEval = decoyEval;
          strongest = quality;
        }
      }
    }

    if (observedEval) {
      this.lastObservation = observedEval;
    }

    // Check if decoy seduced lock from a real target
    if (observed && prevTarget && prevTarget.type !== 'flare' && prevTarget.type !== 'chaff'
      && (observed.type === 'flare' || observed.type === 'chaff') && observed !== prevTarget) {
      this.seekerEvents.push({
        type: 'decoy_transfer',
        decoy: observed,
        decoyType: observed.type,
        prevTarget,
        separationAngleDeg: observedEval?.aspectAngleDeg ?? 0,
        signalQuality: observedEval?.signalQuality ?? 0,
      });
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
      this._recordStateChange(prevState);
      return;
    }
    if (this.hasEstimate) {
      this.observationAgeSeconds += dt;
      if (this.observationAgeSeconds <= this.spec.seekerMemorySeconds + 1e-9) {
        this.estimate.position.addScaledVector(this.estimate.velocity, dt);
        this.state = 'memory';
        this._recordStateChange(prevState);
        return;
      }
      this.hasEstimate = false;
      this.target = null;
    }
    this.state = observed ? 'acquire' : this.everTracked ? 'lost' : 'search';
    this._recordStateChange(prevState);
  }

  _recordStateChange(prevState) {
    if (this.state !== prevState) {
      this.seekerEvents.push({
        type: 'seeker_state',
        state: this.state,
        prevState,
        target: this.target,
        observationAge: this.observationAgeSeconds,
        lastObservation: this.lastObservation,
      });
    }
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
