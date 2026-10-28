import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTROL_AUDIT_CASES, measureControlResponse } from '../scripts/lib/aircraft-control-audit.mjs';

for (const state of CONTROL_AUDIT_CASES) {
  test(`${state.id} ${state.phase}: fine input signs, authority, damping and weathercock stability`, () => {
    const result = measureControlResponse(state);
    for (const axis of ['pitchDegSec2', 'rollDegSec2']) {
      assert.ok(result.after[axis] > 0, `positive command ${axis}`);
      assert.ok(result.negative[axis] < 0, `negative command ${axis}`);
      assert.ok(result.after[axis] < result.before[axis] / 2, `fine input improves ${axis}`);
      assert.ok(Math.abs(result.after[axis] + result.negative[axis]) < 1e-8, `symmetric response ${axis}`);
    }
    assert.ok(result.damping.every(value => value < 0), `rate damping ${result.damping}`);
    assert.ok(result.yawRestoringNm < 0, `weathercock moment ${result.yawRestoringNm}`);
  });
}
