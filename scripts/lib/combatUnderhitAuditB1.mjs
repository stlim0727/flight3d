/**
 * B1 post-lock under-hit cause classifier and summary aggregator (#794 / #770 / #780).
 * Pure analysis over existing combat experiment, defense audit, and coastal sortie outputs.
 */

export const B1_FAILURE_CATEGORIES = Object.freeze([
  'implementation_defect',
  'intended_model_limit',
  'missing_observation_discrimination',
  'unresolved',
]);

/** Classify a single launched shot from matrix/defense or coastal sortie records. */
export function classifyLockedShotOutcome(row) {
  if (!row || (row.launched === false)) {
    throw new TypeError('classifyLockedShotOutcome requires a launched shot record');
  }
  const terminal = row.terminal;
  const outcomeCategory = row.outcomeCategory;
  if (terminal === 'hit' || outcomeCategory === 'kill') {
    return { category: 'kill', subreason: 'lethal_hit' };
  }
  if (terminal === 'timeout' || outcomeCategory === 'unresolved') {
    return { category: 'unresolved', subreason: 'window_ended_in_flight' };
  }
  if ((row.decoyTransfers ?? 0) > 0) {
    if (terminal === 'detonation-non-lethal' || outcomeCategory === 'survived_fuze_blast') {
      return {
        category: 'missing_observation_discrimination',
        subreason: 'decoy_degraded_nonlethal_blast',
      };
    }
    if ((row.controlLimitedSec ?? 0) > 0) {
      return {
        category: 'missing_observation_discrimination',
        subreason: 'decoy_late_reacquire_g_saturated',
      };
    }
    return {
      category: 'missing_observation_discrimination',
      subreason: 'decoy_sustained_fov_loss',
    };
  }
  if (terminal === 'detonation-non-lethal' || outcomeCategory === 'survived_fuze_blast') {
    return { category: 'intended_model_limit', subreason: 'nonlethal_proximity_blast' };
  }
  if (terminal === 'miss-ground' || outcomeCategory === 'ground_impact') {
    return { category: 'intended_model_limit', subreason: 'kinematic_terrain_impact' };
  }
  return {
    category: 'intended_model_limit',
    subreason: (row.controlLimitedSec ?? 0) > 0 ? 'kinematic_g_saturation' : 'kinematic_fov_or_energy_limit',
  };
}

/** Aggregate B1 failure classifications, dispense counts, and confirmed decoy transfers for a cohort. */
export function summarizeUnderhitCohort(rows) {
  const summary = {
    total: rows.length,
    launched: 0,
    noLock: 0,
    kills: 0,
    dispensedFlareCases: 0,
    dispensedChaffCases: 0,
    confirmedTransferCases: 0,
    dispenseWithoutTransferCases: 0,
    categories: {
      implementation_defect: 0,
      intended_model_limit: 0,
      missing_observation_discrimination: 0,
      unresolved: 0,
    },
    subreasons: {},
  };

  for (const row of rows) {
    if (!row.launched) {
      summary.noLock += 1;
      continue;
    }
    summary.launched += 1;
    const flares = row.defense?.flaresDispensed ?? 0;
    const chaff = row.defense?.chaffDispensed ?? 0;
    const transferred = (row.decoyTransfers ?? 0) > 0;
    if (flares > 0) summary.dispensedFlareCases += 1;
    if (chaff > 0) summary.dispensedChaffCases += 1;
    if (transferred) summary.confirmedTransferCases += 1;
    if ((flares > 0 || chaff > 0) && !transferred) summary.dispenseWithoutTransferCases += 1;

    const classification = classifyLockedShotOutcome(row);
    if (classification.category === 'kill') {
      summary.kills += 1;
    } else {
      summary.categories[classification.category] += 1;
    }
    summary.subreasons[classification.subreason] = (summary.subreasons[classification.subreason] ?? 0) + 1;
  }
  return summary;
}

/** Classify Coastal Cruise single-shot vs multi-shot sortie launches linked with engagement analysis. */
export function classifyCoastalSortieShots(result) {
  const analysisMissiles = new Map(
    (result?.diagnostics?.analysis?.missiles ?? []).map(m => [m.missileId, m]),
  );
  const trackMap = result?.diagnostics?.trackMissileIds ?? {};
  const shots = result?.shots ?? [];
  const classifiedShots = shots.map(shot => {
    const trackId = trackMap[shot.missileId];
    const analyzed = analysisMissiles.get(trackId ?? shot.missileId) ?? null;
    const decoyTransfers = analyzed?.decoyTransfers?.length ?? 0;
    const guidanceSamples = analyzed?.guidanceTimeline ?? [];
    const controlLimitedSec = guidanceSamples.filter(
      g => Number.isFinite(g.demandedG) && Number.isFinite(g.availableG) && g.demandedG > g.availableG + 1e-3,
    ).length * 0.2;

    const classification = classifyLockedShotOutcome({
      launched: true,
      outcomeCategory: shot.outcomeCategory,
      decoyTransfers,
      controlLimitedSec,
    });

    return {
      shotIndex: shot.shotIndex,
      missileId: shot.missileId,
      type: shot.type,
      rangeM: shot.rangeM,
      duplicateFollowUp: Boolean(shot.duplicateFollowUp),
      outcomeCategory: shot.outcomeCategory,
      decoyTransfers,
      category: classification.category,
      subreason: classification.subreason,
    };
  });

  const categories = {
    implementation_defect: 0,
    intended_model_limit: 0,
    missing_observation_discrimination: 0,
    unresolved: 0,
  };
  let kills = 0;
  for (const s of classifiedShots) {
    if (s.category === 'kill') kills += 1;
    else categories[s.category] += 1;
  }

  return {
    caseId: result?.caseId ?? 'coastal-0',
    mode: classifiedShots.length <= 1 ? 'single-or-none' : 'multi-shot',
    launched: classifiedShots.length,
    duplicateFollowUpShots: classifiedShots.filter(s => s.duplicateFollowUp).length,
    kills,
    categories,
    shots: classifiedShots,
  };
}
