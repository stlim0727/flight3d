import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installStartupLoadMonitor } from '../src/ui/StartupLoadMonitor.js';
import { PARTIAL_MIN_MS } from '../src/core/startupTrace.js';
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

function fixture({ search = '', resourceEntries = [], paintEntries = [], navEntry = null, clockLag = 0 } = {}) {
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
    // times the adapter happened to call now(). `lagMs` models the one thing a scripted clock
    // cannot express: wall time that keeps running while the test waits on a real timer.
    currentTime: 0,
    lagMs: clockLag,
    lag(elapsedMs) { g.currentTime = Math.max(g.currentTime, elapsedMs - g.lagMs); },
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
  assert.equal(captured[0].p.outcome, 'failed');
  assert.equal(captured[0].p.flushReason, 'failed');
});

test('a tab hidden before ready still reports the boot, tagged never-ready', async () => {
  _resetAnalyticsForTesting(null);
  const captured = [];
  _resetAnalyticsForTesting({
    capture: (eventName, properties) => captured.push({ eventName, properties }),
    flush: () => {},
  });

  const entries = [
    resource('https://flight3d.test/models/b737-cockpit-medium.glb', 3310, 1450, 3_827_468),
    resource('https://flight3d.test/lighting/cockpit-medium.bin', 3312, 620, 2_706_720),
  ];
  const g = fixture({ resourceEntries: entries });
  withWindow(g, () => {
    const m = install(null, g);
    FakeObserver.instances.filter(o => o.type === 'resource').forEach(o => o.push(entries));
    g.currentTime = 6000;
    g.document.visibilityState = 'hidden';
    g.dispatch('visibilitychange');
    return m;
  });

  await new Promise(resolve => setImmediate(resolve));
  // A backgrounded mobile tab is usually killed without ever firing pagehide, and this is what
  // the pre-ready bounces used to produce instead: nothing.
  assert.equal(captured.length, 1);
  const props = captured[0].properties;
  assert.equal(props.outcome, 'never-ready');
  assert.equal(props.flushReason, 'hidden');
  assert.equal(props.readyMs, null);
  assert.equal(props.totals.requests, 2, 'the buffered replay still carries every boot asset');
  assert.equal(props.classes.glb.count, 1);
  assert.equal(typeof props.bootId, 'string');
  assert.ok(props.bootId.length > 0, 'a per-load id so partial and final rows can be joined');
});

test('a pre-ready page hide flushes with its own reason', async () => {
  _resetAnalyticsForTesting(null);
  const captured = [];
  _resetAnalyticsForTesting({
    capture: (eventName, properties) => captured.push({ eventName, properties }),
    flush: () => {},
  });
  const g = fixture({ resourceEntries: [resource('https://flight3d.test/models/a.glb', 100, 400)] });
  // Everything the adapter reacts to has to happen with the fake window installed: the emit path
  // re-reads telemetry config, exactly as it does in a browser.
  withWindow(g, () => {
    install(null, g);
    g.currentTime = 4000;
    g.dispatch('pagehide');
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured.length, 1);
  assert.equal(captured[0].properties.flushReason, 'pagehide');
  assert.equal(captured[0].properties.outcome, 'never-ready');
});

test('a tab hidden after ready reports the completed boot, not a partial one', async () => {
  _resetAnalyticsForTesting(null);
  const captured = [];
  _resetAnalyticsForTesting({
    capture: (eventName, properties) => captured.push({ eventName, properties }),
    flush: () => {},
  });
  const g = fixture({ resourceEntries: [resource('https://flight3d.test/models/a.glb', 100, 400)] });
  let monitor;
  withWindow(g, () => {
    monitor = install(null, g);
    g.currentTime = 6000;
    g.document.body.classList.remove('booting');
    FakeMutation.instances.forEach(o => o.fire());
    g.document.visibilityState = 'hidden';
    g.dispatch('visibilitychange');
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured.length, 1);
  const props = captured[0].properties;
  // The hide branch must not fall into shouldEmitPartialTrace once the boot is done: that would
  // quietly downgrade a finished load to never-ready and spend the only row it was going to send.
  assert.equal(props.outcome, 'ready');
  assert.equal(props.flushReason, 'hidden');
  assert.equal(props.readyMs, 6000);
  assert.equal(props.postReadyMs, 0);

  withWindow(g, () => {
    g.dispatch('pagehide');
    monitor.emit();
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured.length, 1, 'the hidden flush was final, so nothing follows it');
});

test('a partial flush does not spend the final report for the same boot', async () => {
  _resetAnalyticsForTesting(null);
  const captured = [];
  _resetAnalyticsForTesting({
    capture: (eventName, properties) => captured.push({ eventName, properties }),
    flush: () => {},
  });
  const g = fixture({ resourceEntries: [resource('https://flight3d.test/models/a.glb', 100, 400)] });

  // The capture lands on a microtask (initAnalytics().then(...)), so each stage is its own
  // withWindow block with a drain between; asserting inside the block would see the emit's start.
  let mutations;
  const monitor = withWindow(g, () => {
    const m = install(null, g);
    mutations = [...FakeMutation.instances];
    g.currentTime = 6000;
    g.document.visibilityState = 'hidden';
    g.dispatch('visibilitychange');
    return m;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured.length, 1, 'the visitor came back instead of bouncing');

  withWindow(g, () => {
    g.document.visibilityState = 'visible';
    g.currentTime = 9000;
    g.document.body.classList.remove('booting');
    mutations.forEach(o => o.fire());
    g.currentTime = 9000 + 10_000;
    monitor.emit();
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(captured.length, 2);
  assert.equal(captured[0].properties.outcome, 'never-ready');
  assert.equal(captured[1].properties.outcome, 'ready');
  assert.equal(captured[1].properties.flushReason, 'settle');
  assert.equal(captured[1].properties.readyMs, 9000);
  assert.equal(captured[1].properties.bootId, captured[0].properties.bootId, 'one boot, two rows');

  // Only one final report, however many exits follow it.
  withWindow(g, () => {
    g.dispatch('pagehide');
    monitor.emit({ forced: true, reason: 'hidden' });
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured.length, 2);
});

test('a hidden tab that is too young to report retries at the floor', async () => {
  _resetAnalyticsForTesting(null);
  const captured = [];
  _resetAnalyticsForTesting({
    capture: (eventName, properties) => captured.push({ eventName, properties }),
    flush: () => {},
  });
  const g = fixture({ resourceEntries: [resource('https://flight3d.test/models/a.glb', 100, 400)] });
  // This one cannot use withWindow: the retry fires from a timer, so the fake window has to stay
  // installed across the wait exactly as the real one does in a browser.
  const previous = globalThis.window;
  globalThis.window = g;
  let monitor;
  try {
    monitor = withWindow(g, () => {
      const m = install(null, g);
      g.currentTime = PARTIAL_MIN_MS - 400;
      g.document.visibilityState = 'hidden';
      g.dispatch('visibilitychange');
      assert.equal(captured.length, 0, 'below the floor the row would describe a page with no timing');
      return m;
    });
    // The retry runs on the host's timer, which the fake clock cannot fast-forward; wait it out.
    g.currentTime = PARTIAL_MIN_MS;
    await new Promise(resolve => setTimeout(resolve, 600));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(captured.length, 1, 'a killed background tab never fires pagehide again');
    assert.equal(captured[0].properties.flushReason, 'hidden');
    assert.equal(captured[0].properties.outcome, 'never-ready');
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
  monitor.dispose();
});

test('a floor retry that wakes a hair early re-arms instead of losing the load', async () => {
  _resetAnalyticsForTesting(null);
  const captured = [];
  _resetAnalyticsForTesting({
    capture: (eventName, properties) => captured.push({ eventName, properties }),
    flush: () => {},
  });
  const g = fixture({
    resourceEntries: [resource('https://flight3d.test/models/a.glb', 100, 400)],
    clockLag: 3,
  });
  const previous = globalThis.window;
  globalThis.window = g;
  let monitor;
  try {
    monitor = withWindow(g, () => {
      const m = install(null, g);
      g.document.visibilityState = 'hidden';
      g.dispatch('visibilitychange');
      assert.equal(captured.length, 0);
      return m;
    });
    // A browser timer can wake before the deadline it was handed, so the first retry lands a few
    // milliseconds short of the floor. A one-shot retry loses the load right there: a backgrounded
    // tab fires no further event, and this is exactly the mobile bounce row the floor exists to keep.
    const started = Date.now();
    const ticker = setInterval(() => g.lag(Date.now() - started), 1);
    const deadline = Date.now() + 4000;
    try {
      while (captured.length === 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally {
      clearInterval(ticker);
    }
    assert.ok(captured.length > 0, 'the retry re-armed and crossed the floor');
    assert.equal(captured.length, 1, 'the retry loop reports once, not once per wake');
    assert.equal(captured[0].properties.flushReason, 'hidden');
    assert.equal(captured[0].properties.outcome, 'never-ready');
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
  monitor.dispose();
});

test('a load that installs while hidden does not flush at zero milliseconds', async () => {
  _resetAnalyticsForTesting(null);
  const captured = [];
  _resetAnalyticsForTesting({
    capture: (eventName, properties) => captured.push({ eventName, properties }),
    flush: () => {},
  });
  const g = fixture();
  g.document.visibilityState = 'hidden';

  const monitor = withWindow(g, () => {
    const m = install(null, g);
    assert.equal(captured.length, 0, 'backgroundBoot has nothing collected yet');
    g.currentTime = 7000;
    g.dispatch('visibilitychange');
    return m;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured.length, 1, 'once there is a resource list, it is worth sending');
  assert.equal(captured[0].properties.outcome, 'never-ready');
  monitor.dispose();
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
