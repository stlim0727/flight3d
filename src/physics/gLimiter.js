import { Atmosphere } from './Atmosphere.js';

/** Pitch-envelope controller, not a force or telemetry clamp. Bounds commanded
 * pitch acceleration using a critically damped approach to the load boundary.
 * The caller converts the permitted moment back into a physical tail deflection.
 * Stateless: no stored correction can survive a release, reset or aircraft swap.
 */
export function limitedPitchMoment({ requestedMoment, inertia, pitchRate, alphaRate,
  normalG, gPerAlpha, limits }) {
  const bandwidth = 6; // rad/s; anticipate load onset rather than chase filtered HUD G
  const margin = 0.35; // reserve for tail force and discrete integration
  const lowerAcceleration = bandwidth ** 2 * (limits.min + margin - normalG) / gPerAlpha
    - 2 * bandwidth * alphaRate;
  const upperAcceleration = bandwidth ** 2 * (limits.max - margin - normalG) / gPerAlpha
    - 2 * bandwidth * alphaRate;
  // The production integrator applies 0.35/s angular damping after moments.
  const damping = 0.35 * pitchRate;
  return Math.max((lowerAcceleration + damping) * inertia,
    Math.min((upperAcceleration + damping) * inertia, requestedMoment));
}

/** d(alpha)/dt from body translational acceleration and angular velocity.
 * Body coordinates: +X right, +Y up, -Z forward. Gravity is already in aY/aZ.
 */
export function incidenceRate(u, v, w, omega, aY, aZ) {
  return omega.x + (-u * aY + w * aZ + v * (u * omega.z + w * omega.y))
    / Math.max(100, u * u + w * w);
}

export function loadSlope(aero, qDyn, alpha) {
  return Math.max(0.1, qDyn * aero.wingArea * aero.CLa * Math.cos(alpha)
    * aero.tuning.liftMultiplier / (aero.mass * Atmosphere.G0));
}
