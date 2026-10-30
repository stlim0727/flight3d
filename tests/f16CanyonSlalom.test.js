import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flyF16Lukla } from './helpers/f16LuklaFlight.js';
import { F16CanyonSlalomScenario } from '../src/director/scenarios/F16CanyonSlalomScenario.js';

test('extreme canyon slalom flies low, reverses steep banks and escapes without damage', () => {
  const r = flyF16Lukla({ Scenario: F16CanyonSlalomScenario, maxSeconds: 185 });
  assert.equal(r.result.status, 'completed', JSON.stringify(r));
  assert.deepEqual(r.stages.map(s => s.stage), [50, 51, 53, 54]);
  assert.ok(r.finite);
  assert.equal(r.crash, undefined);
  assert.equal(r.incident, false);
  assert.equal(r.stallFrames, 0);
  assert.equal(r.gearDown, null);
  assert.ok(r.result.elapsedSeconds < 100);
  assert.ok(r.result.minClearanceM >= 20 && r.result.minClearanceM < 50);
  assert.ok(r.result.leftBankPeak > 60 && r.result.rightBankPeak > 60, 'steep turns must alternate');
  assert.ok(r.result.lowLevelSeconds > 5, 'low flight must extend beyond the spawn');
  assert.ok(r.result.maxG > 4 && r.result.maxG < 9);
  assert.ok(r.final.agl > 200 && r.final.iasKnots > 200);
  for (const leg of r.gearDamage) assert.equal(leg.damage, 0);
});
