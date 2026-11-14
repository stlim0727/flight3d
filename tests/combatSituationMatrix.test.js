import test from 'node:test';
import assert from 'node:assert/strict';
import {
  simulateCombatSituation,
  sweepCombatSituationMatrix,
  detectMissileAnomalies,
} from '../scripts/lib/combatSituationMatrix.mjs';

test('combat situation: tail-chase inside NEZ reliably hits non-evading target', () => {
  const result = simulateCombatSituation({
    type: 'AIM9X',
    rangeM: 1500,
    aspectDeg: 0,
    shooterAltM: 3000,
    targetAltM: 3000,
    targetBehavior: 'straight',
    countermeasures: false,
  });
  assert.equal(result.launched, true);
  assert.equal(result.terminal, 'hit');
  assert.ok(result.minSeparationM < 5.0, `Expected lethal separation, got ${result.minSeparationM}`);
});

test('combat situation: off-boresight angle respects 28-degree seeker FOV rail boundary', () => {
  const withinFov = simulateCombatSituation({
    type: 'AIM9X',
    rangeM: 2000,
    aspectDeg: 0,
    offBoresightDeg: 25,
  });
  assert.equal(withinFov.launched, true, 'Target within 28 deg should lock and launch');
  assert.equal(withinFov.terminal, 'hit');

  const outsideFov = simulateCombatSituation({
    type: 'AIM9X',
    rangeM: 2000,
    aspectDeg: 0,
    offBoresightDeg: 32,
  });
  assert.equal(outsideFov.launched, false, 'Target outside 28 deg should refuse rail lock');
  assert.equal(outsideFov.terminal, 'no-lock');
});

test('combat situation: short-range crossing beam exposes lack of early boost TVC', () => {
  const beamResult = simulateCombatSituation({
    type: 'AIM9X',
    rangeM: 400,
    aspectDeg: 90,
    shooterAltM: 1500,
    targetAltM: 1500,
    targetBehavior: 'straight',
  });
  assert.equal(beamResult.launched, true);
  assert.notEqual(beamResult.terminal, 'hit', 'Aerodynamically limited missile should miss beam target at 400m');
  assert.ok(beamResult.guidanceLossReasons.includes('gimbal_limit') || beamResult.seekerLossReasons.includes('fov_limit'));
});

test('combat situation: countermeasure flares cause decoy transfers on AIM-9X', () => {
  const cmResult = simulateCombatSituation({
    type: 'AIM9X',
    rangeM: 1200,
    aspectDeg: 180,
    targetBehavior: 'evasive_ai',
    countermeasures: true,
  });
  assert.equal(cmResult.launched, true);
  assert.ok(cmResult.decoyTransfers > 0, `Expected decoy transfers from flare dispenser, got ${cmResult.decoyTransfers}`);
});

test('combat situation: anomaly detector identifies BVR coasting and short-range beam patterns', () => {
  const miniMatrix = sweepCombatSituationMatrix({
    types: ['AIM9X', 'AIM120C'],
    ranges: [400, 7000],
    aspects: [0, 90, 180],
    altitudes: [3000],
    behaviors: ['straight', 'evasive_ai'],
    cms: [false, true],
  });

  assert.ok(miniMatrix.length >= 24);
  const anomalies = detectMissileAnomalies(miniMatrix);
  const anomalyIds = anomalies.map(a => a.id);

  assert.ok(anomalyIds.includes('BVR_BURNOUT_BLINDNESS_ALWAYS_HIT'), 'Should identify BVR burnout blindness anomaly');
  assert.ok(anomalyIds.includes('SHORT_RANGE_BEAM_ALWAYS_MISS'), 'Should identify short-range beam always-miss anomaly');
  assert.ok(!anomalyIds.includes('EXTREME_RANGE_IMPOSSIBLE_HIT'), 'Should not have impossible hits beyond envelope');
});
