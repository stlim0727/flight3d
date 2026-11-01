import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LuklaTerrain } from '../src/environment/LuklaTerrain.js';
import { createValleyManifest, projectValleyPosition, valleyLegs } from '../src/arena/valleyCourse.js';
import { ValleyMission } from '../src/arena/ValleyMission.js';

function straightManifest(overrides = {}) {
  const m = createValleyManifest();
  return createValleyManifest({ ...m, course: { ...m.course,
    points: [{ id: 'start', x: 0, z: 0 }, { id: 'middle', x: 0, z: 500 }, { id: 'finish', x: 0, z: 1000 }] },
  spawn: { ...m.spawn, x: 0, z: 0, headingDeg: 180 }, ...overrides });
}
function sample(tick, x, z, aglM = 80, extra = {}) {
  return { tick, position: { x, y: 2000 + aglM, z }, aglM, iasKnots: 220, groundSpeedKnots: 250,
    crashed: false, damaged: false, bodyContact: false, ...extra };
}
function flyStraight({ agl = () => 80, revisit = false } = {}) {
  const mission = new ValleyMission(straightManifest());
  let tick = 0;
  mission.update(sample(++tick, 0, 0, agl(0)));
  for (let z = 5; z <= 1000; z += 5) {
    mission.update(sample(++tick, 0, z, agl(z)));
    if (revisit && z === 300) {
      // Loiter/backtracking cannot resample already traversed course bins.
      for (let back = 295; back >= 200; back -= 5) mission.update(sample(++tick, 0, back, 500));
      for (let forward = 205; forward <= 300; forward += 5) mission.update(sample(++tick, 0, forward, 500));
    }
  }
  return mission;
}

test('declared route follows measured terrain outside the airport and ends in open recovery terrain', () => {
  const bytes = readFileSync(new URL('../public/terrain/lukla_dem.bin', import.meta.url));
  const elevations = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  const terrain = new LuklaTerrain(undefined, 8, elevations);
  const m = createValleyManifest();
  assert.ok(m.courseLengthM > 5500 && m.courseLengthM < 6000);
  assert.ok(m.course.points.every(p => Math.hypot(p.x, p.z) > 1500));
  assert.ok(Math.abs(terrain.getHeight(m.spawn.x, m.spawn.z) - 2272.69) < 1);
  const last = valleyLegs(m.course).at(-1), finish = last.end;
  const finishHeight = terrain.getHeight(finish.x, finish.z);
  for (let distance = 0; distance <= 1000; distance += 100) {
    const x = finish.x + last.dx / last.lengthM * distance;
    const z = finish.z + last.dz / last.lengthM * distance;
    assert.ok(terrain.getHeight(x, z) < finishHeight + 30, 'finish must not aim immediately into a rising wall');
  }
  terrain.geometry.dispose(); terrain.localTerraceGeometry.dispose(); terrain.mesh.material.dispose();
});

test('ordered plane crossings and complete distance coverage determine completion', () => {
  const run = flyStraight();
  const result = run.result();
  assert.equal(result.status, 'succeeded');
  assert.equal(result.metrics.completedGates, 2);
  assert.equal(result.metrics.scoredDistanceM, 1000);
  assert.equal(result.metrics.meanExcessM, 0);
  assert.equal(result.metrics.p95ExcessM, 0);
  assert.equal(result.metrics.altitudeCostM, 0);
  assert.equal(result.metrics.medianAglM, 80);
  assert.equal(result.metrics.rulesVersion, '1.3.0');
  assert.equal(result.metrics.meanIasKnots, 220);
  assert.equal(result.metrics.maxIasKnots, 220);
  assert.ok(result.metrics.finalScore > 10000, `Expected finalScore > 10000, got ${result.metrics.finalScore}`);
  assert.deepEqual(projectValleyPosition(straightManifest().course, { x: 40, z: 250 }), {
    rawT: 0.5, t: 0.5, progressM: 250, crossTrackM: -40, distanceM: 40, headingDeg: 180,
    segmentIndex: 0, totalLengthM: 1000,
  });
});

test('climbing has a finite cost rather than an upper-altitude failure and sub-target skimming earns no bonus', () => {
  const high = flyStraight({ agl: () => 250 }).result();
  assert.equal(high.status, 'succeeded');
  assert.equal(high.metrics.altitudeCostM, 150);
  const low = flyStraight({ agl: () => 30 }).result();
  assert.equal(low.status, 'succeeded');
  assert.equal(low.metrics.altitudeCostM, 0);
  const unsafe = new ValleyMission(straightManifest({ strictConstraints: true, course: { ...straightManifest().course, minimumAglM: 20 } }));
  assert.equal(unsafe.update(sample(1, 0, 0, 19)).reason, 'clearance-floor');
  assert.equal(unsafe.result().metrics.altitudeCostM, null);
});

test('revisiting low/high terrain cannot change first-progress score bins', () => {
  const normal = flyStraight().result(), revisited = flyStraight({ revisit: true }).result();
  assert.equal(revisited.status, 'succeeded');
  assert.equal(revisited.metrics.altitudeCostM, normal.metrics.altitudeCostM);
  assert.equal(revisited.metrics.scoredDistanceM, normal.metrics.scoredDistanceM);
  assert.equal(revisited.metrics.maxAglM, 500, 'maximum remains a truthful diagnostic even outside scored progress');
});

test('missed gates, discontinuous flight, incomplete logs and deadline cannot create successful runs', () => {
  const m = straightManifest({ strictConstraints: true });
  const missed = new ValleyMission(m);
  missed.update(sample(1, 0, 0));
  for (let z = 5, tick = 2; z <= 500; z += 5, tick++) missed.update(sample(tick, Math.min(250, z), z));
  assert.equal(missed.nextGateIndex, 1, 'crossing outside gate width does not count');
  const jump = new ValleyMission(m); jump.update(sample(1, 0, 0));
  assert.equal(jump.update(sample(2, 0, 1000)).reason, 'discontinuous-flight');
  const missing = new ValleyMission(m);
  assert.equal(missing.update({ tick: 1 }).reason, 'invalid-snapshot');
  const deadline = new ValleyMission(straightManifest({ timeoutTicks: 2 }));
  deadline.update(sample(1, 0, 0));
  assert.equal(deadline.update(sample(2, 0, 5)).reason, 'timeout');
  const before = deadline.result();
  assert.deepEqual(deadline.update(sample(3, 0, 1000)), before);
});

test('shorter completion time yields higher score and climbing above 100m penalizes', () => {
  // Slower flight (more steps: advance 2.5m per tick -> 401 ticks)
  const slowMission = new ValleyMission(straightManifest());
  let tick = 0;
  for (let z = 0; z <= 1000; z += 2.5) {
    slowMission.update(sample(++tick, 0, z, 50, { iasKnots: 200 }));
  }
  const slowResult = slowMission.result();
  assert.equal(slowResult.status, 'succeeded');

  // Faster flight (fewer steps: advance 10m per tick -> 101 ticks)
  const fastMission = new ValleyMission(straightManifest());
  tick = 0;
  for (let z = 0; z <= 1000; z += 10) {
    fastMission.update(sample(++tick, 0, z, 50, { iasKnots: 350 }));
  }
  const fastResult = fastMission.result();
  assert.equal(fastResult.status, 'succeeded');
  assert.ok(fastResult.metrics.durationSeconds < slowResult.metrics.durationSeconds);
  assert.ok(fastResult.metrics.finalScore > slowResult.metrics.finalScore,
    `Fast score ${fastResult.metrics.finalScore} must exceed slow score ${slowResult.metrics.finalScore}`);

  // Altitude test: low flight (e.g. 20m AGL, under 100m) has zero altitude penalty (no lower bound)
  const lowMission = new ValleyMission(straightManifest());
  tick = 0;
  for (let z = 0; z <= 1000; z += 5) {
    lowMission.update(sample(++tick, 0, z, 20, { iasKnots: 350 }));
  }
  const lowResult = lowMission.result();
  assert.equal(lowResult.status, 'succeeded');
  assert.equal(lowResult.metrics.altitudePenalty, 0, 'Flight under 100m must have zero altitude penalty');
  assert.equal(lowResult.metrics.altitudeCostM, 0);

  // High flight: climbing above 100m (e.g. 180m AGL) incurs altitude penalty
  const highMission = new ValleyMission(straightManifest());
  tick = 0;
  for (let z = 0; z <= 1000; z += 5) {
    highMission.update(sample(++tick, 0, z, 180, { iasKnots: 350 }));
  }
  const highResult = highMission.result();
  assert.equal(highResult.status, 'succeeded');
  assert.ok(highResult.metrics.altitudePenalty > 0, 'Flight above 100m must incur altitude penalty');
  assert.ok(highResult.metrics.finalScore < lowResult.metrics.finalScore,
    'Climbing above 100m must lower the final score');
});

test('manifest rejects missing geometry and invalid score/speed parameters', () => {
  for (const overrides of [{ minimumIasKnots: NaN }, { maximumIasKnots: 100 }, { timeoutTicks: 0 },
    { course: { ...straightManifest().course, binSizeM: 0 } },
    { course: { ...straightManifest().course, points: [{ x: 0, z: 0 }, { x: 0, z: 0 }] } }]) {
    assert.throws(() => createValleyManifest(overrides), /Invalid valley/);
  }
});
