/**
 * Pure aggregation core for input-latency telemetry: no DOM, no performance globals.
 * The browser adapter (src/ui/InputLatencyMonitor.js) feeds real entries in; Node tests
 * can drive every computation directly with fake timings.
 */

const EVENT_CAPACITY = 128;
const LONGTASK_CAPACITY = 64;
const SELECTION_CAPACITY = 32;
export const THRESHOLDS = {
  eventMs: 100,        // an input taking longer than this is a breach
  longTaskTotalMs: 5000, // per summary window
  summaryIntervalMs: 10_000,
  bootSummaryAtMs: 3_000,
  quietCooldownMs: 60_000,
};

export function createInputLatencyState({
  eventCapacity = EVENT_CAPACITY,
  longtaskCapacity = LONGTASK_CAPACITY,
  selectionCapacity = SELECTION_CAPACITY,
  clock = () => 0,
} = {}) {
  return {
    clock,
    eventCapacity,
    longtaskCapacity,
    selectionCapacity,
    marks: {},
    samples: [],
    dropped: 0,
    longTasks: [],
    selections: [],
    capability: { eventTiming: false, eventTimingBuffered: false, longTask: false, fallback: false },
    bootSummaryEmitted: false,
    lastSummaryAtMs: null,
  };
}

export function addBootMark(state, name, atMs = state.clock()) {
  if (!Number.isFinite(atMs)) return null;
  state.marks[name] = Math.round(atMs);
  return state.marks[name];
}

function push(ring, item, capacity, state) {
  ring.push(item);
  if (ring.length > capacity) {
    ring.shift();
    state.dropped++;
  }
}

/**
 * Convert an Event Timing entry (or equivalent fake) into a latency sample.
 * processingStart === 0 means no handler ran: processing latency is null, never negative.
 * Returns null for unusable entries (non-finite times, negative durations).
 */
export function addEventSample(state, entry) {
  if (!entry || !Number.isFinite(entry.startTime) || !Number.isFinite(entry.duration)) return null;
  if (entry.duration < 0) return null;
  const hasHandler = Number.isFinite(entry.processingStart) && entry.processingStart > 0;
  const sample = {
    type: String(entry.name || entry.type || 'unknown'),
    startMs: Math.round(entry.startTime),
    processingMs: hasHandler
      ? Math.max(0, Math.round(entry.processingStart - entry.startTime))
      : null,
    handlerMs: hasHandler && Number.isFinite(entry.processingEnd)
      ? Math.max(0, Math.round(entry.processingEnd - entry.processingStart))
      : null,
    totalMs: Math.round(entry.duration),
    source: 'event-timing',
  };
  push(state.samples, sample, state.eventCapacity, state);
  return sample;
}

/** Fallback sample for browsers without Event Timing: click -> next-paint gap. */
export function addFallbackSample(state, { type, clickedAtMs, paintedAtMs }) {
  if (!Number.isFinite(clickedAtMs) || !Number.isFinite(paintedAtMs)) return null;
  if (paintedAtMs < clickedAtMs) return null;
  const sample = {
    type: String(type || 'unknown'),
    startMs: Math.round(clickedAtMs),
    processingMs: null,
    handlerMs: null,
    totalMs: Math.round(paintedAtMs - clickedAtMs),
    source: 'fallback',
  };
  push(state.samples, sample, state.eventCapacity, state);
  return sample;
}

/** Remove a pending/last sample by start time — used when a paint gap is invalid (hidden tab). */
export function discardSample(state, startMs) {
  const i = state.samples.findIndex(s => s.startMs === Math.round(startMs));
  if (i < 0) return false;
  state.samples.splice(i, 1);
  return true;
}

export function addLongTask(state, { startTime, duration }) {
  if (!Number.isFinite(startTime) || !Number.isFinite(duration) || duration <= 0) return null;
  const entry = { startMs: Math.round(startTime), durationMs: Math.round(duration) };
  push(state.longTasks, entry, state.longtaskCapacity, state);
  return entry;
}

/** Pair a queued lobby selection with its applied moment; auto-completes the newest open one. */
export function recordSelection(state, phase, atMs = state.clock()) {
  if (!Number.isFinite(atMs)) return null;
  if (phase === 'start') {
    const last = state.selections.at(-1);
    if (last && last.appliedMs === null) return last; // drain already running; newer choices fold into it
    const entry = { queuedMs: Math.round(atMs), appliedMs: null, drainMs: null };
    state.selections.push(entry);
    if (state.selections.length > state.selectionCapacity) state.selections.shift();
    return entry;
  }
  if (phase === 'applied') {
    const last = state.selections.at(-1);
    if (!last || last.appliedMs !== null) return null;
    last.appliedMs = Math.round(atMs);
    last.drainMs = Math.max(0, last.appliedMs - last.queuedMs);
    return last;
  }
  return null;
}

function inWindow(items, fromMs, toMs, startOf) {
  return items.filter(item => {
    const s = startOf(item);
    return s >= fromMs && s <= toMs;
  });
}

function percentile(sorted, q) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
}

/** Aggregate input samples in [fromMs, toMs]: count, worst/mean, p95 of total latency,
 * and worst wait before any handler ran (main-thread blockage, independent of slow frames). */
export function windowSummary(state, fromMs, toMs) {
  const items = inWindow(state.samples, fromMs, toMs, s => s.startMs);
  if (!items.length) return { inputs: 0, worstMs: null, p95Ms: null, meanMs: null, worstProcessingMs: null };
  const totals = items.map(s => s.totalMs);
  const sorted = [...totals].sort((a, b) => a - b);
  const processings = items.map(s => s.processingMs ?? 0);
  return {
    inputs: items.length,
    worstMs: sorted.at(-1),
    p95Ms: percentile(sorted, 0.95),
    meanMs: Math.round(totals.reduce((a, b) => a + b, 0) / items.length),
    worstProcessingMs: Math.max(...processings),
  };
}

export function longTaskSummary(state, fromMs, toMs) {
  const items = inWindow(state.longTasks, fromMs, toMs, t => t.startMs);
  if (!items.length) return { count: 0, totalMs: 0, maxMs: 0 };
  return {
    count: items.length,
    totalMs: items.reduce((a, t) => a + t.durationMs, 0),
    maxMs: Math.max(...items.map(t => t.durationMs)),
  };
}

/** The user complaint this instrument answers: how long after page load was the first input,
 * and how slow was it. Anchored on `module-start` (≈navigation start) so clicks that arrive
 * before the first frame — squarely inside the boot window — are counted too. */
export function firstSecondsSummary(state, windowMs = 5000) {
  const baseMs = state.marks['module-start'] ?? state.marks['first-frame'] ?? null;
  if (baseMs === null) return { baseMs: null, inputs: 0, firstInputMs: null, firstInputLatencyMs: null, worstMs: null };
  const items = inWindow(state.samples, baseMs, baseMs + windowMs, s => s.startMs);
  const first = items[0];
  return {
    baseMs,
    windowMs,
    inputs: items.length,
    firstInputMs: first ? first.startMs - baseMs : null,
    firstInputLatencyMs: first ? first.totalMs : null,
    worstMs: items.length ? Math.max(...items.map(s => s.totalMs)) : null,
  };
}

export function bootTimeline(state) {
  const m = state.marks;
  const span = (a, b) => (Number.isFinite(m[a]) && Number.isFinite(m[b])) ? Math.max(0, m[b] - m[a]) : null;
  return {
    // `fly` fires inside the constructor, before the first frame paints.
    moduleStartToReadyMs: span('module-start', 'ready'),
    moduleStartToFirstFrameMs: span('module-start', 'first-frame'),
    moduleStartToFlyMs: span('module-start', 'fly'),
    flyToFirstFrameMs: span('fly', 'first-frame'),
  };
}

function breachedInWindow(state, fromMs, toMs) {
  return state.samples.some(s => s.startMs >= fromMs && (s.processingMs ?? 0) > THRESHOLDS.eventMs)
    || longTaskSummary(state, fromMs, toMs).totalMs > THRESHOLDS.longTaskTotalMs;
}

/**
 * Console-summary policy: one unconditional line at ~bootSummaryAtMs (the complaint window),
 * then a line whenever a breach (slow input or heavy long-task total) accumulated since the
 * previous summary, with at least quietCooldownMs between lines.
 */
export function shouldEmitSummary(state, nowMs) {
  if (!Number.isFinite(nowMs)) return false;
  if (!state.bootSummaryEmitted) {
    if (nowMs < THRESHOLDS.bootSummaryAtMs) return false;
    state.bootSummaryEmitted = true;
    state.lastSummaryAtMs = nowMs;
    return true;
  }
  if (nowMs - (state.lastSummaryAtMs ?? 0) < THRESHOLDS.quietCooldownMs) return false;
  if (!breachedInWindow(state, state.lastSummaryAtMs ?? 0, nowMs)) return false;
  state.lastSummaryAtMs = nowMs;
  return true;
}

export function buildReport(state, nowMs = state.clock()) {
  const latest = state.samples.at(-1);
  return {
    version: 1,
    generatedAtMs: Math.round(nowMs),
    capability: { ...state.capability },
    boot: { marks: { ...state.marks }, timeline: bootTimeline(state) },
    firstSeconds: firstSecondsSummary(state),
    windows: {
      last5s: windowSummary(state, nowMs - 5000, nowMs),
      last30s: windowSummary(state, nowMs - 30000, nowMs),
    },
    longTasks: {
      last5s: longTaskSummary(state, nowMs - 5000, nowMs),
      lifetime: longTaskSummary(state, -Infinity, nowMs),
    },
    events: { latest, samples: state.samples.slice(-50), capacity: state.eventCapacity, dropped: state.dropped },
    lobbySelections: state.selections.filter(s => s.appliedMs !== null).slice(-10),
  };
}

/** Compact live view for the diagnostics panel rows. */
export function snapshot(state, nowMs = state.clock()) {
  const latest = state.samples.at(-1) || null;
  const first = firstSecondsSummary(state);
  return {
    last: latest ? { type: latest.type, totalMs: latest.totalMs, processingMs: latest.processingMs, atMs: latest.startMs, source: latest.source } : null,
    worst30s: windowSummary(state, nowMs - 30000, nowMs),
    longTasks5s: longTaskSummary(state, nowMs - 5000, nowMs),
    boot: first,
    capability: { ...state.capability },
  };
}
