/** F16 game-model challenge, not a real-world low-level flight route.
 * Coordinates are local metres east/south of Lukla's DEM origin.
 * The western valley avoids the graded airport; its southern finish opens onto
 * another kilometre of near-level valley floor rather than an opposing ridge.
 */
const POINTS = [
  { id: 'start', x: -1700, z: 500 },
  { id: 'gate-1', x: -1750, z: 1400 },
  { id: 'gate-2', x: -2100, z: 2200 },
  { id: 'gate-3', x: -2450, z: 3000 },
  { id: 'gate-4', x: -2550, z: 3900 },
  { id: 'gate-5', x: -2850, z: 4800 },
  { id: 'finish', x: -3100, z: 6000 },
];

export function valleyLegs(course) {
  let prefix = 0;
  return course.points.slice(1).map((end, index) => {
    const start = course.points[index], dx = end.x - start.x, dz = end.z - start.z;
    const lengthM = Math.hypot(dx, dz);
    const leg = { start, end, dx, dz, lengthM, prefixM: prefix,
      headingDeg: (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360 };
    prefix += lengthM;
    return leg;
  });
}

export function projectValleyLeg(leg, position) {
  const x = position.x - leg.start.x, z = position.z - leg.start.z;
  const rawT = (x * leg.dx + z * leg.dz) / leg.lengthM ** 2;
  const t = Math.max(0, Math.min(1, rawT));
  return { rawT, t, progressM: leg.prefixM + t * leg.lengthM,
    crossTrackM: (-leg.dz * x + leg.dx * z) / leg.lengthM,
    distanceM: Math.hypot(x - t * leg.dx, z - t * leg.dz), headingDeg: leg.headingDeg };
}

/** Nearest course projection for host navigation; the evaluator uses its active leg. */
export function projectValleyPosition(course, position) {
  const legs = valleyLegs(course);
  let nearest;
  for (let segmentIndex = 0; segmentIndex < legs.length; segmentIndex++) {
    const projected = { ...projectValleyLeg(legs[segmentIndex], position), segmentIndex };
    if (!nearest || projected.distanceM < nearest.distanceM) nearest = projected;
  }
  return { ...nearest, totalLengthM: legs.reduce((sum, leg) => sum + leg.lengthM, 0) };
}

export function createValleyManifest(overrides = {}) {
  const manifest = {
    id: 'valley-low-v1', type: 'valley', rulesVersion: '1.0.0',
    aircraftId: 'F16', airportId: 'lukla', physicsHz: 120, decisionPeriodTicks: 24,
    timeoutTicks: 14400, minimumIasKnots: 160, maximumIasKnots: 320,
    environmentProfile: 'mild-disturbance-v1', calibration: 'pending',
    course: { points: structuredClone(POINTS), corridorHalfWidthM: 400,
      gateHalfWidthM: 200, startRadiusM: 50, binSizeM: 25, targetAglM: 50, minimumAglM: 20 },
    spawn: { x: -1700, z: 500, aglM: 120, headingDeg: 183.17983011986425,
      iasKnots: 220, flightPathAngleDeg: 0 },
    terrain: { profile: 'copernicus-lukla-1025-v1', sampleSpacingM: 42.96875,
      sha256: 'dfc3d92e211fa6995faf3dfb51bfb28848c7713d21ae0a1e110ea1a58dd18191' },
    fixedConfiguration: { gearDown: false, flapIndex: 0, spoilers: 0, reverser: false, parkingBrake: false },
    ...structuredClone(overrides),
  };
  validateValleyManifest(manifest);
  manifest.courseLengthM = valleyLegs(manifest.course).reduce((sum, leg) => sum + leg.lengthM, 0);
  return manifest;
}

export function validateValleyManifest(m) {
  const c = m?.course;
  if (m?.type !== 'valley' || m.aircraftId !== 'F16' || m.airportId !== 'lukla' ||
      m.physicsHz !== 120 || m.decisionPeriodTicks !== 24 || !Number.isSafeInteger(m.timeoutTicks) || m.timeoutTicks < 2 ||
      !Number.isFinite(m.minimumIasKnots) || !Number.isFinite(m.maximumIasKnots) ||
      m.minimumIasKnots <= 0 || m.maximumIasKnots < m.minimumIasKnots || !c ||
      !Array.isArray(c.points) || c.points.length < 2 ||
      c.points.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.z) || Math.abs(p.x) > 21000 || Math.abs(p.z) > 21000) ||
      !['corridorHalfWidthM', 'gateHalfWidthM', 'startRadiusM', 'binSizeM', 'targetAglM', 'minimumAglM'].every(k => Number.isFinite(c[k]) && c[k] > 0) ||
      c.gateHalfWidthM > c.corridorHalfWidthM || c.minimumAglM >= c.targetAglM ||
      valleyLegs(c).some(leg => leg.lengthM < 100) || !m.spawn ||
      !['x', 'z', 'aglM', 'headingDeg', 'iasKnots', 'flightPathAngleDeg'].every(k => Number.isFinite(m.spawn[k])) ||
      m.spawn.aglM < c.minimumAglM || m.spawn.iasKnots < m.minimumIasKnots || m.spawn.iasKnots > m.maximumIasKnots ||
      Math.hypot(m.spawn.x - c.points[0].x, m.spawn.z - c.points[0].z) > c.startRadiusM) {
    throw new TypeError('Invalid valley mission manifest');
  }
  return m;
}
