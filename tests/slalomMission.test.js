import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlalomManifest } from '../src/arena/slalomCourse.js';
import { SlalomMission } from '../src/arena/SlalomMission.js';
import { VALLEY_SLALOM_RULES } from '../src/arena/generatedValley.js';
import { createBriefing, validatePlainData } from '../src/pilot/PilotProtocol.js';

/** A scripted line, not a pilot: the contract is tested against geometry it can
 * reproduce exactly, so a judge change that quietly redefines a pass shows up
 * here rather than in somebody's score. */

const KT_TO_MS = 0.514444;

function routePoint(course, s) {
  const route = course.route;
  let index = 0;
  while (index < route.length - 2 && route[index + 1].sM < s) index++;
  const a = route[index], b = route[index + 1];
  const share = (s - a.sM) / (b.sM - a.sM || 1);
  const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz) || 1;
  return { x: a.x + dx * share, z: a.z + dz * share, right: { x: -dz / length, z: dx / length } };
}

function gateValue(gates, s, column) {
  if (s <= gates[0].sM) return gates[0][column];
  for (let index = 1; index < gates.length; index++) {
    if (s <= gates[index].sM) {
      const from = gates[index - 1], to = gates[index];
      const share = (s - from.sM) / (to.sM - from.sM);
      return from[column] + (to[column] - from[column]) * share;
    }
  }
  return gates.at(-1)[column];
}

/** Fly the course as the contract asks: aim at each gate's passage space, stay
 * under its ceiling, and climb only where the line says to. */
function fly(manifest, { iasKnots = 260, cross = s => gateValue(manifest.course.gates, s, 'crossOffsetM'),
  agl = s => gateValue(manifest.course.gates, s, 'maxAglM'), fromS = manifest.course.gates[0].sM,
  toS = manifest.course.lengthM, straight = null, rampM = 0 } = {}) {
  const judge = new SlalomMission(manifest);
  const metresPerTick = iasKnots * KT_TO_MS / manifest.physicsHz;
  const spawnCross = manifest.course.gates[0].crossOffsetM;
  const sideAt = (at) => (rampM > 0 && straight === null
    ? spawnCross + (cross(at) - spawnCross) * Math.min(1, (at - fromS) / rampM) : cross(at));
  const pointAt = (at) => (straight
    ? { x: straight.x + straight.dx * (at - fromS), z: straight.z + straight.dz * (at - fromS),
      right: straight.right }
    : routePoint(manifest.course, at));
  let tick = 0, s = fromS, result = null;
  while (judge.status === 'running') {
    const here = pointAt(s), offset = sideAt(s);
    tick++;
    // Every line starts where the mission puts the aircraft: inside the first
    // passage space.
    const spawn = manifest.spawn;
    const position = tick === 1 ? { x: spawn.x, y: 2200, z: spawn.z }
      : { x: here.x + here.right.x * offset, y: 2200, z: here.z + here.right.z * offset };
    result = judge.update({ tick, position,
      iasKnots, groundSpeedKnots: iasKnots, aglM: agl(s),
      crashed: false, damaged: false, bodyContact: false });
    if (s >= toS) break;
    s = Math.min(toS, s + metresPerTick);
  }
  return { judge, result, steps: tick };
}

test('a line that rides the passage spaces clears the course at zero altitude cost', () => {
  const manifest = createSlalomManifest({ seed: 1 });
  const { judge } = fly(manifest, { agl: s => gateValue(manifest.course.gates, s, 'maxAglM') - 10 });
  assert.equal(judge.status, 'succeeded', `failed as ${judge.reason}`);
  const metrics = judge.result().metrics;
  assert.equal(metrics.gatesCleared, manifest.course.gates.length - 1);
  assert.equal(metrics.altitudeCostM, 0);
  assert.ok(metrics.scoredDistanceM > 5000);
});

test('crossing a gate above its ceiling is a missed gate, however well centred it is', () => {
  const manifest = createSlalomManifest({ seed: 2 });
  const { judge } = fly(manifest, { agl: s => gateValue(manifest.course.gates, s, 'maxAglM') + 40 });
  assert.equal(judge.status, 'failed');
  assert.equal(judge.reason, 'gate-missed');
  assert.equal(judge.result().metrics.gatesCleared, 0);
  assert.equal(judge.result().metrics.altitudeCostM, null);
});

test('the middle of the valley is not the passage space', () => {
  const manifest = createSlalomManifest({ seed: 3 });
  const centred = fly(manifest, { cross: () => 0, agl: () => 90, rampM: 300 });
  assert.equal(centred.judge.reason, 'gate-missed');
  assert.ok(Math.abs(manifest.course.gates[1].crossOffsetM) > 60,
    'a gate with no lateral demand proves nothing');
});

test('cutting the bend on a straight line leaves the corridor instead of shortening the course', () => {
  const manifest = createSlalomManifest({ seed: 4 });
  const gates = manifest.course.gates;
  const start = manifest.spawn, finish = manifest.destination;
  const dx = finish.x - start.x, dz = finish.z - start.z, length = Math.hypot(dx, dz);
  const chord = fly(manifest, { straight: { x: start.x, z: start.z,
    dx: dx / length, dz: dz / length, right: { x: -dz / length, z: dx / length } },
  toS: gates[0].sM + length, agl: () => 100, cross: () => 0 });
  assert.equal(chord.judge.status, 'failed');
  assert.ok(['corridor-excursion', 'gate-missed'].includes(chord.judge.reason),
    `a corner cut scored as ${chord.judge.status}/${chord.judge.reason}`);
  assert.ok(chord.judge.result().metrics.gatesCleared < gates.length - 1);
});

test('a climb between gates is allowed, charged, and stops when the line comes back down', () => {
  const manifest = createSlalomManifest({ seed: 5 });
  const gates = manifest.course.gates;
  const ceiling = s => gateValue(gates, s, 'maxAglM');
  const clean = fly(manifest, { agl: s => ceiling(s) - 10 });
  const hump = (widthM, riseM) => fly(manifest, { agl: (s) => {
    const center = (gates[1].sM + gates[2].sM) / 2;
    const distance = Math.abs(s - center);
    return ceiling(s) - 10 + (distance < widthM / 2 ? riseM * Math.cos(distance / widthM * Math.PI) : 0);
  } });
  assert.equal(clean.judge.status, 'succeeded');
  assert.equal(clean.judge.result().metrics.altitudeCostM, 0);
  const small = hump(600, 60).judge.result().metrics.altitudeCostM;
  const large = hump(900, 160).judge.result().metrics.altitudeCostM;
  assert.ok(small > 0 && large > small,
    `climbing out is not charged: ${small.toFixed(1)} m then ${large.toFixed(1)} m`);
});

test('the speed band and the clearance floor end a run rather than costing one', () => {
  const manifest = createSlalomManifest({ seed: 6 });
  assert.equal(fly(manifest, { iasKnots: VALLEY_SLALOM_RULES.speedKnots[0] - 10 }).judge.reason, 'speed-envelope');
  assert.equal(fly(manifest, { iasKnots: VALLEY_SLALOM_RULES.speedKnots[1] + 5 }).judge.reason, 'speed-envelope');
  const low = fly(manifest, { agl: () => manifest.course.clearanceFloorM - 1 });
  assert.equal(low.judge.reason, 'clearance-floor');
});

test('the judge refuses a snapshot that is not the next physics tick', () => {
  const manifest = createSlalomManifest({ seed: 7 });
  const judge = new SlalomMission(manifest);
  const gate = manifest.course.gates[0];
  const base = { position: { x: manifest.spawn.x, y: 2200, z: manifest.spawn.z }, iasKnots: 260,
    groundSpeedKnots: 260, aglM: gate.maxAglM - 10, crashed: false, damaged: false, bodyContact: false };
  assert.equal(judge.update({ ...base, tick: 2 }).reason, 'invalid-snapshot');
  const fresh = new SlalomMission(manifest);
  assert.notEqual(fresh.update({ ...base, tick: 1 }).status, 'failed');
  assert.equal(fresh.update({ ...base, tick: 2, aglM: Number.NaN }).reason, 'invalid-snapshot');
});

test('the briefing carries the chart and no terrain truth', () => {
  const manifest = createSlalomManifest({ seed: 8 });
  const briefing = createBriefing(manifest);
  assert.ok(validatePlainData(briefing).ok, 'briefing does not fit the payload budget');
  assert.equal(briefing.course.version, 'valley-slalom-v1');
  assert.equal(briefing.successConditions, undefined);
  for (const gate of briefing.course.gates) {
    assert.ok(!Object.hasOwn(gate, 'floorM'), 'the ground under a gate is not chart data');
    assert.deepEqual(gate.passageAglM, [gate.minAglM, gate.maxAglM]);
  }
  const json = JSON.stringify(briefing.course.route);
  assert.ok(!json.includes('floor') && !json.includes('wall'), 'the route leaks the valley profile');
  assert.ok(briefing.course.route.length < manifest.course.lengthM / 50,
    'the chart is a terrain array, not a route');
});

test('an un-flyable course never becomes a manifest', () => {
  assert.throws(() => createSlalomManifest({ seed: 1,
    rules: { ...VALLEY_SLALOM_RULES, headingChangeDeg: [50, 70] } }), /unflyable-course/);
});
