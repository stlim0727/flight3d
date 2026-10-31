import { createValleyManifest, validateValleyManifest, valleyLegs, projectValleyLeg } from './valleyCourse.js';

const quantile = (samples, fraction, value) => {
  const ordered = [...samples].sort((a, b) => value(a) - value(b));
  const threshold = samples.reduce((sum, s) => sum + s.widthM, 0) * fraction;
  let distance = 0;
  for (const sample of ordered) {
    distance += sample.widthM;
    if (distance + 1e-8 >= threshold) return value(sample);
  }
  return 0;
};

/** Truth is used here for judging only. Never pass this snapshot to guest code.
 * update({tick,position:{x,y,z},iasKnots,groundSpeedKnots,aglM,crashed,damaged,bodyContact})
 * must be called once per completed 120 Hz step. Gate planes must be crossed in
 * order; each fixed-distance bin is sampled on first progress only.
 */
export class ValleyMission {
  constructor(manifest = createValleyManifest()) {
    this.manifest = structuredClone(validateValleyManifest(manifest));
    this.legs = valleyLegs(this.manifest.course);
    this.lengthM = this.legs.reduce((sum, leg) => sum + leg.lengthM, 0);
    this.nextGateIndex = 1;
    this.status = 'running'; this.reason = null; this.tick = 0;
    this.previous = null; this.samples = []; this.maximumProgressM = 0; this.maxAglM = 0;
  }

  finish(status, reason) { this.status = status; this.reason = reason; return this.result(); }

  update(s) {
    if (this.status !== 'running') return this.result();
    if (!s || s.tick !== this.tick + 1 ||
        !['x', 'y', 'z'].every(k => Number.isFinite(s.position?.[k])) ||
        !['iasKnots', 'groundSpeedKnots', 'aglM'].every(k => Number.isFinite(s[k])) || s.groundSpeedKnots < 0 ||
        !['crashed', 'damaged', 'bodyContact'].every(k => typeof s[k] === 'boolean')) {
      return this.finish('failed', 'invalid-snapshot');
    }
    this.tick = s.tick;
    if (s.crashed || s.damaged || s.bodyContact) return this.finish('failed', s.crashed ? 'crash' : s.bodyContact ? 'body-strike' : 'damage');
    if (this.tick >= this.manifest.timeoutTicks) return this.finish('failed', 'timeout');
    const c = this.manifest.course;
    if (s.aglM < c.minimumAglM) return this.finish('failed', 'clearance-floor');
    if (s.iasKnots < this.manifest.minimumIasKnots || s.iasKnots > this.manifest.maximumIasKnots) return this.finish('failed', 'speed-envelope');
    if (!this.previous && Math.hypot(s.position.x - c.points[0].x, s.position.z - c.points[0].z) > c.startRadiusM) {
      return this.finish('failed', 'invalid-spawn');
    }
    if (this.previous && Math.hypot(s.position.x - this.previous.position.x, s.position.z - this.previous.position.z) >
        Math.max(10, s.groundSpeedKnots * 0.514444 / this.manifest.physicsHz * 2)) {
      return this.finish('failed', 'discontinuous-flight');
    }
    const leg = this.legs[this.nextGateIndex - 1];
    const projected = projectValleyLeg(leg, s.position);
    if (projected.distanceM > c.corridorHalfWidthM) return this.finish('failed', 'course-excursion');
    this.maxAglM = Math.max(this.maxAglM, s.aglM);
    const previousProgress = this.previous ? this.previous.progressM : 0;
    const previousAgl = this.previous ? this.previous.aglM : s.aglM;
    while (this.samples.length * c.binSizeM < this.lengthM) {
      const startM = this.samples.length * c.binSizeM;
      const widthM = Math.min(c.binSizeM, this.lengthM - startM);
      const centerM = startM + widthM / 2;
      if (centerM > projected.progressM + 1e-8) break;
      const fraction = projected.progressM > previousProgress
        ? Math.max(0, Math.min(1, (centerM - previousProgress) / (projected.progressM - previousProgress))) : 1;
      this.samples.push({ widthM, aglM: previousAgl + (s.aglM - previousAgl) * fraction });
    }
    this.maximumProgressM = Math.max(this.maximumProgressM, projected.progressM);
    const previousT = projectValleyLeg(leg, this.previous?.position ?? c.points[0]).rawT;
    const crossedGate = previousT < 1 && projected.rawT >= 1 && Math.abs(projected.crossTrackM) <= c.gateHalfWidthM;
    this.previous = { position: { ...s.position }, aglM: s.aglM, progressM: projected.progressM };
    if (crossedGate) {
      this.nextGateIndex++;
      if (this.nextGateIndex >= c.points.length) return this.finish('succeeded', 'completed');
    }
    return this.result();
  }

  result() {
    const target = this.manifest.course.targetAglM;
    const distanceM = this.samples.reduce((sum, s) => sum + s.widthM, 0);
    const excess = s => Math.max(0, s.aglM - target);
    const meanExcessM = distanceM ? this.samples.reduce((sum, s) => sum + excess(s) * s.widthM, 0) / distanceM : 0;
    const p95ExcessM = quantile(this.samples, 0.95, excess);
    return { status: this.status, reason: this.reason, tick: this.tick, metrics: {
      completedGates: this.nextGateIndex - 1, totalGates: this.legs.length,
      progressM: this.maximumProgressM, courseLengthM: this.lengthM, scoredDistanceM: distanceM,
      meanExcessM, p95ExcessM, maxAglM: this.maxAglM,
      medianAglM: quantile(this.samples, 0.5, s => s.aglM),
      altitudeCostM: this.status === 'succeeded' ? 0.7 * meanExcessM + 0.3 * p95ExcessM : null,
    } };
  }
}
