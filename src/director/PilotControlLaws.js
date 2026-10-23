import * as THREE from 'three';

// Autoflight alpha protection, like a real flight-director limiter: caps nose-up
// elevator as AoA climbs and commands an uncommanded-pitch-down recovery above the margin.
export function alphaGuarded(elevatorCmd, alphaDeg) {
  if (alphaDeg <= 11.0) return elevatorCmd;
  const cap = THREE.MathUtils.clamp(0.8 - (alphaDeg - 11.0) * 0.37, -0.35, 0.8);
  return Math.min(elevatorCmd, cap);
}

/**
 * Roll command solved from the rolling-moment model instead of a proportional
 * gain on bank error.
 */
export function flyBank(sim, targetRollDeg, tel) {
  const aero = sim.aero;
  const rate = sim.angularVelocity.z;
  const desiredRate = -THREE.MathUtils.clamp(THREE.MathUtils.degToRad(targetRollDeg - tel.rollDeg) * 1.4, -0.35, 0.35);
  const acceleration = (desiredRate - rate) * 3;
  const qSb = Math.max(1, aero.qDyn * aero.wingArea * aero.wingspan);
  const pHat = rate * aero.wingspan / (2 * Math.max(10, aero.tas));
  const coefficient = -aero.Ixx * acceleration / qSb;
  const aileron = (coefficient - aero.Cl_b * aero.beta - Math.abs(aero.Cl_p) * pHat) / (aero.Cl_da * 1.05 * THREE.MathUtils.degToRad(20));
  sim.controls.setVirtualInput('aileron', THREE.MathUtils.clamp(aileron, -1, 1));
}

/**
 * Vertical-path command solved by inverting the lift and pitch-moment model.
 *
 * With groundPitch null it flies a flight-path-angle target: the required lift
 * carries the path acceleration plus the closed-loop correction on vertical
 * speed, and thrust is trimmed to the indicated airspeed target, scaled by
 * throttleScale for a power reduction that is commanded by height rather than
 * by airspeed. With a groundPitch it commands that body attitude directly and
 * feeds in the gear's pitch moment, which is how a rollout holds a decaying
 * nose-up attitude while the nose gear is lowered under control.
 */
export function flyVerticalPath(sim, targetVz, targetIas, tel, pathAcceleration = 0, groundPitch = null, throttleScale = 1) {
  const aero = sim.aero;
  const speed = Math.max(30, Math.hypot(sim.linearVelocity.x, sim.linearVelocity.z));
  const flapCl0 = aero.CL0_clean + 0.95 * aero.currentFlapAngle / 40;
  const bank = THREE.MathUtils.degToRad(tel.rollDeg);
  const requiredCl = aero.mass * (9.80665 + THREE.MathUtils.clamp(pathAcceleration + (targetVz - sim.linearVelocity.y) * 1.2, -3, 4)) / Math.max(1, aero.qDyn * aero.wingArea * Math.cos(bank));
  const alpha = THREE.MathUtils.clamp((requiredCl - flapCl0) / aero.CLa, 0.02, THREE.MathUtils.degToRad(13.5));
  const targetPitch = groundPitch === null ? Math.atan2(sim.linearVelocity.y, speed) + alpha : THREE.MathUtils.degToRad(groundPitch);
  const pitch = THREE.MathUtils.degToRad(tel.pitchDeg);
  const q = sim.angularVelocity.x;
  const desiredRate = THREE.MathUtils.clamp((targetPitch - pitch) * 1.2, -0.12, 0.12);
  const desiredAcceleration = (desiredRate - q) * 2.5;
  const qSc = Math.max(1, aero.qDyn * aero.wingArea * aero.meanChord);
  const thrustMoment = (sim.engines.thrust[0] + sim.engines.thrust[1]) * 0.32;
  const gearMoment = groundPitch === null ? 0 : sim.gear.lastMomentBody.x;
  const requiredCm = (aero.Iyy * desiredAcceleration - thrustMoment - gearMoment) / qSc;
  const qHat = q * aero.meanChord / (2 * Math.max(10, aero.tas));
  const effectiveElevator = (requiredCm - aero.Cm0 - aero.Cma * aero.alpha - aero.Cmq * qHat) / -aero.Cm_de;
  const elevator = (effectiveElevator - THREE.MathUtils.degToRad(aero.pitchTrim) * 0.35) / THREE.MathUtils.degToRad(20);
  sim.controls.setVirtualInput('elevator', alphaGuarded(THREE.MathUtils.clamp(elevator, -0.8, 0.8), THREE.MathUtils.radToDeg(aero.alpha)));
  if (groundPitch === null) sim.controls.setVirtualInput('throttle', THREE.MathUtils.clamp(0.50 + (targetIas - tel.iasKnots) * 0.035 + targetVz * 0.02, 0.05, 0.95) * throttleScale);
}
