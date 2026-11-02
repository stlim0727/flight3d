import { writeFile } from 'node:fs/promises';
import { flySlalom } from '../tests/helpers/slalomFlight.js';
import { createPilot } from '../src/pilot/examples/valleySlalom.js';

const seeds = (process.env.PILOT_SEEDS ?? '1,2,3,4,5').split(',').map(Number);
if (!seeds.length || seeds.some(seed => !Number.isSafeInteger(seed) || seed < 0)) throw new Error('Invalid PILOT_SEEDS');
const profile = process.env.PILOT_PROFILE ?? 'mild-disturbance-v1';
const reports = [];
for (const seed of seeds) {
  const report = await flySlalom({ createPilot, seed, environmentProfile: profile,
    noise: process.env.PILOT_SENSOR_NOISE !== '0' });
  reports.push(report);
  console.log(JSON.stringify({ seed, profile, ...report.result }));
}
if (process.env.PILOT_REPORT) await writeFile(process.env.PILOT_REPORT, JSON.stringify(reports, null, 2));
console.log(`Rendererless production F16 virtual valley: ${reports.filter(r => r.result.status === 'succeeded').length}/${reports.length} completed.`);
if (reports.some(r => r.result.status !== 'succeeded')) process.exitCode = 1;
