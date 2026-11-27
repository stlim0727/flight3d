/**
 * src/config/airportSpawnPlan.js
 *
 * Scenario poses for declaratively described airports. Both the map planner
 * and legacy presets call the same takeoff/approach primitives, so switching
 * an entry point cannot silently change the spawn geometry.
 */
import { getAirportOverride } from './airportOverrides.js';
import { spawnProfileAircraftId } from './aircraftConfigs.js';
import {
  headingToDirection,
  takeoffSpawnPlan,
  approachSpawnPlan,
} from './mapFlightPlan.js';

const DEG = Math.PI / 180;

function speedFor(speeds, aircraftId, fallback) {
  if (Number.isFinite(speeds?.[aircraftId])) return speeds[aircraftId];
  const profileId = spawnProfileAircraftId(aircraftId);
  if (Number.isFinite(speeds?.[profileId])) return speeds[profileId];
  if (Number.isFinite(speeds?.B738)) return speeds.B738;
  return fallback;
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

function declaredSpawn(pose, { groundClearanceM = 3.5, aircraftId }) {
  const specific = pose.byAircraft?.[aircraftId] ?? pose.byAircraft?.[spawnProfileAircraftId(aircraftId)];
  const poseForAircraft = specific ? { ...pose, ...specific } : pose;
  const speed = speedFor(poseForAircraft.speedMps, aircraftId, 0);
  const direction = headingToDirection(poseForAircraft.velocityHeadingDeg ?? poseForAircraft.headingDeg);
  const y = Number.isFinite(poseForAircraft.y)
    ? poseForAircraft.y
    : poseForAircraft.position[1] + groundClearanceM;
  const vy = Number.isFinite(poseForAircraft.vy)
    ? poseForAircraft.vy
    : (poseForAircraft.glideslopeDeg ? -speed * Math.tan(poseForAircraft.glideslopeDeg * DEG) : 0);
  return {
    x: poseForAircraft.position[0],
    y,
    z: poseForAircraft.position[2],
    yaw: -poseForAircraft.headingDeg * DEG,
    vx: direction.x * speed,
    vy,
    vz: direction.z * speed,
    pitchDeg: poseForAircraft.pitchDeg ?? 0,
  };
}

/** Common spawn plan for one airport code and flight scenario. */
export function airportSpawnPlan(code, scenario, { groundClearanceM, aircraftId = 'B738' } = {}) {
  const spawn = getAirportOverride(code)?.spawn;
  if (!spawn) return null;
  const pose = spawn.poses?.[scenario]
    ?? (scenario === 'ditching' ? spawn.poses?.challenge : null);
  if (pose) return declaredSpawn(pose, { groundClearanceM, aircraftId });
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
