import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installStartupLoadMonitor } from '../src/ui/StartupLoadMonitor.js';
import { _resetAnalyticsForTesting, trackStartupTrace } from '../src/analytics/posthog.js';

/**
 * The adapter is the only part of this feature that touches real browser globals, so it is
 * driven here with fakes instead of a GPU browser. Timing policy itself is tested in
 * tests/startupTrace.test.js against the pure core; these cover wiring and the emit paths.
 */

// The monitor is a module singleton, so a mid-test assertion failure would otherwise hand the
// next test a stale, already-emitted instance instead of a fresh install.
let active = null;

const install = (latency, g) => {
  active = installStartupLoadMonitor(latency, g);
  return active;
};

afterEach(() => {
  active?.dispose();
  active = null;
  _resetAnalyticsForTesting(null);
});

class FakeObserver {
  constructor(callback) {
    this.callback = callback;
    this.type = null;
    this.disconnected = false;
    FakeObserver.instances.push(this);
  }
  observe(options) { this.type = options.type; }
  disconnect() { this.disconnected = true; }
  push(entries) { this.callback({ getEntries: () => entries }); }
}
FakeObserver.instances = [];
FakeObserver.supportedEntryTypes = ['resource', 'largest-contentful-paint'];

class FakeMutation {
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    FakeMutation.instances.push(this);
  }
  observe() {}
  disconnect() { this.disconnected = true; }
  fire() { this.callback(); }
}
FakeMutation.instances = [];

function fixture({ search = '', resourceEntries = [], paintEntries = [], navEntry = null } = {}) {
  const listeners = new Map();
  const body = {
    classList: {
      classes: new Set(['booting']),
      contains(name) { return this.classes.has(name); },
      remove(name) { this.classes.delete(name); },
    },
  };
  const g = {
    // Explicit clock: the test advances it, so expected mark values never depend on how many
    // times the adapter happened to call now().
    currentTime: 0,
    location: { search, origin: 'https://flight3d.test' },
    document: {
      body,
      visibilityState: 'visible',
      addEventListener: (type, fn) => { listeners.set(type, fn); },
      removeEventListener: type => { listeners.delete(type); },
    },
    performance: {
      get now() { return () => g.currentTime; },
      getEntriesByType: type => (type === 'resource' ? resourceEntries
        : type === 'paint' ? paintEntries
          : type === 'navigation' && navEntry ? [navEntry] : []),
    },
    PerformanceObserver: FakeObserver,
    MutationObserver: FakeMutation,
    navigator: { connection: { effectiveType: '4g', downlink: 10, rtt: 20 }, deviceMemory: 8, hardwareConcurrency: 12 },
    devicePixelRatio: 2,
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    removeEventListener: type => { listeners.delete(type); },
    dispatch(type) { listeners.get(type)?.(); },
    listeners,
  };
  return g;
}

function resource(name, startTime, duration, bytes = 1_000_000) {
  return {
    name,
    startTime,
    duration,
    responseEnd: startTime + duration,
    transferSize: bytes,
    encodedBodySize: bytes,
    decodedBodySize: bytes * 2,
  };
}

function withWindow(g, fn) {
  const previous = globalThis.window;
  globalThis.window = g;
  FakeObserver.instances = [];
  FakeMutation.instances = [];
  try {
    return fn();
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
}

test('install is a no-op without browser globals, so Node and headless harnesses never collect', () => {
  _resetAnalyticsForTesting(null);
  assert.equal(installStartupLoadMonitor(null, {}), null);
  assert.equal(installStartupLoadMonitor(null, { performance: {}, document: { body: {} } }), null);
});

test('install is skipped when telemetry is disabled by URL, before any observer is created', () => {
  _resetAnalyticsForTesting(null);
  const g = fixture({ search: '?telemetry=0' });
  withWindow(g, () => {
    assert.equal(installStartupLoadMonitor(null, g), null);
    assert.equal(FakeObserver.instances.length, 0);
    assert.equal(FakeMutation.instances.length, 0);
  });
});

test('the booting class flip stamps ready and stage marks land in the shared latency store', () => {
  _resetAnalyticsForTesting(null);
  const g = fixture();
  const latency = { state: { marks: {} }, mark(name) { this.state.marks[name] = g.currentTime; } };
  withWindow(g, () => {
    const monitor = install(latency, g);
    assert.ok(monitor, 'installs with browser globals present');
    assert.equal(monitor.state.ready, null);

    g.currentTime = 1500;
    monitor.noteStage(0);
    g.currentTime = 2500;
    monitor.noteStage(5);
    assert.deepEqual(latency.state.marks, { 'stage:0': 1500, 'stage:5': 2500 });

    g.currentTime = 3000;
    const body = g.document.body;
    body.classList.remove('booting');
    FakeMutation.instances.forEach(o => o.fire());
    assert.equal(monitor.state.ready, 3000);
    assert.equal(monitor.state.readySource, 'booting-class');

    // applyPendingScene reuses stage values after ready; those must not pollute the boot marks.
    monitor.noteStage(1);
    assert.equal(latency.state.marks['stage:1'], undefined);
  });
});

test('one event is sent, duplicates are suppressed, and the payload carries assets and device', async () => {
  _resetAnalyticsForTesting(null);
  const captured = [];
  _resetAnalyticsForTesting({
    capture: (eventName, properties, options) => captured.push({ eventName, properties, options }),
    flush: () => {},
  });

  const entries = [
    resource('https://flight3d.test/models/b737-cockpit-medium.glb', 3310, 1450, 3_827_468),
    resource('https://flight3d.test/lighting/cockpit-medium.bin', 3312, 620, 2_706_720),
  ];
  const g = fixture({
    resourceEntries: entries,
    paintEntries: [
      { name: 'first-paint', startTime: 480 },
      { name: 'first-contentful-paint', startTime: 520 },
    ],
    navEntry: { fetchStart: 3, responseStart: 214, domContentLoadedEventEnd: 512, loadEventEnd: 690 },
  });

  const monitor = withWindow(g, () => {
    const m = install(null, g);
    // The observer path and the emit sweep must not double-count.
    FakeObserver.instances.filter(o => o.type === 'resource').forEach(o => o.push(entries));
    m.noteSelection({ aircraft: 'B738', airport: 'coastal', scenario: 'runway' });
    g.currentTime = 8000;
    g.document.body.classList.remove('booting');
    FakeMutation.instances.forEach(o => o.fire());
    m.emit({ forced: true });
    return m;
  });

  await new Promise(resolve => setImmediate(resolve));

  assert.equal(captured.length, 1);
  assert.equal(captured[0].eventName, 'startup_trace');
  assert.equal(captured[0].options.send_instantly, true);

  const props = captured[0].properties;
  assert.equal(props.readyMs, 8000);
  assert.equal(props.readySource, 'booting-class');
  assert.equal(props.startupAircraft, 'B738');
  assert.equal(props.startupAirport, 'coastal');
  assert.equal(props.classes.glb.count, 1);
  assert.equal(props.classes.glb.transferBytes, 3_827_468);
  assert.equal(props.classes.bin.count, 1);
  assert.equal(props.classes.bin.transferBytes, 2_706_720);
  assert.equal(props.totals.requests, 2, 'observer push and emit sweep must not double-count');
  assert.equal(props.slowest[0].name, 'models/b737-cockpit-medium.glb');
  assert.equal(props.slowest[0].duration, 1450);
  assert.equal(props.navigation.firstContentfulPaintMs, 520);
  assert.equal(props.navigation.domContentLoadedMs, 512);
  assert.equal(props.capability.resourceBuffered, true);
  assert.equal(props.capability.paint, true);
  assert.equal(props.device.effectiveType, '4g');
  assert.equal(props.device.hardwareConcurrency, 12);
  assert.equal(props.gpu.gpuClass, null, 'no simulator context means no GPU claim');
  assert.equal(props.backgroundBoot, false);

  // A second emit (deadline timer, later pagehide) must never produce a second event.
  monitor.emit({ forced: true });
  monitor.emit();
  g.dispatch('pagehide');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured.length, 1);
});

test('a failed boot reports immediately with readySource failed', async () => {
  _resetAnalyticsForTesting(null);
  const captured = [];
  _resetAnalyticsForTesting({ capture: (e, p) => captured.push({ e, p }), flush: () => {} });
  const g = fixture();
  const monitor = withWindow(g, () => {
    const m = install(null, g);
    m.noteFailed();
    return m;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured.length, 1);
  assert.equal(captured[0].e, 'startup_trace');
  assert.equal(captured[0].p.readySource, 'failed');
});

test('dispose disconnects every observer so collection lifetime is bounded', () => {
  _resetAnalyticsForTesting(null);
  const g = fixture();
  const monitor = withWindow(g, () => install(null, g));
  const observers = [...FakeObserver.instances, ...FakeMutation.instances];
  assert.ok(observers.length >= 2);
  monitor.dispose();
  assert.ok(observers.every(o => o.disconnected), 'every observer disconnected');
  assert.equal(g.listeners.has('pagehide'), false, 'pagehide listener removed');
});

test('trackStartupTrace stays a silent no-op once analytics is torn down', () => {
  _resetAnalyticsForTesting(null);
  trackStartupTrace({ readyMs: 1 });
});
