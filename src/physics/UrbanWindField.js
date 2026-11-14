import { WindField } from './WindField.js';

/** Initial tuning of the analytic building-wake model (#696); not measured city data. */
export const URBAN_WIND = Object.freeze({
  profileExponent: 0.25, // power-law height profile of the mean wind
  profileOffset: 2, // m added to the height above water so the surface gradient stays finite
  ceilingY: 500, // m; the mean wind is constant above this world height
  verticalFade: 30, // m above the street over which vertical wind fades in
  deficit: 0.6, // peak mean-speed loss just behind a tower
  rise: 0.25, // wake onset, in reference lengths either side of the lee face
  decayLengths: 4, // deficit halves this many reference lengths downwind
  fadeStart: 8, fadeEnd: 12, // reference lengths over which the wake ends smoothly
  spread: 0.1, // lateral wake growth per metre downwind
  roofBlend: 0.15, roofBlendMin: 10, roofSpread: 0.05, // roof shear-layer half thickness
  intensity: 0.45, intensityCap: 0.35, // wake turbulence relative to the local profile speed
  waveMin: 40, waveMax: 160, // m; wavelengths of the wake turbulence modes
  upWeight: 0.7, // vertical share of the wake turbulence
});

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The generator WindField keeps private; repeated because WindField.js stays unchanged.
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
 * WindField plus a mean wind that buildings shelter. World metres, +X east, +Y up,
 * +Z south; `meanFromDeg` is the direction the wind comes from, clockwise from north,
 * and `meanSpeed` its speed at `referenceHeight`. Obstacles are boxes standing on
 * `streetY`: centre [x, z], local width `w` along X and depth `d` along Z before
 * rotating `rot` radians about +Y, roof `h` metres above the street. The base field
 * supplies the background disturbance unchanged. A real-time approximation: no
 * channelling, corner acceleration or flow reversal, and not divergence-free.
 */
export class UrbanWindField extends WindField {
  constructor({ meanFromDeg = 0, meanSpeed = 0, referenceHeight = 110, streetY = 0, waterY = 0,
    obstacles = [], ...base } = {}) {
    super(base);
    if (![meanFromDeg, meanSpeed, referenceHeight, streetY, waterY].every(Number.isFinite)
      || meanSpeed < 0 || referenceHeight <= waterY || waterY > streetY) {
      throw new RangeError('Invalid urban wind profile');
    }
    if (!Array.isArray(obstacles) || !obstacles.every(o => [o?.x, o?.z, o?.rot].every(Number.isFinite)
      && [o.w, o.d, o.h].every(v => Number.isFinite(v) && v > 0))) {
      throw new TypeError('Invalid urban wind obstacles');
    }
    Object.assign(this, { meanFromDeg, meanSpeed, referenceHeight, streetY, waterY });
    const from = meanFromDeg * Math.PI / 180;
    // Unit vectors in world [x, z]: the wind blows toward e; n is across it.
    this._ex = -Math.sin(from); this._ez = Math.cos(from);
    this._nx = Math.cos(from); this._nz = Math.sin(from);
    this._profileScale = 1 / (referenceHeight - waterY + URBAN_WIND.profileOffset);
    this._towers = obstacles.map(o => {
      // THREE's rotateY: local X is world [cos, -sin], local Z is world [sin, cos].
      const cos = Math.cos(o.rot), sin = Math.sin(o.rot);
      const across = (Math.abs(this._nx * cos - this._nz * sin) * o.w + Math.abs(this._nx * sin + this._nz * cos) * o.d) / 2;
      const along = (Math.abs(this._ex * cos - this._ez * sin) * o.w + Math.abs(this._ex * sin + this._ez * cos) * o.d) / 2;
      return { x: o.x, z: o.z, h: o.h, halfWidth: across, halfDepth: along, length: Math.min(2 * across, o.h) };
    });
    const random = seededRandom(`${this.seed}:city`);
    // Rows: along / across / up component. Unit total amplitude per component.
    this._cityModes = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => {
      const azimuth = random() * Math.PI * 2;
      const vertical = random() * 2 - 1;
      const horizontal = Math.sqrt(1 - vertical * vertical);
      const waveNumber = Math.PI * 2 / (URBAN_WIND.waveMin + random() * (URBAN_WIND.waveMax - URBAN_WIND.waveMin));
      return { kx: horizontal * Math.cos(azimuth) * waveNumber, ky: vertical * waveNumber,
        kz: horizontal * Math.sin(azimuth) * waveNumber, phase: random() * Math.PI * 2 };
    }));
    this._city = { shelter: 1, intensity: 0 };
  }

  /** Unsheltered mean speed (m/s) at world height y. */
  speedAt(y) {
    const height = Math.max(this.waterY, Math.min(URBAN_WIND.ceilingY, y)) - this.waterY + URBAN_WIND.profileOffset;
    return this.meanSpeed * Math.pow(height * this._profileScale, URBAN_WIND.profileExponent);
  }

  // Shelter factor (0..1) and wake turbulence intensity from every tower's wake.
  _wakes(x, y, z) {
    const u = URBAN_WIND, height = y - this.streetY;
    let shelter = 1, sum = 0;
    for (const t of this._towers) {
      const rx = x - t.x, rz = z - t.z;
      const s = rx * this._ex + rz * this._ez - t.halfDepth;
      const xi = s / t.length;
      if (xi <= -u.rise || xi >= u.fadeEnd) continue;
      const n = rx * this._nx + rz * this._nz, downwind = Math.max(0, s);
      const strength = smoothstep(-u.rise, u.rise, xi) / (1 + xi / u.decayLengths)
        * (1 - smoothstep(u.fadeStart, u.fadeEnd, xi));
      const sigma = t.halfWidth + u.spread * downwind;
      const delta = Math.max(u.roofBlendMin, u.roofBlend * t.length) + u.roofSpread * downwind;
      const core = Math.exp(-n * n / (2 * sigma * sigma)) * (1 - smoothstep(t.h - delta, t.h + delta, height));
      shelter *= 1 - u.deficit * strength * core;
      const wide = Math.exp(-n * n / (4.5 * sigma * sigma))
        * (1 - smoothstep(t.h - 0.5 * delta, t.h + 2.5 * delta, height));
      const local = u.intensity * strength * wide * (1 - 0.5 * core);
      sum += local * local;
    }
    this._city.shelter = shelter;
    this._city.intensity = u.intensityCap * Math.tanh(Math.sqrt(sum) / u.intensityCap);
    return this._city;
  }

  /** Background mean at the reference height, away from buildings. */
  mean(target = {}) {
    super.mean(target);
    target.x += this.meanSpeed * this._ex;
    target.z += this.meanSpeed * this._ez;
    return target;
  }

  /** Mean wind at a world position: height profile and building shelter, no gusts. */
  meanAt(position, target = {}) {
    const speed = this.speedAt(position.y) * this._wakes(position.x, position.y, position.z).shelter;
    super.mean(target);
    target.x += speed * this._ex;
    target.z += speed * this._ez;
    return target;
  }

  /** Wake turbulence amplitude scale (m/s) at a world position, for maps and tests. */
  turbulenceAt(position) {
    return this._wakes(position.x, position.y, position.z).intensity * this.speedAt(position.y);
  }

  sample(position, simTimeSeconds, target = {}) {
    // Read first: callers may pass the same object as position and target.
    const px = position?.x, py = position?.y, pz = position?.z;
    super.sample(position, simTimeSeconds, target);
    const { shelter, intensity } = this._wakes(px, py, pz);
    const speed = this.speedAt(py);
    let x = target.x + speed * shelter * this._ex;
    let y = target.y;
    let z = target.z + speed * shelter * this._ez;
    const sigma = intensity * speed;
    if (sigma > 0) {
      // The pattern drifts downwind with the reference mean wind.
      const ax = px - this.meanSpeed * this._ex * simTimeSeconds;
      const az = pz - this.meanSpeed * this._ez * simTimeSeconds;
      const parts = [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) {
        for (const mode of this._cityModes[axis]) {
          parts[axis] += Math.sin(mode.kx * ax + mode.ky * py + mode.kz * az + mode.phase) / 3;
        }
      }
      x += sigma * (parts[0] * this._ex + parts[1] * this._nx);
      z += sigma * (parts[0] * this._ez + parts[1] * this._nz);
      y += sigma * URBAN_WIND.upWeight * parts[2];
    }
    target.x = x;
    target.y = y * smoothstep(this.streetY, this.streetY + URBAN_WIND.verticalFade, py);
    target.z = z;
    return target;
  }
}
