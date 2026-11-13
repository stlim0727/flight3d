import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGate } from '../scripts/agent-workflow.mjs';

test('pr:mac gate classifies pending, passing and failing checks', () => {
  assert.deepEqual(checkGate({}), { failing: [], pending: [] });
  assert.deepEqual(checkGate({ statusCheckRollup: [] }), { failing: [], pending: [] });

  const pending = checkGate({
    statusCheckRollup: [{ name: 'checks', status: 'IN_PROGRESS', conclusion: null }],
  });
  assert.equal(pending.pending.length, 1);
  assert.equal(pending.failing.length, 0);

  const passing = checkGate({
    statusCheckRollup: [
      { name: 'checks', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'publish', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { name: 'review', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    ],
  });
  assert.equal(passing.pending.length, 0);
  assert.equal(passing.failing.length, 0);

  const mixed = checkGate({
    statusCheckRollup: [
      { name: 'checks', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'sweep', status: 'IN_PROGRESS', conclusion: null },
    ],
  });
  assert.equal(mixed.failing.length, 1);
  assert.equal(mixed.pending.length, 1);
});

test('an unresolved check without a status counts as pending, not passing', () => {
  const gate = checkGate({ statusCheckRollup: [{ name: 'checks', conclusion: null }] });
  assert.equal(gate.pending.length, 1);
  assert.equal(gate.failing.length, 0);
});
