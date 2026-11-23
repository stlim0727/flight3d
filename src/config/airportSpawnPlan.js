/**
 * src/config/airportSpawnPlan.js
 *
 * Scenario poses for declaratively described airports. Both the map planner
 * and legacy presets call the same takeoff/approach primitives, so switching
 * an entry point cannot silently change the spawn geometry.
 */
import { getAirportOverride } from './airportOverrides.js';
import {
  headingToDirection,
  takeoffSpawnPlan,
  approachSpawnPlan,
} from './mapFlightPlan.js';

const DEG = Math.PI / 180;

function speedFor(speeds, aircraftId, fallback) {
  return Number.isFinite(speeds?.[aircraftId]) ? speeds[aircraftId] : fallback;
}

function scenicSpawn(pose, aircraftId) {
  const headingDeg = pose.headingDeg;
  const speed = speedFor(pose.speedMps, aircraftId, 0);
  const direction = headingToDirection(headingDeg);
  return {
    x: pose.x,
    y: pose.y,
    z: pose.z,
    yaw: -headingDeg * DEG,
    vx: direction.x * speed,
    vy: pose.vy ?? 0,
    vz: direction.z * speed,
  };
}

/** Common spawn plan for one airport code and flight scenario. */
export function airportSpawnPlan(code, scenario, { groundClearanceM, aircraftId = 'B738' } = {}) {
  const spawn = getAirportOverride(code)?.spawn;
  if (!spawn) return null;

  if (scenario === 'cruise') return scenicSpawn(spawn.cruise, aircraftId);
  if (scenario === 'challenge' || scenario === 'ditching') {
    return scenicSpawn(spawn.challenge, aircraftId);
  }
  if (scenario !== 'runway' && scenario !== 'approach') return null;

  const { threshold, elevationM, headingDeg } = spawn.frame;
  const direction = headingToDirection(headingDeg);
  const frame = {
    threshold: { x: threshold.x, z: threshold.z, elevationM },
    headingDeg,
    direction,
    right: { x: Math.cos(headingDeg * DEG), z: Math.sin(headingDeg * DEG) },
  };

  if (scenario === 'runway') {
    return takeoffSpawnPlan({
      frame,
      groundClearanceM,
      aircraftId,
      distanceM: spawn.takeoffDistanceM,
    });
  }
  return approachSpawnPlan({
    frame,
    groundClearanceM,
    aircraftId,
    distanceM: spawn.approachDistanceM,
    glideslopeDeg: spawn.glideslopeDeg,
  });
}
