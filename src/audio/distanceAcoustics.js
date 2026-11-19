/**
 * Distance acoustics for exterior camera views: sound pressure falls off with
 * distance and air absorbs high frequencies first, so far views get quieter
 * and duller. Values are tuned for scene units in meters (chase 20-140 m,
 * drone 16-85 m, tower several hundred meters).
 *
 * The near-field floor keeps a tower flyby audible, but it must not turn a
 * camera parked beside a bandit kilometres away into a cockpit seat: the floor
 * fades out between 800 m and 4.2 km so the host engine leaves the mix.
 */

export const NEAR_FIELD_GAIN = 1.0;
const GAIN_FLOOR = 0.08;
const GAIN_HALF_DISTANCE = 60;
const GAIN_FLOOR_FADE_START = 600;
const GAIN_FLOOR_FADE_END = 2400;
const NEAR_FIELD_CUTOFF = 8800;
const CUTOFF_FLOOR = 1500;
const CUTOFF_HALF_DISTANCE = 220;

export const SPEED_OF_SOUND_MPS = 343;
const MAX_PROPAGATION_DELAY_SECONDS = 8;
const DOPPLER_MIN = 0.65;
const DOPPLER_MAX = 1.4;

const REMOTE_ENGINE_MAX_GAIN = 0.55;
const REMOTE_ENGINE_HALF_DISTANCE = 900;
const REMOTE_ENGINE_RANGE = 8000;
const REMOTE_ENGINE_NEAR_CUTOFF = 5200;
const REMOTE_ENGINE_CUTOFF_FLOOR = 320;
const REMOTE_ENGINE_CUTOFF_HALF_DISTANCE = 1100;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const coordinate = (vector, axis) => (Number.isFinite(vector?.[axis]) ? vector[axis] : 0);

export function exteriorDistanceGain(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return NEAR_FIELD_GAIN;
  const raw = 1 / (1 + (meters / GAIN_HALF_DISTANCE) ** 2);
  const floor = GAIN_FLOOR * clamp(
    1 - (meters - GAIN_FLOOR_FADE_START) / (GAIN_FLOOR_FADE_END - GAIN_FLOOR_FADE_START),
    0, 1);
  return Math.max(raw, floor);
}

export function exteriorAirCutoff(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return NEAR_FIELD_CUTOFF;
  return Math.max(CUTOFF_FLOOR, NEAR_FIELD_CUTOFF / (1 + (meters / CUTOFF_HALF_DISTANCE) ** 2));
}

/** Sound needs time to cross the scene: one second per 343 m, capped for gameplay. */
export function propagationDelaySeconds(meters, speedOfSound = SPEED_OF_SOUND_MPS) {
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  const speed = Number.isFinite(speedOfSound) && speedOfSound > 0 ? speedOfSound : SPEED_OF_SOUND_MPS;
  return Math.min(MAX_PROPAGATION_DELAY_SECONDS, meters / speed);
}

/**
 * Observed/source frequency ratio for a moving source and listener. The
 * listener velocity matters because chase cameras travel with the aircraft and
 * must not hear its approach; a tower camera must. The ratio is clamped so a
 * transonic pass does not screech.
 */
export function dopplerFactor(sourcePosition, sourceVelocity, listenerPosition, listenerVelocity, speedOfSound = SPEED_OF_SOUND_MPS) {
  if (!sourcePosition || !listenerPosition) return 1;
  const dx = coordinate(listenerPosition, 'x') - coordinate(sourcePosition, 'x');
  const dy = coordinate(listenerPosition, 'y') - coordinate(sourcePosition, 'y');
  const dz = coordinate(listenerPosition, 'z') - coordinate(sourcePosition, 'z');
  const distance = Math.hypot(dx, dy, dz);
  if (!(distance > 1e-3)) return 1;
  const ux = dx / distance, uy = dy / distance, uz = dz / distance;
  const sourceToward = coordinate(sourceVelocity, 'x') * ux
    + coordinate(sourceVelocity, 'y') * uy + coordinate(sourceVelocity, 'z') * uz;
  const listenerToward = coordinate(listenerVelocity, 'x') * ux
    + coordinate(listenerVelocity, 'y') * uy + coordinate(listenerVelocity, 'z') * uz;
  const speed = Number.isFinite(speedOfSound) && speedOfSound > 0 ? speedOfSound : SPEED_OF_SOUND_MPS;
  const observerTerm = speed - listenerToward;
  const sourceTerm = speed - sourceToward;
  if (sourceTerm <= 1) return DOPPLER_MAX;
  return clamp(observerTerm / sourceTerm, DOPPLER_MIN, DOPPLER_MAX);
}

/** One opposing aircraft engine is quieter than the listener's own cockpit mix. */
export function remoteEngineGain(meters) {
  if (!Number.isFinite(meters) || meters < 0 || meters >= REMOTE_ENGINE_RANGE) return 0;
  return REMOTE_ENGINE_MAX_GAIN / (1 + (meters / REMOTE_ENGINE_HALF_DISTANCE) ** 2);
}

export function remoteEngineCutoff(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return REMOTE_ENGINE_NEAR_CUTOFF;
  return Math.max(REMOTE_ENGINE_CUTOFF_FLOOR,
    REMOTE_ENGINE_NEAR_CUTOFF / (1 + meters / REMOTE_ENGINE_CUTOFF_HALF_DISTANCE));
}

/**
 * Stereo placement from the listener's right axis. A source directly ahead,
 * behind or overhead stays centred; wingtip passes reach the outer channels.
 */
export function stereoPan(sourcePosition, listenerPosition, listenerRight) {
  if (!sourcePosition || !listenerPosition || !listenerRight) return 0;
  const dx = coordinate(sourcePosition, 'x') - coordinate(listenerPosition, 'x');
  const dy = coordinate(sourcePosition, 'y') - coordinate(listenerPosition, 'y');
  const dz = coordinate(sourcePosition, 'z') - coordinate(listenerPosition, 'z');
  const distance = Math.hypot(dx, dy, dz);
  if (!(distance > 1e-3)) return 0;
  const pan = (dx / distance) * coordinate(listenerRight, 'x')
    + (dy / distance) * coordinate(listenerRight, 'y')
    + (dz / distance) * coordinate(listenerRight, 'z');
  return clamp(pan, -0.85, 0.85);
}
