import * as THREE from 'three';
import { CLIMB_BUDGET_MS, MAX_BANK_DEG, SLALOM_ENVELOPE_VERSION, SLALOM_IAS_MAX_KT,
  SLALOM_IAS_MIN_KT, assessLeg, bankReversalMeters } from './slalomEnvelope.js';

/** Seed-reproducible valley courses for validating the slalom contract. Terrain
 * and geometry are generated together, which keeps a course honest in two
 * directions: the walls are the ones the pilot will actually meet, and the
 * geometry is only accepted if the measured aircraft response can fly it. A
 * course that fails that test is a generation failure, reported as such, never
 * shipped as a harder course. Nothing here is offered to a guest pilot: the
 * terrain stays host-side and the briefing carries the usual sensor model only. */

const RAD = Math.PI / 180, KT_TO_MS = 0.514444;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frozen generation and judging numbers. `valley-low-v1` stays untouched as the
 * regression baseline; slalom scores live in their own version and are never
 * compared against low-v1 numbers. */
export const VALLEY_SLALOM_RULES = Object.freeze({
  version: 'valley-slalom-v1',
  gates: 7,
  /** Leg length floor comes from the measured bank reversal: at the fast end of
   * the band a full reversal costs about 600 m of straight line. */
  legLengthM: [900, 1250],
  headingChangeDeg: [18, 28],
  /** Half of the canyon floor. Tight trench-like canyon profile so turns carve
   * around steep rocky spurs. */
  corridorHalfWidthM: [120, 170],
  gatePassageHalfWidthM: 50,
  /** The aim point sits across the valley, alternating sides, so the line must
   * carve the bend instead of following the middle. */
  gateOffsetFraction: [0.45, 0.75],
  /** The ceiling a gate is credited under, and how much deeper it may be. */
  passageMinAglM: 50,
  passageBandM: [35, 75],
  /** Between gates the valley may drop by no more than what a constant-speed leg
   * can actually sink, and may rise by a good deal more. */
  floorStepDownM: 25,
  floorStepUpM: 180,
  wallRiseM: [380, 620],
  ridgeExponent: [0.85, 1.25],
  speedKnots: [SLALOM_IAS_MIN_KT, SLALOM_IAS_MAX_KT],
  /** The measured turn rate and sink ceiling are both best at the slow end of the
   * band, and a leg assessed at any other speed would be sized on borrowed time. */
  cruiseKnots: 240,
  clearanceFloorM: 20,
  reliefAmplitudeM: 10,
  decisionPeriodTicks: 24,
  commandDelayTicks: 24,
  sampleStepM: 25,
  /** Chart resolution offered to a pilot: a route to read, not a terrain array. */
  chartSpacingM: 100,
  /** Two minutes of flying, the same wall clock the low-v1 baseline runs with. */
  timeoutTicks: 14400,
  envelopeVersion: SLALOM_ENVELOPE_VERSION,
  maximumBankDeg: MAX_BANK_DEG,
});

/** Smooth deterministic relief added to the idealised walls, so a course is not
 * a perfect prism while still being exactly reproducible from its seed. */
function valueNoise(random, cells = 240) {
  const lattice = new Map();
  const corner = (ix, iz) => {
    const key = `${ix}|${iz}`;
    let value = lattice.get(key);
    if (value === undefined) {
      value = random();
      lattice.set(key, value);
    }
    return value;
  };
  return (x, z) => {
    const gx = x / cells, gz = z / cells;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = corner(ix, iz), b = corner(ix + 1, iz), c = corner(ix, iz + 1), d = corner(ix + 1, iz + 1);
    return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
  };
}

/** One valley: a heading-continuous polyline of constant-curvature legs, with a
 * floor height, a half width and a wall height carried along it. */
function buildCenterline(random, rules) {
  const samples = [];
  let heading = (random() - 0.5) * 20 * RAD, x = 0, z = 0, floor = 2100, progress = 0;
  const legs = [];
  for (let index = 0; index < rules.gates; index++) {
    const lengthM = rules.legLengthM[0] + random() * (rules.legLengthM[1] - rules.legLengthM[0]);
    // Slalom: the bend reverses side, so no leg can be flown without a roll.
    const side = index % 2 === 0 ? 1 : -1;
    const headingChangeDeg = side * (rules.headingChangeDeg[0]
      + random() * (rules.headingChangeDeg[1] - rules.headingChangeDeg[0]));
    const stepDownM = random() * rules.floorStepDownM;
    const floorAt = floor - stepDownM
      + (random() < 0.35 ? random() * rules.floorStepUpM * 0.4 : 0);
    const wallRiseRange = rules.wallRiseM ?? [380, 620];
    const ridgeExpRange = rules.ridgeExponent ?? [0.85, 1.25];
    const leg = { index, lengthM, headingChangeDeg, startFloor: floor, endFloor: floorAt,
      halfWidth: rules.corridorHalfWidthM[0]
        + random() * (rules.corridorHalfWidthM[1] - rules.corridorHalfWidthM[0]),
      wallRiseM: wallRiseRange[0] + random() * (wallRiseRange[1] - wallRiseRange[0]),
      ridgeExponent: ridgeExpRange[0] + random() * (ridgeExpRange[1] - ridgeExpRange[0]),
      offsetFraction: rules.gateOffsetFraction[0]
        + random() * (rules.gateOffsetFraction[1] - rules.gateOffsetFraction[0]) };
    legs.push(leg);
    const curvature = headingChangeDeg * RAD / lengthM;
    const steps = Math.max(2, Math.round(lengthM / rules.sampleStepM));
    const stepM = lengthM / steps;
    // The first sample of a leg is the last sample of the one before it; pushing
    // it twice would freeze the position while the arc length kept counting.
    for (let step = index === 0 ? 0 : 1; step <= steps; step++) {
      const share = step / steps;
      if (step > 0) {
        // Integrate the arc: heading changes uniformly along the leg, so the
        // demand the contract puts on a leg is the demand the turn was sized to.
        // Half a step at the old heading, the whole step's turn, half a step at
        // the new heading; anything else quietly shortens the bend.
        x += Math.sin(heading) * stepM / 2; z -= Math.cos(heading) * stepM / 2;
        heading += curvature * stepM;
        x += Math.sin(heading) * stepM / 2; z -= Math.cos(heading) * stepM / 2;
        progress += stepM;
      }
      samples.push({ x, z, s: progress, heading, floor: floor + (floorAt - floor) * share,
        halfWidth: leg.halfWidth, wallRiseM: leg.wallRiseM, ridgeExponent: leg.ridgeExponent,
        legIndex: index });
    }
    floor = floorAt;
    leg.endSample = samples.length - 1;
  }
  return { samples, legs };
}

/** Height of the idealised valley at (cross-track, along-track) coordinates.
 * The corridor is the valley *floor*: flat, wide enough to hold a passage space,
 * and the thing the lateral rule is measured against. The walls start outside it
 * and rise to the ridge, so the low line is genuinely the constrained line. */
function profileHeight({ crossM, floorM, halfWidthM, wallRiseM, ridgeExponent }) {
  const outside = Math.abs(crossM) / halfWidthM - 1;
  if (outside <= 0) return floorM;
  if (outside <= 1) return floorM + wallRiseM * outside ** ridgeExponent;
  // Past the crest the rim keeps rising a little and then stands up, so a pilot
  // who leaves the valley meets a plateau, not an infinite ramp.
  return floorM + wallRiseM * Math.min(2.2, 1 + (outside - 1) * 0.3);
}

export function createValleyTerrain({ samples, noise, reliefAmplitudeM = 10, crossJitterM = 12 }) {
  const cellSizeM = 400;
  const index = new Map();
  samples.forEach((sample, sampleIndex) => {
    const reach = 2 * sample.halfWidth + 300;
    const fromX = Math.floor((sample.x - reach) / cellSizeM), toX = Math.floor((sample.x + reach) / cellSizeM);
    const fromZ = Math.floor((sample.z - reach) / cellSizeM), toZ = Math.floor((sample.z + reach) / cellSizeM);
    for (let cx = fromX; cx <= toX; cx++) for (let cz = fromZ; cz <= toZ; cz++) {
      const key = `${cx}|${cz}`;
      const bucket = index.get(key);
      if (bucket) bucket.push(sampleIndex); else index.set(key, [sampleIndex]);
    }
  });

  /** Nearest point on the centreline: progress, signed cross-track and the
   * interpolated valley profile there. */
  function project(x, z) {
    const cx = Math.floor(x / cellSizeM), cz = Math.floor(z / cellSizeM);
    let candidates = index.get(`${cx}|${cz}`);
    if (!candidates) {
      for (let dx = -1; dx <= 1 && (!candidates || !candidates.length); dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          candidates = index.get(`${cx + dx}|${cz + dz}`);
          if (candidates?.length) break;
        }
      }
    }
    const pool = candidates?.length ? candidates : samples.map((_, i) => i);
    let best = null;
    for (const i of pool) {
      const from = samples[i], to = samples[Math.min(samples.length - 1, i + 1)];
      const dx = to.x - from.x, dz = to.z - from.z;
      const lengthSquared = dx * dx + dz * dz || 1;
      const share = clamp(((x - from.x) * dx + (z - from.z) * dz) / lengthSquared, 0, 1);
      const px = from.x + dx * share, pz = from.z + dz * share;
      const distanceSquared = (x - px) ** 2 + (z - pz) ** 2;
      if (!best || distanceSquared < best.distanceSquared) {
        // Cross-track is positive to the right of the direction of travel.
        const along = { x: Math.sin(to.heading), z: -Math.cos(to.heading) };
        best = { distanceSquared, s: from.s + (to.s - from.s) * share,
          crossM: (x - px) * along.z * -1 + (z - pz) * along.x,
          floorM: from.floor + (to.floor - from.floor) * share,
          halfWidthM: from.halfWidth + (to.halfWidth - from.halfWidth) * share,
          wallRiseM: from.wallRiseM + (to.wallRiseM - from.wallRiseM) * share,
          ridgeExponent: from.ridgeExponent + (to.ridgeExponent - from.ridgeExponent) * share,
          legIndex: from.legIndex };
      }
    }
    return best;
  }

  return {
    isLoaded: true,
    loadError: null,
    size: 44000,
    gridSize: 0,
    region: 'generated-valley',
    project,
    getHeight(x, z) {
      const here = project(x, z);
      const floor = here.floorM + (noise(x, z) - 0.5) * 2 * reliefAmplitudeM;
      // The walls wander a little sideways, so the ridge line is not a copy of
      // the centreline. Judging still uses the smooth corridor from project().
      return profileHeight({ ...here, floorM: floor,
        crossM: here.crossM + (noise(x + 900, z - 700) - 0.5) * 2 * crossJitterM });
    },
    getNormal(x, z) {
      const eps = 2;
      const normal = new THREE.Vector3(
        this.getHeight(x - eps, z) - this.getHeight(x + eps, z), 2 * eps,
        this.getHeight(x, z - eps) - this.getHeight(x, z + eps));
      return normal.normalize();
    },
  };
}

/** Gates sit at the leg boundaries, aimed across the valley rather than down the
 * middle, each with its own terrain-relative passage band. */
export function buildGates({ samples, legs, rules, random, terrain }) {
  const gates = [];
  for (let index = 0; index < legs.length; index++) {
    const leg = legs[index];
    // The gate is the arc the leg actually ends on, not an index counted from
    // the start: each leg repeats its boundary sample, so a running count drifts
    // upstream by one sample per leg and quietly shortens every turn.
    const sample = samples[Math.min(samples.length - 1, leg.endSample)];
    const side = index % 2 === 0 ? -1 : 1;
    const bandM = rules.passageBandM[0] + random() * (rules.passageBandM[1] - rules.passageBandM[0]);
    const heading = sample.heading;
    // The aim point leaves the whole passage space inside the corridor.
    const crossOffsetM = side * leg.offsetFraction * (sample.halfWidth - rules.gatePassageHalfWidthM);
    const anchorX = sample.x + Math.cos(heading) * crossOffsetM;
    const anchorZ = sample.z + Math.sin(heading) * crossOffsetM;
    gates.push({ index, x: sample.x, z: sample.z, sM: sample.s,
      headingDeg: heading / RAD, halfWidthM: sample.halfWidth,
      crossOffsetM, passageHalfWidthM: rules.gatePassageHalfWidthM,
      // The band is anchored to the ground the pilot will measure against, not to
      // the idealised profile the generator started from.
      floorM: terrain.getHeight(anchorX, anchorZ),
      minAglM: rules.passageMinAglM, maxAglM: rules.passageMinAglM + bandM });
  }
  return gates;
}

/** Every rule a course must satisfy before anyone is asked to fly it. Geometry
 * is checked against the measured envelope, not against a pilot's result: a
 * course that fails here is a generation failure and never becomes a level. */
export function assessCourse({ course, terrain, rules = VALLEY_SLALOM_RULES }) {
  const failures = [];
  const push = (gateIndex, reason, detail) => failures.push({ gateIndex, reason, detail });
  const { gates } = course;
  for (let index = 1; index < gates.length; index++) {
    const from = gates[index - 1], to = gates[index];
    const legLengthM = to.sM - from.sM;
    const headingChangeDeg = ((to.headingDeg - from.headingDeg + 540) % 360) - 180;
    const leg = assessLeg({ lengthM: legLengthM, headingChangeDeg,
      altitudeChangeM: to.floorM - from.floorM, entryIasKnots: rules.cruiseKnots,
      exitIasKnots: rules.cruiseKnots });
    if (!leg.ok) for (const shortfall of leg.shortfalls) {
      push(index, `leg-${shortfall}`, { legLengthM, headingChangeDeg,
        floorChangeM: to.floorM - from.floorM, ...leg });
    }
    const reversalM = bankReversalMeters({ iasKnots: rules.speedKnots[1] });
    if (legLengthM < reversalM) push(index, 'leg-shorter-than-a-bank-reversal', { legLengthM, reversalM });
    const lateral = Math.abs(to.crossOffsetM - from.crossOffsetM);
    const room = Math.max(from.halfWidthM, to.halfWidthM);
    if (lateral > 2 * room) push(index, 'line-leaves-the-valley', { lateral, room });
  }
  for (const gate of gates) {
    if (Math.abs(gate.crossOffsetM) + gate.passageHalfWidthM > gate.halfWidthM) {
      push(gate.index, 'passage-space-outside-the-corridor', gate);
    }
    const along = { x: Math.sin(gate.headingDeg * RAD), z: -Math.cos(gate.headingDeg * RAD) };
    const right = { x: -along.z, z: along.x };
    const anchorX = gate.x + right.x * gate.crossOffsetM, anchorZ = gate.z + right.z * gate.crossOffsetM;
    const anchorGroundM = terrain.getHeight(anchorX, anchorZ);
    if (Math.abs(anchorGroundM - gate.floorM) > 1) {
      push(gate.index, 'gate-floor-is-not-the-ground-under-it', { floorM: gate.floorM, anchorGroundM });
    }
    // The band sits on the valley floor, not on a hillside: a steep slope under
    // the gate would make the AGL range a function of the line chosen.
    const slopeDeg = Math.acos(Math.min(1, terrain.getNormal(anchorX, anchorZ).y)) / RAD;
    if (slopeDeg > 20) push(gate.index, 'passage-band-anchored-to-a-hillside', { slopeDeg });
    for (let offset = -gate.passageHalfWidthM; offset <= gate.passageHalfWidthM; offset += 20) {
      const x = gate.x + right.x * offset, z = gate.z + right.z * offset;
      const projected = terrain.project(x, z);
      if (Math.abs(projected.crossM) > gate.halfWidthM) {
        push(gate.index, 'passage-crosses-a-wall', { offset, halfWidthM: gate.halfWidthM });
        break;
      }
    }
    // A corridor whose crest sits below the top of the passage band is not a
    // valley: the pilot could leave it by climbing, which would make the lateral
    // rule decorative. The crest is twice the floor half-width out.
    const walls = [1, -1].map(side => terrain.getHeight(gate.x + right.x * side * gate.halfWidthM * 2,
      gate.z + right.z * side * gate.halfWidthM * 2));
    const wallHeightM = Math.max(...walls) - anchorGroundM;
    if (wallHeightM < gate.maxAglM) {
      push(gate.index, 'passage-band-above-the-ridge', { maxAglM: gate.maxAglM, wallHeightM });
    }
  }
  // The intended line has to exist in the generated ground, not only in the
  // idealised profile: it stays inside the walls, and rising terrain cannot
  // outpace the airframe's measured climb authority.
  const climbBudgetM = CLIMB_BUDGET_MS * (rules.sampleStepM / (rules.cruiseKnots * KT_TO_MS));
  for (let index = 1; index < gates.length; index++) {
    const from = gates[index - 1], to = gates[index];
    const steps = Math.max(2, Math.round((to.sM - from.sM) / rules.sampleStepM));
    let previousGround = terrain.getHeight(from.x, from.z);
    for (let step = 1; step <= steps; step++) {
      const share = step / steps;
      const x = from.x + (to.x - from.x) * share, z = from.z + (to.z - from.z) * share;
      const projected = terrain.project(x, z);
      if (Math.abs(projected.crossM) > projected.halfWidthM) {
        push(index, 'line-leaves-the-corridor',
          { share, crossM: projected.crossM, halfWidthM: projected.halfWidthM });
        break;
      }
      const ground = terrain.getHeight(x, z);
      if (ground - previousGround > climbBudgetM) {
        push(index, 'line-climb-demand-exceeds-the-airframe',
          { share, riseM: ground - previousGround, climbBudgetM });
        break;
      }
      previousGround = ground;
    }
  }
  return { ok: failures.length === 0, failures, lengthM: course.lengthM };
}

/** A seed becomes a course, or it fails: the two are never confused. */
export function generateValley({ seed, rules = VALLEY_SLALOM_RULES } = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError('valley seed must be a safe integer');
  const random = mulberry32(seed);
  const { samples, legs } = buildCenterline(random, rules);
  const noise = valueNoise(mulberry32(seed ^ 0x5bf03635));
  const terrain = createValleyTerrain({ samples, noise, reliefAmplitudeM: rules.reliefAmplitudeM });
  const gates = buildGates({ samples, legs, rules, random, terrain });
  const centerline = samples.map(sample => ({ x: sample.x, z: sample.z, sM: sample.s,
    halfWidthM: sample.halfWidth, headingDeg: sample.heading / RAD }));
  const course = { version: rules.version, seed, gates, legs, centerline,
    lengthM: samples.at(-1).s, elevationReferenceM: 2100,
    clearanceFloorM: rules.clearanceFloorM, speedKnots: rules.speedKnots };
  const assessment = assessCourse({ course, terrain, rules });
  return { course, terrain, assessment };
}

