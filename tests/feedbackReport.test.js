import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackReport, deliverFeedbackReport, gatherFeedbackDiagnostics } from '../src/analytics/feedbackReport.js';
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
  for (const response of [new Error('net::ERR_BLOCKED_BY_CLIENT'),
    { ok: false, status: 429 }, { ok: true, type: 'opaque' },
    ...['', '<html>ok</html>', '0', '{}', '{"status":0}', 'true'].map(text => ({ ok: true, text: async () => text }))]) {
    await assert.rejects(deliverFeedbackReport(report(), options(async () => {
      if (response instanceof Error) throw response;
      return response;
    })), /수신을 확인하지 못했습니다/);
  }
});

test('times out even if fetch never settles, aborts it, and reuses id on explicit retry', async () => {
  const draft = report(); let signal;
  await assert.rejects(deliverFeedbackReport(draft, { ...options(async (_, request) => {
    signal = request.signal;
    return new Promise(() => {});
  }), timeoutMs: 5 }), /수신을 확인하지 못했습니다/);
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
