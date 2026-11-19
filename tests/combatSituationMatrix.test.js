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

  // With RWR enabled the pilot receives warnings. Survival is an experimental outcome.
  const rwrMatrix = sweepCombatSituationMatrix({
    types: ['AIM120C'],
    ranges: [7000],
    aspects: [0],
    altitudes: [3000],
    behaviors: ['evasive_ai'],
    cms: [true],
    rwr: true,
  });
  assert.ok(rwrMatrix.some(row => row.launched && row.defense.firstWarningSeconds !== null));
  assert.ok(rwrMatrix.some(row => row.defense.evasionSeconds > 0));

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

test('combat situation: trace LOS is sampled at the guidance instant, not after integration', () => {
  const result = simulateCombatSituation({
    type: 'AIM9X', rangeM: 2500, targetSpeedMps: 180, targetBehavior: 'evasive_ai',
    shooterSpeedMps: Math.hypot(96, 49), shooterAltM: 750, targetAltM: 1210, aspectDeg: 0,
    countermeasures: false, chaff: false, flares: true, threatResponseEnabled: true,
    recordDetail: true, maxSimTimeSec: 20,
  });
  const detail = result.detail || [];
  assert.ok(detail.length > 0, 'expected a recorded trace');
  const angle = (velocity, from, to) => {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const range = Math.hypot(dx, dy, dz);
    const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    if (!(range > 1e-6 && speed > 1e-6)) return null;
    return Math.acos(Math.max(-1, Math.min(1,
      (velocity[0] * dx + velocity[1] * dy + velocity[2] * dz) / (speed * range)))) * (180 / Math.PI);
  };
  let compared = 0, maxPostStepDelta = 0, gimbal = null;
  for (let i = 1; i < detail.length; i++) {
    const row = detail[i], prev = detail[i - 1];
    if (row.seekerLosAngleDeg == null || !row.estimatePosition) continue;
    const guidanceInstant = angle(prev.missileVelocity, prev.missilePosition, row.estimatePosition);
    const postStep = angle(row.missileVelocity, row.missilePosition, row.estimatePosition);
    assert.ok(Math.abs(guidanceInstant - row.seekerLosAngleDeg) < 1e-6,
      `row ${i} reports the pre-integration angle`);
    maxPostStepDelta = Math.max(maxPostStepDelta, Math.abs(postStep - row.seekerLosAngleDeg));
    compared++;
    if (row.guidanceReason === 'gimbal_limit') gimbal = row;
  }
  assert.ok(compared > 100, `expected a long guided trace, got ${compared}`);
  assert.ok(maxPostStepDelta > 1, `post-integration recomputation should differ, got ${maxPostStepDelta}`);
  assert.ok(gimbal, 'expected a gimbal_limit row');
  assert.ok(gimbal.seekerLosAngleDeg > 65, `gimbal row angle ${gimbal.seekerLosAngleDeg} should exceed the limit`);
});
