import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInputLatencyState, addBootMark, addEventSample, addFallbackSample, discardSample,
  addLongTask, recordSelection, windowSummary, longTaskSummary, firstSecondsSummary,
  bootTimeline, shouldEmitSummary, buildReport, snapshot, THRESHOLDS,
} from '../src/core/inputLatency.js';

test('event timing samples compute processing and paint latency; no-handler events report null processing', () => {
  const s = createInputLatencyState();
  const a = addEventSample(s, { name: 'click', startTime: 1000, processingStart: 1040, processingEnd: 1100, duration: 180 });
  assert.deepEqual(a, { type: 'click', startMs: 1000, processingMs: 40, handlerMs: 60, totalMs: 180, source: 'event-timing' });
  const b = addEventSample(s, { name: 'keydown', startTime: 2000, processingStart: 0, processingEnd: 0, duration: 12 });
  assert.equal(b.processingMs, null);
  assert.equal(b.handlerMs, null);
  assert.equal(b.totalMs, 12);
  assert.equal(addEventSample(s, { name: 'click', startTime: NaN, duration: 5 }), null);
  assert.equal(addEventSample(s, { name: 'click', startTime: 1, duration: -2 }), null);
  assert.equal(s.samples.length, 2);
});

test('fallback samples measure click-to-paint gap and can be discarded (hidden-tab guard)', () => {
  const s = createInputLatencyState();
  const a = addFallbackSample(s, { type: 'pointerdown', clickedAtMs: 500.4, paintedAtMs: 900 });
  assert.equal(a.source, 'fallback');
  assert.equal(a.startMs, 500);
  assert.equal(a.totalMs, 400);
  assert.equal(addFallbackSample(s, { clickedAtMs: 500, paintedAtMs: 400 }), null);
  assert.equal(discardSample(s, 500), true);
  assert.equal(s.samples.length, 0);
  assert.equal(discardSample(s, 500), false);
});

test('ring buffers keep the newest samples, drop oldest and count drops', () => {
  const s = createInputLatencyState({ eventCapacity: 3 });
  for (let i = 0; i < 5; i++) addEventSample(s, { name: `click${i}`, startTime: i * 10, duration: 10 });
  assert.equal(s.samples.length, 3);
  assert.equal(s.samples[0].type, 'click2');
  assert.equal(s.dropped, 2);
});

test('window summaries report count, worst, p95, processing wait and long-task aggregates', () => {
  const s = createInputLatencyState();
  for (const [at, ms, wait] of [[100, 30, 5000], [200, 500, 2], [300, 120, null], [900, 10, 1]]) {
    addEventSample(s, { name: 'click', startTime: at, processingStart: wait === null ? 0 : at + wait, processingEnd: at + wait + 1, duration: ms });
  }
  const win = windowSummary(s, 0, 500);
  assert.deepEqual(win, { inputs: 3, worstMs: 500, p95Ms: 500, meanMs: 217, worstProcessingMs: 5000 });
  assert.deepEqual(windowSummary(s, 5000, 6000), { inputs: 0, worstMs: null, p95Ms: null, meanMs: null, worstProcessingMs: null });
  addLongTask(s, { startTime: 150, duration: 7000 });
  addLongTask(s, { startTime: 9000, duration: 400 });
  assert.deepEqual(longTaskSummary(s, 0, 500), { count: 1, totalMs: 7000, maxMs: 7000 });
  assert.deepEqual(longTaskSummary(s, -Infinity, 10_000), { count: 2, totalMs: 7400, maxMs: 7000 });
  const overlap = createInputLatencyState();
  addLongTask(overlap, { startTime: 90, duration: 400 });
  assert.deepEqual(longTaskSummary(overlap, 100, 600), { count: 1, totalMs: 400, maxMs: 400 });
  assert.deepEqual(longTaskSummary(overlap, 500, 600), { count: 0, totalMs: 0, maxMs: 0 });
});

test('first-seconds summary anchors on first-frame and reports the first input after boot', () => {
  const s = createInputLatencyState();
  addBootMark(s, 'first-frame', 2000);
  assert.deepEqual(firstSecondsSummary(s), { baseMs: 2000, windowMs: 5000, inputs: 0, firstInputMs: null, firstInputLatencyMs: null, worstMs: null });
  addEventSample(s, { name: 'click', startTime: 2600, duration: 240 });
  addEventSample(s, { name: 'keydown', startTime: 3000, duration: 40 });
  addEventSample(s, { name: 'click', startTime: 9000, duration: 60 }); // outside the 5 s window
  const first = firstSecondsSummary(s);
  assert.equal(first.inputs, 2);
  assert.equal(first.firstInputMs, 600);
  assert.equal(first.firstInputLatencyMs, 240);
  assert.equal(first.worstMs, 240);
});

test('boot timeline spans module start to ready, first frame and fly', () => {
  const s = createInputLatencyState();
  assert.equal(bootTimeline(s).moduleStartToFirstFrameMs, null);
  addBootMark(s, 'module-start', 100);
  addBootMark(s, 'ready', 900);
  addBootMark(s, 'first-frame', 1200);
  addBootMark(s, 'fly', 1300);
  assert.deepEqual(bootTimeline(s), {
    moduleStartToReadyMs: 800, moduleStartToFirstFrameMs: 1100,
    moduleStartToFlyMs: 1200, flyToFirstFrameMs: 0,
  });
  // fly is marked inside the constructor; when it precedes the first frame the span clamps to 0,
  // and when first paint lands later the gap is reported honestly.
  const s3 = createInputLatencyState();
  addBootMark(s3, 'module-start', 100); addBootMark(s3, 'fly', 300); addBootMark(s3, 'first-frame', 1200);
  assert.equal(bootTimeline(s3).flyToFirstFrameMs, 900);
});

test('lobby selection drain pairs queued and applied stamps, folding newer choices into the running drain', () => {
  let now = 0;
  const s = createInputLatencyState({ clock: () => now });
  recordSelection(s, 'start');            // queued at 0
  now = 500; recordSelection(s, 'start'); // newer click while draining: folds into the same pass
  now = 1200; recordSelection(s, 'applied');
  assert.equal(s.selections.length, 1);
  assert.deepEqual(s.selections[0], { queuedMs: 0, appliedMs: 1200, drainMs: 1200 });
  now = 1300; recordSelection(s, 'start');
  assert.equal(recordSelection(s, 'applied', 1800).drainMs, 500);
  assert.equal(recordSelection(s, 'applied'), null); // nothing open
});

test('summary emits once at boot and stays silent on a quiet page', () => {
  const s = createInputLatencyState();
  assert.equal(shouldEmitSummary(s, 1000), false);
  assert.equal(shouldEmitSummary(s, THRESHOLDS.bootSummaryAtMs), true);
  assert.equal(shouldEmitSummary(s, 61_000), false);
  assert.equal(shouldEmitSummary(s, 300_000), false);
});

test('summary second line requires both cooldown elapsed and a breach since last summary', () => {
  const s = createInputLatencyState();
  assert.equal(shouldEmitSummary(s, 3_000), true); // boot line
  addEventSample(s, { name: 'click', startTime: 30_000, processingStart: 30_800, processingEnd: 30_810, duration: 500 }); // 800 ms blocked before handler
  assert.equal(shouldEmitSummary(s, 62_000), false); // breach present, spacing < 60 s
  assert.equal(shouldEmitSummary(s, 63_000), true);  // spacing reached, breach still unreported
  addLongTask(s, { startTime: 100_000, duration: THRESHOLDS.longTaskTotalMs + 1 });
  assert.equal(shouldEmitSummary(s, 122_000), false); // heavy long task, spacing < 60 s
  assert.equal(shouldEmitSummary(s, 123_000), true);  // long task reported once
  assert.equal(shouldEmitSummary(s, 300_000), false); // nothing new since
  // slow paint alone (no handler wait) must not fire the processing breach
  const q = createInputLatencyState();
  assert.equal(shouldEmitSummary(q, 3_000), true);
  addEventSample(q, { name: 'click', startTime: 30_000, processingStart: 30_005, processingEnd: 30_006, duration: 6000 });
  assert.equal(shouldEmitSummary(q, 64_000), false);
});

test('breach older than the last summary does not re-fire', () => {
  const t = createInputLatencyState();
  assert.equal(shouldEmitSummary(t, 3_000), true);
  addEventSample(t, { name: 'click', startTime: 50_000, processingStart: 50_600, processingEnd: 50_610, duration: 800 });
  assert.equal(shouldEmitSummary(t, 64_000), true);
  assert.equal(shouldEmitSummary(t, 130_000), false);
});

test('report is JSON-safe and snapshot exposes live rows', () => {
  let now = 0;
  const s = createInputLatencyState({ clock: () => now });
  s.capability.eventTiming = true;
  now = 20_000;
  addBootMark(s, 'module-start');
  addEventSample(s, { name: 'click', startTime: 19_000, processingStart: 19_020, processingEnd: 19_050, duration: 120 });
  addLongTask(s, { startTime: 19_500, duration: 300 });
  recordSelection(s, 'start', 19_600);
  recordSelection(s, 'applied', 19_900);
  const json = JSON.parse(JSON.stringify(buildReport(s)));
  assert.equal(json.version, 1);
  assert.equal(json.capability.eventTiming, true);
  assert.equal(json.boot.marks['module-start'], 20_000);
  assert.equal(json.windows.last5s.worstMs, 120);
  assert.equal(json.longTasks.last5s.totalMs, 300);
  assert.equal(json.events.samples.length, 1);
  assert.equal(json.lobbySelections.length, 1);
  assert.equal(json.lobbySelections[0].drainMs, 300);
  assert.ok(!('selectionDrain' in json));
  const snap = snapshot(s);
  assert.equal(snap.last.type, 'click');
  assert.equal(snap.last.processingMs, 20);
  assert.equal(snap.worst30s.worstMs, 120);
  assert.equal(snap.longTasks5s.count, 1);
});
