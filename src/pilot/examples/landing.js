/** Experimental SDK-only training pilot. Not calibrated or proven to complete a mission. */
export function createPilot() {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const read = sensor => sensor?.status === 'available' && Number.isFinite(sensor.mean) ? sensor.mean : null;
  let phase, previousRoll, previousPitch, approachSpeed, dt, command;
  function reset(briefing = {}) {
    phase = 'approach'; previousRoll = previousPitch = null;
    approachSpeed = Number.isFinite(briefing.recommendedSpeeds?.approachKnots) ? briefing.recommendedSpeeds.approachKnots : 145;
    dt = Number.isFinite(briefing.decisionPeriodSeconds) && briefing.decisionPeriodSeconds > 0 ? briefing.decisionPeriodSeconds : 0.2;
    command = { elevator: 0, aileron: 0, rudder: 0, throttle: 0.52, brakes: 0 };
  }
  reset();
  return {
    reset,
    onTick(observation) {
      const instruments = observation?.instruments || {}, navigation = observation?.navigation || {};
      const speed = read(instruments.iasKnots), groundSpeed = read(instruments.groundSpeedKnots);
      const pitch = read(instruments.pitchDeg), roll = read(instruments.rollDeg);
      const height = read(instruments.radioAltFt), vsi = read(instruments.vsiFpm);
      const headingError = read(navigation.headingErrorDeg), centerline = read(navigation.centerlineOffsetM);
      const wow = observation?.feedback?.weightOnWheels;
      // Latch rollout: a bounce must not reapply approach thrust.
      if (wow?.status === 'available' && wow.value === true) phase = 'rollout';
      if ([speed, groundSpeed, pitch, roll, height, vsi, headingError, centerline].some(v => v === null)) {
        if (phase === 'rollout') command = { ...command, throttle: 0, brakes: Math.max(command.brakes, 0.3) };
        return { ...command };
      }
      const rollRate = previousRoll === null ? 0 : clamp((roll - previousRoll) / dt, -40, 40);
      const pitchRate = previousPitch === null ? 0 : clamp((pitch - previousPitch) / dt, -20, 20);
      previousRoll = roll; previousPitch = pitch;
      if (phase === 'approach' && height < 55) phase = 'flare';
      if (phase === 'rollout') {
        command = {
          elevator: clamp(-pitch * 0.045 - pitchRate * 0.015, -0.25, 0.15),
          aileron: clamp(-roll * 0.055 - rollRate * 0.012, -0.25, 0.25),
          rudder: clamp(-headingError * 0.05 - centerline * 0.03, -0.4, 0.4),
          throttle: 0, brakes: groundSpeed > 3 ? 0.8 : 0.5,
        };
        return { ...command };
      }
      const glideError = read(navigation.glideSlopeErrorDeg);
      // Guidance expires near threshold. Flare does not require that channel.
      if (phase === 'approach' && glideError === null) return { ...command };
      const targetBank = clamp(-headingError * 0.6 - centerline * 0.06, -5, 5);
      const referenceVsi = -Math.max(60, groundSpeed) * 101.2686 * Math.tan(3 * Math.PI / 180);
      const targetPitch = phase === 'flare' ? 5 : clamp(2 - glideError * 2 + (referenceVsi - vsi) * 0.002, -3, 7);
      command = {
        elevator: clamp(0.05 + (targetPitch - pitch) * 0.065 - pitchRate * 0.015, -0.35, 0.5),
        aileron: clamp((targetBank - roll) * 0.055 - rollRate * 0.012, -0.3, 0.3),
        rudder: clamp(-headingError * 0.025, -0.25, 0.25),
        throttle: phase === 'flare' ? clamp((height - 10) / 45, 0, 1) * 0.35 : clamp(0.52 + (approachSpeed - speed) * 0.018, 0.15, 0.85),
        brakes: 0,
      };
      return { ...command };
    },
  };
}

export const landingPilotSource = `// Experimental, uncalibrated SDK-only landing example.\nexport ${createPilot.toString()}\n`;
