import { simulateCombatSituation } from './combatSituationMatrix.mjs';
import { summarizeCombatResults } from './combatMatrixReport.mjs';

export const DEFENSE_VARIANTS = Object.freeze([
  { id: 'passive', threatResponseEnabled: false, chaff: false, flares: false },
  { id: 'reaction-only', threatResponseEnabled: true, chaff: false, flares: false },
  { id: 'reaction-chaff', threatResponseEnabled: true, chaff: true, flares: false },
  { id: 'reaction-flare', threatResponseEnabled: true, chaff: false, flares: true },
  { id: 'reaction-both', threatResponseEnabled: true, chaff: true, flares: true },
].map(Object.freeze));

export function defaultDefenseGeometries() {
  const geometries = [];
  for (const type of ['AIM9X', 'AIM120C']) {
    for (const rangeM of [800, 1500, 3000, 7000]) {
      for (const aspectDeg of [0, 90, 180]) {
        for (const altitude of [1500, 8000]) {
          geometries.push({ type, rangeM, aspectDeg, shooterAltM: altitude, targetAltM: altitude });
        }
      }
    }
  }
  return geometries;
}

/** Only compare samples at the same instant, never different terminal times. */
export function compareTargetTrajectories(before, after) {
  const byTick = new Map((before ?? []).map(s => [Math.round(s.seconds * 120), s]));
  let sharedSamples = 0;
  let maxPositionDifferenceM = null;
  let maxSpeedDifferenceMps = null;
  for (const sample of after ?? []) {
    const reference = byTick.get(Math.round(sample.seconds * 120));
    if (!reference) continue;
    sharedSamples++;
    const distance = Math.hypot(...sample.targetPosition.map((v, i) => v - reference.targetPosition[i]));
    maxPositionDifferenceM = Math.max(maxPositionDifferenceM ?? 0, distance);
    maxSpeedDifferenceMps = Math.max(maxSpeedDifferenceMps ?? 0,
      Math.abs(sample.targetSpeedMps - reference.targetSpeedMps));
  }
  return { sharedSamples, maxPositionDifferenceM, maxSpeedDifferenceMps };
}

function summarizeDefense(rows) {
  const launched = rows.filter(r => r.launched);
  const samples = launched.flatMap(r => r.trajectory ?? []);
  return {
    ...summarizeCombatResults(rows),
    casesWithChaffRelease: launched.filter(r => r.defense.chaffDispensed > 0).length,
    casesWithFlareRelease: launched.filter(r => r.defense.flaresDispensed > 0).length,
    casesWithDecoyTransfer: launched.filter(r => r.decoyTransfers > 0).length,
    casesWithReaction: launched.filter(r => r.defense.evasionSeconds > 0).length,
    maxTargetG: launched.length ? Math.max(...launched.map(r => r.maxTargetG)) : null,
    sampledMaxAbsoluteBankDeg: samples.length
      ? Math.max(...samples.map(s => Math.abs(s.targetBankDeg))) : null,
    sampledMinSpeedMps: samples.length ? Math.min(...samples.map(s => s.targetSpeedMps)) : null,
    sampledMaxSpeedMps: samples.length ? Math.max(...samples.map(s => s.targetSpeedMps)) : null,
  };
}

/** A controlled fixture comparison, not a real-world probability estimate. */
export function runCombatDefenseAudit({ geometries = defaultDefenseGeometries() } = {}) {
  const groups = geometries.map(geometry => {
    const variants = DEFENSE_VARIANTS.map(({ id, ...controls }) => ({ id,
      result: simulateCombatSituation({ ...geometry, targetBehavior: 'evasive_ai',
        countermeasures: false, ...controls, recordTrajectory: true }),
    }));
    // Before the missile exists, treatment controls must not change the launch.
    const launch = JSON.stringify(variants[0].result.launchState);
    if (variants.some(v => JSON.stringify(v.result.launchState) !== launch)) {
      throw new Error('Defense audit requires identical launch states');
    }
    const passive = variants[0].result;
    const reaction = variants[1].result;
    const comparisons = variants.slice(1).map(({ id, result }) => {
      const reference = id === 'reaction-only' ? passive : reaction;
      return { treatment: id, reference: id === 'reaction-only' ? 'passive' : 'reaction-only',
        bothLaunched: reference.launched && result.launched,
        beforeTerminal: reference.terminal, afterTerminal: result.terminal,
        ...compareTargetTrajectories(reference.trajectory, result.trajectory),
      };
    });
    return { geometry, variants, comparisons };
  });
  const types = [...new Set(groups.map(g => g.geometry.type))];
  const summaries = DEFENSE_VARIANTS.flatMap(({ id }) => types.map(type => ({
    variant: id, type,
    ...summarizeDefense(groups.flatMap(g => g.variants
      .filter(v => v.id === id && v.result.type === type).map(v => v.result))),
  })));
  return { groups, summaries };
}

/** Characterize named fixtures; different patrol geometry is not a treatment pair. */
export function runTargetBehaviorAudit() {
  const geometry = { type: 'AIM120C', rangeM: 7000, aspectDeg: 90,
    shooterAltM: 3000, targetAltM: 3000 };
  const results = ['straight', 'orbit', 'break_turn', 'evasive_ai'].map(targetBehavior =>
    simulateCombatSituation({ ...geometry, targetBehavior, countermeasures: false, recordTrajectory: true }));
  return { geometry, results, orbitVersusBreak: compareTargetTrajectories(
    results[1].trajectory, results[2].trajectory) };
}
