import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flyF16Lukla } from './helpers/f16LuklaFlight.js';
import { F16LuklaScenario } from '../src/director/scenarios/F16LuklaScenario.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

test('F16 runway pass returns promptly, configures on final and parks without damage', () => {
  const report = flyF16Lukla();
  assert.equal(report.result.status, 'completed', JSON.stringify(report));
  assert.deepEqual(report.stages.map(s => s.stage), Object.values(F16LuklaScenario.STAGES));
  assert.ok(report.finite);
  assert.equal(report.crash, undefined);
  assert.equal(report.incident, false);
  assert.equal(report.stallFrames, 0);
  assert.ok(report.runwayPassMin >= 40 && report.runwayPassMax < 110,
    `runway pass clearance: ${report.runwayPassMin}–${report.runwayPassMax}`);
  assert.ok(report.cameras.some(c => c.stage === F16LuklaScenario.STAGES.LOW_PASS && c.mode === CameraSystem.MODES.FLYBY));
  assert.equal(report.gearDown.stage, F16LuklaScenario.STAGES.FINAL);
  assert.ok(report.touchdown.seconds - report.gearDown.seconds < 85, 'gear stays up through the return circuit');
  assert.ok(report.result.elapsedSeconds < 250, `completion: ${report.result.elapsedSeconds}s`);
  assert.ok(report.result.touchdown.iasKnots < 135);
  assert.ok(Math.abs(report.result.touchdown.crossTrackM) < 8);
  assert.ok(report.final.along < 240 && Math.abs(report.final.cross) < 12);
  for (const leg of report.gearDamage) {
    assert.equal(leg.damage, 0, `${leg.id} damage`);
    assert.equal(leg.state, 'normal');
  }
  assert.ok(report.holdDrift < .05, `parking drift: ${report.holdDrift}`);
});
