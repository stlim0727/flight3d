/** Bounded training wind, not an atmospheric turbulence-spectrum model. */
export const WIND_PROFILES = Object.freeze({
  'calm-debug-v1': Object.freeze({ crosswind: 0, gust: Object.freeze([0, 0, 0]) }),
  'mild-disturbance-v1': Object.freeze({ crosswind: 1.5, gust: Object.freeze([0.3, 0.6, 0.2]) }),
});

function seededRandom(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * A pure position/time field. Heading is degrees clockwise from north, crosswind
 * sign +1 blows runway-right. Amplitudes are along/right/up m/s; phase vectors
 * use world meters, omega radians per simulated second. Sampling order never
 * consumes random numbers, so a replay follows the same field on a new path.
 */
export class WindField {
  constructor({ profile = 'calm-debug-v1', seed = 0, runwayHeadingDeg = 90, crosswindSign = 1 } = {}) {
    if (!Object.hasOwn(WIND_PROFILES, profile)) throw new RangeError('Unknown wind profile');
    if (!Number.isFinite(runwayHeadingDeg)) throw new TypeError('Invalid runway heading');
    if (crosswindSign !== -1 && crosswindSign !== 1) throw new RangeError('Crosswind sign must be -1 or 1');
    if (!['string', 'number'].includes(typeof seed) || (typeof seed === 'number' && !Number.isFinite(seed))) {
      throw new TypeError('Wind seed must be a finite number or string');
    }
    this.profile = profile;
    this.seed = seed;
    this.runwayHeadingDeg = runwayHeadingDeg;
    this.crosswindSign = crosswindSign;
    const heading = runwayHeadingDeg * Math.PI / 180;
    this._sinHeading = Math.sin(heading);
    this._cosHeading = Math.cos(heading);
    this._meanRight = WIND_PROFILES[profile].crosswind * crosswindSign;
    const random = seededRandom(seed);
    this._modes = WIND_PROFILES[profile].gust.map(amplitude => Array.from({ length: 3 }, () => {
      const azimuth = random() * Math.PI * 2;
      const vertical = random() * 2 - 1;
      const horizontal = Math.sqrt(1 - vertical * vertical);
      const waveNumber = Math.PI * 2 / (300 + random() * 700);
      return Object.freeze({
        amplitude: amplitude / 3,
        kx: horizontal * Math.cos(azimuth) * waveNumber,
        ky: vertical * waveNumber,
        kz: horizontal * Math.sin(azimuth) * waveNumber,
        omega: Math.PI * 2 / (4 + random() * 8),
        phase: random() * Math.PI * 2,
      });
    }));
  }

  /** Mean world wind for preparing a steady approach before gust response. */
  mean(target = {}) {
    target.x = this._meanRight * this._cosHeading;
    target.y = 0;
    target.z = this._meanRight * this._sinHeading;
    return target;
  }

  /** Writes world-frame m/s into caller-owned target (e.g. THREE.Vector3). */
  sample(position, simTimeSeconds, target = {}) {
    if (![position?.x, position?.y, position?.z, simTimeSeconds].every(Number.isFinite)) {
      throw new TypeError('Wind sampling requires finite position and simulation time');
    }
    const values = [0, this._meanRight, 0];
    for (let axis = 0; axis < 3; axis++) {
      for (const mode of this._modes[axis]) {
        values[axis] += mode.amplitude * Math.sin(mode.kx * position.x + mode.ky * position.y
          + mode.kz * position.z + mode.omega * simTimeSeconds + mode.phase);
      }
    }
    const [along, right, up] = values;
    target.x = along * this._sinHeading + right * this._cosHeading;
    target.y = up;
    target.z = -along * this._cosHeading + right * this._sinHeading;
    return target;
  }
}

/** Opt-in only. Configure after a preset; clearing removes the last field wind. */
export function setSimulationWind(simulation, field = null) {
  if (field !== null && !(field instanceof WindField)) throw new TypeError('Expected WindField or null');
  simulation.windField = field;
  simulation.windTimeSeconds = 0;
  simulation.aero.windWorld.set(0, 0, 0);
}

/** One sample per integrated physics tick, independent of the render clock. */
export function advanceSimulationWind(simulation, dt) {
  if (!simulation.windField) return;
  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError('Invalid wind timestep');
  simulation.windField.sample(simulation.position, simulation.windTimeSeconds ?? 0, simulation.aero.windWorld);
  simulation.windTimeSeconds = (simulation.windTimeSeconds ?? 0) + dt;
}
