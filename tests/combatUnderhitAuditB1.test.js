import test from 'node:test';
import assert from 'node:assert/strict';
import { combatExperimentConfig, runCombatExperiment } from '../scripts/lib/combatExperiment.mjs';
import { simulateCombatSituation } from '../scripts/lib/combatSituationMatrix.mjs';
import {
  classifyCoastalSortieShots,
  classifyLockedShotOutcome,
  summarizeUnderhitCohort,
} from '../scripts/lib/combatUnderhitAuditB1.mjs';

test('B1 defense audit separates decoy dispense from confirmed transfer and cross-weapon compatibility', () => {
  const res = runCombatExperiment(combatExperimentConfig({
    scenario: 'defense',
    types: 'AIM9X,AIM120C',
    ranges: '1500,3000',
    aspects: '0,90',
    speeds: '200',
    'altitude-pairs': '1500:1500',
    defense: 'all',
  }));

  const cohort = (type, variant) => summarizeUnderhitCohort(
    res.results.filter(r => r.type === type && r.variant === variant),
  );

  // AIM-9X dispenses chaff when reaction-chaff is enabled, yet has 0 confirmed transfers and matches reaction-only.
  const aim9Only = cohort('AIM9X', 'reaction-only');
  const aim9Chaff = cohort('AIM9X', 'reaction-chaff');
  assert.ok(aim9Chaff.dispensedChaffCases > 0);
  assert.equal(aim9Chaff.confirmedTransferCases, 0);
  assert.equal(aim9Chaff.dispenseWithoutTransferCases, aim9Chaff.dispensedChaffCases);
  assert.equal(aim9Chaff.kills, aim9Only.kills);

  // AIM-120C dispenses flares when reaction-flare is enabled, yet has 0 confirmed transfers and matches reaction-only.
  const aim120Only = cohort('AIM120C', 'reaction-only');
  const aim120Flare = cohort('AIM120C', 'reaction-flare');
  assert.ok(aim120Flare.dispensedFlareCases > 0);
  assert.equal(aim120Flare.confirmedTransferCases, 0);
  assert.equal(aim120Flare.dispenseWithoutTransferCases, aim120Flare.dispensedFlareCases);
  assert.equal(aim120Flare.kills, aim120Only.kills);

  // Compatible decoy failures classify under missing_observation_discrimination.
  const aim9Flare = cohort('AIM9X', 'reaction-flare');
  const aim120Chaff = cohort('AIM120C', 'reaction-chaff');
  assert.ok(aim9Flare.confirmedTransferCases > 0);
  assert.ok(aim120Chaff.confirmedTransferCases > 0);
  assert.equal(aim9Flare.categories.implementation_defect, 0);
  assert.equal(aim120Chaff.categories.implementation_defect, 0);
  assert.ok(
    aim9Flare.categories.missing_observation_discrimination + aim120Chaff.categories.missing_observation_discrimination > 0,
  );
  for (const s of [aim9Only, aim9Chaff, aim9Flare, aim120Only, aim120Chaff, aim120Flare]) {
    const accounted = s.kills
      + s.categories.implementation_defect
      + s.categories.intended_model_limit
      + s.categories.missing_observation_discrimination
      + s.categories.unresolved;
    assert.equal(accounted, s.launched);
  }
});

test('B1 2.5km isolation separates sustained decoy observation from seeker/PN implementation defects', () => {
  const base = {
    type: 'AIM9X',
    rangeM: 2500,
    aspectDeg: 90,
    shooterSpeedMps: 250,
    shooterAltM: 1500,
    targetAltM: 1500,
    targetSpeedMps: 180,
    targetBehavior: 'evasive_ai',
    countermeasures: false,
    chaff: false,
    maxSimTimeSec: 20,
  };
  const evasionOnly = simulateCombatSituation({ ...base, flares: false, threatResponseEnabled: true });
  const reactionFlare = simulateCombatSituation({ ...base, flares: true, threatResponseEnabled: true });
  const flareOnly = simulateCombatSituation({
    ...base,
    flares: true,
    threatResponseEnabled: false,
    manualFlareAtSeconds: reactionFlare.defense.firstConfirmedThreatSeconds,
  });
  const cutoff02 = simulateCombatSituation({
    ...base,
    flares: true,
    threatResponseEnabled: true,
    flareObservationCutoffSeconds: 0.2,
  });

  assert.equal(evasionOnly.terminal, 'hit');
  assert.equal(cutoff02.terminal, 'hit');
  assert.ok(reactionFlare.decoyTransfers > 0);
  assert.ok(flareOnly.decoyTransfers > 0);
  assert.notEqual(reactionFlare.terminal, 'hit');
  const cls = classifyLockedShotOutcome(reactionFlare);
  assert.ok(['missing_observation_discrimination', 'unresolved'].includes(cls.category));
});

test('B1 classifies single and multiple recorded shots independently of pursuit', () => {
  const first = { shotIndex: 0, missileId: 1, outcomeCategory: 'kill' };
  const followUp = { shotIndex: 1, missileId: 2, duplicateFollowUp: true, outcomeCategory: 'unresolved' };
  const singleShot = classifyCoastalSortieShots({ shots: [first] });
  const multiShot = classifyCoastalSortieShots({ shots: [first, followUp] });

  assert.equal(singleShot.mode, 'single-or-none');
  assert.equal(singleShot.launched, 1);
  assert.equal(singleShot.kills, 1);
  assert.equal(multiShot.mode, 'multi-shot');
  assert.equal(multiShot.launched, 2);
  assert.equal(multiShot.duplicateFollowUpShots, 1);
  assert.equal(multiShot.kills, 1);
  assert.equal(multiShot.categories.unresolved, 1);
});

test('B1 classifier requires post-decoy reacquisition evidence and preserves missing diagnostics as unresolved', () => {
  const untraced = classifyLockedShotOutcome({
    launched: true,
    terminal: 'miss-expired',
    decoyTransfers: 1,
    controlLimitedSec: 0.8,
  });
  assert.equal(untraced.category, 'missing_observation_discrimination');
  assert.equal(untraced.subreason, 'decoy_transfer_untraced_terminal');

  const noReacqWithPreSaturation = classifyLockedShotOutcome({
    launched: true,
    terminal: 'miss-expired',
    decoyTransfers: 1,
    controlLimitedSec: 0.8,
    detail: [
      { seekerState: 'track', seekerTargetType: 'bandit', requestedLateralMps2: 500, availableLateralMps2: 343 },
      { seekerState: 'track', seekerTargetType: 'flare', requestedLateralMps2: 100, availableLateralMps2: 343 },
      { seekerState: 'lost', seekerTargetType: null, requestedLateralMps2: 0, availableLateralMps2: 343 },
    ],
  });
  assert.equal(noReacqWithPreSaturation.subreason, 'decoy_sustained_fov_loss');

  const postReacqSaturated = classifyLockedShotOutcome({
    launched: true,
    terminal: 'miss-expired',
    decoyTransfers: 1,
    controlLimitedSec: 0.8,
    detail: [
      { seekerState: 'track', seekerTargetType: 'flare', requestedLateralMps2: 100, availableLateralMps2: 343 },
      { seekerState: 'track', seekerTargetType: 'bandit', requestedLateralMps2: 800, availableLateralMps2: 343 },
    ],
  });
  assert.equal(postReacqSaturated.subreason, 'decoy_late_reacquire_g_saturated');

  const withoutDiagnostics = classifyCoastalSortieShots({
    caseId: 'coastal-0',
    diagnostics: null,
    shots: [
      { shotIndex: 0, missileId: 1, type: 'AIM9X', rangeM: 2200, duplicateFollowUp: false, outcomeCategory: 'expired' },
      { shotIndex: 1, missileId: 2, type: 'AIM9X', rangeM: 1800, duplicateFollowUp: true, outcomeCategory: 'kill' },
    ],
  });
  assert.equal(withoutDiagnostics.shots[0].decoyTransfers, null);
  assert.equal(withoutDiagnostics.shots[0].category, 'unresolved');
  assert.equal(withoutDiagnostics.shots[0].subreason, 'diagnostics_unavailable');
  assert.equal(withoutDiagnostics.shots[1].decoyTransfers, null);
  assert.equal(withoutDiagnostics.shots[1].category, 'kill');

  const replayNullTargetTypeAndNonDecoySat = classifyCoastalSortieShots({
    caseId: 'coastal-0',
    diagnostics: {
      trackMissileIds: { 1: 1, 2: 2 },
      analysis: {
        missiles: [
          {
            missileId: 1,
            decoyTransfers: [{ timeSec: 1.0, decoyType: 'flare' }],
            seekerTimeline: [
              { timeSec: 1.2, state: 'track', targetType: null },
            ],
            guidanceTimeline: [
              { timeSec: 1.4, demandedG: 40, availableG: 35 },
            ],
          },
          {
            missileId: 2,
            decoyTransfers: [],
            seekerTimeline: [],
            guidanceTimeline: [
              { timeSec: 2.0, demandedG: 42, availableG: 35 },
            ],
          },
        ],
      },
    },
    shots: [
      { shotIndex: 0, missileId: 1, type: 'AIM9X', rangeM: 2200, duplicateFollowUp: false, outcomeCategory: 'expired' },
      { shotIndex: 1, missileId: 2, type: 'AIM9X', rangeM: 1800, duplicateFollowUp: true, outcomeCategory: 'expired' },
    ],
  });
  assert.equal(replayNullTargetTypeAndNonDecoySat.shots[0].category, 'missing_observation_discrimination');
  assert.equal(replayNullTargetTypeAndNonDecoySat.shots[0].subreason, 'decoy_transfer_untraced_terminal');
  assert.equal(replayNullTargetTypeAndNonDecoySat.shots[1].category, 'intended_model_limit');
  assert.equal(replayNullTargetTypeAndNonDecoySat.shots[1].subreason, 'kinematic_g_saturation');
});
