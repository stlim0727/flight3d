import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_HEALTH_KEY, startUncleanExitTracker } from '../src/analytics/uncleanExitTracker.js';
import { _resetAnalyticsForTesting, trackUncleanExit, trackBrowserReport } from '../src/analytics/posthog.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
  };
}

function createEmitter() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
}

test('unclean foreground exit is detected and reported on next launch', () => {
  const storage = createMemoryStorage();
  const win1 = { ...createEmitter(), innerWidth: 384, innerHeight: 646, devicePixelRatio: 2.625, ontouchstart: null };
  const doc1 = { ...createEmitter(), visibilityState: 'visible' };
  const sim1 = {
    activeAirport: 'incheon',
    currentAircraftId: 'C172',
    lastPresetType: 'cruise',
    renderQuality: 'high',
    gameFlow: { state: 'flight' },
    startingFlight: true,
    lastFrameDelta: 1 / 45,
  };
  let clock = 1_700_000_000_000;
  const reports1 = [];
  const tracker1 = startUncleanExitTracker({
    sim: sim1,
    storage,
    windowObj: win1,
    documentObj: doc1,
    navigatorObj: { deviceMemory: 4, maxTouchPoints: 5 },
    performanceObj: { memory: { usedJSHeapSize: 320 * 1024 * 1024, jsHeapSizeLimit: 1024 * 1024 * 1024 } },
    onUncleanExit: r => reports1.push(r),
    heartbeatIntervalMs: 0,
    now: () => clock,
  });
  assert.equal(reports1.length, 0);

  clock += 12_000;
  tracker1.markStage('flight-start:incheon:cruise:high');
  // Simulate sudden OOM kill: no pagehide, no beforeunload, no visibilitychange
  tracker1.dispose();

  // Next launch 30 seconds later
  clock += 30_000;
  const reports2 = [];
  const win2 = { ...createEmitter(), innerWidth: 384, innerHeight: 646, devicePixelRatio: 2.625 };
  const doc2 = { ...createEmitter(), visibilityState: 'visible' };
  const tracker2 = startUncleanExitTracker({
    sim: { activeAirport: 'incheon', renderQuality: 'balanced' },
    storage,
    windowObj: win2,
    documentObj: doc2,
    onUncleanExit: r => reports2.push(r),
    heartbeatIntervalMs: 0,
    now: () => clock,
  });
  tracker2.dispose();

  assert.equal(reports2.length, 1);
  const report = reports2[0];
  assert.equal(report.previousAirport, 'incheon');
  assert.equal(report.previousAircraft, 'C172');
  assert.equal(report.previousScenario, 'cruise');
  assert.equal(report.previousRenderQuality, 'high');
  assert.equal(report.wasStartingFlight, true);
  assert.equal(report.lastStage, 'flight-start:incheon:cruise:high');
  assert.equal(report.lastFps, 45);
  assert.equal(report.jsHeapUsedMB, 320);
  assert.equal(report.jsHeapLimitMB, 1024);
  assert.equal(report.deviceMemoryGB, 4);
  assert.equal(report.viewport, '384x646');
  assert.equal(report.isTouchDevice, true);
  assert.equal(report.sessionDurationSec, 12);
  assert.equal(report.sinceLastHeartbeatSec, 30);
});

test('clean pagehide exit and background tab kills do not emit false-positive crash reports', () => {
  for (const mode of ['pagehide', 'hidden']) {
    const storage = createMemoryStorage();
    const win = createEmitter();
    const doc = { ...createEmitter(), visibilityState: 'visible' };
    const tracker = startUncleanExitTracker({
      sim: { activeAirport: 'incheon', renderQuality: 'high' },
      storage,
      windowObj: win,
      documentObj: doc,
      heartbeatIntervalMs: 0,
    });
    if (mode === 'pagehide') {
      win.emit('pagehide');
    } else {
      doc.visibilityState = 'hidden';
      doc.emit('visibilitychange');
    }
    tracker.dispose();

    const reports = [];
    const next = startUncleanExitTracker({
      sim: { activeAirport: 'incheon', renderQuality: 'high' },
      storage,
      windowObj: createEmitter(),
      documentObj: { ...createEmitter(), visibilityState: 'visible' },
      onUncleanExit: r => reports.push(r),
      heartbeatIntervalMs: 0,
    });
    next.dispose();
    assert.equal(reports.length, 0, `${mode} should not trigger unclean exit`);
  }
});

test('ReportingObserver crash and intervention reports are forwarded', () => {
  const storage = createMemoryStorage();
  const received = [];
  let observerCallback = null;
  class MockReportingObserver {
    constructor(cb) { observerCallback = cb; }
    observe() {}
    disconnect() {}
  }
  const win = { ...createEmitter(), ReportingObserver: MockReportingObserver };
  const doc = { ...createEmitter(), visibilityState: 'visible' };
  const tracker = startUncleanExitTracker({
    sim: { activeAirport: 'incheon', lastPresetType: 'cruise', renderQuality: 'high' },
    storage,
    windowObj: win,
    documentObj: doc,
    onBrowserReport: r => received.push(r),
    heartbeatIntervalMs: 0,
  });
  tracker.markStage('quality-change:high');
  observerCallback([{ type: 'crash', body: { id: 'oom', reason: 'oom', message: 'Renderer OOM' } }]);
  tracker.dispose();

  assert.equal(received.length, 1);
  assert.equal(received[0].reportType, 'crash');
  assert.equal(received[0].reportReason, 'oom');
  assert.equal(received[0].lastStage, 'quality-change:high');
  assert.equal(received[0].renderQuality, 'high');
  assert.ok(storage.getItem(SESSION_HEALTH_KEY));
});

test('trackUncleanExit and trackBrowserReport queue before SDK init and flush with send_instantly', () => {
  _resetAnalyticsForTesting(null);
  trackUncleanExit({ previousRenderQuality: 'high', previousAirport: 'incheon' });
  trackBrowserReport({ reportType: 'crash', reportReason: 'oom' });

  const captured = [];
  _resetAnalyticsForTesting({
    capture(eventName, payload, options) {
      captured.push({ eventName, payload, options });
    },
  });
  try {
    assert.equal(captured.length, 2);
    assert.equal(captured[0].eventName, 'browser_unclean_exit');
    assert.equal(captured[0].payload.previousRenderQuality, 'high');
    assert.equal(captured[0].options.send_instantly, true);
    assert.equal(captured[1].eventName, 'browser_intervention');
    assert.equal(captured[1].payload.reportReason, 'oom');
    assert.equal(captured[1].options.send_instantly, true);
  } finally {
    _resetAnalyticsForTesting(null);
  }
});
