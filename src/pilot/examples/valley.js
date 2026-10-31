/** Experimental F16 terrain-assisted valley pilot; not real-aircraft flight software. */
export function createPilot() {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const radians = Math.PI / 180;
  const read = sensor => sensor?.status === 'available' && Number.isFinite(sensor.mean) ? sensor.mean : null;
  const signed = value => ((value + 540) % 360) - 180;
  let cruiseKnots, targetAgl, trimDeg, dt, previousPitch, previousRoll, filteredVz, command;
  function reset(briefing = {}) {
    cruiseKnots = briefing.recommendedSpeeds?.cruiseKnots ?? 220;
    targetAgl = briefing.successConditions?.targetAglM ?? briefing.course?.targetAglM ?? 50;
    trimDeg = briefing.configuration?.pitchTrimDeg ?? 0;
    dt = briefing.decisionPeriodSeconds ?? 0.2;
    previousPitch = previousRoll = null;
    filteredVz = 0;
    command = { elevator: 0, aileron: 0, rudder: 0, throttle: 0.5, brakes: 0 };
  }
  reset();
  return {
    reset,
    onTick(observation) {
      const s = observation?.instruments ?? {}, nav = observation?.navigation ?? {};
      const ias = read(s.iasKnots), pitch = read(s.pitchDeg), roll = read(s.rollDeg);
      const heading = read(s.headingDeg), heightFt = read(s.radioAltFt), vsi = read(s.vsiFpm);
      const bearing = read(nav.goalBearingDeg);
      if ([ias, pitch, roll, heading, heightFt, vsi, bearing].some(v => v === null)) return { ...command };
      const speed = Math.max(40, (read(s.tasKnots) ?? ias * 1.13) * 0.514444);
      const height = heightFt * 0.3048, vz = vsi * 0.3048 / 60;
      const measuredPitchRate = read(s.pitchRateDegS) ?? (previousPitch === null ? 0 : (pitch - previousPitch) / dt);
      const measuredRollRate = read(s.rollRateDegS) ?? (previousRoll === null ? 0 : (roll - previousRoll) / dt);
      previousPitch = pitch; previousRoll = roll;
      const pitchRate = clamp(measuredPitchRate, -50, 50) * radians;
      const rollRate = clamp(measuredRollRate, -80, 80) * radians;
      // A small buffer above the score's target avoids rewarding a surface skim.
      let desiredVz = clamp((targetAgl + 15 - height) * 0.28, -14, 18);
      const cp = Math.cos(pitch * radians), sp = Math.sin(pitch * radians);
      const cr = Math.cos(roll * radians), sr = Math.sin(roll * radians);
      for (const cell of observation.terrain?.cells ?? []) {
        if (Math.abs(cell.azimuthDeg) > 10 || cell.status !== 'available') continue;
        const range = cell.rangeM?.mean, sigma = cell.rangeM?.std;
        if (!Number.isFinite(range) || !Number.isFinite(sigma) || range <= 0 || sigma < 0) continue;
        const az = cell.azimuthDeg * radians, el = cell.elevationDeg * radians;
        // Rotate a body-frame point ray's vertical component using observed attitude.
        const vertical = cp * (-sr * Math.sin(az) * Math.cos(el) + cr * Math.sin(el)) + sp * Math.cos(az) * Math.cos(el);
        const horizontal = range * Math.sqrt(Math.max(0, 1 - vertical * vertical));
        if (horizontal < 70 || horizontal > 1600) continue;
        const time = Math.max(1, (horizontal - sigma) / speed - 0.7);
        const required = (range * vertical + targetAgl + 15 + sigma * 0.5) / time;
        desiredVz = Math.max(desiredVz, Math.min(45, required));
      }
      // Do not keep a stale high-climb target after the ridge has passed.
      filteredVz += (desiredVz - filteredVz) * (1 - Math.exp(-dt / 0.5));
      const bankTarget = clamp(signed(bearing - heading) * 0.9, -28, 28);
      // Nominal F16 game-model prior; dynamic state still comes only from SDK sensors.
      const q = Math.max(500, 0.5 * 1.225 * (ias * 0.514444) ** 2);
      const flightPath = Math.atan2(vz, speed);
      const acceleration = clamp((filteredVz - vz) * 0.8, -3.5, 5.5);
      const alphaTarget = clamp((12000 * (9.80665 + acceleration) / (q * 27.87 * Math.max(0.7, Math.cos(roll * radians))) - 0.05) / 4.2, 0.02, 0.23);
      const pitchTarget = clamp((flightPath + alphaTarget) / radians, -15, 28) * radians;
      const desiredRate = clamp((pitchTarget - pitch * radians) * 1.2, -0.16, 0.16);
      const requiredCm = 75000 * (desiredRate - pitchRate) * 2.5 / (q * 27.87 * 3.45);
      const alphaEstimate = pitch * radians - flightPath;
      const qHat = pitchRate * 3.45 / (2 * speed);
      const elevator = ((requiredCm + 0.45 * alphaEstimate + 12 * qHat) / 1.8 - trimDeg * radians) / (20 * radians);
      const desiredRollRate = clamp((bankTarget - roll) * 1.4, -20, 20) * radians;
      const requiredCl = 12800 * (desiredRollRate - rollRate) * 3 / (q * 27.87 * 9.96);
      const aileron = (requiredCl + 0.45 * rollRate * 9.96 / (2 * speed)) / (0.35 * 1.05 * 20 * radians);
      command = {
        elevator: clamp(elevator, -0.65, 0.8),
        aileron: clamp(aileron, -0.45, 0.45),
        rudder: 0,
        throttle: clamp(0.35 + (cruiseKnots - ias) * 0.025 + filteredVz * 0.012, 0.05, 0.95),
        brakes: 0,
      };
      return { ...command };
    },
  };
}

export const valleyPilotSource = `// Experimental F16 valley SDK pilot.\nexport ${createPilot.toString()}\n`;
