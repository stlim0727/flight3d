/** Bounded training wind, not an atmospheric turbulence-spectrum model. */
export const WIND_PROFILES = Object.freeze({
  'calm-debug-v1': Object.freeze({ crosswind: 0, gust: Object.freeze([0, 0, 0]) }),
  'mild-disturbance-v1': Object.freeze({ crosswind: 1.5, gust: Object.freeze([0.3, 0.6, 0.2]) }),
  'light-turbulence-v1': Object.freeze({ crosswind: 0, gust: Object.freeze([0.3, 0.6, 0.2]) }),
  // Medium/strong also resolve wing-scale vertical gusts in the same world field.
  'moderate-turbulence-v1': Object.freeze({ crosswind: 0, gust: Object.freeze([0.9, 1.8, 0.6]), wingGust: 0.8 }),
  'strong-turbulence-v1': Object.freeze({ crosswind: 0, gust: Object.freeze([1.8, 3.6, 1.2]), wingGust: 1.6 }),
  'incheon-crosswind-v1': Object.freeze({ crosswind: 9.5, gust: Object.freeze([2.8, 3.5, 1.8]) }),
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
  constructor({ profile = 'calm-debug-v1', seed = 0, runwayHeadingDeg = 90, crosswindSign = 1,
    mean, gust, wingGust, spatialScale = 1, timeScale = 1, region = null } = {}) {
    if (!Object.hasOwn(WIND_PROFILES, profile)) throw new RangeError('Unknown wind profile');
    if (!Number.isFinite(runwayHeadingDeg)) throw new TypeError('Invalid runway heading');
    if (crosswindSign !== -1 && crosswindSign !== 1) throw new RangeError('Crosswind sign must be -1 or 1');
    if (!['string', 'number'].includes(typeof seed) || (typeof seed === 'number' && !Number.isFinite(seed))) {
      throw new TypeError('Wind seed must be a finite number or string');
    }
    const preset = WIND_PROFILES[profile];
    // Components are along/right/up m/s in the fixed heading basis.
    mean ??= [0, preset.crosswind * crosswindSign, 0];
    gust ??= preset.gust;
    wingGust ??= preset.wingGust ?? 0;
    for (const [name, vector] of [['mean', mean], ['gust', gust]]) {
      if (!Array.isArray(vector) || vector.length !== 3
        || !Array.from(vector).every(value => Number.isFinite(value) && (name === 'mean' || value >= 0))) {
        throw new TypeError(`Invalid ${name} wind components`);
      }
    }
    if (!Number.isFinite(wingGust) || wingGust < 0
      || !Number.isFinite(spatialScale) || spatialScale <= 0
      || !Number.isFinite(timeScale) || timeScale <= 0) throw new RangeError('Invalid wind scales');
    if (region !== null) {
      if (!['x', 'y', 'z'].every(axis => Number.isFinite(region.center?.[axis]))
        || !Number.isFinite(region.radius) || region.radius <= 0
        || !Number.isFinite(region.fade) || region.fade <= 0 || region.fade > region.radius) {
        throw new RangeError('Invalid wind region');
      }
      this.region = Object.freeze({ center: Object.freeze({ ...region.center }),
        radius: region.radius, fade: region.fade });
    } else this.region = null;
    this._mean = Object.freeze([...mean]);
    this.profile = profile;
    this.seed = seed;
    this.runwayHeadingDeg = runwayHeadingDeg;
    this.crosswindSign = crosswindSign;
    const heading = runwayHeadingDeg * Math.PI / 180;
    this._sinHeading = Math.sin(heading);
    this._cosHeading = Math.cos(heading);
    const random = seededRandom(seed);
    this._modes = gust.map(amplitude => Array.from({ length: 3 }, () => {
      const azimuth = random() * Math.PI * 2;
      const vertical = random() * 2 - 1;
      const horizontal = Math.sqrt(1 - vertical * vertical);
      const waveNumber = Math.PI * 2 / (300 + random() * 700);
      return Object.freeze({
        amplitude: amplitude / 3,
        kx: horizontal * Math.cos(azimuth) * waveNumber / spatialScale,
        ky: vertical * waveNumber / spatialScale,
        kz: horizontal * Math.sin(azimuth) * waveNumber / spatialScale,
        omega: Math.PI * 2 / (4 + random() * 8) * timeScale,
        phase: random() * Math.PI * 2,
      });
    }));
    // Long along-track coherence, shorter cross-track scale: nearby wings can
    // encounter different updrafts. Anchored in world space, never to the aircraft.
    const wingRandom = seededRandom(`${seed}:wing-gust`);
    this._wingModes = wingGust > 0 ? Array.from({ length: 3 }, () => ({
      amplitude: wingGust / 3,
      alongWaveNumber: Math.PI * 2 / (1500 + wingRandom() * 1000) / spatialScale,
      rightWaveNumber: Math.PI * 2 / (70 + wingRandom() * 80) / spatialScale,
      omega: Math.PI * 2 / (5 + wingRandom() * 5) * timeScale,
      phase: wingRandom() * Math.PI * 2,
    })) : [];
  }

  /** Mean world wind for preparing a steady approach before gust response. */
  mean(target = {}) {
    const [along, right, up] = this._mean;
    target.x = along * this._sinHeading + right * this._cosHeading;
    target.y = up;
    target.z = -along * this._cosHeading + right * this._sinHeading;
    return target;
  }

  /** Writes world-frame m/s into caller-owned target (e.g. THREE.Vector3). */
  sample(position, simTimeSeconds, target = {}) {
    if (![position?.x, position?.y, position?.z, simTimeSeconds].every(Number.isFinite)) {
      throw new TypeError('Wind sampling requires finite position and simulation time');
    }
    const values = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      for (const mode of this._modes[axis]) {
        values[axis] += mode.amplitude * Math.sin(mode.kx * position.x + mode.ky * position.y
          + mode.kz * position.z + mode.omega * simTimeSeconds + mode.phase);
      }
    }
    let [along, right, up] = values;
    const alongPosition = position.x * this._sinHeading - position.z * this._cosHeading;
    const rightPosition = position.x * this._cosHeading + position.z * this._sinHeading;
    for (const mode of this._wingModes) {
      up += mode.amplitude * Math.sin(mode.alongWaveNumber * alongPosition
        + mode.rightWaveNumber * rightPosition + mode.omega * simTimeSeconds + mode.phase);
    }
    // Localize only disturbances: the background mean persists outside the region.
    let weight = 1;
    if (this.region) {
      const { center, radius, fade } = this.region;
      const distance = Math.hypot(position.x - center.x, position.y - center.y, position.z - center.z);
      const t = Math.max(0, Math.min(1, (radius - distance) / fade));
      weight = t * t * (3 - 2 * t);
    }
    along = this._mean[0] + weight * along;
    right = this._mean[1] + weight * right;
    up = this._mean[2] + weight * up;
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
  simulation.aero.windLeftWorld?.set(0, 0, 0);
  simulation.aero.windRightWorld?.set(0, 0, 0);
}

/** Sample center and wings at one physics time; advance the clock once per tick. */
export function advanceSimulationWind(simulation, dt) {
  if (!simulation.windField) return;
  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError('Invalid wind timestep');
  simulation.windField.sample(simulation.position, simulation.windTimeSeconds ?? 0, simulation.aero.windWorld);
  const aero = simulation.aero;
  if (aero.windLeftWorld && aero.windRightWorld) {
    // Half-wing area centroids for the two-panel approximation, in body axes.
    // Reuse the wind output vectors as sample positions before overwriting them.
    const arm = aero.wingspan / 4;
    for (const [target, sign] of [[aero.windLeftWorld, -1], [aero.windRightWorld, 1]]) {
      target.set(sign * arm, 0, 0).applyQuaternion(simulation.quaternion).add(simulation.position);
      simulation.windField.sample(target, simulation.windTimeSeconds ?? 0, target);
    }
  }
  simulation.windTimeSeconds = (simulation.windTimeSeconds ?? 0) + dt;
}
