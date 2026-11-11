import { BOOL_FIELDS, COMPRESSION_LEGS } from './ReplayCodec.js';
import { Atmosphere } from '../physics/Atmosphere.js';
const LINEAR_FIELDS = Object.freeze(['x', 'y', 'z', 'elevator', 'aileron', 'rudder', 'pitchTrim',
  'flapDegree', 'spoilers', 'gearState', 'throttle', 'iasKnots', 'tasKnots', 'groundSpeedKnots',
  'vsiFpm', 'radioAltFt', 'mach', 'gForce', 'pitchDeg', 'rollDeg']);
const DISCRETE_FIELDS = Object.freeze(['flapIndex', 'selectedHeading', 'selectedAltitude', 'selectedSpeed']);
const ENGINE_SCALARS = Object.freeze(['n1', 'n2', 'egt', 'ff']);

/**
 * Everything a viewer needs besides the transform: instruments, controls, configuration.
 * `y` stays out because telemetry reports height as altitudeFt, never as metres.
 */
export const STATE_FIELDS = Object.freeze([
  ...LINEAR_FIELDS.filter(name => name !== 'y'),
  ...DISCRETE_FIELDS, ...BOOL_FIELDS, 'parkBrake', 'altitudeFt', 'headingDeg',
]);
/** Sample values that are objects, so a viewer must adopt them by reference, not copy numbers. */
export const OBJECT_FIELDS = Object.freeze(['compressions', 'gearDamage', 'bodyDamage', 'engine1', 'engine2']);

function lerp(a, b, alpha) {
  return a + (b - a) * alpha;
}

/** A track that has not been through the codec yet can still hold absent optional fields. */
function num(value) {
  return Number.isFinite(value) ? value : 0;
}

/** Heading is circular, so the shortest way round is taken instead of the numeric one. */
function lerpDegrees(a, b, alpha) {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * alpha + 360) % 360;
}

function slerp(out, a, b, alpha) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  dot = Math.min(1, dot * sign);
  const theta = Math.acos(dot);
  if (theta < 1e-6) {
    for (let index = 0; index < 4; index++) out[index] = a[index] + ((b[index] * sign) - a[index]) * alpha;
    const length = Math.hypot(...out) || 1;
    for (let index = 0; index < 4; index++) out[index] /= length;
    return out;
  }
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - alpha) * theta) / sinTheta;
  const wb = Math.sin(alpha * theta) / sinTheta * sign;
  for (let index = 0; index < 4; index++) out[index] = wa * a[index] + wb * b[index];
  const length = Math.hypot(...out) || 1;
  for (let index = 0; index < 4; index++) out[index] /= length;
  return out;
}

/** Index of the sample at or before `timeSec`, never the final sample (so i + 1 always exists). */
export function findSpan(samples, timeSec, hint = 0) {
  let low = 0;
  let high = samples.length - 2;
  if (high < 0) return 0;
  if (hint >= 0 && hint <= high && timeSec >= samples[hint].timeSec && timeSec < samples[hint + 1].timeSec) {
    return hint;
  }
  if (timeSec < samples[0].timeSec) return 0;
  if (timeSec >= samples[high + 1].timeSec) return high;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (samples[middle].timeSec <= timeSec) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * Interpolated pose and configuration at `timeSec`, or null when the request cannot be answered.
 * Times outside the track clamp to its ends rather than extrapolating physics that never happened.
 */
export function sampleTrack(track, timeSec, out = {}, state = {}) {
  const samples = track?.samples;
  if (!Number.isFinite(timeSec) || !Array.isArray(samples) || samples.length < 2) return null;
  if (state.hint === undefined) state.hint = 0;
  const time = Math.max(samples[0].timeSec, Math.min(samples.at(-1).timeSec, timeSec));
  const index = findSpan(samples, time, state.hint);
  state.hint = index;
  const a = samples[index];
  const b = samples[index + 1] ?? a;
  const alpha = spanAlpha(a, b, time);
  out.timeSec = time;
  for (const name of LINEAR_FIELDS) out[name] = lerp(num(a[name]), num(b[name]), alpha);
  out.headingDeg = lerpDegrees(num(a.headingDeg), num(b.headingDeg), alpha);
  out.rollDeg = ((lerpDegrees(num(a.rollDeg), num(b.rollDeg), alpha) + 180) % 360) - 180;
  out.altitudeFt = Atmosphere.metersToFeet(out.y);
  for (const name of DISCRETE_FIELDS) out[name] = num(alpha < 0.5 ? a[name] : b[name]);
  for (const name of BOOL_FIELDS) out[name] = (alpha < 0.5 ? a[name] : b[name]) === true;
  out.quat = out.quat || [0, 0, 0, 1];
  slerp(out.quat, a.quat, b.quat, alpha);
  out.compressions = out.compressions || {};
  for (const leg of COMPRESSION_LEGS) {
    out.compressions[leg] = lerp(num(a.compressions?.[leg]), num(b.compressions?.[leg]), alpha);
  }
  const discrete = alpha < 0.5 ? a : b;
  out.gearDamage = discrete.gearDamage;
  out.bodyDamage = discrete.bodyDamage;
  out.parkBrake = Boolean(discrete.parkBrake);
  for (let engine = 1; engine <= 2; engine++) {
    const from = a[`engine${engine}`] || {};
    const to = b[`engine${engine}`] || {};
    const target = out[`engine${engine}`] || (out[`engine${engine}`] = {});
    for (const name of ENGINE_SCALARS) target[name] = lerp(num(from[name]), num(to[name]), alpha);
    target.failed = (discrete[`engine${engine}`]?.failed) === true;
  }
  return out;
}

/**
 * Position inside a span. A respawn or restart between two samples is a teleport, so the
 * earlier pose holds until the next segment's first sample instead of flying between them.
 */
function spanAlpha(a, b, time) {
  if (time >= b.timeSec) return 1;
  if ((a.segment ?? 0) !== (b.segment ?? 0)) return 0;
  const span = b.timeSec - a.timeSec;
  return span > 0 ? Math.min(1, Math.max(0, (time - a.timeSec) / span)) : 0;
}

/**
 * Pose of one remote aircraft from a room track (#646), or null when it cannot be answered.
 * `visible` is false while this client could not see that pilot; nothing is blended across
 * a gap or a respawn.
 */
export function sampleRemote(track, remoteIndex, timeSec, out = {}, state = {}) {
  const samples = track?.remotes?.[remoteIndex]?.samples;
  if (!Number.isFinite(timeSec) || !Array.isArray(samples) || samples.length < 2) return null;
  if (state.hint === undefined) state.hint = 0;
  const time = Math.max(samples[0].timeSec, Math.min(samples.at(-1).timeSec, timeSec));
  const index = findSpan(samples, time, state.hint);
  state.hint = index;
  const a = samples[index];
  const b = samples[index + 1] ?? a;
  let alpha = spanAlpha(a, b, time);
  // Appearing or vanishing is a step: an unseen sample has no pose to blend toward.
  if (!(a.visible && b.visible) && alpha < 1) alpha = 0;
  const discrete = alpha < 0.5 ? a : b;
  out.timeSec = time;
  out.visible = discrete.visible === true;
  out.x = lerp(num(a.x), num(b.x), alpha);
  out.y = lerp(num(a.y), num(b.y), alpha);
  out.z = lerp(num(a.z), num(b.z), alpha);
  out.quat = out.quat || [0, 0, 0, 1];
  slerp(out.quat, a.quat, b.quat, alpha);
  out.gearState = lerp(num(a.gearState), num(b.gearState), alpha);
  out.flapDegree = lerp(num(a.flapDegree), num(b.flapDegree), alpha);
  for (const name of ['crashed', 'held', 'stale']) out[name] = discrete[name] === true;
  out.segment = discrete.segment ?? 0;
  return out;
}

export function trackDuration(track) {
  const samples = track?.samples;
  if (!Array.isArray(samples) || !samples.length) return 0;
  return Math.max(Number(track.durationSec) || 0, samples.at(-1).timeSec);
}
