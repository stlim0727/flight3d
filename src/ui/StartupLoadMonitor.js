import {
  createStartupTraceState, addResourceEntry, noteReady, noteMilestone, noteFirstVisible,
  noteSelection, shouldEmitTrace, buildStartupTraceReport, SETTLE_MS, HARD_DEADLINE_MS,
} from '../core/startupTrace.js';
import { longTaskSummary } from '../core/inputLatency.js';
import { getPostHogConfig, initAnalytics, trackStartupTrace } from '../analytics/posthog.js';

/**
 * Browser adapter for startup load tracing. Installs `resource` and LCP observers on import,
 * stamps `ready` from the same `booting` class flip the CDP harness watches
 * (scripts/verify-startup-performance.mjs), and emits one PostHog event once the settle window
 * passes so late-arriving cockpit assets are counted.
 *
 * Environment facts (device, GPU class, navigation entries) are attached here rather than in
 * the pure core, which stays free of `performance`/`navigator` so Node tests can drive every
 * aggregation with literal entries.
 */

let singleton = null;

export function installStartupLoadMonitor(inputLatency = null, g = globalThis) {
  if (singleton) return singleton;
  if (!g.performance || !g.document?.body) return null;
  const Observer = g.PerformanceObserver;
  if (typeof Observer !== 'function' || typeof g.MutationObserver !== 'function') return null;
  if (isTelemetryDisabled(g)) return null;

  const now = () => g.performance.now();
  const state = createStartupTraceState({ clock: now, ownOrigin: pageOrigin(g) });
  const supported = Observer.supportedEntryTypes || [];
  const cleanups = [];

  /** 'buffered' replayed history, 'live' only future entries, false unsupported. */
  const observe = (type, onEntry) => {
    if (!supported.includes(type)) return false;
    const attach = withBuffered => {
      try {
        const po = new Observer(list => { for (const e of list.getEntries()) onEntry(e); });
        po.observe({ type, buffered: withBuffered });
        return po;
      } catch {
        return null;
      }
    };
    let po = attach(true);
    if (po) {
      cleanups.push(() => po.disconnect());
      return 'buffered';
    }
    // Older Safari/Firefox reject `buffered` outright; keep the tail and record the gap.
    po = attach(false);
    if (!po) return false;
    cleanups.push(() => po.disconnect());
    return 'live';
  };

  const resourceMode = observe('resource', e => addResourceEntry(state, e));
  state.capability.resource = resourceMode !== false;
  state.capability.resourceBuffered = resourceMode === 'buffered';

  if (observe('largest-contentful-paint', e => noteMilestone(state, 'largestContentfulPaint', e.startTime)) !== false) {
    state.capability.lcp = true;
  }

  const emit = ({ forced = false } = {}) => {
    if (state.emitted) return;
    // The one-shot and deadline policy lives in the tested core; a forced send (page hide)
    // overrides only the settle wait, never the already-emitted guard.
    if (!forced && !shouldEmitTrace(state, now())) return;
    state.emitted = true;
    if (!getPostHogConfig().enabled) return;
    collectSnapshot(g, state);
    const core = inputLatency?.state;
    const report = buildStartupTraceReport(state, {
      marks: core?.marks || {},
      longTasks: core ? longTaskSummary(core, -Infinity, state.ready ?? Infinity) : null,
      nowMs: now(),
    });
    report.device = readDevice(g);
    report.gpu = readGpuClass(g);
    initAnalytics().then(() => trackStartupTrace(report)).catch(() => {});
  };

  // Overlay lifting: stamp ready, then arm the settle timer exactly once.
  const body = g.document.body;
  const settleTimer = { id: null };
  const arm = () => {
    if (settleTimer.id !== null || state.emitted) return;
    settleTimer.id = setTimeout(() => emit(), Math.max(0, state.ready + SETTLE_MS - now()));
  };
  const bootWatcher = new g.MutationObserver(() => {
    if (body.classList.contains('booting')) return;
    noteReady(state, now(), 'booting-class');
    arm();
  });
  bootWatcher.observe(body, { attributes: true, attributeFilter: ['class'] });
  cleanups.push(() => bootWatcher.disconnect());
  // A monitor installed after the overlay already lifted still needs a ready anchor.
  if (!body.classList.contains('booting')) {
    noteReady(state, now(), 'booting-class');
    arm();
  }

  const onVisibility = () => {
    if (g.document.visibilityState === 'visible') {
      noteFirstVisible(state, now());
      if (state.ready !== null) arm();
    }
  };
  g.document.addEventListener('visibilitychange', onVisibility, { passive: true });
  cleanups.push(() => g.document.removeEventListener('visibilitychange', onVisibility));
  onVisibility();

  const onPageHide = () => emit({ forced: true });
  g.addEventListener?.('pagehide', onPageHide);
  cleanups.push(() => g.removeEventListener?.('pagehide', onPageHide));

  // The only emit path for a boot whose overlay never lifts; shouldEmitTrace converts this into
  // readySource 'timeout' rather than letting the adapter invent its own reason.
  const deadline = setTimeout(() => emit(), HARD_DEADLINE_MS);
  cleanups.push(() => clearTimeout(deadline));

  const monitor = {
    state,
    noteStage(value) {
      // Only the boot pass is traced; applyPendingScene reuses the same stage values later.
      if (state.ready === null && Number.isFinite(value)) inputLatency?.mark(`stage:${value}`);
    },
    noteSelection(selection) { noteSelection(state, selection); },
    noteFailed() {
      if (state.ready === null) state.readySource = 'failed';
      emit({ forced: true });
    },
    report: () => {
      const core = inputLatency?.state;
      return buildStartupTraceReport(state, {
        marks: core?.marks || {},
        longTasks: core ? longTaskSummary(core, -Infinity, state.ready ?? Infinity) : null,
        nowMs: now(),
      });
    },
    emit,
    dispose() {
      if (settleTimer.id !== null) clearTimeout(settleTimer.id);
      cleanups.forEach(fn => fn());
      cleanups.length = 0;
      if (singleton === monitor) singleton = null;
    },
  };
  singleton = monitor;
  return monitor;
}

/** URL-only check: reading localStorage here would be a synchronous storage hit on the boot path. */
function isTelemetryDisabled(g) {
  try {
    if (g.__POSTHOG_DISABLED__ === true) return true;
    return new URLSearchParams(g.location?.search || '').get('telemetry') === '0';
  } catch {
    return false;
  }
}

function pageOrigin(g) {
  const origin = g.location?.origin || '';
  return origin.startsWith('http') ? `${origin}/` : '';
}

/**
 * Single sweep over the persisted buffers at emit. `buffered: true` already replayed what this
 * observer missed, but a browser that rejected it yields only the tail, so re-reading recovers
 * the prefix. Dedupe on (name, startTime) makes the overlap harmless. Paint and navigation
 * entries persist in the buffer; LCP does not, hence its observer.
 */
function collectSnapshot(g, state) {
  for (const e of g.performance.getEntriesByType?.('resource') || []) addResourceEntry(state, e);

  const nav = g.performance.getEntriesByType?.('navigation')?.[0];
  if (nav) {
    state.capability.navigation = true;
    noteMilestone(state, 'fetchStart', nav.fetchStart);
    noteMilestone(state, 'responseStart', nav.responseStart);
    noteMilestone(state, 'domContentLoaded', nav.domContentLoadedEventEnd);
    noteMilestone(state, 'loadEventEnd', nav.loadEventEnd);
  }
  const paint = g.performance.getEntriesByType?.('paint') || [];
  if (paint.length) state.capability.paint = true;
  for (const e of paint) {
    if (e.name === 'first-paint') noteMilestone(state, 'firstPaint', e.startTime);
    else if (e.name === 'first-contentful-paint') noteMilestone(state, 'firstContentfulPaint', e.startTime);
  }
}

function readDevice(g) {
  const nav = g.navigator || {};
  const conn = nav.connection || {};
  return {
    effectiveType: conn.effectiveType ?? null,
    downlink: Number.isFinite(conn.downlink) ? conn.downlink : null,
    rtt: Number.isFinite(conn.rtt) ? conn.rtt : null,
    saveData: Boolean(conn.saveData),
    deviceMemory: nav.deviceMemory ?? null,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    dpr: g.devicePixelRatio ?? null,
    viewportW: g.innerWidth ?? null,
    viewportH: g.innerHeight ?? null,
  };
}

/**
 * Bucketed instead of shipping the raw UNMASKED_RENDERER_WEBGL string, to keep the property
 * low-cardinality and let insights exclude software-rendered CI traffic from real-user
 * percentiles. Reads the app's existing context, so no GL context is created for telemetry.
 */
function readGpuClass(g) {
  try {
    const context = g.sim?.renderer?.getContext?.();
    if (!context) return { softwareGpu: null, gpuClass: null };
    const extension = context.getExtension('WEBGL_debug_renderer_info');
    if (!extension) return { softwareGpu: null, gpuClass: null };
    const raw = String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL) || '');
    if (!raw) return { softwareGpu: null, gpuClass: null };
    const lower = raw.toLowerCase();
    return {
      softwareGpu: /swiftshader|llvmpipe|software|basic render|mesa d3d/i.test(lower),
      gpuClass: /nvidia|geforce/.test(lower) ? 'nvidia'
        : /amd|radeon/.test(lower) ? 'amd'
          : /intel|uhd|iris/.test(lower) ? 'intel'
            : /apple/.test(lower) ? 'apple'
              : /adreno|mali|powervr|tegra/.test(lower) ? 'mobile'
                : 'other',
    };
  } catch {
    return { softwareGpu: null, gpuClass: null };
  }
}
