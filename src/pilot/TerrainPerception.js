/** Virtual forward range instrument, not a human-vision or whole-sector clearance model. */
export const TERRAIN_SENSOR_VERSION = 'forward-terrain-range-v1';

const RAD = Math.PI / 180;
const DEFAULT_AZIMUTHS = [-60, -45, -30, -20, -10, -5, 5, 10, 20, 30, 45, 60];
const DEFAULT_ELEVATIONS = [-35, -25, -15, -5, 0, 10, 25];
const finite = value => typeof value === 'number' && Number.isFinite(value);

function uniform(seed, key, tick, component) {
  let h = 2166136261;
  for (const ch of `${seed}:${key}:${tick}:${component}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}

function gaussian(seed, key, tick) {
  return Math.sqrt(-2 * Math.log(uniform(seed, key, tick, 0))) * Math.cos(2 * Math.PI * uniform(seed, key, tick, 1));
}

function rotate(v, q) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx };
}

/**
 * sample({position:{x,y,z},quaternion:{x,y,z,w},getHeight(x,z)}, tick).
 * The trusted dispatcher calls this at 5 Hz. Body axes: +X right, +Y up, -Z forward.
 * Height queries must return NaN/undefined outside loaded terrain; unknown rays
 * become unavailable rather than clear. Intersections are finite-resolution
 * point rays (20 m march, <=5 mm refinement), not clearance for every angle
 * between samples, thin obstacles, trees or buildings. No raw geometry escapes.
 */
export class TerrainPerception {
  constructor({ sensorSeed = 1, noise = true, physicsHz = 120, maxRangeM = 2000,
    marchStepM = 20, azimuthsDeg = DEFAULT_AZIMUTHS, elevationsDeg = DEFAULT_ELEVATIONS } = {}) {
    if (!Number.isSafeInteger(sensorSeed) || typeof noise !== 'boolean' || !finite(physicsHz) || physicsHz <= 0 ||
        !finite(maxRangeM) || maxRangeM <= 0 || maxRangeM > 2000 ||
        !finite(marchStepM) || marchStepM < 5 || marchStepM > 20 ||
        !Array.isArray(azimuthsDeg) || !azimuthsDeg.length || azimuthsDeg.length > 12 ||
        !Array.isArray(elevationsDeg) || !elevationsDeg.length || elevationsDeg.length > 7 ||
        azimuthsDeg.some(v => !finite(v) || Math.abs(v) > 60) ||
        elevationsDeg.some(v => !finite(v) || v < -35 || v > 25)) throw new TypeError('Invalid terrain sensor profile');
    this.seed = sensorSeed; this.noise = noise; this.physicsHz = physicsHz;
    this.maxRangeM = maxRangeM; this.marchStepM = marchStepM;
    this.rays = elevationsDeg.flatMap(elevationDeg => azimuthsDeg.map(azimuthDeg => ({
      azimuthDeg, elevationDeg,
      direction: { x: Math.sin(azimuthDeg * RAD) * Math.cos(elevationDeg * RAD),
        y: Math.sin(elevationDeg * RAD), z: -Math.cos(azimuthDeg * RAD) * Math.cos(elevationDeg * RAD) },
    })));
    this.limits = { maxRangeM, marchStepM, azimuthMinDeg: Math.min(...azimuthsDeg),
      azimuthMaxDeg: Math.max(...azimuthsDeg), elevationMinDeg: Math.min(...elevationsDeg),
      elevationMaxDeg: Math.max(...elevationsDeg), columns: azimuthsDeg.length, rows: elevationsDeg.length,
      sampleHz: 5, sampling: 'point-rays', surface: 'terrain-only' };
    this.reset();
  }

  reset() { this.states = new Map(); this.lastTick = -1; this.lastResult = null; }

  sample(source, tick) {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick < this.lastTick) throw new RangeError('Nonmonotonic terrain sample tick');
    if (tick === this.lastTick) return structuredClone(this.lastResult);
    const p = source?.position, rawQ = source?.quaternion;
    let reason = null, q;
    if (!p || !['x', 'y', 'z'].every(k => finite(p[k])) || !rawQ || !['x', 'y', 'z', 'w'].every(k => finite(rawQ[k])) ||
        typeof source.getHeight !== 'function') reason = 'missing-source';
    else {
      const length = Math.hypot(rawQ.x, rawQ.y, rawQ.z, rawQ.w);
      if (!finite(length) || length < 1e-9) reason = 'invalid-orientation';
      else q = { x: rawQ.x / length, y: rawQ.y / length, z: rawQ.z / length, w: rawQ.w / length };
    }
    if (!reason) {
      try {
        const ground = source.getHeight(p.x, p.z);
        if (!finite(ground)) reason = 'terrain-unavailable';
        else if (p.y <= ground) reason = 'sensor-below-surface';
      } catch { reason = 'terrain-unavailable'; }
    }
    const cells = this.rays.map((ray, index) => {
      const cell = { azimuthDeg: ray.azimuthDeg, elevationDeg: ray.elevationDeg,
        status: 'unavailable', rangeM: null, sampleTick: tick };
      if (reason) return { ...cell, reason };
      try {
        const d = rotate(ray.direction, q);
        const distance = this.trace(p, d, source.getHeight);
        if (distance === null) return { ...cell, status: 'clear-to-range' };
        const std = this.noise ? 2 + 0.03 * distance : 0;
        const innovation = gaussian(this.seed, index, tick), previous = this.states.get(index);
        const rho = previous ? Math.exp(-(tick - previous.tick) / this.physicsHz) : 0;
        const z = previous ? rho * previous.z + Math.sqrt(1 - rho * rho) * innovation : innovation;
        this.states.set(index, { tick, z });
        return { ...cell, status: 'available', rangeM: {
          mean: Math.max(0.001, Math.min(this.maxRangeM, distance + std * z)), std,
        } };
      } catch { return { ...cell, reason: 'terrain-unavailable' }; }
    });
    const result = { modelVersion: TERRAIN_SENSOR_VERSION, frame: 'body', limits: { ...this.limits }, cells };
    this.lastTick = tick; this.lastResult = structuredClone(result);
    return result;
  }

  trace(p, d, getHeight) {
    const clearance = range => {
      const ground = getHeight(p.x + d.x * range, p.z + d.z * range);
      if (!finite(ground)) throw new Error('Unknown terrain');
      return p.y + d.y * range - ground;
    };
    let prior = 0;
    for (let range = Math.min(this.marchStepM, this.maxRangeM); ; range = Math.min(range + this.marchStepM, this.maxRangeM)) {
      if (clearance(range) <= 0) {
        let low = prior, high = range;
        for (let i = 0; i < 12; i++) {
          const mid = (low + high) / 2;
          if (clearance(mid) > 0) low = mid;
          else high = mid;
        }
        return high;
      }
      if (range === this.maxRangeM) return null;
      prior = range;
    }
  }
}
