/** Experimental B738/coastal training pilot; validated only on the fixed local calibration suite. */
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
      // Ground reaction initially needs substantial rotation effort. Capture pitch
      // after the nose begins moving rather than holding full aft stick airborne.
      let elevator = 0;
      if (phase === 'rotate') {
        elevator = pitch < 2 ? 1 : clamp(0.18 + (10 - pitch) * 0.035 - pitchRate * 0.08, -0.4, 0.7);
      } else if (phase === 'climb') {
        // AGL outer loop and vertical-speed feedback hold 100–200 m above terrain.
        const targetVsi = clamp((450 - height) * 8, -100, 1000);
        elevator = clamp(0.25 + (targetVsi - vsi) * 0.0003 - pitchRate * 0.05, -0.2, 0.6);
      }
      const targetBank = phase === 'roll' ? 0 : clamp(-headingError * 0.7 - centerline * 0.04, -6, 6);
      command = {
        elevator,
        aileron: clamp((targetBank - roll) * 0.055 - rollRate * 0.012, -0.35, 0.35),
        rudder: phase === 'roll' || phase === 'rotate' ? clamp(-headingError * 0.045 - centerline * 0.02, -0.35, 0.35) : 0,
        throttle: phase === 'climb' ? clamp(0.65 + (climbSpeed - speed) * 0.025, 0.3, 1) : 1,
        brakes: 0,
      };
      return { ...command };
    },
  };
}

export const takeoffPilotSource = `// Experimental B738/coastal SDK-only takeoff example; limited calibration suite.\nexport ${createPilot.toString()}\n`;
