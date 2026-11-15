import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateCombatSituation } from '../scripts/lib/combatSituationMatrix.mjs';
import { compareTargetTrajectories, runCombatDefenseAudit, runTargetBehaviorAudit } from '../scripts/lib/combatDefenseAudit.mjs';

test('paired defense controls preserve launch state and isolate sensor-compatible decoys', () => {
  const report = runCombatDefenseAudit({ geometries: ['AIM9X', 'AIM120C'].map(type =>
    ({ type, rangeM: 3000, aspectDeg: 0, shooterAltM: 1500, targetAltM: 1500 })) });
  for (const group of report.groups) {
    const byId = Object.fromEntries(group.variants.map(v => [v.id, v.result]));
    const passive = byId.passive;
    for (const result of Object.values(byId)) {
      assert.equal(result.launched, true);
      assert.deepEqual(result.launchState, passive.launchState);
      assert.equal(result.trajectory[0].seconds, 0);
      assert.ok(Math.abs(result.trajectory.at(-1).seconds - result.terminalSeconds) < 0.001);
      assert.ok(result.trajectory.every(s => Number.isFinite(s.targetG) && Number.isFinite(s.targetBankDeg)));
    }
    assert.equal(passive.defense.evasionSeconds, 0);
    assert.equal(passive.defense.firstWarningSeconds, null);
    const reaction = byId['reaction-only'];
    assert.ok(reaction.defense.evasionSeconds > 0);
    assert.equal(reaction.defense.chaffDispensed, 0);
    assert.equal(reaction.defense.flaresDispensed, 0);
    assert.ok(group.comparisons[0].maxPositionDifferenceM > 1, 'Reaction changes actual trajectory');
    const chaff = byId['reaction-chaff'];
    const flare = byId['reaction-flare'];
    assert.ok(chaff.defense.chaffDispensed > 0);
    assert.equal(chaff.defense.flaresDispensed, 0);
    assert.equal(flare.defense.chaffDispensed, 0);
    assert.ok(flare.defense.flaresDispensed > 0);
    const incompatible = group.geometry.type === 'AIM9X' ? chaff : flare;
    const compatible = group.geometry.type === 'AIM9X' ? flare : chaff;
    assert.equal(incompatible.decoyTransfers, 0);
    assert.equal(incompatible.terminal, reaction.terminal);
    assert.ok(compatible.decoyTransfers > 0);
  }
});

test('trajectory recording does not change dynamics and includes final off-cadence sample', () => {
  const input = { type: 'AIM120C', rangeM: 1500, targetBehavior: 'evasive_ai' };
  const ordinary = simulateCombatSituation(input);
  const traced = simulateCombatSituation({ ...input, recordTrajectory: true });
  assert.equal(ordinary.trajectory, null);
  for (const key of ['terminal', 'terminalSeconds', 'minSeparationM', 'maxTargetG', 'defense']) {
    assert.deepEqual(traced[key], ordinary[key]);
  }
  assert.equal(traced.trajectory[1].seconds, 0.2);
  assert.ok(Math.abs(traced.trajectory.at(-1).seconds - traced.terminalSeconds) < 0.001);
});

test('no-lock conditions are retained and never credited as defense successes', () => {
  const report = runCombatDefenseAudit({ geometries: [
    { type: 'AIM9X', rangeM: 10000, aspectDeg: 0 },
  ] });
  for (const s of report.summaries) {
    assert.equal(s.noLock, 1);
    assert.equal(s.launched, 0);
    assert.equal(s.casesWithReaction, 0);
    assert.equal(s.killFractionOfLaunches, null);
    assert.equal(s.maxTargetG, null);
  }
  for (const pair of report.groups[0].comparisons) {
    assert.equal(pair.bothLaunched, false);
    assert.equal(pair.sharedSamples, 0);
    assert.equal(pair.maxPositionDifferenceM, null);
  }
  assert.deepEqual(runCombatDefenseAudit({ geometries: [] }).summaries, []);
});

test('trajectory comparison uses common instants rather than terminal endpoints', () => {
  const sample = (seconds, x) => ({ seconds, targetPosition: [x, 0, 0], targetSpeedMps: 200 });
  const result = compareTargetTrajectories([sample(0, 0), sample(0.2, 40)],
    [sample(0, 0), sample(0.4, 80)]);
  assert.equal(result.sharedSamples, 1);
  assert.equal(result.maxPositionDifferenceM, 0);
});

test('orbit and break fixtures have distinct trajectories despite matching kill labels', () => {
  const audit = runTargetBehaviorAudit();
  assert.ok(audit.orbitVersusBreak.sharedSamples > 10);
  assert.ok(audit.orbitVersusBreak.maxPositionDifferenceM > 10);
  assert.equal(audit.results[0].trajectory[0].targetG, null, 'Straight fixture is kinematic');
  assert.throws(() => simulateCombatSituation({ targetBehavior: 'straight', threatResponseEnabled: true }), TypeError);
});
