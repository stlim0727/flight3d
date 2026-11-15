import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCombatResults, combatMatrixCells } from '../scripts/lib/combatMatrixReport.mjs';
import { detectMissileAnomalies, simulateCombatSituation } from '../scripts/lib/combatSituationMatrix.mjs';

const row = (terminal, extra = {}) => ({
  type: 'AIM120C', rangeM: 400, aspectDeg: 90,
  terminal, launched: !['no-lock', 'fire-failed'].includes(terminal), ...extra,
});

test('report preserves mutually exclusive outcomes and both denominators', () => {
  const terminals = ['no-lock', 'fire-failed', 'hit', 'detonation-non-lethal',
    'miss-ground', 'miss-expired', 'miss-other', 'target-destroyed', 'timeout'];
  const summary = summarizeCombatResults(terminals.map(t => row(t)));
  assert.equal(summary.total, 9);
  assert.equal(summary.launched, 7);
  assert.equal(summary.unresolved, 1);
  assert.equal(summary.nonLethalDetonations, 1);
  assert.equal(summary.killFractionOfLaunches, 1 / 7);
  assert.equal(summary.killFractionOfSituations, 1 / 9);
  for (const key of ['noLock', 'fireFailed', 'kills', 'groundImpacts', 'expired', 'otherMisses', 'targetDestroyed']) {
    assert.equal(summary[key], 1);
  }
});

test('empty or malformed results cannot silently report a successful fraction', () => {
  assert.equal(summarizeCombatResults([]).killFractionOfLaunches, null);
  assert.equal(summarizeCombatResults([]).killFractionOfSituations, null);
  assert.throws(() => summarizeCombatResults([row('unknown')]), TypeError);
  assert.throws(() => summarizeCombatResults([row('hit', { launched: false })]), TypeError);
  assert.throws(() => summarizeCombatResults([row('no-lock', { launched: true })]), TypeError);
});

test('mixed types cannot hide a short-range beam cohort with no kills', () => {
  const results = [row('hit', { type: 'AIM9X' }), row('miss-expired'), row('no-lock')];
  const findings = detectMissileAnomalies(results);
  assert.deepEqual(findings.map(f => [f.id, f.type, f.count]), [
    ['SHORT_RANGE_BEAM_ALWAYS_MISS', 'AIM120C', 1],
  ]);
  const cells = combatMatrixCells(results);
  assert.equal(cells[1].launched, 1);
  assert.equal(cells[1].total, 2);
});

test('unresolved, survived explosions and distant kills do not imply duds or impossible hits', () => {
  assert.deepEqual(detectMissileAnomalies([row('timeout')]), []);
  assert.deepEqual(detectMissileAnomalies([
    row('detonation-non-lethal', { aspectDeg: 0 }),
    row('hit', { rangeM: 12000 }),
  ]), []);
  assert.deepEqual(detectMissileAnomalies([]), []);
});

test('scenario records actual launch geometry and rejects impossible initial geometry', () => {
  const input = { rangeM: 1500, targetBehavior: 'straight' };
  const first = simulateCombatSituation(input);
  const second = simulateCombatSituation(input);
  assert.deepEqual(first, second);
  assert.equal(first.inputs.rangeM, 1500);
  assert.equal(first.inputs.maxSimTimeSec, 25);
  assert.ok(first.launchState.elapsedSeconds > 0);
  assert.notEqual(first.launchState.rangeM, first.rangeM);
  assert.equal(first.launchState.targetVelocity.length, 3);
  const noLock = simulateCombatSituation({ offBoresightDeg: 40 });
  assert.equal(noLock.launchState, null);
  assert.throws(() => simulateCombatSituation({ rangeM: 400, targetAltM: 8000 }), RangeError);
});

test('defense records actual chaff release separately from inventory permission', () => {
  const options = { type: 'AIM120C', rangeM: 3000, targetBehavior: 'evasive_ai' };
  const defended = simulateCombatSituation({ ...options, countermeasures: true });
  assert.ok(defended.defense.chaffDispensed > 0);
  assert.ok(defended.defense.firstEvasionSeconds >= defended.defense.firstConfirmedThreatSeconds);
  const clean = simulateCombatSituation({ ...options, countermeasures: false });
  assert.equal(clean.defense.chaffDispensed, 0);
  assert.equal(clean.defense.flaresDispensed, 0);
  const patrol = simulateCombatSituation({ ...options, targetBehavior: 'orbit', countermeasures: true });
  assert.equal(patrol.defense.chaffDispensed, 0);
  assert.equal(patrol.defense.firstWarningSeconds, null);
});
