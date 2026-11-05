import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shortenAssetName, classifyAsset, createStartupTraceState, addResourceEntry, noteReady,
  noteMilestone, noteFirstVisible, noteDocumentTransfer, noteSelection, shouldEmitTrace,
  shouldEmitPartialTrace,
  stageSpans, buildStartupTraceReport, BOOT_STAGES, ASSET_CLASSES, SETTLE_MS, HARD_DEADLINE_MS,
  TRACE_VERSION, PARTIAL_MIN_MS,
} from '../src/core/startupTrace.js';

const ORIGIN = 'https://flight3d.example/';
const state = (over = {}) => createStartupTraceState({ ownOrigin: ORIGIN, ...over });
const entry = (name, startTime, duration, bytes = {}) => ({
  name,
  startTime,
  duration,
  responseEnd: startTime + duration,
  transferSize: bytes.transfer ?? 1000,
  encodedBodySize: bytes.encoded ?? 900,
  decodedBodySize: bytes.decoded ?? 2000,
});

test('asset names shorten to the harness form and reject non-fetchable schemes', () => {
  assert.equal(shortenAssetName(`${ORIGIN}models/b737-cockpit-medium.glb`), 'models/b737-cockpit-medium.glb');
  assert.equal(shortenAssetName(`${ORIGIN}models/x.glb?v=1#frag`), 'models/x.glb');
  assert.equal(shortenAssetName('data:application/octet-stream,AAAA'), null);
  assert.equal(shortenAssetName('blob:https://cdn.example/abc'), null);
  assert.equal(shortenAssetName(''), null);
  assert.equal(shortenAssetName('draco_wasm_wrapper-DxJM36Ib.js'), 'draco_wasm_wrapper-DxJM36Ib.js');
});

test('classification keys decoder off the draco path, not the extension', () => {
  assert.equal(classifyAsset(`${ORIGIN}models/b737-800.glb`), 'glb');
  assert.equal(classifyAsset(`${ORIGIN}lighting/cockpit-medium.bin`), 'bin');
  assert.equal(classifyAsset(`${ORIGIN}textures/environment/sky_1k.hdr`), 'hdr');
  assert.equal(classifyAsset(`${ORIGIN}textures/pavement/asphalt-normal.jpg`), 'texture');
  assert.equal(classifyAsset(`${ORIGIN}audio/departure/taxi.wav`), 'audio');
  assert.equal(classifyAsset(`${ORIGIN}draco/gltf/draco_decoder.js`), 'decoder');
  assert.equal(classifyAsset(`${ORIGIN}assets/draco_decoder-C32yEggz.wasm`), 'decoder');
  assert.equal(classifyAsset(`${ORIGIN}assets/draco_wasm_wrapper-DxJM36Ib.js`), 'decoder');
  assert.equal(classifyAsset(`${ORIGIN}assets/main-BGfRLKoj.js`), 'module');
  assert.equal(classifyAsset(`${ORIGIN}assets/main-D_gWv12K.css`), 'style');
  assert.equal(classifyAsset(`${ORIGIN}scenery/incheon/patch.json`), 'json');
  assert.equal(classifyAsset(`${ORIGIN}index.html`), 'other');
  assert.equal(classifyAsset(undefined), 'other');
});

test('resource entries aggregate per class and split on the ready boundary', () => {
  const s = state();
  assert.equal(addResourceEntry(s, entry(`${ORIGIN}models/a.glb`, 100, 400)), true);
  assert.equal(addResourceEntry(s, entry(`${ORIGIN}lighting/b.bin`, 120, 200)), true);
  noteReady(s, 800, 'booting-class');
  // Delivered after the class flip, with responseEnd past ready.
  assert.equal(addResourceEntry(s, entry(`${ORIGIN}textures/c.jpg`, 900, 50)), true);

  const report = buildStartupTraceReport(s, { nowMs: 90_000 });
  assert.equal(report.classes.glb.count, 1);
  assert.equal(report.classes.glb.totalMs, 400);
  assert.equal(report.classes.glb.maxMs, 400);
  assert.equal(report.classes.glb.transferBytes, 1000);
  assert.equal(report.classes.bin.countBeforeReady, 1);
  // responseEnd 950 > ready 800: after the overlay lifted.
  assert.equal(report.classes.texture.countBeforeReady, 0);
  assert.equal(report.readyMs, 800);
  assert.equal(report.readySource, 'booting-class');
  assert.equal(report.requestsBeforeReady, 2);
  assert.equal(report.bytesBeforeReady, 2000);
  assert.equal(report.blocking.name, 'models/a.glb');
  assert.equal(report.slowest[0].duration, 400);
});

test('duplicate entries are ignored so observer and snapshot paths can both feed the core', () => {
  const s = state();
  const e = entry(`${ORIGIN}models/a.glb`, 100, 400);
  assert.equal(addResourceEntry(s, e), true);
  assert.equal(addResourceEntry(s, e), false);
  assert.equal(addResourceEntry(s, entry(`${ORIGIN}models/a.glb`, 100.4, 400)), false);
  // Same asset re-fetched later is a real second request.
  assert.equal(addResourceEntry(s, entry(`${ORIGIN}models/a.glb`, 5000, 400)), true);
  assert.equal(s.totals.requests, 2);
  assert.equal(s.classes.glb.count, 2);
});

test('unusable, cross-origin and telemetry entries are dropped with the reason recorded', () => {
  const s = state({ ignore: ['ieu1.posthog.com/i/'] });
  assert.equal(addResourceEntry(s, { name: `${ORIGIN}models/a.glb`, startTime: NaN, duration: 5 }), false);
  assert.equal(addResourceEntry(s, { name: `${ORIGIN}models/a.glb`, startTime: 1, duration: NaN }), false);
  assert.equal(addResourceEntry(s, entry('https://cdn.third-party.test/size.glb', 10, 10)), false);
  assert.equal(addResourceEntry(s, entry('https://ieu1.posthog.com/i/v0/e/', 12, 30)), false);
  assert.equal(s.totals.requests, 0);
  assert.equal(s.thirdPartyDropped, 2);

  // A Timing-Allow-Origin-less response reports no sizes at all.
  const o = state();
  addResourceEntry(o, entry(`${ORIGIN}models/opaque.glb`, 10, 250, { transfer: 0, encoded: 0, decoded: 0 }));
  const report = buildStartupTraceReport(o, {});
  assert.equal(report.classes.glb.count, 1);
  assert.equal(report.classes.glb.totalMs, 250);
  assert.equal(report.classes.glb.transferBytes, 0);
  assert.equal(report.totals.opaqueDropped, 1);
});

test('ring overflow counts drops while per-class aggregates stay honest', () => {
  const s = state({ resourceCapacity: 4, topN: 2 });
  for (let i = 0; i < 10; i++) addResourceEntry(s, entry(`${ORIGIN}models/m${i}.glb`, i * 100, 100 + i));
  assert.equal(s.entries.length, 4);
  assert.equal(s.dropped, 6);
  assert.equal(s.classes.glb.count, 10);
  assert.equal(s.totals.requests, 10);
  const report = buildStartupTraceReport(s, {});
  assert.equal(report.slowest.length, 2);
  assert.equal(report.totals.dropped, 6);
});

test('stage spans read the shared boot marks, going null when a mark is missing', () => {
  const s = state();
  const marks = { 'stage:0': 100, 'stage:1': 300, 'stage:2': 1300, 'stage:5': 3180 };
  const spans = stageSpans(s, marks);
  assert.equal(spans.scene, 200);
  assert.equal(spans.world, null);
  assert.equal(spans.cockpit, null);
  noteReady(s, 4000);
  assert.deepEqual(Object.keys(stageSpans(s, marks)), BOOT_STAGES.map(b => b.key));
  assert.equal(stageSpans(s, marks).cockpit, null);
  // Negative spans clamp to zero, matching inputLatency's bootTimeline.
  assert.equal(stageSpans(s, { 'stage:0': 900, 'stage:1': 100 }).scene, 0);
  // The final stage closes on ready, not on a later mark.
  assert.equal(stageSpans(s, { ...marks, 'stage:6': 3500 }).ready, 500);
});

test('emit is one-shot and waits for the settle window after ready', () => {
  const s = state();
  assert.equal(shouldEmitTrace(s, 100_000), false, 'nothing to anchor on before the deadline');
  assert.equal(s.readySource, null);
  assert.equal(shouldEmitTrace(s, 200_000), true, 'the hard deadline reports a boot that never lifted');
  assert.equal(s.readySource, 'timeout');
  assert.equal(s.emitted, true);
  assert.equal(shouldEmitTrace(s, 300_000), false);

  const r = state();
  noteReady(r, 5000);
  assert.equal(shouldEmitTrace(r, 5000 + SETTLE_MS - 1), false);
  assert.equal(shouldEmitTrace(r, 5000 + SETTLE_MS), true);
  assert.equal(shouldEmitTrace(r, 5000 + SETTLE_MS + 1), false);

  const failed = state();
  failed.readySource = 'failed';
  assert.equal(shouldEmitTrace(failed, 1000), true, 'a failed boot reports immediately');
});

test('a report emitted before any ready anchor labels readySource never', () => {
  const s = state();
  assert.equal(buildStartupTraceReport(s, { nowMs: 20_000 }).readySource, 'never');
  noteReady(s, 800, 'booting-class');
  assert.equal(buildStartupTraceReport(s, { nowMs: 9_000 }).readySource, 'booting-class');
});

test('a pre-ready forced flush is allowed once and keeps the final emit right', () => {
  const s = state();
  assert.equal(shouldEmitPartialTrace(s, PARTIAL_MIN_MS - 1), false, 'too early to have a resource list worth sending');
  assert.equal(shouldEmitPartialTrace(s, PARTIAL_MIN_MS), true);
  assert.equal(s.partialEmitted, true);
  assert.equal(s.emitted, false, 'the partial trace does not spend the completed boot');
  assert.equal(shouldEmitPartialTrace(s, 3000), false, 'one partial per load');

  noteReady(s, 3200, 'booting-class');
  assert.equal(shouldEmitTrace(s, 3200 + SETTLE_MS), true, 'the settle path still reports the finished boot');

  const done = state();
  noteReady(done, 800, 'booting-class');
  assert.equal(shouldEmitPartialTrace(done, 5000), false, 'a completed boot is not partial');

  const spent = state();
  spent.emitted = true;
  assert.equal(shouldEmitPartialTrace(spent, 5000), false);
});

test('outcome names what the boot reached, so partial rows never pollute latency percentiles', () => {
  const ready = state();
  noteReady(ready, 2400, 'booting-class');
  assert.equal(buildStartupTraceReport(ready, { nowMs: 12_400 }).outcome, 'ready');

  const never = state();
  assert.equal(buildStartupTraceReport(never, { nowMs: 2400 }).outcome, 'never-ready');

  const failed = state();
  failed.readySource = 'failed';
  assert.equal(buildStartupTraceReport(failed, { nowMs: 2400 }).outcome, 'failed');

  const late = state();
  late.readySource = 'timeout';
  assert.equal(buildStartupTraceReport(late, { nowMs: HARD_DEADLINE_MS }).outcome, 'deadline');
});

test('lobbyReadyMs reads the usable-app mark and never falls back to lobby idle time', () => {
  const s = state();
  const report = buildStartupTraceReport(s, {
    marks: { 'module-start': 180, 'lobby-ready': 913, 'first-frame': 21636, fly: 300 },
    nowMs: 30_000,
  });
  assert.equal(report.lobbyReadyMs, 913, 'the demo lobby mark wins over a later fly mark');
  assert.equal(report.lobbyReadySource, 'lobby-ready');
  assert.equal(report.readyMs, null);

  const direct = buildStartupTraceReport(state(), { marks: { fly: 2750 }, nowMs: 9000 });
  assert.equal(direct.lobbyReadyMs, 2750, '?fly boots never mark a lobby');
  assert.equal(direct.lobbyReadySource, 'fly');

  const blind = buildStartupTraceReport(state(), { marks: {}, nowMs: 9000 });
  assert.equal(blind.lobbyReadyMs, null);
  assert.equal(blind.lobbyReadySource, null);
});

test('cache hits are counted separately from entries with no sizing at all', () => {
  const s = state();
  // HTTP cache hit: body size known, nothing transferred.
  addResourceEntry(s, entry(`${ORIGIN}models/a.glb`, 100, 400, { transfer: 0, encoded: 2_000_000, decoded: 3_000_000 }));
  // Cold load.
  addResourceEntry(s, entry(`${ORIGIN}models/b.glb`, 600, 100, { transfer: 5000, encoded: 4000, decoded: 6000 }));
  // No sizing: memory-cache hit or (on a non-same-origin harness) a CORS-opaque response.
  addResourceEntry(s, entry(`${ORIGIN}textures/c.png`, 700, 50, { transfer: 0, encoded: 0, decoded: 0 }));

  const report = buildStartupTraceReport(s, { nowMs: 1200 });
  assert.equal(report.totals.cacheHitRequests, 1);
  assert.equal(report.totals.sizeUnknownRequests, 1);
  assert.equal(report.totals.opaqueDropped, 1);
  assert.equal(report.cacheWarmRatio, 0.5, 'one of the two entries with sizing was served from cache');

  const empty = buildStartupTraceReport(state(), { nowMs: 10 });
  assert.equal(empty.cacheWarmRatio, null, 'no data is not 0 % warm');

  noteDocumentTransfer(s, 0);
  assert.equal(buildStartupTraceReport(s, { nowMs: 1200 }).documentCached, true);
  assert.equal(buildStartupTraceReport(state(), { nowMs: 1200 }).documentCached, null, 'no navigation entry is not a miss');
});

test('post-ready requests are totalled so a partial flush can be told from a short capture window', () => {
  const s = state();
  noteReady(s, 1000, 'booting-class');
  addResourceEntry(s, entry(`${ORIGIN}models/early.glb`, 100, 400, { transfer: 1500, encoded: 1400 }));
  addResourceEntry(s, entry(`${ORIGIN}models/late.glb`, 1200, 300, { transfer: 2500, encoded: 2400 }));

  const report = buildStartupTraceReport(s, { nowMs: 11_000 });
  assert.equal(report.requestsBeforeReady, 1);
  assert.equal(report.totals.requestsAfterReady, 1);
  assert.equal(report.totals.bytesAfterReady, 2500);
  assert.equal(report.postReadyMs, 10_000, 'how long the window stayed open before flushing');

  const partial = buildStartupTraceReport(state(), { nowMs: 1200 });
  assert.equal(partial.postReadyMs, null, 'no ready anchor means no post-ready window');
});

test('flushReason is carried onto the report and defaults to the settle path', () => {
  assert.equal(buildStartupTraceReport(state(), { nowMs: 10 }).flushReason, 'settle');
  assert.equal(buildStartupTraceReport(state(), { nowMs: 10, flushReason: 'hidden' }).flushReason, 'hidden');
});

test('bootId and version identify the report schema in PostHog', () => {
  const s = state({ bootId: '01a1a49c-3a21-783f' });
  const report = buildStartupTraceReport(s, { nowMs: 10 });
  assert.equal(report.bootId, '01a1a49c-3a21-783f');
  assert.equal(report.version, TRACE_VERSION);
  assert.equal(TRACE_VERSION, 2, 'v2 added outcome/flushReason/lobbyReadyMs and the cache totals');
  assert.equal(buildStartupTraceReport(state(), { nowMs: 10 }).bootId, null);
});

test('milestones ignore non-finite values and map onto the navigation payload', () => {
  const s = state();
  assert.equal(noteMilestone(s, 'firstContentfulPaint', 520.6), true);
  assert.equal(noteMilestone(s, 'domContentLoaded', NaN), false);
  assert.equal(noteMilestone(s, 'largestContentfulPaint', undefined), false);
  noteMilestone(s, 'fetchStart', 3);
  const report = buildStartupTraceReport(s, {});
  assert.equal(report.fcpMs, 521);
  assert.equal(report.navigation.firstContentfulPaintMs, 521);
  assert.equal(report.navigation.domContentLoadedMs, null);
  assert.equal(report.navigation.largestContentfulPaintMs, null);
  assert.equal(report.capability.lcp, false);
});

test('backgroundBoot flags every load that ran out of sight, including a killed background tab', () => {
  const s = state();
  noteReady(s, 90_000);
  noteFirstVisible(s, 120_000);
  assert.equal(buildStartupTraceReport(s, {}).backgroundBoot, true);
  const lit = state();
  noteReady(lit, 9000);
  noteFirstVisible(lit, 1000);
  assert.equal(buildStartupTraceReport(lit, {}).backgroundBoot, false);
  // The mobile bounce this whole feature exists to capture: created hidden, never revealed, so
  // there is no visible mark at all. Reporting false here would hide the population in a segment.
  assert.equal(buildStartupTraceReport(state(), {}).backgroundBoot, true,
    'a load with no visible mark was never in the foreground');
  // Revealed before the overlay lifted: the paint timings are real, so this is not a background boot.
  const revealed = state();
  noteFirstVisible(revealed, 20_000);
  assert.equal(buildStartupTraceReport(revealed, {}).backgroundBoot, false);
});

test('startup selection survives the analytics context merge', () => {
  const s = state();
  noteSelection(s, { aircraft: 'B738', airport: 'coastal', scenario: 'runway' });
  const report = buildStartupTraceReport(s, {});
  assert.equal(report.startupAircraft, 'B738');
  assert.equal(report.startupAirport, 'coastal');
  noteSelection(s, {});
  assert.equal(buildStartupTraceReport(s, {}).startupAircraft, null);
});

test('long tasks and module-start-to-ready span come from the caller-supplied inputs', () => {
  const s = state();
  noteMilestone(s, 'unused', 1);
  noteReady(s, 8421, 'booting-class');
  const marks = { 'module-start': 640, 'first-frame': 3110, 'stage:5': 3180, 'stage:6': 8070 };
  const report = buildStartupTraceReport(s, { marks, longTasks: { count: 14, totalMs: 2600, maxMs: 780 } });
  assert.equal(report.boot.moduleStartToReadyMs, 7781);
  assert.equal(report.boot.stagesMs.cockpit, 4890);
  assert.equal(report.cockpitStageMs, 4890);
  assert.equal(report.firstFrameMs, 3110);
  assert.deepEqual(report.longTasks, { count: 14, totalMs: 2600, maxMs: 780 });
  assert.deepEqual(report.boot.marks, marks);
});

test('every declared class appears in the payload so PostHog trends do not fragment', () => {
  const s = state();
  const report = buildStartupTraceReport(s, {});
  assert.deepEqual(Object.keys(report.classes).sort(), [...ASSET_CLASSES].sort());
  assert.equal(report.classes.glb.count, 0);
});

test('payload stays small under a pathological asset count', () => {
  const s = state({ topN: 5 });
  for (let i = 0; i < 400; i++) {
    addResourceEntry(s, entry(`${ORIGIN}textures/t${i}.jpg`, i * 10, 5 + i, { transfer: 40_000, encoded: 39_000 }));
  }
  noteReady(s, 2000);
  const report = buildStartupTraceReport(s, { marks: { 'module-start': 0 } });
  assert.equal(report.totals.requests, 400);
  assert.equal(report.slowest.length, 5);
  assert.ok(report.boot.marks['module-start'] !== undefined);
  const size = JSON.stringify(report).length;
  assert.ok(size < 12_000, `payload was ${size} bytes`);
});

test('HARD_DEADLINE_MS bounds a boot that never lifts the overlay', () => {
  assert.ok(HARD_DEADLINE_MS > SETTLE_MS);
  const s = state();
  assert.equal(shouldEmitTrace(s, HARD_DEADLINE_MS - 1), false);
  assert.equal(shouldEmitTrace(s, HARD_DEADLINE_MS), true);
  assert.equal(s.readySource, 'timeout');
});
