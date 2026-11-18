import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGate, parseResolveThreadIds, shouldWaitChecks } from '../scripts/agent-workflow.mjs';

test('pr:arc parseResolveThreadIds extracts single and multiple thread IDs', () => {
  assert.deepEqual(parseResolveThreadIds([]), []);
  assert.deepEqual(parseResolveThreadIds(['--other', 'val']), []);
  assert.deepEqual(parseResolveThreadIds(['--resolve']), []);
  assert.deepEqual(parseResolveThreadIds(['--resolve', 'PRRT_123']), ['PRRT_123']);
  assert.deepEqual(
    parseResolveThreadIds(['--resolve', 'PRRT_1', '--resolve', 'PRRT_2', '--resolve', 'PRRT_3']),
    ['PRRT_1', 'PRRT_2', 'PRRT_3']
  );
  assert.deepEqual(
    parseResolveThreadIds(['--wait', '--resolve', 'PRRT_A', '--verbose', '--resolve', 'PRRT_B']),
    ['PRRT_A', 'PRRT_B']
  );
});

test('pr:arc shouldWaitChecks recognizes --wait and --watch flags', () => {
  assert.equal(shouldWaitChecks([]), false);
  assert.equal(shouldWaitChecks(['--resolve', 'PRRT_1']), false);
  assert.equal(shouldWaitChecks(['--wait']), true);
  assert.equal(shouldWaitChecks(['--watch']), true);
  assert.equal(shouldWaitChecks(['--resolve', 'PRRT_1', '--wait']), true);
});

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
