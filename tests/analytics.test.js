import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POSTHOG_HOST,
  DEFAULT_POSTHOG_KEY,
  PENDING_EVENT_CAP,
  getPostHogConfig,
  gatherFlightContext,
  initAnalytics,
  trackEvent,
  captureException,
  trackFlightStart,
  trackFlightEnd,
  trackFlightCrash,
  trackPilotModeChange,
  trackStartupTrace,
  sendUserFeedback,
  _resetAnalyticsForTesting,
} from '../src/analytics/posthog.js';

// Events captured without an SDK are held in a module queue and released the moment one appears,
// so a test that queued events would otherwise hand them to the next test's mock.
afterEach(() => {
  _resetAnalyticsForTesting(null);
});

test('getPostHogConfig defaults to EU host and provides configured EU key', () => {
  assert.equal(DEFAULT_POSTHOG_HOST, 'https://eu.i.posthog.com');
  assert.equal(DEFAULT_POSTHOG_KEY, 'phc_ussf2qgryzxghWApkvG2kcpXarbF4nNGTNEnwCBy8VKj');

  const config = getPostHogConfig();
  assert.equal(typeof config.apiKey, 'string');
  assert.equal(config.host, 'https://eu.i.posthog.com');
  // Safe in Node environments without window
  assert.equal(config.enabled, false);
});

test('getPostHogConfig in browser uses default EU credentials or query overrides', () => {
  const originalWindow = globalThis.window;
  try {
    globalThis.window = {
      location: { search: '' },
      localStorage: { getItem: () => null },
    };

    const browserConfig = getPostHogConfig();
    assert.equal(browserConfig.apiKey, DEFAULT_POSTHOG_KEY);
    assert.equal(browserConfig.host, 'https://eu.i.posthog.com');
    assert.equal(browserConfig.enabled, true);

    // Test URL query param override
    globalThis.window.location.search = '?posthogKey=custom_key&posthogHost=https://custom.posthog.com';
    const overrideConfig = getPostHogConfig();
    assert.equal(overrideConfig.apiKey, 'custom_key');
    assert.equal(overrideConfig.host, 'https://custom.posthog.com');
    assert.equal(overrideConfig.enabled, true);

    // Test opt-out via query param
    globalThis.window.location.search = '?telemetry=0';
    const disabledConfig = getPostHogConfig();
    assert.equal(disabledConfig.enabled, false);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('gatherFlightContext extracts simulator state safely', () => {
  assert.deepEqual(gatherFlightContext(null), {});

  const mockSim = {
    currentAircraftId: 'F16',
    activeAirport: 'lukla',
    lastPresetType: 'valley',
    isCrashed: false,
    crashResult: null,
    lastFrameDelta: 1 / 60,
    flightRecorder: { elapsedSeconds: 42.5 },
    lobby: { pilotMode: 'human' },
  };

  const context = gatherFlightContext(mockSim);
  assert.equal(context.aircraft, 'F16');
  assert.equal(context.airport, 'lukla');
  assert.equal(context.scenario, 'valley');
  assert.equal(context.isCrashed, false);
  assert.equal(context.pilotMode, 'human');
  assert.equal(context.fps, 60);
  assert.equal(context.flightDurationSec, 42.5);
});

test('analytics calls safely no-op when uninitialized without throwing', () => {
  _resetAnalyticsForTesting(null);

  assert.doesNotThrow(() => {
    trackEvent('test_event', { foo: 'bar' });
    captureException(new Error('test exception'));
    trackFlightStart({ airport: 'coastal', aircraft: 'B738', scenario: 'runway', pilotMode: 'human' });
    trackFlightEnd({ airport: 'coastal', aircraft: 'B738', scenario: 'runway', reason: 'landed', durationSeconds: 60 });
    trackFlightCrash({ airport: 'coastal', aircraft: 'B738', scenario: 'runway', crashResult: { type: 'WATER', name: 'Water' } });
    trackPilotModeChange('ai', 'valley-slalom-v1');
    sendUserFeedback({ message: 'Great game!' });
  });
});

test('trackEvent forwards formatted payload to PostHog instance when initialized', async () => {
  const captured = [];
  const mockPostHog = {
    capture: (eventName, properties, options) => {
      captured.push({ eventName, properties, options });
    },
    flush: () => {},
  };

  _resetAnalyticsForTesting(mockPostHog);

  trackFlightStart({
    airport: 'lukla',
    aircraft: 'F16',
    scenario: 'valley-slalom-v1',
    pilotMode: 'human',
    timeOfDay: 'sunrise',
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].eventName, 'flight_started');
  assert.equal(captured[0].properties.airport, 'lukla');
  assert.equal(captured[0].properties.aircraft, 'F16');
  assert.equal(captured[0].properties.scenario, 'valley-slalom-v1');
  assert.equal(captured[0].properties.pilotMode, 'human');
  assert.equal(captured[0].properties.timeOfDay, 'sunrise');
  assert.equal(typeof captured[0].properties.clientTimeMs, 'number');
  assert.ok(!('timestamp' in captured[0].properties),
    'a custom timestamp property would shadow PostHog event timestamps in HogQL');

  trackFlightCrash({
    airport: 'lukla',
    aircraft: 'F16',
    scenario: 'valley-slalom-v1',
    crashResult: { type: 'TERRAIN', name: '지형 충돌' },
    speedKnots: 450,
  });

  assert.equal(captured.length, 2);
  assert.equal(captured[1].eventName, 'flight_crashed');
  assert.equal(captured[1].properties.crashType, 'TERRAIN');
  assert.equal(captured[1].properties.crashName, '지형 충돌');
  assert.equal(captured[1].properties.speedKnots, 450);

  trackFlightEnd({
    airport: 'lukla',
    aircraft: 'F16',
    scenario: 'valley-slalom-v1',
    reason: 'completed',
    durationSeconds: 38.4,
    score: 16420,
    gatesCleared: 6,
  });

  assert.equal(captured.length, 3);
  assert.equal(captured[2].eventName, 'flight_ended');
  assert.equal(captured[2].properties.endReason, 'completed');
  assert.equal(captured[2].properties.durationSeconds, 38.4);
  assert.equal(captured[2].properties.score, 16420);
  assert.equal(captured[2].properties.gatesCleared, 6);

  trackPilotModeChange('ai', 'valley-slalom-v1');
  assert.equal(captured.length, 4);
  assert.equal(captured[3].eventName, 'pilot_mode_selected');
  assert.equal(captured[3].properties.pilotMode, 'ai');

  await sendUserFeedback({
    message: 'HUD text overlapped',
    contact: 'pilot@example.com',
    category: 'bug',
    includeContext: false,
  });

  assert.equal(captured.length, 6);
  assert.equal(captured[4].eventName, 'user_feedback_submitted');
  assert.equal(captured[4].properties.feedback_message, 'HUD text overlapped');
  assert.equal(captured[4].properties.feedback_contact, 'pilot@example.com');
  assert.equal(captured[4].options?.send_instantly, true);

  assert.equal(captured[5].eventName, '$feedback');
  assert.equal(captured[5].properties.$feedback_text, 'HUD text overlapped');
  assert.equal(captured[5].options?.send_instantly, true);

  captureException(new Error('Sample WebGL error'), { extra: 'debug' });
  assert.equal(captured.length, 7);
  assert.equal(captured[6].eventName, '$exception');
  assert.equal(captured[6].properties.$exception_message, 'Sample WebGL error');
  assert.equal(captured[6].properties.extra, 'debug');
  assert.equal(captured[6].options?.send_instantly, true);

  _resetAnalyticsForTesting(null);
});

test('trackStartupTrace sends one aggregated load event and stays a no-op when unconfigured', async () => {
  const captured = [];
  _resetAnalyticsForTesting({
    capture: (eventName, properties, options) => captured.push({ eventName, properties, options }),
    flush: () => {},
  });

  const report = {
    version: 1,
    readyMs: 8421,
    readySource: 'booting-class',
    cockpitStageMs: 4890,
    bytesBeforeReady: 8912340,
    startupAircraft: 'B738',
    startupAirport: 'coastal',
    backgroundBoot: false,
    longTasks: { count: 14, totalMs: 2600, maxMs: 780 },
    classes: { glb: { count: 2, totalMs: 1450 } },
    slowest: [{ name: 'models/b737-cockpit-medium.glb', duration: 1450 }],
  };
  trackStartupTrace(report);

  assert.equal(captured.length, 1);
  assert.equal(captured[0].eventName, 'startup_trace');
  assert.equal(captured[0].properties.readyMs, 8421);
  assert.equal(captured[0].properties.cockpitStageMs, 4890);
  assert.equal(captured[0].properties.startupAircraft, 'B738');
  assert.deepEqual(captured[0].properties.classes, { glb: { count: 2, totalMs: 1450 } });
  assert.deepEqual(captured[0].properties.slowest, report.slowest);
  assert.equal(captured[0].properties.slowestAsset, 'models/b737-cockpit-medium.glb');
  assert.equal(captured[0].properties.slowestAssetDurationMs, 1450);
  assert.equal(captured[0].properties.glbTotalLatencyMs, 1450);
  assert.equal(captured[0].options.send_instantly, true);

  // Detail groups ride as JSON properties, so PostHog can drill into them.
  assert.equal(captured[0].properties.longTasks.count, 14);

  trackStartupTrace(null);
  assert.equal(captured.length, 1, 'an absent report sends nothing');

  _resetAnalyticsForTesting(null);
  trackStartupTrace(report);
  assert.equal(captured.length, 1, 'silent once telemetry is off');
});

test('trackStartupTrace keeps the blocking pair together and nulls absent classes', () => {
  const captured = [];
  _resetAnalyticsForTesting({
    capture: (eventName, properties, options) => captured.push({ eventName, properties, options }),
    flush: () => {},
  });

  // buildStartupTraceReport always fills every class bucket; a zero-count bucket must
  // surface as null, not 0. A cached blocking asset can round to duration 0, which
  // must stay paired with its own name instead of falling through to slowest[0].
  trackStartupTrace({
    blocking: { name: 'models/aircraft.glb', cls: 'glb', duration: 0 },
    classes: {
      glb: { count: 1, totalMs: 0, maxMs: 0 },
      texture: { count: 0, totalMs: 0, maxMs: 0 },
    },
    slowest: [{ name: 'terrain/hdr-0.hdr', cls: 'hdr', duration: 512 }],
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].properties.slowestAsset, 'models/aircraft.glb');
  assert.equal(captured[0].properties.slowestAssetDurationMs, 0);
  assert.equal(captured[0].properties.glbMaxLatencyMs, 0);
  assert.equal(captured[0].properties.binMaxLatencyMs, null, 'absent bucket is null, not 0');
  assert.equal(captured[0].properties.textureMaxLatencyMs, null);
  assert.equal(captured[0].properties.audioMaxLatencyMs, null);

  _resetAnalyticsForTesting(null);
});

test('events captured before the SDK resolves are queued and released on init', async () => {
  const captured = [];
  const mock = {
    capture: (eventName, properties, options) => captured.push({ eventName, properties, options }),
    flush: () => {},
  };

  // This is the page-hide case: the trace exists while the dynamic import has not finished, and
  // there is no opportunity to wait for it.
  _resetAnalyticsForTesting(null);
  trackStartupTrace({ readyMs: 900, classes: { glb: { count: 1, totalMs: 120, maxMs: 120 } } });
  trackFlightStart({ airport: 'coastal', aircraft: 'B738', scenario: 'runway', pilotMode: 'human' });
  assert.equal(captured.length, 0, 'nothing can be sent before an instance exists');

  _resetAnalyticsForTesting(mock);
  assert.equal(captured.length, 2, 'installing the SDK releases everything queued');
  assert.equal(captured[0].eventName, 'startup_trace');
  assert.equal(captured[0].options.send_instantly, true, 'the instant flag survives the queue');
  assert.equal(captured[1].eventName, 'flight_started');

  trackEvent('later_event', { ok: true });
  assert.equal(captured.length, 3, 'after init the path is direct');
});

test('the pre-init queue is bounded and drops the oldest events', () => {
  const captured = [];
  _resetAnalyticsForTesting(null);
  for (let i = 0; i < PENDING_EVENT_CAP + 5; i += 1) trackEvent('queued', { seq: i });
  assert.equal(captured.length, 0);

  _resetAnalyticsForTesting({
    capture: (eventName, properties) => captured.push({ eventName, properties }),
    flush: () => {},
  });
  assert.equal(captured.length, PENDING_EVENT_CAP, 'a load that never initializes holds nothing more');
  assert.equal(captured[0].properties.seq, 5, 'the oldest events are the ones given up on');
  assert.equal(captured.at(-1).properties.seq, PENDING_EVENT_CAP + 4);
});

test('an unconfigured load clears the queue instead of holding events forever', async () => {
  const captured = [];
  _resetAnalyticsForTesting(null);
  trackEvent('orphan', { seq: 1 });
  // No window in Node, which is how an opted-out visitor behaves: initialization resolves as
  // disabled rather than pending.
  await initAnalytics();

  _resetAnalyticsForTesting({
    capture: (eventName, properties) => captured.push({ eventName, properties }),
    flush: () => {},
  });
  assert.equal(captured.length, 0, 'events from a disabled load never resurface');
});

test('startup_trace reports the boot only, never the live simulator state it flushed from', () => {
  const captured = [];
  _resetAnalyticsForTesting({
    capture: (eventName, properties, options) => captured.push({ eventName, properties, options }),
    flush: () => {},
  });

  const report = {
    version: 2,
    bootId: '01a1a49c-test-boot',
    outcome: 'ready',
    flushReason: 'settle',
    readyMs: 21775,
    lobbyReadyMs: 1398,
    lobbyReadySource: 'lobby-ready',
    cacheWarmRatio: 0.75,
    classes: {},
    slowest: [],
  };
  trackStartupTrace(report);

  // PostHog field data paired a B738/coastal boot with aircraft F16/generated-valley because the
  // flight context was merged in at flush time. The payload must be the report plus derived
  // scalars and nothing else.
  const expected = [
    ...Object.keys(report),
    'slowestAsset', 'slowestAssetDurationMs',
    'glbMaxLatencyMs', 'glbTotalLatencyMs', 'binMaxLatencyMs',
    'textureMaxLatencyMs', 'audioMaxLatencyMs', 'clientTimeMs',
  ].sort();
  assert.deepEqual(Object.keys(captured[0].properties).sort(), expected);
  assert.equal(captured[0].properties.bootId, '01a1a49c-test-boot');
  assert.equal(captured[0].properties.outcome, 'ready');
  assert.equal(captured[0].properties.lobbyReadyMs, 1398);
});

test('resource_loaded telemetry was removed with its uncalled producer', async () => {
  const fs = await import('node:fs');
  const posthogSrc = fs.readFileSync(new URL('../src/analytics/posthog.js', import.meta.url), 'utf8');
  const mainSrc = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(posthogSrc, /trackResourceLatency|resource_loaded/,
    'PostHog held zero resource_loaded events: the per-asset timings live in startup_trace totals');
  assert.doesNotMatch(mainSrc, /trackResourceLatency/);
});

test('posthog.js configures API defaults 2026-08-30 and enables performance tracking', async () => {
  const fs = await import('node:fs');
  const posthogSrc = fs.readFileSync(new URL('../src/analytics/posthog.js', import.meta.url), 'utf8');
  assert.match(posthogSrc, /defaults:\s*['"]2026-08-30['"]/);
  assert.match(posthogSrc, /capture_performance:\s*\{/);
  assert.match(posthogSrc, /network_timing:\s*true/);
  assert.match(posthogSrc, /web_vitals:\s*true/);
});

test('the startup monitor is the importer of trackStartupTrace', async () => {
  const fs = await import('node:fs');
  const monitorSrc = fs.readFileSync(new URL('../src/ui/StartupLoadMonitor.js', import.meta.url), 'utf8');
  assert.match(monitorSrc, /import\s*\{[^}]*trackStartupTrace[^}]*\}\s*from\s*['"]\.\.\/analytics\/posthog\.js['"]/);
});

test('src/main.js imports all analytics methods attached to this.analytics', async () => {
  const fs = await import('node:fs');
  const mainSrc = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

  // Verify analytics methods in constructor are properly imported
  const importMatch = mainSrc.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/analytics\/posthog\.js['"]/);
  assert.ok(importMatch, 'Should import from ./analytics/posthog.js');

  const imported = importMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  const required = [
    'initAnalytics',
    'trackFlightStart',
    'trackFlightEnd',
    'trackFlightCrash',
    'captureException',
  ];

  for (const name of required) {
    assert.ok(imported.includes(name), `src/main.js should import ${name} from posthog.js`);
  }
});
