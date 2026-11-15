import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameTransitionMonitor } from '../src/core/FrameTransitionMonitor.js';

function fixture() {
  let now = 0, hidden = false;
  const paints = [], reports = [];
  const monitor = new FrameTransitionMonitor({
    clock: () => now, isHidden: () => hidden,
    afterPaint: callback => paints.push(callback), emit: report => reports.push(report),
    longTasks: (start, end) => ({ start, end }),
  });
  return { monitor, paints, reports, time: value => { now = value; }, hide: value => { hidden = value; } };
}

test('resume measures state change through render and a paint opportunity, once', () => {
  const f = fixture();
  f.monitor.flowChanged('lobby', false);
  f.monitor.flowChanged('flight', false);
  assert.equal(f.monitor.pending, null, 'a new flight is not a resume');
  f.monitor.flowChanged('lobby', true);
  f.time(100);
  f.monitor.flowChanged('flight', false, { renderQuality: 'low' });
  f.time(600);
  f.monitor.rendered(450);
  f.monitor.rendered(10);
  assert.equal(f.paints.length, 1);
  f.time(650); f.paints.shift()();
  assert.deepEqual(f.reports, [{ version: 1, kind: 'resume', from: 'lobby', renderQuality: 'low',
    firstFrameMs: 500, renderMs: 450, paintOpportunityMs: 550, longTasks: { start: 100, end: 650 } }]);
});

test('hide, leave, and superseded transitions cannot emit stale paint samples', () => {
  for (const cancel of [f => f.monitor.cancel(), f => f.hide(true), f => f.monitor.flowChanged('paused', false)]) {
    const f = fixture();
    f.monitor.begin('resume'); f.time(10); f.monitor.rendered(5);
    cancel(f); f.time(50000); f.paints.shift()();
    assert.equal(f.reports.length, 0);
  }
  const f = fixture();
  f.monitor.flowChanged('paused', false); f.monitor.flowChanged('flight', false);
  f.monitor.rendered(1); f.monitor.begin('resume'); f.paints.shift()();
  assert.equal(f.reports.length, 0);
  f.hide(true); f.monitor.begin('resume');
  assert.equal(f.monitor.pending, null);
});
