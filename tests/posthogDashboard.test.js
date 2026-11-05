import test from 'node:test';
import assert from 'node:assert/strict';
import { INSIGHTS, DASHBOARD_NAME } from '../scripts/lib/posthogDashboard.mjs';

test('dashboard insights are uniquely named, valid queries', () => {
  assert.ok(DASHBOARD_NAME);
  const names = INSIGHTS.map(([n]) => n);
  assert.equal(new Set(names).size, names.length);
  for (const [, q] of INSIGHTS) {
    assert.equal(q.kind, 'InsightVizNode');
    assert.ok(['TrendsQuery', 'FunnelsQuery'].includes(q.source.kind));
    assert.ok(q.source.series.every(s => s.event));
  }
});
