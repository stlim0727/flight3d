/** Experimental SDK-only training pilot. Not calibrated or proven to complete a mission. */
export function createPilot() {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const read = sensor => sensor?.status === 'available' && Number.isFinite(sensor.mean) ? sensor.mean : null;
  let phase, previousRoll, previousPitch, rotationSpeed, climbSpeed, dt, command;
  function reset(briefing = {}) {
    phase = 'roll'; previousRoll = previousPitch = null;
    rotationSpeed = Number.isFinite(briefing.recommendedSpeeds?.rotationKnots) ? briefing.recommendedSpeeds.rotationKnots : 140;
    climbSpeed = Number.isFinite(briefing.recommendedSpeeds?.climbKnots) ? briefing.recommendedSpeeds.climbKnots : 165;
    dt = Number.isFinite(briefing.decisionPeriodSeconds) && briefing.decisionPeriodSeconds > 0 ? briefing.decisionPeriodSeconds : 0.2;
    command = { elevator: 0, aileron: 0, rudder: 0, throttle: 0, brakes: 0 };
  }
  reset();
  return {
    reset,
    onTick(observation) {
      const instruments = observation?.instruments || {}, navigation = observation?.navigation || {};
      const speed = read(instruments.iasKnots), pitch = read(instruments.pitchDeg), roll = read(instruments.rollDeg);
      const height = read(instruments.radioAltFt), vsi = read(instruments.vsiFpm);
      const headingError = read(navigation.headingErrorDeg), centerline = read(navigation.centerlineOffsetM);
      // Missing data never creates a new full-throttle command or wipes state.
      if ([speed, pitch, roll, height, vsi, headingError, centerline].some(v => v === null)) return { ...command };
      const rollRate = previousRoll === null ? 0 : clamp((roll - previousRoll) / dt, -40, 40);
      const pitchRate = previousPitch === null ? 0 : clamp((pitch - previousPitch) / dt, -20, 20);
      previousRoll = roll; previousPitch = pitch;
      if (phase === 'roll' && speed >= rotationSpeed) phase = 'rotate';
      if (phase === 'rotate' && height > 35) phase = 'climb';
      let targetPitch = 0;
      if (phase === 'rotate') targetPitch = 8;
      if (phase === 'climb') {
        // Stabilize near 450 ft AGL, inside the mission's 100–200 m band.
        const targetVsi = clamp((450 - height) * 5, -50, 850);
        targetPitch = clamp(3 + (targetVsi - vsi) * 0.006 + (speed - climbSpeed) * 0.1, -2, 10);
      }
      const targetBank = phase === 'roll' ? 0 : clamp(-headingError * 0.7 - centerline * 0.04, -6, 6);
      command = {
        elevator: clamp((phase === 'roll' ? 0 : 0.05) + (targetPitch - pitch) * 0.065 - pitchRate * 0.015, -0.4, 0.55),
        aileron: clamp((targetBank - roll) * 0.055 - rollRate * 0.012, -0.35, 0.35),
        rudder: clamp(-headingError * 0.045 - centerline * 0.02, -0.35, 0.35),
        throttle: phase === 'climb' ? clamp(0.65 + (climbSpeed - speed) * 0.025, 0.3, 1) : 1,
        brakes: 0,
      };
      return { ...command };
    },
  };
}

export const takeoffPilotSource = `// Experimental, uncalibrated SDK-only takeoff example.\nexport ${createPilot.toString()}\n`;
