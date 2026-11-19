import { MathUtils } from 'three';
import { wrapSignedDegrees } from './PilotPerception.js';

const { clamp, radToDeg } = MathUtils;

/** Converts available cockpit indications and navigation cues into pilot inputs. */
export function banditPilotCommand(observation) {
  const { instruments, navigation } = observation;
  const ias = instruments.iasKnots.mean;
  const roll = instruments.rollDeg.mean;
  const pitch = instruments.pitchDeg.mean;
  const verticalSpeed = instruments.vsiFpm.mean;
  const headingError = wrapSignedDegrees(radToDeg(navigation.headingRad) - instruments.headingDeg.mean);
  const bankLimit = clamp((ias - 155) * 0.55, 0, 45);
  const terrainAhead = observation.terrain.cells.some(cell =>
    cell.status === 'available' && cell.rangeM.mean < 1400);
  const bank = terrainAhead ? 0 : clamp(headingError * 0.9, -bankLimit, bankLimit);
  const altitudeError = navigation.altitudeFt - instruments.altitudeFt.mean;
  const climbRate = terrainAhead ? 3000 : clamp(altitudeError * 4, -1000, 3000);
  const pitchTarget = clamp(3 + (climbRate - verticalSpeed) * 0.004
    + (1 - Math.cos(roll * Math.PI / 180)) * 10 - Math.max(0, 160 - ias) * 0.2, -8, 18);
  return {
    elevator: clamp((pitchTarget - pitch) * 0.014 - instruments.pitchRateDegS.mean * 0.0014, -0.45, 0.45),
    aileron: clamp((bank - roll) * 0.005 - instruments.rollRateDegS.mean * 0.001, -0.5, 0.5),
    rudder: 0,
    throttle: clamp(0.35 + (navigation.iasKnots - ias) * 0.008, 0.1, 1),
    brakes: 0,
  };
}

/** Equipment requests use the game's warning channel and cockpit inventory. */
export function banditCountermeasureRequest({ warning, equipment }) {
  if (!warning) return null;
  const type = warning.channel === 'radar' ? 'chaff' : 'flare';
  return equipment[type] > 0 ? { type, trackId: warning.trackId } : null;
}
