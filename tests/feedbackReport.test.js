import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlightLog, createFeedbackReport, deliverFeedbackReport, FLIGHT_LOG_BUDGET_BYTES,
  gatherFeedbackDiagnostics, gatherFeedbackFullReport } from '../src/analytics/feedbackReport.js';
import { prepareUserFeedback, sendUserFeedback, _resetAnalyticsForTesting } from '../src/analytics/posthog.js';

const originalWindow = globalThis.window, originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  _resetAnalyticsForTesting();
});
const report = () => createFeedbackReport({ message: '50g on landing', context: { peakG: 50.12 } });
const options = fetchImpl => ({ apiKey: 'test-project-key', host: 'https://example.test', distinctId: 'pilot', fetchImpl });

test('waits for a readable ingestion acknowledgement and sends one stable-id event', async () => {
  const draft = report();
  let acknowledge, sent, endpoint;
  const delivery = deliverFeedbackReport(draft, options(async (url, request) => {
    endpoint = url; sent = JSON.parse(request.body);
    assert.equal(request.mode, 'cors');
    assert.equal(request.credentials, 'omit');
    return { ok: true, text: () => new Promise(resolve => { acknowledge = resolve; }) };
  }));
  let resolved = false;
  delivery.then(() => { resolved = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, false);
  acknowledge('{"status":"Ok"}');
  assert.deepEqual(await delivery, { reportId: draft.reportId, accepted: true });
  assert.equal(endpoint, 'https://example.test/i/v0/e/');
  assert.equal(sent.event, 'user_feedback_submitted');
  assert.equal(sent.uuid, draft.reportId);
  assert.equal(sent.properties.peakG, 50.12);
  assert.equal(sent.distinct_id, 'pilot');
  assert.equal(sent.timestamp, draft.createdAt);
  assert.ok(!JSON.stringify(draft).includes('test-project-key'), 'download contains no credential');
});

test('blocked requests, HTTP errors, opaque responses and invalid/negative acknowledgements fail', async () => {
  for (const [response, reason] of [[new Error('net::ERR_BLOCKED_BY_CLIENT'), /연결할 수 없습니다/],
    [{ ok: false, status: 429 }, /HTTP 429/], [{ ok: true, type: 'opaque' }, /연결할 수 없습니다/],
    ...['', '<html>ok</html>', '0', '{}', '{"status":0}', 'true'].map(text =>
      [{ ok: true, text: async () => text }, /확인 가능한 수신 응답/])]) {
    await assert.rejects(deliverFeedbackReport(report(), options(async () => {
      if (response instanceof Error) throw response;
      return response;
    })), reason);
  }
});

test('times out even if fetch never settles, aborts it, and reuses id on explicit retry', async () => {
  const draft = report(); let signal;
  await assert.rejects(deliverFeedbackReport(draft, { ...options(async (_, request) => {
    signal = request.signal;
    return new Promise(() => {});
  }), timeoutMs: 5 }), /응답 시간이 초과/);
  assert.equal(signal.aborted, true);
  const ids = [];
  for (let i = 0; i < 2; i++) await deliverFeedbackReport(draft, options(async (_, request) => {
    ids.push(JSON.parse(request.body).uuid);
    return { ok: true, text: async () => '1' };
  }));
  assert.deepEqual(ids, [draft.reportId, draft.reportId]);
});

test('explicit reports work without SDK even when automatic telemetry is opted out or storage is blocked', async () => {
  globalThis.window = { location: { search: '?telemetry=0' },
    get localStorage() { throw new Error('Storage denied'); } };
  let captured;
  globalThis.fetch = async (_, request) => {
    captured = JSON.parse(request.body);
    return { ok: true, text: async () => '1' };
  };
  const draft = prepareUserFeedback({ message: 'Manual report', includeContext: false,
    context: { aircraft: 'B738', gForce: 50, secretContext: 'do not send' } });
  await sendUserFeedback({ report: draft });
  assert.equal(captured.properties.feedback_message, 'Manual report');
  assert.equal(captured.properties.aircraft, undefined);
  assert.equal(captured.properties.gForce, undefined);
  assert.equal(captured.properties.secretContext, undefined);
});

test('missing reporting configuration fails rather than enqueueing success', async () => {
  await assert.rejects(deliverFeedbackReport(report(), { ...options(async () => {}), apiKey: '' }), /설정/);
});

test('snapshot includes held sortie peak, touchdown G, context samples, dynamics and correct duration', () => {
  const samples = Array.from({ length: 100 }, (_, i) => ({ timeSec: i / 5, gForce: i === 50 ? 51.8 : 1 }));
  const sim = { currentAircraftId: 'C172', activeAirport: 'coastal', lastPresetType: 'demo',
    flightRecorder: { active: false, elapsed: 999 },
    debriefReport: { metadata: { aircraft: 'B738', airport: 'incheon', scenario: 'approach' },
      reason: 'crash', durationSec: 20, peaks: { gForce: samples[50] }, samples,
      touchdowns: [{ timeSec: 9.5, sinkRateFpm: 700, contactG: 3.1 }],
      crash: { type: 'TERRAIN', timeSec: 19.9 } },
    telemetry: { gForce: .99, gearDamage: { nose: 'collapsed' }, vsiFpm: -800 },
    position: { x: 1, y: 2, z: 3 }, gear: { failure: { contact: 'nose', sinkRate: 6 } } };
  const diagnostics = gatherFeedbackDiagnostics(sim);
  assert.equal(diagnostics.aircraft, 'B738');
  assert.equal(diagnostics.peakG, 51.8);
  assert.equal(diagnostics.peakGTimeSec, 10);
  assert.equal(diagnostics.gForce, .99);
  assert.equal(diagnostics.flightDurationSec, 20);
  assert.equal(diagnostics.touchdowns[0].contactG, 3.1);
  assert.equal(diagnostics.peakSample.gForce, 51.8);
  assert.equal(diagnostics.recentSamples.length, 30);
  assert.equal(diagnostics.peakSamples.length, 21);
  assert.equal(diagnostics.flightLog.source, 'held-sortie');
  assert.equal(diagnostics.flightLog.samples.length, 100);
  assert.equal(diagnostics.flightLog.crash.timeSec, 19.9);
  assert.equal(diagnostics.gearFailure.sinkRate, 6);
  sim.telemetry.gearDamage.nose = 'normal';
  assert.equal(diagnostics.telemetry.gearDamage.nose, 'collapsed', 'dialog-open diagnostics own their data');
  const draft = createFeedbackReport({ message: 'snapshot', context: diagnostics });
  assert.equal(draft.properties.telemetry.gearDamage.nose, 'collapsed', 'retry owns immutable snapshot');
  sim.flightRecorder = { active: true, elapsed: 2, samples: [], peaks: {} };
  const live = gatherFeedbackDiagnostics(sim);
  assert.equal(live.aircraft, 'C172');
  assert.equal(live.flightDurationSec, 2);
  assert.equal(live.peakG, null, 'new flight must not inherit previous peak');
});

test('report attaches the live sortie flight log with its metadata and touchdown records', () => {
  const samples = Array.from({ length: 25 }, (_, i) => ({ timeSec: i / 5, x: i, z: -i, altitudeFt: 1000 + i,
    iasKnots: 90, gForce: i === 12 ? 4.5 : 1, pitchDeg: 2, rollDeg: 0, headingDeg: 180 }));
  const sim = { flightRecorder: { active: true, elapsed: 4.8, interval: 0.2,
    metadata: { aircraft: 'C172', airport: 'coastal', scenario: 'demo' },
    samples, peaks: { gForce: samples[12] }, touchdowns: [{ timeSec: 4, sinkRateFpm: 120, contactG: 1.4,
      _tdRecord: { finalized: true } }], glocIncidents: 0 } };
  const log = buildFlightLog(sim);
  assert.equal(log.source, 'live-sortie');
  assert.equal(log.metadata.aircraft, 'C172');
  assert.equal(log.capturedAtSec, 4.8);
  assert.equal(log.samples.length, 25);
  assert.equal(log.samples[12].gForce, 4.5);
  assert.equal(log.sampling.intervalSec, 0.2);
  assert.equal(log.sampling.decimated, false);
  assert.equal(log.touchdowns[0].contactG, 1.4);
  assert.equal(log.touchdowns[0]._tdRecord, undefined, 'recorder internals stay out of the report');
  assert.equal(gatherFeedbackDiagnostics(sim).flightLog.samples.length, 25);
  assert.equal(buildFlightLog({}), null, 'no sortie means no attachable log');
});

test('long flight logs are decimated under the payload budget with the peak and final samples kept', () => {
  const samples = Array.from({ length: 4000 }, (_, i) => ({ timeSec: i / 5, x: i * 3, z: -i * 2,
    altitudeFt: 1000 + i, iasKnots: 120, gForce: i === 2000 ? 12.5 : 1, pitchDeg: 0, rollDeg: 0,
    headingDeg: 90 }));
  const log = buildFlightLog({ flightRecorder: { active: true, elapsed: 800, interval: 0.2,
    metadata: { aircraft: 'F16', airport: 'valley', scenario: 'demo' }, samples,
    peaks: { gForce: samples[2000] }, touchdowns: [], glocIncidents: 0 } }, { budgetBytes: 60000 });
  assert.ok(new TextEncoder().encode(JSON.stringify(log)).length <= 60000);
  assert.equal(log.sampling.decimated, true);
  assert.equal(log.sampling.originalCount, 4000);
  assert.equal(log.sampling.retainedCount, log.samples.length);
  assert.ok(log.samples.length < 4000 && log.samples.length > 100);
  assert.equal(log.samples[0].timeSec, 0);
  assert.equal(log.samples.at(-1).timeSec, samples.at(-1).timeSec);
  assert.ok(log.samples.some(sample => sample.gForce === 12.5), 'peak-G moment survives decimation');
});

test('final budget thinning keeps the peak-G sample and final sample', () => {
  const samples = Array.from({ length: 4270 }, (_, i) => ({ timeSec: i / 5,
    x: 1234.5678901234 + i * 1.234567890123, z: -9876.5432109876 + i * 1.987654321098,
    altitudeFt: 1000.123456789 + i * 3.141592653589, iasKnots: 120.123456789 + i * 0.0123456789,
    gForce: i === 1000 ? 50.123456789 : 1.000000001, pitchDeg: 2.123456789,
    rollDeg: -1.987654321, headingDeg: 180.123456789 }));
  const sim = { flightRecorder: { active: true, elapsed: 854, interval: 0.2,
    metadata: { aircraft: 'B738', airport: 'incheon', scenario: 'approach' }, samples,
    peaks: { gForce: samples[1000] }, touchdowns: [], glocIncidents: 0 } };
  for (const budgetBytes of [FLIGHT_LOG_BUDGET_BYTES, 20000]) {
    const log = buildFlightLog(sim, { budgetBytes });
    assert.ok(new TextEncoder().encode(JSON.stringify(log)).length <= budgetBytes, `${budgetBytes} B budget`);
    const peak = log.samples.find(sample => sample.timeSec === samples[1000].timeSec);
    assert.equal(peak?.gForce, 50.123456789, `${budgetBytes} B keeps the peak sample`);
    assert.equal(log.samples.at(-1).timeSec, samples.at(-1).timeSec, `${budgetBytes} B keeps the final sample`);
  }
});

test('report payload carries category, severity, expectations and reproduction steps', () => {
  const draft = createFeedbackReport({ message: ' 50g on landing ', category: 'collision',
    severity: 'blocker', expected: ' soft touchdown ', steps: ' F16 valley ring 2 ' });
  assert.equal(draft.properties.feedback_message, '50g on landing');
  assert.equal(draft.properties.feedback_category, 'collision');
  assert.equal(draft.properties.feedback_severity, 'blocker');
  assert.equal(draft.properties.feedback_expected, 'soft touchdown');
  assert.equal(draft.properties.feedback_steps, 'F16 valley ring 2');
  assert.equal(draft.properties.fullReport, undefined);
  assert.equal(draft.properties.screenshot, undefined);
});

test('gatherFeedbackFullReport builds flight3d.sortie.v1 from held debrief and live recorder', () => {
  const heldSim = {
    flightRecorder: { active: false },
    debriefReport: {
      version: 2,
      reason: 'landed',
      durationSec: 42,
      metadata: { aircraft: 'B738', airport: 'incheon', scenario: 'approach' },
      samples: [{ timeSec: 0, altitudeFt: 500 }, { timeSec: 42, altitudeFt: 20 }],
      touchdowns: [{ timeSec: 40, sinkRateFpm: -120, contactG: 1.2 }],
    },
  };
  const heldFull = gatherFeedbackFullReport(heldSim);
  assert.equal(heldFull.kind, 'flight3d.sortie.v1');
  assert.equal(heldFull.report.reason, 'landed');
  assert.equal(heldFull.report.samples.length, 2);

  const liveSim = {
    flightRecorder: {
      active: true,
      elapsed: 12.5,
      metadata: { aircraft: 'F16', airport: 'coastal', scenario: 'free' },
      samples: [{ timeSec: 0 }, { timeSec: 12.5 }],
      peaks: { gForce: { timeSec: 5, gForce: 4.2 } },
      touchdowns: [],
      glocIncidents: 0,
    },
  };
  const liveFull = gatherFeedbackFullReport(liveSim);
  assert.equal(liveFull.kind, 'flight3d.sortie.v1');
  assert.equal(liveFull.report.source, 'live-sortie');
  assert.equal(liveFull.report.durationSec, 12.5);
  assert.equal(gatherFeedbackFullReport({}), null);

  // Large 18,000-sample sortie is decimated iteratively until it fits the budget
  const largeSamples = Array.from({ length: 18000 }, (_, i) => ({
    timeSec: i * 0.2, x: i * 1.1, z: -i * 1.3, altitudeFt: 1000 + i,
    iasKnots: 250, gForce: i === 5000 ? 9.5 : 1.0, pitchDeg: 1.5, rollDeg: 0, headingDeg: 90,
  }));
  const largeSim = {
    flightRecorder: {
      active: true,
      elapsed: 3600,
      metadata: { aircraft: 'F16', airport: 'incheon', scenario: 'free' },
      samples: largeSamples,
      peaks: { gForce: largeSamples[5000] },
      touchdowns: [],
      glocIncidents: 0,
    },
  };
  const bounded = gatherFeedbackFullReport(largeSim, { budgetBytes: 40_000 });
  assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).length <= 40_000);
  assert.equal(bounded.report.samplesDecimatedForBudget, true);
  assert.ok(bounded.report.samples.some(entry => entry.gForce === 9.5), 'peak-G sample kept');
  assert.equal(bounded.report.samples.at(-1).timeSec, largeSamples.at(-1).timeSec, 'final sample kept');
});

test('createFeedbackReport attaches fullReport and screenshot only when provided', () => {
  const fullReport = { kind: 'flight3d.sortie.v1', report: { reason: 'landed' }, track: null };
  const screenshot = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const withBoth = createFeedbackReport({
    message: 'wing visual glitch',
    fullReport,
    screenshot,
  });
  assert.deepEqual(withBoth.properties.fullReport, fullReport);
  assert.equal(withBoth.properties.screenshot, screenshot);

  const invalidShot = createFeedbackReport({
    message: 'invalid shot',
    screenshot: 'not-a-data-uri',
  });
  assert.equal(invalidShot.properties.screenshot, undefined);
});
