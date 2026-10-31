import { writeFile } from 'node:fs/promises';
import { flyPilotMission } from '../tests/helpers/pilotMissionFlight.js';
import { createPilot as takeoff } from '../src/pilot/examples/takeoff.js';
import { createPilot as landing } from '../src/pilot/examples/landing.js';

const profile = process.env.PILOT_PROFILE || 'mild-disturbance-v1';
const seeds = (process.env.PILOT_SEEDS || '1,2,3,4,5').split(',').map(Number);
const missionFilter = process.env.PILOT_MISSION;
const sensorNoise = process.env.PILOT_SENSOR_NOISE !== '0';
const reports = [];
for (const [type, factory] of [['takeoff', takeoff], ['landing', landing]]) {
  if (missionFilter && missionFilter !== type) continue;
  for (const seed of seeds) {
    const report = await flyPilotMission({ missionId: `${type}-basic-v1`, createPilot: factory,
      environmentProfile: profile, seed, sensorNoise });
    reports.push(report);
    console.log(JSON.stringify({ mission: type, profile, seed, ...report.result, final: {
      seconds: report.final.tick / 120, ias: report.final.iasKnots,
      runwayS: report.final.runwayS, centerline: report.final.centerlineOffsetM,
      radioAltFt: report.final.radioAltFt, roll: report.final.rollDeg,
    } }));
  }
}
if (process.env.PILOT_REPORT) await writeFile(process.env.PILOT_REPORT, JSON.stringify(reports, null, 2));
console.log(`Production-physics calibration: ${reports.filter(r => r.result.status === 'succeeded').length}/${reports.length} succeeded. No browser/Worker/GPU acceptance is implied.`);
if (!reports.length || reports.some(r => r.result.status !== 'succeeded')) process.exitCode = 1;
