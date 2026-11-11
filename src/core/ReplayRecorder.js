import { Atmosphere } from '../physics/Atmosphere.js';
import { REPLAY_INTERVAL_SEC, REPLAY_INTERVAL_LADDER, REPLAY_BUDGET, REPLAY_MIN_DURATION_SEC,
  maxSamplesFor } from '../replay/replayConfig.js';

// Observations only: time is integrated in simulation seconds, never wall time.
const REQUIRED = ['x', 'z', 'altitudeFt', 'iasKnots', 'gForce', 'pitchDeg', 'rollDeg', 'headingDeg'];
const SCALAR_FIELDS = ['elevator', 'aileron', 'rudder', 'pitchTrim', 'throttle', 'flapDegree', 'flapIndex',
  'spoilers', 'gearState', 'iasKnots', 'tasKnots', 'groundSpeedKnots', 'vsiFpm', 'radioAltFt', 'mach',
  'gForce', 'pitchDeg', 'rollDeg', 'headingDeg', 'selectedHeading', 'selectedAltitude', 'selectedSpeed'];
const FLAG_FIELDS = ['onGround', 'isTransit', 'touchdown', 'isStalled', 'isPreStall', 'isStallWarning',
  'reverserActive', 'apEngaged', 'parkBrake'];

export class ReplayRecorder {
  constructor({ maxBase64Bytes = REPLAY_BUDGET.entryBase64Bytes } = {}) {
    this.maxBase64Bytes = maxBase64Bytes;
  }

  start(metadata) {
    // A crash belongs to the sortie that had it, never to one started from its metadata.
    const { crash, ...sortie } = metadata ?? {};
    this.metadata = sortie;
    this.active = true;
    this.overflow = false;
    this.elapsed = 0;
    this.validDuration = 0;
    this.interval = REPLAY_INTERVAL_SEC;
    this.nextSample = 0;
    this.samples = [];
    this.latest = null;
    this.track = null;
    this.gearIds = [];
    this.bodyIds = [];
    this._measureMetadata();
  }

  /** @param quaternion the authoritative body attitude; a pose track cannot be rebuilt from attitude angles. */
  update(dt, telemetry, quaternion) {
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt;
    if (!telemetry || !REQUIRED.every(key => Number.isFinite(telemetry[key]))) return;
    if (!isQuaternion(quaternion)) return;
    this.validDuration += dt;
    const sample = this._observe(telemetry, quaternion);
    this.latest = sample;
    if (this.elapsed + 1e-9 >= this.nextSample) {
      this._append(sample);
      this.nextSample = this.elapsed + this.interval;
    }
  }

  _observe(telemetry, quaternion) {
    const sample = {
      timeSec: this.elapsed,
      x: telemetry.x,
      y: Atmosphere.feetToMeters(telemetry.altitudeFt),
      z: telemetry.z,
      quat: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      compressions: {
        nose: telemetry.compressions?.nose ?? 0,
        mainLeft: telemetry.compressions?.mainLeft ?? 0,
        mainRight: telemetry.compressions?.mainRight ?? 0,
      },
      gearDamage: { ...telemetry.gearDamage },
      bodyDamage: { ...telemetry.bodyDamage },
      engine1: observeEngine(telemetry.engine1),
      engine2: observeEngine(telemetry.engine2),
    };
    for (const key of SCALAR_FIELDS) sample[key] = telemetry[key];
    for (const key of FLAG_FIELDS) sample[key] = Boolean(telemetry[key]);
    // The damage id lists live in metadata, so they are charged against the byte budget as soon
    // as they are known instead of being guessed at start.
    if (!this.gearIds.length && telemetry.gearDamage) {
      this.gearIds = Object.keys(telemetry.gearDamage);
      this._measureMetadata();
    }
    if (!this.bodyIds.length && telemetry.bodyDamage) {
      this.bodyIds = Object.keys(telemetry.bodyDamage);
      this._measureMetadata();
    }
    return sample;
  }

  /** The metadata blob is part of every stored entry, so it is charged against the same budget. */
  _measureMetadata() {
    this.metadataBytes = new TextEncoder().encode(JSON.stringify({
      ...this.metadata, gearIds: this.gearIds, bodyIds: this.bodyIds,
    })).length;
  }

  /** Frames that still fit the per-entry budget once the metadata is paid for. */
  capacity() {
    return maxSamplesFor(this.maxBase64Bytes, this.metadataBytes);
  }

  /** The byte budget, not a sample count, decides when a track is thinned or refused. */
  _append(sample) {
    if (this.samples.length < this.capacity()) {
      this.samples.push(sample);
      return;
    }
    if (this.interval >= REPLAY_INTERVAL_LADDER.at(-1)) {
      this.overflow = true;
      return;
    }
    this.samples = this.samples.filter((_, index) => index % 2 === 0);
    this.interval *= 2;
    this.samples.push(sample);
  }

  /**
   * The pose track stops being meaningful at impact, so playback stages the crash from this
   * marker instead (#648). Only the first impact of a sortie is kept.
   */
  markCrash(crashResult) {
    if (!this.active || !crashResult || this.metadata.crash) return;
    const speedKnots = Number(crashResult.speedKnots);
    this.metadata.crash = { type: crashResult.type ?? null, timeSec: Math.round(this.elapsed * 1000) / 1000,
      speedKnots: Number.isFinite(speedKnots) ? Math.round(speedKnots) : null };
    this._measureMetadata();
  }

  finish() {
    if (this.track) return this.track;
    this.active = false;
    if (this.samples.length < 2 || this.validDuration + 1e-9 < REPLAY_MIN_DURATION_SEC) return null;
    if (this.latest && this.samples.at(-1) !== this.latest) {
      this._append(this.latest);
      // At the final rung retain the endpoint even when the flight is too long to save.
      if (this.samples.at(-1) !== this.latest) this.samples[this.samples.length - 1] = this.latest;
    }
    this.track = {
      intervalSec: this.interval,
      durationSec: this.elapsed,
      overflow: this.overflow,
      metadata: { ...this.metadata, gearIds: this.gearIds, bodyIds: this.bodyIds },
      samples: this.samples,
      gearIds: this.gearIds,
      bodyIds: this.bodyIds,
    };
    return this.track;
  }
}

function isQuaternion(value) {
  return value && [value.x, value.y, value.z, value.w].every(Number.isFinite);
}

function observeEngine(engine) {
  return { n1: engine?.n1 ?? 0, n2: engine?.n2 ?? 0, egt: engine?.egt ?? 0, ff: engine?.fuelFlow ?? engine?.ff ?? 0,
    failed: Boolean(engine?.failed) };
}
