import { VALLEY_SLALOM_RULES, generateValley } from './generatedValley.js';

/** `valley-slalom-v1`: the course contract the slalom is judged on.
 *
 * A gate here is not a point in the air. It is a passage space: a lateral band
 * across the valley, inside the corridor walls, with a ceiling measured against
 * the ground underneath it. Gates are ordered and their spacing comes from the
 * measured bank reversal, so no leg can be flown without a roll, and the corridor
 * follows the curving centreline, so a straight-line cut across a bend leaves the
 * course rather than shortening it. Every number is either measured in
 * `docs/development/f16-valley-envelope.json` or a generation rule the
 * pre-evaluation validity gate had to accept; none of them is fitted to a pilot's
 * result. `valley-low-v1` keeps its own rules and its own score space.
 *
 * What a pilot may know is what a chart may show: the route, the widths, the
 * ordered passage spaces and their AGL ceilings. Ground heights stay host side,
 * as in low-v1, and the live numbers the pilot steers on come from the shared
 * navigation model with its own noise and delay.
 */

export function createSlalomManifest({ seed, rules = VALLEY_SLALOM_RULES,
  environmentProfile = 'mild-disturbance-v1' } = {}) {
  const { course, assessment } = generateValley({ seed, rules });
  if (!assessment.ok) {
    const reasons = [...new Set(assessment.failures.map(failure => failure.reason))].join(', ');
    throw new Error(`unflyable-course: seed ${seed} ${reasons}`);
  }
  const first = course.gates[0], last = course.gates.at(-1);
  // The pilot starts in the first passage space, not on the centreline beside it.
  const anchor = (gate, distance) => ({ x: gate.x + Math.cos(gate.headingDeg * Math.PI / 180) * distance,
    z: gate.z + Math.sin(gate.headingDeg * Math.PI / 180) * distance });
  // Charted route: the pilot gets the same shape the judge measures against, at
  // a resolution that is a chart rather than a terrain array.
  const stride = Math.max(1, Math.round(rules.chartSpacingM / rules.sampleStepM));
  const route = course.centerline
    .filter((_, index) => index % stride === 0 || index === course.centerline.length - 1)
    .map(sample => ({ x: sample.x, z: sample.z, sM: sample.sM, halfWidthM: sample.halfWidthM }));
  const manifest = {
    id: 'valley-slalom-v1', type: 'valley-slalom', rulesVersion: rules.version,
    aircraftId: 'F16', physicsHz: 120, decisionPeriodTicks: rules.decisionPeriodTicks,
    commandDelayTicks: rules.commandDelayTicks, timeoutTicks: rules.timeoutTicks,
    minimumIasKnots: rules.speedKnots[0], maximumIasKnots: rules.speedKnots[1],
    environmentProfile, calibration: 'pending',
    course: {
      version: rules.version, seed, route, lengthM: course.lengthM,
      corridorHalfWidthM: rules.corridorHalfWidthM[1],
      clearanceFloorM: rules.clearanceFloorM, sampleStepM: rules.sampleStepM,
      gates: course.gates.map(({ floorM, ...gate }) => ({ ...gate,
        passageAglM: [gate.minAglM, gate.maxAglM] })),
    },
    spawn: { ...anchor(first, first.crossOffsetM), headingDeg: first.headingDeg,
      aglM: (first.minAglM + first.maxAglM) / 2, iasKnots: rules.cruiseKnots,
      flightPathAngleDeg: 0 },
    destination: { ...anchor(last, last.crossOffsetM), sM: last.sM },
    terrain: { kind: 'generated-valley', seed, rulesVersion: rules.version,
      sampleSpacingM: rules.sampleStepM },
    fixedConfiguration: { gearDown: false, flapIndex: 0, spoilers: 0, reverser: false, parkingBrake: false },
    envelope: { version: rules.envelopeVersion, cruiseKnots: rules.cruiseKnots,
      maximumBankDeg: rules.maximumBankDeg },
  };
  return validateSlalomManifest(manifest);
}

export function validateSlalomManifest(manifest) {
  const course = manifest?.course, spawn = manifest?.spawn;
  const valid = manifest && manifest.type === 'valley-slalom' && manifest.aircraftId === 'F16'
    && manifest.physicsHz === 120 && manifest.decisionPeriodTicks === 24
    && manifest.commandDelayTicks === 24 && Number.isSafeInteger(manifest.timeoutTicks)
    && manifest.minimumIasKnots >= 160 && manifest.maximumIasKnots > manifest.minimumIasKnots
    && Number.isSafeInteger(course?.seed) && Number.isFinite(course?.lengthM)
    && Array.isArray(course?.gates) && course.gates.length >= 2
    && Array.isArray(course?.route) && course.route.length >= course.gates.length
    && Number.isFinite(course?.clearanceFloorM) && course.clearanceFloorM > 0
    && Number.isFinite(course?.corridorHalfWidthM) && course.corridorHalfWidthM > 0
    && course.gates.every((gate, index) => gate.index === index
      && !Object.hasOwn(gate, 'floorM')
      && ['x', 'z', 'sM', 'headingDeg', 'halfWidthM', 'crossOffsetM', 'passageHalfWidthM',
        'minAglM', 'maxAglM'].every(key => Number.isFinite(gate[key]))
      && Array.isArray(gate.passageAglM) && gate.passageAglM[0] < gate.passageAglM[1]
      && gate.sM > (index ? course.gates[index - 1].sM : -1)
      && gate.maxAglM > gate.minAglM && gate.passageHalfWidthM > 0
      && Math.abs(gate.crossOffsetM) + gate.passageHalfWidthM <= gate.halfWidthM)
    && course.route.every(point => ['x', 'z', 'sM', 'halfWidthM'].every(key => Number.isFinite(point[key])))
    && ['x', 'z', 'headingDeg', 'aglM', 'iasKnots', 'flightPathAngleDeg']
      .every(key => Number.isFinite(spawn?.[key]))
    && spawn.aglM >= course.gates[0].minAglM && spawn.aglM <= course.gates[0].maxAglM
    && spawn.iasKnots >= manifest.minimumIasKnots && spawn.iasKnots <= manifest.maximumIasKnots
    && manifest.terrain?.kind === 'generated-valley' && manifest.terrain.seed === course.seed
    && manifest.fixedConfiguration?.gearDown === false
    && manifest.fixedConfiguration?.flapIndex === 0 && manifest.fixedConfiguration?.spoilers === 0
    && Math.abs(Math.hypot(spawn.x - course.gates[0].x, spawn.z - course.gates[0].z)
      - Math.abs(course.gates[0].crossOffsetM)) < 1;
  if (!valid) throw new TypeError('Invalid valley slalom manifest');
  return manifest;
}

/** Legs between consecutive ordered gates, in the terms the envelope measures. */
export function slalomLegs(course) {
  return course.gates.slice(1).map((gate, index) => {
    const previous = course.gates[index];
    return { index: index + 1, from: previous, to: gate, startS: previous.sM,
      lengthM: gate.sM - previous.sM,
      headingChangeDeg: ((gate.headingDeg - previous.headingDeg + 540) % 360) - 180 };
  });
}

/** The passage ceiling at any progress: interpolated between gate ceilings, so
 * an avoidance climb between gates costs altitude and returning stops it. */
export function passageCeilingAglAt(course, progressM) {
  const gates = course.gates;
  if (progressM <= gates[0].sM) return gates[0].maxAglM;
  for (let index = 1; index < gates.length; index++) {
    const from = gates[index - 1], to = gates[index];
    if (progressM <= to.sM) {
      const share = (progressM - from.sM) / (to.sM - from.sM);
      return from.maxAglM + (to.maxAglM - from.maxAglM) * share;
    }
  }
  return gates.at(-1).maxAglM;
}

/** Nearest point on the curving centreline, with the corridor width and passage
 * ceiling that apply there. The judge and the HUD use this one function, so a
 * corner cut is measured exactly the way it is displayed. `hintIndex` keeps the
 * projection on the active leg where a bend has two nearby centreline points. */
export function projectSlalom(course, position, hintIndex = null) {
  const route = course.route;
  const from = hintIndex === null ? 0 : Math.max(0, hintIndex - 12);
  const to = hintIndex === null ? route.length - 1 : Math.min(route.length - 1, hintIndex + 12);
  let best = null;
  for (let index = from; index < to; index++) {
    const start = route[index], end = route[index + 1];
    const dx = end.x - start.x, dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz || 1;
    const share = Math.max(0, Math.min(1,
      ((position.x - start.x) * dx + (position.z - start.z) * dz) / lengthSquared));
    const px = start.x + dx * share, pz = start.z + dz * share;
    const distanceM = Math.hypot(position.x - px, position.z - pz);
    if (best && distanceM >= best.distanceM) continue;
    // Cross-track is positive to the right of the direction of travel, the same
    // sign convention the generator's own projection uses.
    const length = Math.sqrt(lengthSquared) || 1;
    best = { segmentIndex: index, distanceM,
      progressM: start.sM + (end.sM - start.sM) * share,
      crossM: (-dz * (position.x - px) + dx * (position.z - pz)) / length,
      halfWidthM: start.halfWidthM + (end.halfWidthM - start.halfWidthM) * share };
  }
  best.ceilingAglM = passageCeilingAglAt(course, best.progressM);
  return best;
}

/** Signed cross-track and altitude at the exact plane of a gate, interpolated
 * from the positions on either side of it. Gate credit is measured where the
 * plane is, not a tick early. */
export function crossAtPlane(from, to, planeS) {
  const share = (planeS - from.progressM) / (to.progressM - from.progressM || 1);
  return { crossM: from.crossM + (to.crossM - from.crossM) * share,
    aglM: from.aglM + (to.aglM - from.aglM) * share };
}
