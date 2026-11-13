import { DEPARTURE_TAXI_ROUTE, DEPARTURE_LINEUP_ROUTE, DEPARTURE_RUNWAY, departurePushbackPose } from '../config/incheonDeparture.js';

/**
 * DOM-free open polyline in the horizontal (x, z) plane, parameterised by arc length.
 * Heading follows the simulator convention: atan2(dx, -dz), so 0 points to -Z.
 */
export function buildOpenRoutePath(points) {
  const nodes = [];
  for (const point of points) {
    const last = nodes.at(-1);
    if (last && Math.hypot(point.x - last.x, point.z - last.z) < 0.01) continue;
    nodes.push({ x: point.x, z: point.z });
  }
  if (nodes.length < 2) throw new Error('Route path needs at least two distinct points');
  const distances = [0];
  for (let i = 1; i < nodes.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].z - nodes[i - 1].z));
  }
  return { points: nodes, distances, length: distances.at(-1) };
}

function segmentAt(path, s) {
  const { distances } = path;
  let lo = 0, hi = distances.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (distances[mid] <= s) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Pose at arc length `s`, clamped to the path ends. */
export function sampleOpenPose(path, s) {
  const distance = Math.min(path.length, Math.max(0, Number.isFinite(s) ? s : 0));
  const i = segmentAt(path, distance);
  const a = path.points[i], b = path.points[i + 1];
  const span = path.distances[i + 1] - path.distances[i];
  const t = span > 0 ? (distance - path.distances[i]) / span : 0;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    heading: Math.atan2(b.x - a.x, -(b.z - a.z)),
    distance,
    segment: i,
  };
}

const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Mean heading change per metre over a window centred on `s` (rad/m, signed). */
export function samplePathCurvature(path, s, window = 12) {
  const half = Math.max(0.5, window / 2);
  const from = sampleOpenPose(path, s - half), to = sampleOpenPose(path, s + half);
  const span = to.distance - from.distance;
  return span > 0 ? wrapAngle(to.heading - from.heading) / span : 0;
}

/** Arc length of the point on the path closest to (x, z). */
export function projectOntoPath(path, x, z) {
  let best = { distance: 0, offset: Infinity };
  for (let i = 0; i < path.points.length - 1; i++) {
    const a = path.points[i], b = path.points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, span = path.distances[i + 1] - path.distances[i];
    const t = span > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (span * span))) : 0;
    const offset = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (offset < best.offset) best = { distance: path.distances[i] + span * t, offset };
  }
  return best;
}

/**
 * Pushback end → mapped taxi route → hold short → mapped runway entry → runway axis,
 * then a straight climb-out extension so an airborne actor never clamps at the runway end.
 * The milestones are arc lengths used by the kinematic traffic state machine.
 */
export function buildDepartureTakeoffPath({ climbOutMeters = 12000 } = {}) {
  const runway = DEPARTURE_RUNWAY;
  const angle = runway.headingDeg * Math.PI / 180;
  const along = p => (p.x - runway.threshold.x) * Math.sin(angle) - (p.z - runway.threshold.z) * Math.cos(angle);
  const entryIndex = DEPARTURE_LINEUP_ROUTE.findIndex(p => Math.abs((p.x - runway.threshold.x) * Math.cos(angle)
    + (p.z - runway.threshold.z) * Math.sin(angle)) < 0.5);
  const entry = DEPARTURE_LINEUP_ROUTE[entryIndex];
  const runwayLength = Math.hypot(runway.end.x - runway.threshold.x, runway.end.z - runway.threshold.z);
  const climb = runwayLength + climbOutMeters;
  const beyond = { x: runway.threshold.x + Math.sin(angle) * climb, z: runway.threshold.z - Math.cos(angle) * climb };
  const start = departurePushbackPose(1);
  const path = buildOpenRoutePath([start, ...DEPARTURE_TAXI_ROUTE, ...DEPARTURE_LINEUP_ROUTE.slice(0, entryIndex + 1), runway.end, beyond]);
  const at = point => path.distances[path.points.findIndex(p => Math.hypot(p.x - point.x, p.z - point.z) < 0.01)];
  return {
    ...path,
    holdShort: at(DEPARTURE_TAXI_ROUTE.at(-1)),
    lineUp: at(entry),
    runwayEnd: at(runway.end),
    lineUpAlongRunway: along(entry),
  };
}
