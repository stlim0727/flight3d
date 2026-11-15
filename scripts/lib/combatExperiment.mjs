import assert from 'node:assert/strict';
import { simulateCombatSituation } from './combatSituationMatrix.mjs';
import { DEFENSE_VARIANTS } from './combatDefenseAudit.mjs';
import { summarizeCombatResults } from './combatMatrixReport.mjs';

const list = (text, fallback) => text === undefined ? fallback : text.split(',').map(s => {
  if (!s.trim()) throw new Error('Empty list entry');
  return s.trim();
});
function numbers(text, fallback, valid, label) {
  const values = list(text, fallback).map(Number);
  if (!values.length || values.some(n => !Number.isFinite(n) || !valid(n))) throw new Error(`Invalid ${label}`);
  return [...new Set(values)];
}

export function combatExperimentConfig(values = {}) {
  const scenario = values.scenario ?? 'locked-ir';
  if (!['locked-ir', 'defense', 'single'].includes(scenario)) throw new Error('Unknown scenario');
  const single = scenario === 'single', defense = scenario === 'defense';
  const types = list(values.types, defense ? ['AIM9X', 'AIM120C'] : ['AIM9X']);
  if (!types.length || types.some(t => !['AIM9X', 'AIM120C'].includes(t))) throw new Error('Unknown missile type');
  const ranges = numbers(values.ranges, single ? [2500] : defense ? [800, 1500, 3000, 7000] : [800, 1500, 2500, 3500, 5000], n => n > 0, 'ranges');
  const aspects = numbers(values.aspects, single ? [0] : defense ? [0, 90, 180] : [0, 45, 90, 135, 180], n => n >= 0 && n <= 180, 'aspects');
  const speeds = numbers(values.speeds, single || defense ? [250] : [Math.hypot(96, 49), 250], n => n > 0, 'speeds');
  const pairs = list(values['altitude-pairs'], single ? ['1500:1500'] : defense ? ['1500:1500', '8000:8000'] : ['750:1210', '1500:1500'])
    .map(pair => {
      const parts = String(pair).split(':');
      if (parts.length !== 2 || parts.some(p => !p.trim())) throw new Error('Use shooter:target altitude pairs');
      const heights = parts.map(Number);
      if (heights.some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Invalid altitude pair');
      return heights;
    });
  const selection = values.defense ?? (single ? 'reaction-flare' : 'all');
  const variants = DEFENSE_VARIANTS.filter(v => selection === 'all'
    ? defense || ['passive', 'reaction-only', 'reaction-flare'].includes(v.id) : v.id === selection);
  if (!variants.length) throw new Error('Unknown defense variant');
  const geometries = [];
  for (const type of types) for (const rangeM of ranges) for (const aspectDeg of aspects)
    for (const shooterSpeedMps of speeds) for (const [shooterAltM, targetAltM] of pairs) {
      if (rangeM < Math.abs(targetAltM - shooterAltM)) throw new Error('Range is smaller than altitude difference');
      geometries.push({ type, rangeM, aspectDeg, shooterSpeedMps, shooterAltM, targetAltM });
    }
  if (single && (geometries.length !== 1 || variants.length !== 1)) throw new Error('single requires one geometry and one defense variant');
  const timeoutSeconds = Number(values.timeout ?? 60);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error('Timeout must be positive seconds');
  return { scenario, geometries, variants, recordTrajectory: Boolean(values.diagnostics),
    targetSpeedMps: defense ? 200 : 180, timeoutSeconds };
}

export function runCombatExperiment(config, progress = () => {}) {
  const results = [];
  for (const geometry of config.geometries) {
    const group = config.variants.map(({ id, ...controls }) => ({ variant: id,
      ...simulateCombatSituation({ ...geometry, ...controls, targetBehavior: 'evasive_ai',
        targetSpeedMps: config.targetSpeedMps, countermeasures: false, recordTrajectory: config.recordTrajectory }),
    }));
    const launch = JSON.stringify(group[0].launchState);
    assert.ok(group.every(r => JSON.stringify(r.launchState) === launch), 'Paired launch states differ');
    results.push(...group);
    progress(results.length);
  }
  if (!results.length) throw new Error('Empty experiment');
  const summary = config.variants.flatMap(v => [...new Set(config.geometries.map(g => g.type))].map(type => ({
    variant: v.id, type,
    ...summarizeCombatResults(results.filter(r => r.variant === v.id && r.type === type)),
  })));
  return { summary, results };
}
