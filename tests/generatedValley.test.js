import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VALLEY_SLALOM_RULES, generateValley } from '../src/arena/generatedValley.js';
import { bankReversalMeters } from '../src/arena/slalomEnvelope.js';

/** The validity gate is the promise that no un-flyable course is ever offered as
 * a difficulty, so it is tested in both directions: real seeds pass, and a rule
 * set pushed past the measured envelope is refused rather than accepted. */

const DEV_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const EVAL_SEEDS = [101, 102, 103, 104, 105, 106, 107, 108];

const reasonsOf = (assessment) => assessment.failures.map(failure => failure.reason);

test('every fixed seed generates a valid valley before anyone is asked to fly it', () => {
  for (const seed of [...DEV_SEEDS, ...EVAL_SEEDS]) {
    const { course, assessment } = generateValley({ seed });
    assert.deepEqual(assessment.failures, [], `seed ${seed}: ${reasonsOf(assessment).join(', ')}`);
    assert.equal(course.gates.length, VALLEY_SLALOM_RULES.gates);
    assert.ok(course.lengthM > 4000, `seed ${seed} is too short to be a course`);
  }
});

test('a seed is the whole course: the same numbers reproduce terrain and gates', () => {
  const first = generateValley({ seed: 7 });
  const second = generateValley({ seed: 7 });
  assert.deepEqual(second.course, first.course);
  assert.deepEqual(second.assessment.failures, first.assessment.failures);
  for (const [x, z] of [[0, 0], [1234, -567], [first.course.lengthM / 2, 800]]) {
    assert.equal(second.terrain.getHeight(x, z), first.terrain.getHeight(x, z));
  }
  assert.notDeepEqual(generateValley({ seed: 8 }).course, first.course);
});

test('the bend a leg is judged on is the bend the centreline actually turns', () => {
  for (const seed of DEV_SEEDS) {
    const { course } = generateValley({ seed });
    course.gates.slice(1).forEach((gate, index) => {
      const previous = course.gates[index];
      const measured = ((gate.headingDeg - previous.headingDeg + 540) % 360) - 180;
      const declared = course.legs[index + 1].headingChangeDeg;
      assert.ok(Math.abs(measured - declared) < 0.5,
        `seed ${seed} leg ${index + 1}: turns ${measured.toFixed(2)} deg, declared ${declared.toFixed(2)}`);
    });
  }
});

test('the line carves the valley: gates alternate sides and no leg is a straight roll-in', () => {
  for (const seed of DEV_SEEDS) {
    const { course } = generateValley({ seed });
    const sides = course.gates.map(gate => Math.sign(gate.crossOffsetM));
    assert.deepEqual(sides, course.gates.map((_, index) => index % 2 ? 1 : -1),
      `seed ${seed} does not weave`);
    const shortestLeg = Math.min(...course.gates.slice(1).map((gate, index) =>
      gate.sM - course.gates[index].sM));
    assert.ok(shortestLeg >= bankReversalMeters({ iasKnots: VALLEY_SLALOM_RULES.speedKnots[1] }),
      `seed ${seed} has a leg shorter than one bank reversal`);
    const meanBend = course.gates.slice(1).reduce((sum, gate, index) => sum
      + Math.abs(((gate.headingDeg - course.gates[index].headingDeg + 540) % 360) - 180), 0)
      / (course.gates.length - 1);
    assert.ok(meanBend > 8, `seed ${seed} is a straight line at ${meanBend.toFixed(1)} deg per leg`);
  }
});

test('a passage space is a band over flat ground inside the corridor', () => {
  for (const seed of DEV_SEEDS) {
    const { course, terrain } = generateValley({ seed });
    for (const gate of course.gates) {
      const half = gate.halfWidthM;
      assert.ok(Math.abs(gate.crossOffsetM) + gate.passageHalfWidthM <= half,
        `gate ${gate.index} sits outside its corridor`);
      const heading = gate.headingDeg * Math.PI / 180;
      const right = { x: Math.cos(heading), z: Math.sin(heading) };
      let lowest = Infinity, highest = -Infinity;
      for (const offset of [-gate.passageHalfWidthM, 0, gate.passageHalfWidthM]) {
        const ground = terrain.getHeight(gate.x + right.x * offset, gate.z + right.z * offset);
        lowest = Math.min(lowest, ground);
        highest = Math.max(highest, ground);
        assert.ok(Math.abs(ground - gate.floorM) < 25,
          `gate ${gate.index} band is anchored to a hillside, not a floor`);
      }
      assert.ok(highest - lowest < 25, `gate ${gate.index} floor varies by ${(highest - lowest).toFixed(1)} m`);
      // Leaving the corridor means climbing: the shoulders of the floor are still
      // floor, and the wall behind them is the thing that closes the valley.
      for (const side of [-1, 1]) {
        const shoulder = terrain.getHeight(gate.x + right.x * side * half * 0.9,
          gate.z + right.z * side * half * 0.9);
        assert.ok(Math.abs(shoulder - gate.floorM) < 25, `gate ${gate.index} floor ends early on side ${side}`);
      }
      const crests = [-1, 1].map(side => terrain.getHeight(gate.x + right.x * side * half * 2,
        gate.z + right.z * side * half * 2));
      assert.ok(Math.max(...crests) - gate.floorM > gate.maxAglM,
        `gate ${gate.index} has no ridge above the passage band`);
    }
  }
});

test('the terrain answers the physics API everywhere a pilot could go', () => {
  const { terrain } = generateValley({ seed: 3 });
  assert.equal(terrain.isLoaded, true);
  assert.equal(terrain.loadError, null);
  assert.equal(terrain.region, 'generated-valley');
  for (const [x, z] of [[0, 0], [4200, 4200], [-9000, 6500], [20000, -20000]]) {
    const height = terrain.getHeight(x, z);
    assert.ok(Number.isFinite(height), `getHeight(${x}, ${z}) is not finite`);
    assert.ok(height > 0 && height < 4000, `getHeight(${x}, ${z}) returned ${height.toFixed(0)} m`);
    const normal = terrain.getNormal(x, z);
    assert.ok(Math.abs(normal.y) <= 1 && normal.y > 0, `getNormal(${x}, ${z}) is not usable`);
    assert.ok(Math.hypot(normal.x, normal.y, normal.z) - 1 < 1e-6);
  }
  // A valley floor is walkable: the slope under the centreline stays gentle.
  for (let x = -3000; x <= 3000; x += 37) {
    const here = terrain.project(x, Math.sin(x / 900) * 900);
    if (Math.abs(here.crossM) > here.halfWidthM * 0.7) continue;
    const slope = Math.acos(Math.min(1, terrain.getNormal(x, Math.sin(x / 900) * 900).y));
    assert.ok(slope < 25 * Math.PI / 180, `floor slope of ${(slope * 57.3).toFixed(1)} deg`);
  }
});

test('the gate refuses a course the airframe cannot fly instead of selling it', () => {
  const turnRules = { ...VALLEY_SLALOM_RULES, headingChangeDeg: [40, 60] };
  const sinkRules = { ...VALLEY_SLALOM_RULES, floorStepDownM: 200 };
  const ridgeRules = { ...VALLEY_SLALOM_RULES, passageBandM: [400, 600] };
  const narrowRules = { ...VALLEY_SLALOM_RULES, corridorHalfWidthM: [60, 80] };
  for (const [label, rules] of [['turn', turnRules], ['sink', sinkRules],
    ['ridge', ridgeRules], ['narrow', narrowRules]]) {
    const rejected = DEV_SEEDS.map(seed => generateValley({ seed, rules }));
    assert.ok(rejected.some(entry => !entry.assessment.ok),
      `${label}: impossible geometry was accepted as a course`);
    for (const entry of rejected) if (!entry.assessment.ok) assert.ok(reasonsOf(entry.assessment).length);
  }
});
