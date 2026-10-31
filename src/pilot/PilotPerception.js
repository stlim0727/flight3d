/** Pure training-navigation sensor model. Input is a trusted snapshot, never sent whole. */
export const SENSOR_PROFILE_VERSION = 'training-navigation-v1';
const FEET_PER_METER = 3.280839895013123;
const DEG_PER_RAD = 180 / Math.PI;
const wrap360 = value => ((value % 360) + 360) % 360;
export const wrapSignedDegrees = value => ((value + 180) % 360 + 360) % 360 - 180;
const unavailable = (tick, reason = 'missing-source') => ({ status: 'unavailable', mean: null, std: null, sampleTick: tick, reason });

const INSTRUMENTS = Object.freeze({
  iasKnots: [1, true], groundSpeedKnots: [0.5, true], pitchDeg: [0.2, false],
  rollDeg: [0.2, false], headingDeg: [0.3, false], altitudeFt: [3, false],
  radioAltFt: [1, true], vsiFpm: [30, false],
});
const FEEDBACK = ['elevator', 'aileron', 'rudder', 'throttle', 'brakes'];

function uniform(seed, key, tick, component) {
  let hash = 2166136261;
  for (const char of `${seed}:${key}:${tick}:${component}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16;
  return ((hash >>> 0) + 0.5) / 4294967296;
}
function gaussian(seed, key, tick) {
  return Math.sqrt(-2 * Math.log(uniform(seed, key, tick, 0))) * Math.cos(2 * Math.PI * uniform(seed, key, tick, 1));
}

/**
 * Snapshot shape (all scalars optional; absent/nonfinite produces unavailable):
 * { iasKnots, groundSpeedKnots, pitchDeg, rollDeg, headingDeg, altitudeFt,
 *   radioAltFt, vsiFpm, elevator, aileron, rudder, throttle, brakes,
 *   runwayS, centerlineOffsetM, weightOnWheels }
 * runwayS: forward from threshold in meters; e positive runway-right.
 * altitudeFt is MSL at the simulator's documented altitude reference point.
 * Call updateContact(boolean,tick) on EVERY physics tick for 0.1 s debounce.
 * sample() may be called once at each decision tick; duplicate calls are idempotent.
 */
export class PilotPerception {
  constructor({ sensorSeed = 1, noise = true, physicsHz = 120, mission = 'takeoff', runway = {} } = {}) {
    if (!Number.isFinite(physicsHz) || physicsHz <= 0) throw new TypeError('Invalid physicsHz');
    this.seed = sensorSeed;
    this.noise = noise;
    this.physicsHz = physicsHz;
    this.mission = mission;
    this.runway = { headingDeg: runway.headingDeg, elevationM: runway.elevationM };
    this.reset();
  }

  reset() {
    this.states = new Map();
    this.lastTick = -1;
    this.lastObservation = null;
    this.contact = undefined;
    this.contactCandidate = undefined;
    this.contactSince = 0;
    this.contactTick = -1;
    this.contactValid = false;
  }

  updateContact(value, tick) {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick < this.contactTick) throw new RangeError('Nonmonotonic contact tick');
    this.contactTick = tick;
    this.contactValid = typeof value === 'boolean';
    if (!this.contactValid) {
      this.contactCandidate = undefined; // A missing interval cannot count as stable contact time.
      return;
    }
    if (this.contact === undefined) this.contact = value; // Initial switch state is known at preparation.
    if (value !== this.contactCandidate) { this.contactCandidate = value; this.contactSince = tick; }
    if (tick - this.contactSince >= Math.ceil(0.1 * this.physicsHz)) this.contact = value;
  }

  scalar(key, truth, std, tick, nonnegative = false) {
    if (!Number.isFinite(truth)) return unavailable(tick);
    let error = 0;
    if (this.noise) {
      const prior = this.states.get(key);
      const innovation = gaussian(this.seed, key, tick);
      const rho = prior ? Math.exp(-(tick - prior.tick) / this.physicsHz) : 0;
      const z = prior ? rho * prior.z + Math.sqrt(1 - rho * rho) * innovation : innovation;
      this.states.set(key, { tick, z });
      error = std * z;
    }
    const mean = truth + error;
    return { status: 'available', mean: nonnegative ? Math.max(0, mean) : mean, std: this.noise ? std : 0, sampleTick: tick };
  }

  sample(snapshot, tick) {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick < this.lastTick) throw new RangeError('Nonmonotonic sample tick');
    if (tick === this.lastTick) return structuredClone(this.lastObservation);
    const instruments = {};
    for (const [key, [std, nonnegative]] of Object.entries(INSTRUMENTS)) instruments[key] = this.scalar(`instruments.${key}`, snapshot[key], std, tick, nonnegative);
    if (instruments.headingDeg.status === 'available') instruments.headingDeg.mean = wrap360(instruments.headingDeg.mean);
    const heading = instruments.headingDeg;
    const navigation = {
      centerlineOffsetM: this.scalar('navigation.centerlineOffsetM', snapshot.centerlineOffsetM, 0.5, tick),
      headingErrorDeg: heading.status === 'available' && Number.isFinite(this.runway.headingDeg)
        ? { ...heading, mean: wrapSignedDegrees(heading.mean - this.runway.headingDeg) }
        : unavailable(tick),
    };
    if (this.mission === 'landing' || this.mission === 'landing-basic-v1') {
      const distance = this.scalar('navigation.thresholdDistanceM', Number.isFinite(snapshot.runwayS) ? -snapshot.runwayS : undefined, 2, tick);
      navigation.thresholdDistanceM = distance;
      const altitude = instruments.altitudeFt;
      if (!Number.isFinite(snapshot.runwayS)) navigation.glideSlopeErrorDeg = unavailable(tick);
      else if (snapshot.runwayS >= -20) navigation.glideSlopeErrorDeg = unavailable(tick, 'passed-guidance-limit');
      else if (distance.status !== 'available' || altitude.status !== 'available' || !Number.isFinite(this.runway.elevationM)) navigation.glideSlopeErrorDeg = unavailable(tick);
      else {
        // Share distance/altitude estimates; extra 0.05 degree instrument noise is independent.
        const h = altitude.mean / FEET_PER_METER - this.runway.elevationM - 15;
        const d = distance.mean;
        const angle = Math.atan2(h, d) * DEG_PER_RAD - 3;
        const reading = this.scalar('navigation.glideSlopeErrorDeg', angle, 0.05, tick);
        const denominator = Math.max(Number.EPSILON, d * d + h * h);
        const altitudeSigma = altitude.std / FEET_PER_METER;
        reading.std = Math.hypot(reading.std, DEG_PER_RAD * d / denominator * altitudeSigma, DEG_PER_RAD * h / denominator * distance.std);
        navigation.glideSlopeErrorDeg = reading;
      }
    }
    const feedback = {};
    for (const key of FEEDBACK) {
      feedback[key] = this.scalar(`feedback.${key}`, snapshot[key], 0.01, tick);
      if (feedback[key].status === 'available') feedback[key].mean = Math.max(key === 'throttle' || key === 'brakes' ? 0 : -1, Math.min(1, feedback[key].mean));
    }
    if (tick >= this.contactTick) this.updateContact(snapshot.weightOnWheels, tick);
    feedback.weightOnWheels = !this.contactValid || this.contact === undefined
      ? { status: 'unavailable', value: null, sampleTick: tick, reason: 'missing-source' }
      : { status: 'available', value: this.contact, sampleTick: tick };
    const result = { instruments, navigation, feedback, visual: { contacts: [] }, capabilities: { visualContacts: false, trainingNavigation: true } };
    this.lastTick = tick;
    this.lastObservation = structuredClone(result);
    return result;
  }
}
