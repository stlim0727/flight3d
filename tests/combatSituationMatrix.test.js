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

test('combat situation: short-range crossing beam demonstrates early boost TVC capability', () => {
  // With TVC enabled (default on AIM-9X), missile pulls high-G off the rail and intercepts crossing target
  const tvcResult = simulateCombatSituation({
    type: 'AIM9X',
    rangeM: 400,
    aspectDeg: 90,
    shooterAltM: 1500,
    targetAltM: 1500,
    targetBehavior: 'straight',
    tvc: true,
  });
  assert.equal(tvcResult.launched, true);
  assert.equal(tvcResult.terminal, 'hit', 'TVC-capable AIM-9X should intercept crossing beam target at 400m');
  assert.ok(tvcResult.minSeparationM < 5.0, `Expected lethal proximity burst, got ${tvcResult.minSeparationM}`);
  assert.ok(tvcResult.maxMissileLateralG > 24, `Expected high TVC turn rate >24G, got ${tvcResult.maxMissileLateralG}G`);

  // Without TVC (e.g. AIM-120C or baseline tvc: false), missile is aerodynamically limited and misses
  const nonTvcResult = simulateCombatSituation({
    type: 'AIM9X',
    rangeM: 400,
    aspectDeg: 90,
    shooterAltM: 1500,
    targetAltM: 1500,
    targetBehavior: 'straight',
    tvc: false,
  });
  assert.equal(nonTvcResult.launched, true);
  assert.notEqual(nonTvcResult.terminal, 'hit', 'Aerodynamically limited missile should miss beam target at 400m');
  assert.ok(nonTvcResult.guidanceLossReasons.includes('gimbal_limit') || nonTvcResult.seekerLossReasons.includes('fov_limit'));
});

test('combat situation: a warning releases flares without guaranteeing IR capture', () => {
  const cmResult = simulateCombatSituation({
    type: 'AIM9X',
    rangeM: 1200,
    aspectDeg: 180,
    targetBehavior: 'evasive_ai',
    countermeasures: true,
  });
  assert.equal(cmResult.launched, true);
  assert.ok(cmResult.defense.flaresDispensed > 0);
  assert.ok(cmResult.defense.firstConfirmedThreatSeconds >= cmResult.defense.firstWarningSeconds);
  assert.ok(cmResult.defense.evasionSeconds > 0);
  assert.equal(cmResult.decoyTransfers, 0, 'resolved angular motion preserves this head-on track');
  const ambiguous = simulateCombatSituation({ type: 'AIM9X', rangeM: 1500, aspectDeg: 0,
    shooterAltM: 750, targetAltM: 1210, shooterSpeedMps: Math.hypot(96, 49),
    targetSpeedMps: 180, targetBehavior: 'evasive_ai', flares: true });
  assert.equal(ambiguous.launched, true);
  assert.ok(ambiguous.decoyTransfers > 0, 'a different measured geometry can still be captured');
});

test('combat situation: anomaly detector identifies BVR coasting and short-range beam patterns', () => {
  // Baseline without RWR and TVC exposes both anomalies
  const baselineMatrix = sweepCombatSituationMatrix({
    types: ['AIM9X', 'AIM120C'],
    ranges: [400, 7000],
    aspects: [0, 90, 180],
    altitudes: [3000],
    behaviors: ['straight', 'evasive_ai'],
    cms: [false, true],
    rwr: false,
    tvc: false,
  });

  assert.ok(baselineMatrix.length >= 24);
  const baselineAnomalies = detectMissileAnomalies(baselineMatrix);
  const baselineIds = baselineAnomalies.map(a => a.id);

  assert.ok(baselineIds.includes('BVR_STERN_ALL_HIT'), 'Should identify BVR burnout blindness anomaly without RWR');
  assert.ok(baselineIds.includes('SHORT_RANGE_BEAM_ALWAYS_MISS'), 'Should identify short-range beam always-miss anomaly without TVC');
  assert.ok(!baselineIds.includes('EXTREME_RANGE_IMPOSSIBLE_HIT'), 'Should not have impossible hits beyond envelope');

  // With RWR enabled, the BVR active radar burnout blindness is mitigated
  const rwrMatrix = sweepCombatSituationMatrix({
    types: ['AIM120C'],
    ranges: [7000],
    aspects: [0],
    altitudes: [3000],
    behaviors: ['evasive_ai'],
    cms: [true],
    rwr: true,
  });
  const rwrAnomalies = detectMissileAnomalies(rwrMatrix);
  const rwrIds = rwrAnomalies.map(a => a.id);
  assert.ok(!rwrIds.includes('BVR_STERN_ALL_HIT'), 'RWR defense should mitigate BVR always-hit anomaly');

  // With TVC enabled on AIM-9X, the short-range beam always-miss anomaly is mitigated
  const tvcMatrix = sweepCombatSituationMatrix({
    types: ['AIM9X'],
    ranges: [400],
    aspects: [90],
    altitudes: [3000],
    behaviors: ['straight'],
    cms: [false],
    tvc: true,
  });
  const tvcAnomalies = detectMissileAnomalies(tvcMatrix);
  const tvcIds = tvcAnomalies.map(a => a.id);
  assert.ok(!tvcIds.includes('SHORT_RANGE_BEAM_ALWAYS_MISS'), 'TVC should mitigate short-range beam always-miss anomaly on AIM-9X');
});

test('combat situation: diagnostic flare controls observe without changing the launch', () => {
  const base = { type: 'AIM9X', rangeM: 2500, aspectDeg: 0, shooterAltM: 1500,
    targetAltM: 1500, shooterSpeedMps: 250, targetSpeedMps: 180,
    targetBehavior: 'evasive_ai', countermeasures: false, chaff: false };
  const control = simulateCombatSituation({ ...base, flares: true, threatResponseEnabled: true });
  const detailed = simulateCombatSituation({ ...base, flares: true, threatResponseEnabled: true,
    recordDetail: true });
  assert.equal(detailed.terminal, control.terminal);
  assert.equal(detailed.minSeparationM, control.minSeparationM);
  assert.ok(detailed.detail.length > 0, 'detail trace retains 120 Hz samples');
  assert.ok(detailed.detail.some(s => s.seekerTargetType === 'flare' && s.seekerState === 'track'),
    'the representative geometry captures the flare');
  assert.ok(control.decoyTransfers > 0);

  const cutoff = simulateCombatSituation({ ...base, flares: true, threatResponseEnabled: true,
    flareObservationCutoffSeconds: 0.2, recordDetail: true });
  assert.equal(JSON.stringify(cutoff.launchState), JSON.stringify(control.launchState));
  assert.equal(cutoff.decoyTransfers, 1, 'the flare transfer is still confirmed before the cutoff');
  assert.ok(cutoff.detail.some(s => s.seconds > 0.85 && s.seekerTargetType === 'bandit'),
    'hiding the flare allows a prompt aircraft reacquisition');

  const manual = simulateCombatSituation({ ...base, flares: true, threatResponseEnabled: false,
    manualFlareAtSeconds: 0.65 });
  assert.equal(JSON.stringify(manual.launchState), JSON.stringify(control.launchState));
  assert.equal(manual.defense.flaresDispensed, 1, 'manual control dispenses exactly one flare');
  assert.equal(manual.defense.evasionSeconds, 0, 'manual control keeps the target out of evasion');
  assert.equal(manual.decoyTransfers, 1);
});
