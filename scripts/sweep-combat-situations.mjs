#!/usr/bin/env node
import {
  sweepCombatSituationMatrix,
  detectMissileAnomalies,
  COMBAT_MATRIX_TIMESTEP_S,
} from './lib/combatSituationMatrix.mjs';

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { COMBAT_MATRIX_REPORT_VERSION, summarizeCombatResults, combatMatrixCells } from './lib/combatMatrixReport.mjs';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim());

console.log('=== FLIGHT3D F-16 AIR-TO-AIR COMBAT SITUATION MATRIX & ANOMALY EXPLORATION ===\n');

const configuration = {
  types: ['AIM9X', 'AIM120C'],
  ranges: [400, 800, 1500, 3000, 5000, 7000, 9000, 10000],
  aspects: [0, 45, 90, 135, 180],
  altitudes: [1500, 8000],
  behaviors: ['straight', 'orbit', 'break_turn', 'evasive_ai'],
  cms: [false, true],
  rwr: true,
  tvc: true,
};
const start = performance.now();
const results = sweepCombatSituationMatrix(configuration);
const duration = ((performance.now() - start) / 1000).toFixed(2);

console.log(`Simulated ${results.length} combat situations across physical parameters in ${duration}s.`);

const summary = summarizeCombatResults(results);
console.log(JSON.stringify(summary, null, 2));
console.log('\n--- KILLS / LAUNCHES BY TYPE, INITIAL RANGE AND ASPECT ---');
for (const cell of combatMatrixCells(results)) {
  console.log(`${cell.type} ${cell.rangeM}m ${cell.aspectDeg}°: ${cell.kills}/${cell.launched} launches; ${cell.total} situations`);
}

console.log('\n--- PATTERNS REQUIRING INVESTIGATION ---');
const anomalies = detectMissileAnomalies(results);
for (const a of anomalies) {
  console.log(`\n[${a.severity.toUpperCase()}] ${a.title} (${a.id})`);
  console.log(`  Count: ${a.count}`);
  console.log(`  Description: ${a.description}`);
  if (a.sample) {
    console.log(`  Sample case: Type=${a.sample.type}, Range=${a.sample.rangeM}m, Aspect=${a.sample.aspectDeg}°, Behavior=${a.sample.targetBehavior}, CM=${a.sample.countermeasures}, Terminal=${a.sample.terminal}`);
  }
}

console.log('\n==============================================================================');

if (values.output) {
  const report = {
    schemaVersion: COMBAT_MATRIX_REPORT_VERSION,
    metadata: { revision, dirty, nodeVersion: process.version,
      timestepSeconds: COMBAT_MATRIX_TIMESTEP_S, durationSeconds: Number(duration),
      terrain: 'flat-zero', randomSeed: null,
      randomness: 'No stochastic input is used by this fixture; compare results, not timing metadata.' },
    configuration, summary, cells: combatMatrixCells(results), findings: anomalies, results,
  };
  writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report written to ${values.output}`);
}
