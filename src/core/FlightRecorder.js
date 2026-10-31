// Observations only: time is integrated in simulation seconds, never wall time.
const FIELDS = ['x', 'z', 'altitudeFt', 'iasKnots', 'gForce', 'pitchDeg', 'rollDeg', 'headingDeg'];
export class FlightRecorder {
  constructor({ maxSamples = 18000 } = {}) { this.maxSamples = Math.max(4, maxSamples); }

  start(metadata) {
    this.metadata = { ...metadata };
    this.active = true;
    this.elapsed = 0;
    this.validDuration = 0;
    this.interval = 0.2;
    this.nextSample = 0;
    this.samples = [];
    this.latest = null;
    this.peaks = {};
    this.touchdowns = [];
    this.airborne = 0;
    this.wasOnGround = true;
    this.stopped = 0;
  }

  update(dt, telemetry) {
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt;
    if (!FIELDS.every(key => Number.isFinite(telemetry[key]))) return;
    this.validDuration += dt;
    const sample = { timeSec: this.elapsed };
    for (const key of FIELDS) sample[key] = telemetry[key];
    this.latest = sample;
    for (const key of ['altitudeFt', 'iasKnots', 'gForce']) {
      if (!this.peaks[key] || sample[key] > this.peaks[key][key]) this.peaks[key] = sample;
    }
    if (!telemetry.onGround) this.airborne += dt;
    else {
      if (!this.wasOnGround && this.airborne >= 1.5 && Number.isFinite(telemetry.touchdownSinkRate)) {
        // Contact sink rate is positive down in m/s; display its magnitude in ft/min.
        this.touchdowns.push({ timeSec: this.elapsed, sinkRateFpm: Math.max(0, telemetry.touchdownSinkRate) * 60 / 0.3048,
          contactG: telemetry.gForce });
      }
      this.airborne = 0;
    }
    this.wasOnGround = Boolean(telemetry.onGround);
    this.stopped = this.touchdowns.length && telemetry.onGround && telemetry.groundSpeedKnots < 1
      ? this.stopped + dt : 0;
    if (this.elapsed + 1e-9 >= this.nextSample) {
      this._append(sample);
      this.nextSample = this.elapsed + this.interval;
    }
  }

  _append(sample) {
    if (this.samples.length >= this.maxSamples) {
      this.samples = this.samples.filter((_, index) => index % 2 === 0);
      this.interval *= 2;
    }
    this.samples.push(sample);
  }

  finish(reason = 'manual') {
    if (!this.active) return this.report;
    this.active = false;
    if (this.latest && this.samples.at(-1) !== this.latest) this._append(this.latest);
    // Snapshots own their data, so a new sortie cannot change an exported report.
    this.report = structuredClone({ version: 1, metadata: this.metadata, reason,
      durationSec: this.elapsed, peaks: this.peaks, touchdowns: this.touchdowns, samples: this.samples,
      sufficient: this.validDuration + 1e-9 >= 5 && this.samples.length >= 2,
      units: { time: 's', x: 'm', z: 'm', altitude: 'ft MSL', airspeed: 'kt IAS', attitude: 'deg',
        gForce: 'g (simulator measured load)', sinkRate: 'ft/min positive down' },
      coordinates: 'Three.js world: +Y up; x/z horizontal; altitudeFt = world Y / 0.3048',
    });
    return this.report;
  }
}

export function flightDuration(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
