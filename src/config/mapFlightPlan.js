// Pure geometry for map-based flight starts (#922). No DOM and no simulator state.
import { projectToLocal } from '../geospatial/incheon.js';
import { wgs84ToLocal } from '../geospatial/TileCoordinateSystem.js';
import { AIRCRAFT_REGISTRY } from './aircraftConfigs.js';
const finite = Number.isFinite;
const DEG = Math.PI / 180;
const TAKEOFF_DISTANCE_M = 100;
const DEFAULT_CLEARANCE_M = 3.5;

function projectPoint(latitude, longitude, origin) {
  return origin && finite(origin.latitude) && finite(origin.longitude)
    ? wgs84ToLocal(latitude, longitude, origin)
    : projectToLocal(latitude, longitude);
}

/** World frame: +x east, +z south; heading 0 points north (-z). */
export function headingToDirection(deg) {
  const angle = deg * DEG;
  return { x: Math.sin(angle), z: -Math.cos(angle) };
}

export function yawForHeading(deg) {
  return -deg * DEG;
}

export function directionToHeading(x, z) {
  return (Math.atan2(x, -z) / DEG + 360) % 360;
}

function numberOr(value, fallback) {
  return finite(value) ? value : fallback;
}

function clearanceFor(aircraftId) {
  return AIRCRAFT_REGISTRY[aircraftId]?.landingGear?.cgGroundHeightM ?? DEFAULT_CLEARANCE_M;
}

/** Offsets may be [x, z] arrays or {x, z}; anything else means no offset. */
function offsetParts(value) {
  if (Array.isArray(value) && value.length >= 2 && finite(value[0]) && finite(value[1])) {
    return { x: value[0], z: value[1] };
  }
  if (value && finite(value.x) && finite(value.z)) return { x: value.x, z: value.z };
  return { x: 0, z: 0 };
}

function airportOrigin(airport, geoOrigin = null) {
  if (!airport || !finite(airport.latitude) || !finite(airport.longitude)) return { x: 0, z: 0 };
  try {
    const [x, z] = projectPoint(airport.latitude, airport.longitude, geoOrigin);
    return { x, z };
  } catch {
    return { x: 0, z: 0 };
  }
}

/** Airport-local ARP frame; WGS84 ends are rebased onto the airport reference point. */
function endPoint(point, origin, geoOrigin = null) {
  if (!point || typeof point !== 'object') return null;
  let x = point.x;
  let z = point.z;
  if (!finite(x) || !finite(z)) {
    if (!finite(point.latitude) || !finite(point.longitude)) return null;
    try {
      [x, z] = projectPoint(point.latitude, point.longitude, geoOrigin);
    } catch {
      return null;
    }
    x -= origin.x;
    z -= origin.z;
  }
  return { x, z, elevationM: finite(point.elevationM) ? point.elevationM : undefined };
}

/** Aiming frame for one physical runway end, derived from its opposite end. */
export function runwayEndFrame(airport, runwayId, endId, { origin: geoOrigin = null } = {}) {
  if (!airport || runwayId == null || endId == null || !Array.isArray(airport.runways)) return null;
  const runway = airport.runways.find(r => r && String(r.id) === String(runwayId));
  if (!runway || !Array.isArray(runway.ends) || runway.ends.length < 2) return null;
  const end = runway.ends.find(e => e && (String(e.ident) === String(endId) || String(e.id) === String(endId)));
  if (!end) return null;
  const other = runway.ends.find(e => e && e !== end);
  if (!other) return null;

  const origin = airportOrigin(airport, geoOrigin);
  const physical = endPoint(end.physical, origin, geoOrigin);
  const opposite = endPoint(other.physical, origin, geoOrigin);
  const threshold = endPoint(end.threshold, origin, geoOrigin);
  if (!physical || !opposite || !threshold) return null;
  const length = Math.hypot(opposite.x - physical.x, opposite.z - physical.z);
  if (!(length > 0)) return null;

  const headingDeg = directionToHeading(opposite.x - physical.x, opposite.z - physical.z);
  const angle = headingDeg * DEG;
  const elevationM = finite(threshold.elevationM) ? threshold.elevationM
    : finite(physical.elevationM) ? physical.elevationM
      : finite(airport.elevationM) ? airport.elevationM : 0;
  const widthM = finite(runway.widthM) && runway.widthM > 0 ? runway.widthM
    : finite(runway.width) && runway.width > 0 ? runway.width : 0;
  const publishedLength = finite(runway.lengthM) && runway.lengthM > 0 ? runway.lengthM
    : finite(runway.length) && runway.length > 0 ? runway.length : length;

  return {
    runwayId: runway.id ?? runwayId,
    endId: end.ident ?? end.id ?? endId,
    threshold: { x: threshold.x, z: threshold.z, elevationM },
    headingDeg,
    direction: headingToDirection(headingDeg),
    right: { x: Math.cos(angle), z: Math.sin(angle) },
    widthM,
    lengthM: publishedLength,
    displacedThresholdM: finite(end.displacedThresholdM) && end.displacedThresholdM > 0
      ? end.displacedThresholdM : 0,
  };
}

function worldXZ(x, z, baseOffset, anchorBase) {
  const base = offsetParts(baseOffset);
  const anchor = offsetParts(anchorBase);
  return { x: x + base.x - anchor.x, z: z + base.z - anchor.z };
}

function usableFrame(frame) {
  return !!frame && !!frame.threshold && finite(frame.threshold.x) && finite(frame.threshold.z)
    && finite(frame.threshold.elevationM) && !!frame.direction && finite(frame.direction.x)
    && finite(frame.direction.z) && finite(frame.headingDeg);
}

export function takeoffSpawnPlan({
  frame, baseOffset = [0, 0], anchorBase = [0, 0], groundClearanceM,
  aircraftId = 'B738', distanceM = TAKEOFF_DISTANCE_M,
} = {}) {
  if (!usableFrame(frame)) return null;
  const x = frame.threshold.x + frame.direction.x * distanceM;
  const z = frame.threshold.z + frame.direction.z * distanceM;
  const world = worldXZ(x, z, baseOffset, anchorBase);
  const surface = worldXZ(frame.threshold.x, frame.threshold.z, baseOffset, anchorBase);
  const headingDeg = frame.headingDeg;
  const clearance = numberOr(groundClearanceM, clearanceFor(aircraftId));
  return {
    x: world.x,
    y: frame.threshold.elevationM + clearance,
    z: world.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: yawForHeading(headingDeg),
    headingDeg,
    state: 'runway',
    speedMps: 0,
    groundClearanceM: clearance,
    glideRiseM: 0,
    alignToGround: true,
    surfaceX: surface.x,
    surfaceZ: surface.z,
  };
}

export function cruiseSpawnPlan({
  latitude, longitude, headingDeg, altitudeM, anchorBase = [0, 0], aircraftId = 'B738', origin = null,
} = {}) {
  if (![latitude, longitude, headingDeg, altitudeM].every(finite)) return null;
  let projected;
  try {
    projected = projectPoint(latitude, longitude, origin);
  } catch {
    return null;
  }
  const anchor = offsetParts(anchorBase);
  const speed = aircraftId === 'C172' ? 48 : aircraftId === 'F16' ? 180 : 108;
  const direction = headingToDirection(headingDeg);
  return {
    x: projected[0] - anchor.x,
    y: altitudeM,
    z: projected[1] - anchor.z,
    vx: speed * direction.x,
    vy: 0,
    vz: speed * direction.z,
    yaw: yawForHeading(headingDeg),
    headingDeg,
    state: 'cruise',
  };
}

export function approachSpawnPlan({
  frame, baseOffset = [0, 0], anchorBase = [0, 0], distanceM = 5556, glideslopeDeg = 3,
  lateralOffsetM = 0, interceptOffsetDeg = 0, groundClearanceM,
  aircraftId = 'B738',
} = {}) {
  if (!usableFrame(frame)) return null;
  if (![distanceM, glideslopeDeg, lateralOffsetM, interceptOffsetDeg].every(finite)
    || (groundClearanceM !== undefined && !finite(groundClearanceM))) return null;
  const right = frame.right && finite(frame.right.x) && finite(frame.right.z)
    ? frame.right : { x: Math.cos(frame.headingDeg * DEG), z: Math.sin(frame.headingDeg * DEG) };
  const x = frame.threshold.x - distanceM * frame.direction.x + lateralOffsetM * right.x;
  const z = frame.threshold.z - distanceM * frame.direction.z + lateralOffsetM * right.z;
  const world = worldXZ(x, z, baseOffset, anchorBase);
  const surface = worldXZ(frame.threshold.x, frame.threshold.z, baseOffset, anchorBase);
  const speed = aircraftId === 'B738' ? 74.5 : aircraftId === 'C172' ? 33 : aircraftId === 'F16' ? 90 : 74.5;
  const interceptHeading = frame.headingDeg + interceptOffsetDeg;
  const clearance = numberOr(groundClearanceM, clearanceFor(aircraftId));
  const glideTangent = Math.tan(glideslopeDeg * DEG);
  const glideRiseM = distanceM * glideTangent;
  return {
    x: world.x,
    y: frame.threshold.elevationM + clearance + glideRiseM,
    z: world.z,
    vx: speed * frame.direction.x,
    vy: -speed * glideTangent,
    vz: speed * frame.direction.z,
    yaw: yawForHeading(interceptHeading),
    headingDeg: (interceptHeading % 360 + 360) % 360,
    state: 'approach',
    groundClearanceM: clearance,
    glideRiseM,
    alignToGround: true,
    surfaceX: surface.x,
    surfaceZ: surface.z,
  };
}

export function resolveMapFlightPlan({
  state, airport, runwayId, endId, point, baseOffset, anchorBase, aircraftId, origin = null,
} = {}) {
  if (state === 'cruise') {
    if (!point || typeof point !== 'object') return null;
    const spawn = cruiseSpawnPlan({ ...point, anchorBase, aircraftId, origin });
    return spawn ? { scenario: 'cruise', spawn } : null;
  }
  if (state !== 'runway' && state !== 'approach') return null;
  // Indexed runways have validated endpoints. Use the first published end
  // when the player leaves the optional runway direction on Automatic.
  const defaultRunway = airport?.runways?.[0];
  const frame = runwayId || endId
    ? runwayEndFrame(airport, runwayId, endId, { origin })
    : runwayEndFrame(airport, defaultRunway?.id, defaultRunway?.ends?.[0]?.ident, { origin });
  if (!frame) return null;
  const spawn = state === 'runway'
    ? takeoffSpawnPlan({ frame, baseOffset, anchorBase, aircraftId })
    : approachSpawnPlan({ frame, baseOffset, anchorBase, aircraftId });
  return spawn ? { scenario: state, spawn, airportCode: airport?.code ?? null } : null;
}
