/** Experimental B738/coastal training pilot; validated only on the fixed local calibration suite. */
export function createPilot() {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const read = sensor => sensor?.status === 'available' && Number.isFinite(sensor.mean) ? sensor.mean : null;
  let phase, previousRoll, previousPitch, previousCenterline, crossRate, bankIntegral, approachSpeed, dt, command;
  function reset(briefing = {}) {
    phase = 'approach'; previousRoll = previousPitch = previousCenterline = null; crossRate = bankIntegral = 0;
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
      const measuredCrossRate = previousCenterline === null ? 0 : clamp((centerline - previousCenterline) / dt, -15, 15);
      crossRate += (measuredCrossRate - crossRate) * (1 - Math.exp(-dt / 0.8));
      previousCenterline = centerline;
      if (phase === 'approach' && height < 55) phase = 'flare';
      if (phase === 'rollout') {
        command = {
          elevator: clamp(-pitch * 0.10 - pitchRate * 0.06, -0.65, 0.15),
          aileron: clamp(-roll * 0.055 - rollRate * 0.012, -0.25, 0.25),
          rudder: clamp(-headingError * 0.05 - centerline * 0.03, -0.4, 0.4),
          throttle: 0, brakes: groundSpeed > 3 ? 0.8 : 0.5,
        };
        return { ...command };
      }
      const glideError = read(navigation.glideSlopeErrorDeg);
      // Guidance expires near threshold. Flare does not require that channel.
      if (phase === 'approach' && glideError === null) return { ...command };
      // Permit a crab angle: airborne rudder must not fight ground-track correction.
      const targetBank = clamp(-centerline * 0.15 - crossRate * 1.5, -6, 6);
      bankIntegral = clamp(bankIntegral + (targetBank - roll) * dt * 0.008, -0.2, 0.2);
      const speedMs = groundSpeed * 0.514444;
      const distance = read(navigation.thresholdDistanceM);
      const pathErrorM = distance === null || glideError === null ? 0 : Math.tan(glideError * Math.PI / 180) * distance;
      const pathVz = -Math.tan(3 * Math.PI / 180) * speedMs - pathErrorM * 0.15;
      const targetVz = phase === 'flare' ? -Math.max(0.4, (height / 3.28084 - 3.5) * 0.12) : clamp(pathVz, -6, 1);
      const targetVsi = targetVz * 196.8504;
      // Reduce residual lift before the delayed contact switch reports touchdown.
      // Radio altitude at gear contact is about 11–13 ft in this B738 profile.
      command = {
        elevator: height < 22 ? clamp((1 - pitch) * 0.10 - pitchRate * 0.06, -0.5, 0.3) : clamp((targetVsi - vsi) * 0.0004 - pitchRate * 0.05, -0.4, 0.6),
        aileron: clamp(bankIntegral + (targetBank - roll) * 0.06 - rollRate * 0.03, -0.3, 0.3),
        rudder: 0,
        throttle: clamp(0.52 + (approachSpeed - speed) * 0.018, 0.15, 0.85) * clamp((height - 30) / 90, 0, 1),
        brakes: 0,
      };
      return { ...command };
    },
  };
}

export const landingPilotSource = `// Experimental B738/coastal SDK-only landing example; limited calibration suite.\nexport ${createPilot.toString()}\n`;
