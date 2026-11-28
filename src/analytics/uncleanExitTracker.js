/**
 * Detects foreground browser/tab crashes (OOM kills, GPU/renderer crashes)
 * that terminate the process before window.onerror or pagehide can fire.
 *
 * Persists a lightweight session-health record in localStorage on key state
 * transitions (quality change, flight start, visibility change) plus a 5 s
 * heartbeat. On the next launch, if the previous session was actively visible
 * (`hidden === false`) and never recorded a clean exit (`cleanExit === false`),
 * it emits a diagnostic report so PostHog receives the crash context.
 */

export const SESSION_HEALTH_KEY = 'flight3d.sessionHealth.v1';

const DEFAULT_HEARTBEAT_MS = 5000;

function makeSessionId(nowMs) {
  return `sess_${Math.random().toString(36).slice(2, 10)}_${nowMs.toString(36)}`;
}

function readJsHeapMB(perf) {
  const mem = perf?.memory;
  if (!mem || !Number.isFinite(mem.usedJSHeapSize)) {
    return { jsHeapUsedMB: null, jsHeapLimitMB: null };
  }
  const toMB = bytes => Math.round(bytes / (1024 * 1024));
  return {
    jsHeapUsedMB: toMB(mem.usedJSHeapSize),
    jsHeapLimitMB: Number.isFinite(mem.jsHeapSizeLimit) ? toMB(mem.jsHeapSizeLimit) : null,
  };
}

function readPreviousRecord(storage, key) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeRecord(storage, key, record) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function buildUncleanExitReport(previous, nowMs) {
  const startedAtMs = Number.isFinite(previous.startedAtMs) ? previous.startedAtMs : null;
  const lastHeartbeatMs = Number.isFinite(previous.lastHeartbeatMs) ? previous.lastHeartbeatMs : startedAtMs;
  const sessionDurationSec = startedAtMs != null && lastHeartbeatMs != null
    ? Math.max(0, Number(((lastHeartbeatMs - startedAtMs) / 1000).toFixed(1)))
    : null;
  const sinceLastHeartbeatSec = lastHeartbeatMs != null
    ? Math.max(0, Number(((nowMs - lastHeartbeatMs) / 1000).toFixed(1)))
    : null;

  return {
    previousSessionId: previous.sessionId ?? null,
    previousBuildCommit: previous.buildCommit ?? null,
    previousAirport: previous.airport ?? null,
    previousAircraft: previous.aircraft ?? null,
    previousScenario: previous.scenario ?? null,
    previousRenderQuality: previous.renderQuality ?? null,
    previousGameFlowState: previous.gameFlowState ?? null,
    wasStartingFlight: Boolean(previous.startingFlight),
    lastStage: previous.lastStage ?? null,
    lastFps: Number.isFinite(previous.fps) ? previous.fps : null,
    jsHeapUsedMB: Number.isFinite(previous.jsHeapUsedMB) ? previous.jsHeapUsedMB : null,
    jsHeapLimitMB: Number.isFinite(previous.jsHeapLimitMB) ? previous.jsHeapLimitMB : null,
    deviceMemoryGB: Number.isFinite(previous.deviceMemoryGB) ? previous.deviceMemoryGB : null,
    viewport: previous.viewport ?? null,
    dpr: Number.isFinite(previous.dpr) ? previous.dpr : null,
    isTouchDevice: Boolean(previous.isTouchDevice),
    sessionDurationSec,
    sinceLastHeartbeatSec,
  };
}

export function startUncleanExitTracker({
  sim = null,
  storage = typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null,
  windowObj = typeof globalThis.window !== 'undefined' ? globalThis.window : null,
  documentObj = typeof globalThis.document !== 'undefined' ? globalThis.document : null,
  navigatorObj = typeof globalThis.navigator !== 'undefined' ? globalThis.navigator : null,
  performanceObj = typeof globalThis.performance !== 'undefined' ? globalThis.performance : null,
  onUncleanExit = null,
  onBrowserReport = null,
  storageKey = SESSION_HEALTH_KEY,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
  now = () => Date.now(),
} = {}) {
  const startedAtMs = now();
  const sessionId = makeSessionId(startedAtMs);
  let lastStage = 'boot';
  let disposed = false;

  const previous = readPreviousRecord(storage, storageKey);
  let detectedReport = null;
  if (previous && previous.cleanExit === false && previous.hidden === false) {
    detectedReport = buildUncleanExitReport(previous, startedAtMs);
    try {
      onUncleanExit?.(detectedReport);
    } catch { /* Never let telemetry break startup. */ }
  }

  const snapshot = ({ cleanExit = false, hidden = documentObj?.visibilityState === 'hidden' } = {}) => {
    const heap = readJsHeapMB(performanceObj);
    const fps = Number.isFinite(sim?.lastFrameDelta) && sim.lastFrameDelta > 0
      ? Math.round(1 / sim.lastFrameDelta) : null;
    const width = windowObj?.innerWidth;
    const height = windowObj?.innerHeight;
    return {
      sessionId,
      startedAtMs,
      lastHeartbeatMs: now(),
      cleanExit: Boolean(cleanExit),
      hidden: Boolean(hidden),
      buildCommit: typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__.revision : 'dev',
      airport: sim?.activeAirport ?? sim?.lobby?.airport ?? null,
      aircraft: sim?.currentAircraftId ?? sim?.lobby?.aircraft ?? null,
      scenario: sim?.lastPresetType ?? sim?.lobby?.preset ?? null,
      renderQuality: sim?.renderQuality ?? null,
      gameFlowState: sim?.gameFlow?.state ?? null,
      startingFlight: Boolean(sim?.startingFlight),
      lastStage,
      fps,
      jsHeapUsedMB: heap.jsHeapUsedMB,
      jsHeapLimitMB: heap.jsHeapLimitMB,
      deviceMemoryGB: Number.isFinite(navigatorObj?.deviceMemory) ? navigatorObj.deviceMemory : null,
      viewport: Number.isFinite(width) && Number.isFinite(height) ? `${width}x${height}` : null,
      dpr: Number.isFinite(windowObj?.devicePixelRatio) ? Number(windowObj.devicePixelRatio.toFixed(2)) : null,
      isTouchDevice: Boolean(
        (windowObj && 'ontouchstart' in windowObj)
        || (navigatorObj?.maxTouchPoints ?? 0) > 0,
      ),
    };
  };

  const flush = (overrides = {}) => {
    if (disposed) return false;
    return writeRecord(storage, storageKey, snapshot(overrides));
  };

  const markStage = (stage) => {
    if (typeof stage === 'string' && stage) lastStage = stage;
    return flush();
  };

  flush();

  const onVisibilityChange = () => {
    flush({ hidden: documentObj?.visibilityState === 'hidden' });
  };
  const onCleanExit = () => {
    flush({ cleanExit: true });
  };

  documentObj?.addEventListener?.('visibilitychange', onVisibilityChange);
  windowObj?.addEventListener?.('pagehide', onCleanExit);
  windowObj?.addEventListener?.('beforeunload', onCleanExit);

  let timer = null;
  if (heartbeatIntervalMs > 0 && typeof globalThis.setInterval === 'function') {
    timer = globalThis.setInterval(() => {
      if (documentObj?.visibilityState === 'hidden') return;
      flush({ hidden: false });
    }, heartbeatIntervalMs);
    timer?.unref?.();
  }

  let observer = null;
  const ReportingObserverCtor = windowObj?.ReportingObserver;
  if (typeof ReportingObserverCtor === 'function' && typeof onBrowserReport === 'function') {
    try {
      observer = new ReportingObserverCtor(reports => {
        for (const report of reports) {
          try {
            onBrowserReport({
              reportType: report.type ?? null,
              reportId: report.body?.id ?? null,
              reportReason: report.body?.reason ?? null,
              reportMessage: report.body?.message ?? null,
              lastStage,
              renderQuality: sim?.renderQuality ?? null,
              airport: sim?.activeAirport ?? null,
              scenario: sim?.lastPresetType ?? sim?.lobby?.preset ?? null,
            });
          } catch { /* Ignore observer callback failures. */ }
        }
      }, { types: ['crash', 'intervention'], buffered: true });
      observer.observe();
    } catch {
      observer = null;
    }
  }

  return {
    sessionId,
    detectedReport,
    markStage,
    flush,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer != null) globalThis.clearInterval(timer);
      documentObj?.removeEventListener?.('visibilitychange', onVisibilityChange);
      windowObj?.removeEventListener?.('pagehide', onCleanExit);
      windowObj?.removeEventListener?.('beforeunload', onCleanExit);
      try { observer?.disconnect?.(); } catch { /* Ignore. */ }
    },
  };
}
