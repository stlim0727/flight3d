import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleControlResponse } from '../scripts/audit-control-response.mjs';

for (const axis of ['pitch', 'roll']) {
  test(`F16 ${axis} response retains small-input resolution and full authority across airspeeds`, () => {
    for (const iasKnots of [200, 350, 500]) {
      let previous = -1;
      const full = sampleControlResponse({ input: 1, axis, iasKnots });
      assert.ok(full.accelerationDegS2 > 0);
      for (let i = 0; i <= 20; i++) {
        const sample = sampleControlResponse({ input: i / 20, axis, iasKnots });
        assert.ok(Number.isFinite(sample.accelerationDegS2));
        assert.ok(sample.accelerationDegS2 >= previous - 1e-8);
        if (i < 20) assert.ok(sample.accelerationDegS2 < full.accelerationDegS2);
        if (i <= 4) assert.ok(sample.accelerationDegS2 < full.accelerationDegS2 * .1);
        assert.ok(Math.abs(sample.surface) <= 1);
        previous = sample.accelerationDegS2;
      }
      const positive = sampleControlResponse({ input: .5, axis, iasKnots });
      const negative = sampleControlResponse({ input: -.5, axis, iasKnots });
      assert.ok(Math.abs(positive.accelerationDegS2 + negative.accelerationDegS2) < 1e-7);
      const oldGyro = sampleControlResponse({ input: .1, axis, iasKnots, legacyGyro: true });
      const corrected = sampleControlResponse({ input: .1, axis, iasKnots });
      assert.ok(oldGyro.accelerationDegS2 > corrected.accelerationDegS2 * 6);
      assert.equal(full.normalized, 1, 'Precision shaping must retain full travel authority');
    }
  });
}
