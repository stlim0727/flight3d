import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleControlResponse as sampleProtectedResponse } from '../scripts/audit-control-response.mjs';

// Audit input shaping and raw actuator authority independently of the asymmetric
// -3/+9g envelope. Production protection is exercised by gLimiter.test.js.
const sampleControlResponse = options => sampleProtectedResponse({ ...options, gLimiter: false });

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

for (const aircraftId of ['F16', 'C172']) for (const axis of ['pitch', 'roll']) {
  test(`${aircraftId} HOTAS ${axis} preserves precision and full authority across airspeeds`, () => {
    for (const iasKnots of (aircraftId === 'C172' ? [70, 100, 130] : [200, 350, 500])) {
      let previous = -1;
      for (const input of [0, .04, .1, .2, .5, 1]) {
        const current = sampleControlResponse({ input, axis, iasKnots, aircraftId, source: 'hotas' });
        const oldLinear = sampleControlResponse({ input: Math.max(0, (input - .04) / .96),
          axis, iasKnots, aircraftId, legacyGyro: true });
        assert.ok(current.accelerationDegS2 >= previous - 1e-8);
        assert.ok(current.accelerationDegS2 <= oldLinear.accelerationDegS2 + 1e-8);
        if (input === .1 || input === .2) {
          assert.ok(current.accelerationDegS2 < oldLinear.accelerationDegS2 * .4);
        }
        const opposite = sampleControlResponse({ input: -input, axis, iasKnots, aircraftId, source: 'hotas' });
        assert.ok(Math.abs(current.accelerationDegS2 + opposite.accelerationDegS2) < 1e-7);
        if (input === 1) assert.equal(current.surface, oldLinear.surface);
        previous = current.accelerationDegS2;
      }
    }
  });
}
