import { crossAtPlane, passageCeilingAglAt, projectSlalom } from './slalomCourse.js';

const quantile = (samples, fraction, value) => {
  const ordered = [...samples].sort((a, b) => value(a) - value(b));
  const threshold = samples.reduce((sum, sample) => sum + sample.widthM, 0) * fraction;
  let distance = 0;
  for (const sample of ordered) {
    distance += sample.widthM;
    if (distance + 1e-8 >= threshold) return value(sample);
  }
  return 0;
};

/** Host judge for `valley-slalom-v1`. Truth is used here for judging only; never
 * pass this snapshot to guest code.
 * update({tick,position:{x,z},iasKnots,groundSpeedKnots,aglM,crashed,damaged,bodyContact})
 * is called once per completed 120 Hz step. Ordered gates each have a passage
 * space: a ceiling above the ground under them and a lateral band inside the
 * corridor. A gate crossed anywhere else is missed, and a missed gate ends the
 * run, because slalom order cannot be recovered later. Altitude cost is measured
 * against the interpolated ceiling, so a climb over a ridge is allowed and paid
 * for, and returning to the low space stops the charge.
 */
export class SlalomMission {
  constructor(manifest) {
    this.manifest = manifest;
    const course = manifest.course;
    this.course = course;
    this.gate = 1;
    this.status = 'running'; this.reason = null; this.tick = 0;
    this.previous = null; this.samples = [];
    this.maximumProgressM = 0; this.maxAglM = 0; this.minAglM = null;
    this.iasSumKt = 0; this.iasCount = 0; this.maxIasKnots = 0;
    this.startS = course.gates[0].sM;
    this.lengthM = course.lengthM - this.startS;
    this.binSizeM = course.sampleStepM;
  }

  finish(status, reason) { this.status = status; this.reason = reason; return this.result(); }

  /** The gate the pilot is being pointed at. Shared by the HUD and the AI
   * observation so both navigate to the same next waypoint. */
  get nextGateIndex() { return this.gate; }

  update(snapshot) {
    if (this.status !== 'running') return this.result();
    const position = snapshot?.position;
    if (!snapshot || snapshot.tick !== this.tick + 1 ||
        !['x', 'z'].every(key => Number.isFinite(position?.[key])) ||
        !['iasKnots', 'groundSpeedKnots', 'aglM'].every(key => Number.isFinite(snapshot[key])) ||
        snapshot.groundSpeedKnots < 0 ||
        !['crashed', 'damaged', 'bodyContact'].every(key => typeof snapshot[key] === 'boolean')) {
      return this.finish('failed', 'invalid-snapshot');
    }
    this.tick = snapshot.tick;
    this.minAglM = Math.min(this.minAglM ?? snapshot.aglM, snapshot.aglM);
    if (snapshot.crashed || snapshot.damaged || snapshot.bodyContact) {
      return this.finish('failed', snapshot.crashed ? 'crash'
        : snapshot.bodyContact ? 'body-strike' : 'damage');
    }
    if (this.tick >= this.manifest.timeoutTicks) return this.finish('failed', 'timeout');
    const course = this.course;
    if (snapshot.aglM < course.clearanceFloorM) return this.finish('failed', 'clearance-floor');
    if (snapshot.iasKnots < this.manifest.minimumIasKnots || snapshot.iasKnots > this.manifest.maximumIasKnots) {
      return this.finish('failed', 'speed-envelope');
    }
    if (!this.previous && Math.hypot(position.x - this.manifest.spawn.x, position.z - this.manifest.spawn.z)
        > this.binSizeM * 2) return this.finish('failed', 'invalid-spawn');
    if (this.previous && Math.hypot(position.x - this.previous.x, position.z - this.previous.z) >
        Math.max(10, snapshot.groundSpeedKnots * 0.514444 / this.manifest.physicsHz * 2)) {
      return this.finish('failed', 'discontinuous-flight');
    }
    const projected = projectSlalom(course, position, this.hintIndex ?? null);
    this.hintIndex = projected.segmentIndex;
    if (Math.abs(projected.crossM) > projected.halfWidthM) return this.finish('failed', 'corridor-excursion');
    this.maximumProgressM = Math.max(this.maximumProgressM, projected.progressM);
    this.maxAglM = Math.max(this.maxAglM, snapshot.aglM);
    this.iasSumKt += snapshot.iasKnots;
    this.iasCount++;
    this.maxIasKnots = Math.max(this.maxIasKnots, snapshot.iasKnots);
    this.bin(projected, snapshot);
    const previous = this.previous;
    this.previous = { ...position, aglM: snapshot.aglM, progressM: projected.progressM,
      crossM: projected.crossM };
    if (previous && previous.progressM < course.gates[this.gate].sM &&
        projected.progressM >= course.gates[this.gate].sM) {
      const gate = course.gates[this.gate];
      const atPlane = crossAtPlane(previous, this.previous, gate.sM);
      // The passage space is the band around the gate's own aim point, not the
      // middle of the valley: the low line has to be flown to the wall side.
      const cleared = Math.abs(atPlane.crossM - gate.crossOffsetM) <= gate.passageHalfWidthM &&
        atPlane.aglM <= gate.maxAglM;
      if (!cleared) return this.finish('failed', 'gate-missed');
      this.gate++;
      if (this.gate >= course.gates.length) return this.finish('succeeded', 'completed');
    }
    return this.result();
  }

  /** Fixed-distance bins of altitude above the local ceiling, sampled on first
   * progress only, so a pilot cannot bank the score by flying the same metre
   * twice. */
  bin(projected, snapshot) {
    const course = this.course;
    const previous = this.previous;
    const previousProgress = previous ? Math.max(this.startS, previous.progressM) : this.startS;
    const previousAgl = previous ? previous.aglM : snapshot.aglM;
    while (this.samples.length * this.binSizeM + this.startS < course.lengthM) {
      const centerM = this.startS + this.samples.length * this.binSizeM + this.binSizeM / 2;
      if (centerM > projected.progressM + 1e-8) break;
      const fraction = projected.progressM > previousProgress
        ? Math.max(0, Math.min(1, (centerM - previousProgress) / (projected.progressM - previousProgress))) : 1;
      const aglM = previousAgl + (snapshot.aglM - previousAgl) * fraction;
      const ceilingM = passageCeilingAglAt(course, centerM);
      this.samples.push({ widthM: this.binSizeM, aglM, excessM: Math.max(0, aglM - ceilingM) });
    }
  }

  result() {
    const distanceM = this.samples.reduce((sum, sample) => sum + sample.widthM, 0);
    const meanExcessM = distanceM
      ? this.samples.reduce((sum, sample) => sum + sample.excessM * sample.widthM, 0) / distanceM : 0;
    const p95ExcessM = quantile(this.samples, 0.95, sample => sample.excessM);
    const durationSeconds = this.tick / this.manifest.physicsHz;
    const altitudeCostM = this.status === 'succeeded' ? 0.7 * meanExcessM + 0.3 * p95ExcessM : null;
    const finalScore = this.status === 'succeeded'
      ? Math.max(0, Math.round(20000 - durationSeconds * 100 - (altitudeCostM ?? 0) * 50))
      : null;
    return { status: this.status, reason: this.reason, tick: this.tick, metrics: {
      rulesVersion: this.manifest.rulesVersion,
      completedGates: this.gate - 1,
      gatesCleared: this.gate - 1, totalGates: this.course.gates.length - 1,
      progressM: Math.max(0, this.maximumProgressM - this.startS),
      courseLengthM: this.lengthM, scoredDistanceM: distanceM,
      meanExcessM, p95ExcessM, maxAglM: this.maxAglM, minAglM: this.minAglM,
      medianAglM: quantile(this.samples, 0.5, sample => sample.aglM),
      meanIasKnots: this.iasCount ? this.iasSumKt / this.iasCount : 0,
      maxIasKnots: this.maxIasKnots,
      durationSeconds,
      altitudeCostM,
      finalScore,
    } };
  }
}
