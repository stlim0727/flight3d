import { writeFile } from 'node:fs/promises';
import { flySlalom } from '../tests/helpers/slalomFlight.js';
import { createPilot } from '../src/pilot/examples/valley.js';
import { VALLEY_SLALOM_RULES } from '../src/arena/generatedValley.js';

/** Host-only runner: production physics, generated valleys, no rendering.
 *
 * Two kinds of failure are kept apart on purpose. A valley that cannot be flown
 * is a generation failure and a defect in this script's own rules; a pilot that
 * cannot fly a valid valley is a result, and it stays in the report. Nothing here
 * tunes a controller and nothing here is dropped after the fact.
 */

const devSeeds = (process.env.DEV_SEEDS ?? '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const evalSeeds = (process.env.EVAL_SEEDS ?? '101,102,103,104,105,106,107,108').split(',').map(Number);
const profile = process.env.PILOT_PROFILE ?? 'mild-disturbance-v1';
const rules = { ...VALLEY_SLALOM_RULES, ...JSON.parse(process.env.SLALOM_RULES ?? '{}') };

async function run(label, seeds) {
  const rows = [];
  for (const seed of seeds) {
    let entry;
    try {
      const { manifest, result } = await flySlalom({ createPilot, seed, environmentProfile: profile,
        noise: process.env.PILOT_SENSOR_NOISE !== '0', rules });
      entry = { label, seed, kind: 'pilot', courseLengthM: Math.round(manifest.course.lengthM),
        status: result.status, reason: result.reason, ...result.metrics };
    } catch (error) {
      entry = { label, seed,
        kind: error.message.startsWith('unflyable-course') ? 'generation' : 'infrastructure',
        status: 'failed', reason: error.message };
    }
    rows.push(entry);
    console.log(`${label} seed ${String(seed).padStart(3)} ${entry.kind.padEnd(14)}`
      + ` ${String(entry.status).padEnd(9)} ${String(entry.reason ?? '').padEnd(22)}`
      + ` gates ${entry.gatesCleared ?? '-'}/${entry.totalGates ?? '-'}`
      + ` cost ${entry.altitudeCostM === null || entry.altitudeCostM === undefined ? '-' : entry.altitudeCostM.toFixed(1)} m`
      + ` median ${entry.medianAglM === undefined ? '-' : entry.medianAglM.toFixed(0)} m`
      + ` ias ${entry.meanIasKnots === undefined ? '-' : entry.meanIasKnots.toFixed(0)} kt`
      + ` in ${entry.durationSeconds === undefined ? '-' : entry.durationSeconds.toFixed(1)} s`);
  }
  const succeeded = rows.filter(row => row.status === 'succeeded');
  const costs = succeeded.map(row => row.altitudeCostM).filter(Number.isFinite);
  return { entries: rows, summary: { label, seeds: rows.length, succeeded: succeeded.length,
    generationFailures: rows.filter(row => row.kind === 'generation').length,
    meanAltitudeCostM: costs.length ? +(costs.reduce((sum, cost) => sum + cost, 0) / costs.length).toFixed(1) : null,
    meanIasKnots: succeeded.length ? +(succeeded.reduce((sum, row) => sum + row.meanIasKnots, 0)
      / succeeded.length).toFixed(1) : null } };
}

const rows = [];
const reports = [];
for (const [label, seeds] of [['dev', devSeeds], ['eval', evalSeeds]]) {
  const { summary, entries } = await run(label, seeds);
  rows.push(summary);
  reports.push(...entries);
}
console.log(`rules ${rules.version} envelope ${rules.envelopeVersion} pilot ${process.env.PILOT ?? 'examples/valley.js'}`);
for (const row of rows) console.log(JSON.stringify(row));
if (process.env.SLALOM_REPORT) await writeFile(process.env.SLALOM_REPORT, JSON.stringify(reports, null, 2));
if (rows.some(row => row.generationFailures)) process.exitCode = 1;
