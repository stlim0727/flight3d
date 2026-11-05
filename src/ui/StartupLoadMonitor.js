import {
  createStartupTraceState, addResourceEntry, noteReady, noteMilestone, noteFirstVisible,
  noteSelection, noteDocumentTransfer, shouldEmitTrace, shouldEmitPartialTrace,
  buildStartupTraceReport, SETTLE_MS, HARD_DEADLINE_MS, PARTIAL_MIN_MS,
} from '../core/startupTrace.js';
import { longTaskSummary } from '../core/inputLatency.js';
import { getPostHogConfig, initAnalytics, trackStartupTrace } from '../analytics/posthog.js';

/**
 * Browser adapter for startup load tracing. Installs `resource` and LCP observers on import,
 * stamps `ready` from the same `booting` class flip the CDP harness watches
 * (scripts/verify-startup-performance.mjs), and emits one PostHog event once the settle window
 * passes so late-arriving cockpit assets are counted.
 *
 * A visitor who leaves before that settle window still has to be counted, otherwise the field
 * percentiles only describe people who stayed: a forced flush on tab hide or page hide reports
 * what the buffered observer holds at that moment, tagged `outcome:'never-ready'`. It is allowed
 * once and does not spend the final emit, so partial and final rows for one boot join on `bootId`.
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
  const state = createStartupTraceState({ clock: now, ownOrigin: pageOrigin(g), bootId: newBootId(g) });
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

  const emit = ({ forced = false, reason = 'settle' } = {}) => {
    if (state.emitted) return false;
    // The one-shot and deadline policy lives in the tested core; a forced send (tab hidden,
    // page hidden, startup failure) overrides only the settle wait, never the already-emitted guard.
    let partial = false;
    if (forced) {
      // A failure is terminal, so it takes the final emit like any completed boot.
      if (state.ready === null && state.readySource !== 'failed') {
        if (!shouldEmitPartialTrace(state, now())) return false;
        partial = true;
      }
    } else if (!shouldEmitTrace(state, now())) {
      return false;
    }
    if (!partial) state.emitted = true;
    if (!getPostHogConfig().enabled) return true;
    collectSnapshot(g, state);
    const core = inputLatency?.state;
    const report = buildStartupTraceReport(state, {
      marks: core?.marks || {},
      longTasks: core ? longTaskSummary(core, -Infinity, state.ready ?? Infinity) : null,
      nowMs: now(),
      flushReason: reason,
    });
    report.device = readDevice(g);
    report.gpu = readGpuClass(g);
    initAnalytics().then(() => trackStartupTrace(report)).catch(() => {});
    return true;
  };

  // Overlay lifting: stamp ready, then arm the settle timer.
  // A browser timer can wake a fraction of a millisecond before the deadline it was handed, and
  // every flush policy here refuses that. These waits have no later event to lean on — a settled
  // load fires nothing else, a hidden tab is killed — so a refused wake re-arms for the time the
  // clock says is left. `WAKE_RETRY_LIMIT` bounds it against a clock that never advances.
  const WAKE_RETRY_LIMIT = 3;
  const body = g.document.body;
  const settleTimer = { id: null, attempts: 0 };
  const arm = () => {
    if (settleTimer.id !== null || state.emitted || settleTimer.attempts >= WAKE_RETRY_LIMIT) return;
    const remaining = state.ready + SETTLE_MS - now();
    if (!Number.isFinite(remaining)) return;
    settleTimer.id = setTimeout(() => {
      settleTimer.id = null;
      settleTimer.attempts += 1;
      if (emit()) return;
      arm();
    }, Math.max(0, remaining));
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

  const hiddenRetry = { id: null, attempts: 0 };
  const armHiddenRetry = () => {
    const remaining = PARTIAL_MIN_MS - now();
    if (remaining <= 0 || hiddenRetry.id !== null || hiddenRetry.attempts >= WAKE_RETRY_LIMIT) return;
    hiddenRetry.id = setTimeout(() => {
      hiddenRetry.id = null;
      hiddenRetry.attempts += 1;
      // Revealed in the meantime: the visible load has its own settle and deadline flushes, and a
      // `hidden` row here would mislabel the reason.
      if (g.document.visibilityState === 'visible') return;
      if (emit({ forced: true, reason: 'hidden' })) return;
      armHiddenRetry();
    }, remaining);
  };
  const onVisibility = () => {
    if (g.document.visibilityState === 'visible') {
      noteFirstVisible(state, now());
      if (state.ready !== null) arm();
      return;
    }
    // A backgrounded mobile tab is usually killed without ever firing `pagehide`, so this is the
    // only flush many loads get.
    if (emit({ forced: true, reason: 'hidden' })) return;
    // Refused only because the load is younger than the collection floor, and a hidden tab has no
    // later event to lean on: retry when the floor is reached.
    armHiddenRetry();
  };
  cleanups.push(() => clearTimeout(hiddenRetry.id));
  g.document.addEventListener('visibilitychange', onVisibility, { passive: true });
  cleanups.push(() => g.document.removeEventListener('visibilitychange', onVisibility));
  onVisibility();

  const onPageHide = () => emit({ forced: true, reason: 'pagehide' });
  g.addEventListener?.('pagehide', onPageHide);
  cleanups.push(() => g.removeEventListener?.('pagehide', onPageHide));

  // The only emit path for a boot whose overlay never lifts; shouldEmitTrace converts this into
  // readySource 'timeout' rather than letting the adapter invent its own reason.
  const deadlineWait = { id: null, attempts: 0 };
  const armDeadline = () => {
    const remaining = HARD_DEADLINE_MS - now();
    // Past the deadline the one shot it got was refused for a reason the settle timer owns, so
    // re-arming here would only spin.
    if (remaining <= 0 || deadlineWait.id !== null || deadlineWait.attempts >= WAKE_RETRY_LIMIT) return;
    deadlineWait.id = setTimeout(() => {
      deadlineWait.id = null;
      deadlineWait.attempts += 1;
      if (emit({ reason: 'deadline' })) return;
      armDeadline();
    }, remaining);
  };
  armDeadline();
  cleanups.push(() => clearTimeout(deadlineWait.id));

  // Warm the SDK before any of the flushes above can fire: the trace is queued until it
  // resolves, and an import started during a page hide usually does not get the chance.
  warmAnalytics(g, cleanups);

  const monitor = {
    state,
    noteStage(value) {
      // Only the boot pass is traced; applyPendingScene reuses the same stage values later.
      if (state.ready === null && Number.isFinite(value)) inputLatency?.mark(`stage:${value}`);
    },
    noteSelection(selection) { noteSelection(state, selection); },
    noteFailed() {
      if (state.ready === null) state.readySource = 'failed';
      emit({ forced: true, reason: 'failed' });
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
 * Per-load join key. PostHog's own `$window_id` survives reloads inside one tab, so it cannot pair
 * a partial trace with the final one for the same boot.
 */
function newBootId(g) {
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `boot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Start the SDK import while the boot is still running rather than at flush time. The trace is
 * queued until `posthog.init` resolves, but an import begun during a page hide rarely finishes,
 * which is where the pre-ready loads used to disappear. Scheduled on the host's own idle timer
 * so it cannot compete with the first assets, and skipped entirely where no timer is offered
 * (Node fixtures, harnesses without a window).
 */
function warmAnalytics(g, cleanups) {
  if (!getPostHogConfig().enabled) return;
  const run = () => { initAnalytics().catch(() => {}); };
  if (typeof g.requestIdleCallback === 'function') {
    const handle = g.requestIdleCallback(run, { timeout: 2000 });
    cleanups.push(() => g.cancelIdleCallback?.(handle));
  } else if (typeof g.setTimeout === 'function') {
    const timer = g.setTimeout(run, 0);
    cleanups.push(() => g.clearTimeout?.(timer));
  }
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
    noteDocumentTransfer(state, nav.transferSize);
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
