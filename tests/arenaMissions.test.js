import test from 'node:test';
import assert from 'node:assert/strict';
import { TakeoffMission } from '../src/arena/TakeoffMission.js';
import { LandingMission } from '../src/arena/LandingMission.js';
import { createMissionManifest } from '../src/arena/missionConfig.js';

function snapshot(tick, overrides = {}) {
  const s = { tick, iasKnots: 160, groundSpeedKnots: 160, rollDeg: 0, headingDeg: 90,
    vsiFpm: 100, radioAltFt: 350, runwayS: 300, centerlineOffsetM: 0, heightAboveRunwayM: 110,
    crashed: false, damaged: false, bodyContact: false, ...overrides };
  s.gearContacts ??= ['nose', 'mainLeft', 'mainRight'].map(id => ({ id, grounded: false,
    runwayS: s.runwayS, centerlineOffsetM: 0, sinkRateMs: 0 }));
  return s;
}
function contact(s, ids, sinkRateMs = 1) {
  for (const c of s.gearContacts) { c.grounded = ids.includes(c.id); c.sinkRateMs = sinkRateMs; }
  return s;
}
function startTakeoff(run) { run.update(contact(snapshot(1, { heightAboveRunwayM: 4 }), ['nose', 'mainLeft', 'mainRight'], 0)); }
function startLanding(run) { run.update(snapshot(1, { runwayS: -3000 })); }

// Tick counts here use full production rules to catch cumulative timing errors.
test('takeoff requires sustained 1200 ticks and resets stable counter on a single violation', () => {
  const run = new TakeoffMission(); startTakeoff(run);
  for (let tick = 2; tick <= 1200; tick++) run.update(snapshot(tick));
  assert.equal(run.status, 'running'); assert.equal(run.metrics.stableTicks, 1199);
  run.update(snapshot(1201, { rollDeg: 11 })); assert.equal(run.metrics.stableTicks, 0);
  for (let tick = 1202; tick <= 2401; tick++) run.update(snapshot(tick));
  assert.equal(run.status, 'succeeded'); assert.equal(run.metrics.liftoffTick, 2);
});
test('takeoff contact footprint excursion, recontact and bad initial spawn fail irrevocably', () => {
  const excursion = new TakeoffMission();
  const s = contact(snapshot(1), ['mainLeft']); s.gearContacts[1].centerlineOffsetM = 31;
  assert.equal(excursion.update(s).reason, 'runway-excursion');
  const recontact = new TakeoffMission(); startTakeoff(recontact); recontact.update(snapshot(2));
  assert.equal(recontact.update(contact(snapshot(3), ['mainRight'])).reason, 'recontact');
  const result = recontact.result(); recontact.update(snapshot(4)); assert.deepEqual(recontact.result(), result);
  assert.equal(new TakeoffMission().update(snapshot(1)).reason, 'invalid-scenario');
});
test('takeoff height gate uses actual terrain clearance rather than runway elevation', () => {
  const run = new TakeoffMission(); startTakeoff(run);
  run.update(snapshot(2, { radioAltFt: 50, heightAboveRunwayM: 150 }));
  assert.equal(run.metrics.stableTicks, 0, '150m above runway can still be too close to rising terrain');
  run.update(snapshot(3, { radioAltFt: 400, heightAboveRunwayM: 250 }));
  assert.equal(run.metrics.stableTicks, 1);
});
test('landing requires first touchdown then 600 uninterrupted stopped ticks', () => {
  const run = new LandingMission(); startLanding(run);
  const td = contact(snapshot(2), ['mainLeft'], 2);
  assert.equal(run.update(td).status, 'running');
  assert.equal(run.metrics.touchdown.tick, 2);
  for (let tick = 3; tick <= 601; tick++) run.update(contact(snapshot(tick, { groundSpeedKnots: 2 }), ['mainLeft', 'mainRight'], 0));
  assert.equal(run.status, 'running'); assert.equal(run.metrics.stopTicks, 599);
  run.update(contact(snapshot(602, { groundSpeedKnots: 4 }), ['mainLeft', 'mainRight'], 0));
  assert.equal(run.metrics.stopTicks, 0);
  for (let tick = 603; tick <= 1202; tick++) run.update(contact(snapshot(tick, { groundSpeedKnots: 2 }), ['mainLeft', 'mainRight'], 0));
  assert.equal(run.status, 'succeeded');
});
test('a gentle contact without a touchdown event still anchors landing; main contact offset controls zone', () => {
  const run = new LandingMission(); startLanding(run);
  const s = contact(snapshot(2, { runwayS: 145 }), ['mainLeft'], 0.1);
  s.gearContacts[1].runwayS = 151;
  assert.equal(run.update(s).status, 'running');
  assert.equal(run.metrics.touchdown.runwayS, 151);
});
test('landing rejects nose-first, hard touchdown, zone miss, ground spawn and approach departure', () => {
  for (const [make, reason] of [
    [() => contact(snapshot(2), ['nose']), 'nose-first'],
    [() => contact(snapshot(2), ['mainLeft'], 3.01), 'hard-touchdown'],
    [() => contact(snapshot(2, { runwayS: 149 }), ['mainLeft']), 'touchdown-outside-zone'],
    [() => snapshot(2, { runwayS: 901 }), 'missed-landing'],
    [() => snapshot(2, { centerlineOffsetM: 301 }), 'approach-abandoned'],
  ]) {
    const run = new LandingMission(); startLanding(run);
    assert.equal(run.update(make()).reason, reason);
  }
  assert.equal(new LandingMission().update(contact(snapshot(1), ['mainLeft'])).reason, 'invalid-scenario');
});
test('landing small bounce retains immutable first touchdown, repeated bounces accumulate and hard recontact fails', () => {
  const run = new LandingMission(); startLanding(run);
  run.update(contact(snapshot(2), ['mainLeft'], 2));
  const first = structuredClone(run.metrics.touchdown);
  for (let tick = 3; tick <= 122; tick++) run.update(snapshot(tick));
  assert.equal(run.status, 'running'); assert.equal(run.metrics.bounceTicks, 120);
  run.update(contact(snapshot(123, { runwayS: 450 }), ['mainLeft'], 1));
  assert.deepEqual(run.metrics.touchdown, first);
  assert.equal(run.update(snapshot(124)).reason, 'unstable-touchdown');
  const hard = new LandingMission(); startLanding(hard);
  hard.update(contact(snapshot(2), ['mainLeft'], 1)); hard.update(snapshot(3));
  assert.equal(hard.update(contact(snapshot(4), ['mainRight'], 4)).reason, 'hard-touchdown');
});
test('rollout checks physical gear footprint even if CG remains in bounds', () => {
  const run = new LandingMission(); startLanding(run); run.update(contact(snapshot(2), ['mainLeft']));
  const s = contact(snapshot(3), ['mainLeft', 'mainRight']); s.gearContacts[2].centerlineOffsetM = 30.01;
  assert.equal(run.update(s).reason, 'runway-excursion');
});
test('missing/nonfinite data, duplicate or skipped ticks and damage cannot earn completion', () => {
  for (const bad of [{}, { ...snapshot(1), vsiFpm: NaN }, { ...snapshot(1), gearContacts: [] }, snapshot(2)]) {
    assert.equal(new LandingMission().update(bad).reason, 'invalid-snapshot');
  }
  const run = new LandingMission(); startLanding(run);
  assert.equal(run.update(snapshot(1)).reason, 'invalid-snapshot');
  for (const key of ['crashed', 'damaged', 'bodyContact']) {
    const r = new LandingMission(); startLanding(r);
    assert.equal(r.update(snapshot(2, { [key]: true })).status, 'failed');
  }
});
test('timeout remains terminal and manifest values are checked', () => {
  const m = createMissionManifest('landing', { timeoutTicks: 2 });
  const run = new LandingMission(m); startLanding(run);
  assert.equal(run.update(snapshot(2)).reason, 'timeout', 'exact deadline cannot leave a sweep running');
  assert.equal(run.update(snapshot(3)).reason, 'timeout');
  for (const overrides of [{ stopTicks: 0 }, { maximumSinkRateMs: NaN }, { runwayWidthM: 0 }, { touchdownEndS: 5000 },
    { runwayThreshold: { x: 0, y: NaN, z: 0 } }, { decisionPeriodTicks: 0 }]) {
    assert.throws(() => createMissionManifest('landing', overrides), /Invalid mission/);
  }
});
