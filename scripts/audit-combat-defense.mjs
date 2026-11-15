#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { COMBAT_MATRIX_TIMESTEP_S } from './lib/combatSituationMatrix.mjs';
import { DEFENSE_VARIANTS, defaultDefenseGeometries, runCombatDefenseAudit,
  runTargetBehaviorAudit } from './lib/combatDefenseAudit.mjs';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
const geometries = defaultDefenseGeometries();
const start = performance.now();
const report = {
  schemaVersion: 1,
  metadata: { revision, dirty, nodeVersion: process.version,
    timestepSeconds: COMBAT_MATRIX_TIMESTEP_S, trajectorySampleIntervalSeconds: 0.2,
    terrain: 'flat-zero', randomSeed: null },
  configuration: { geometries, variants: DEFENSE_VARIANTS,
    targetBehavior: 'evasive_ai', recordTrajectory: true },
  ...runCombatDefenseAudit({ geometries }),
  behaviorAudit: runTargetBehaviorAudit(),
};
report.metadata.durationSeconds = (performance.now() - start) / 1000;
console.log('Controlled defense fixture audit (not real-world effectiveness):');
for (const s of report.summaries) {
  console.log(`${s.type} ${s.variant}: ${s.kills}/${s.launched} kills/launches; ${s.noLock} no-lock; ` +
    `release cases chaff=${s.casesWithChaffRelease} flare=${s.casesWithFlareRelease}; ` +
    `transfer cases=${s.casesWithDecoyTransfer}; peak target G=${s.maxTargetG}`);
}
console.log('Orbit vs break fixture shared-time trajectory comparison:', report.behaviorAudit.orbitVersusBreak);
if (values.output) {
  writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report written to ${values.output}`);
}
