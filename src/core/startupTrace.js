/**
 * Pure aggregation core for startup load tracing: no DOM, no performance globals.
 * The browser adapter (src/ui/StartupLoadMonitor.js) feeds real entry literals in; Node
 * tests drive every computation directly with fake timings.
 *
 * Answers a question byte sizes cannot: which asset classes and stages actually cost the
 * wall-clock time before the boot overlay lifts.
 */

export const TRACE_VERSION = 1;

export const RESOURCE_CAPACITY = 256;
export const TOP_N = 5;
export const SETTLE_MS = 10_000;
export const HARD_DEADLINE_MS = 180_000;

export const ASSET_CLASSES = [
  'glb', 'bin', 'hdr', 'texture', 'audio', 'decoder', 'module', 'json', 'style', 'other',
];

const EXT_CLASS = {
  glb: 'glb',
  bin: 'bin',
  hdr: 'hdr',
  jpg: 'texture', jpeg: 'texture', png: 'texture', webp: 'texture', avif: 'texture', ktx2: 'texture',
  wav: 'audio', mp3: 'audio', ogg: 'audio', m4a: 'audio',
  js: 'module', mjs: 'module', css: 'style',
  json: 'json', osm: 'json',
  // The vendored draco decoder ships as both .js and a Vite-hashed .wasm under assets/.
  wasm: 'decoder',
};

/** Path-suffix form used by scripts/verify-startup-performance.mjs, so field data and local report.json compare directly. */
export function shortenAssetName(name) {
  if (typeof name !== 'string' || !name) return null;
  if (name.startsWith('data:') || name.startsWith('blob:') || name.startsWith('filesystem:')) return null;
  const clean = name.split('#')[0].split('?')[0];
  const parts = clean.split('/');
  return parts.slice(-2).join('/');
}

function extension(name) {
  const base = name.split('#')[0].split('?')[0].split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** Draco lives under /draco/, and Vite hashes the wasm wrapper into assets/draco_*, so match both. */
export function classifyAsset(name) {
  if (typeof name !== 'string' || !name) return 'other';
  const path = name.split('#')[0].split('?')[0];
  const base = path.split('/').pop() || '';
  if (path.includes('/draco/') || base.startsWith('draco_')) return 'decoder';
  return EXT_CLASS[extension(path)] || 'other';
}

function emptyClassBucket() {
  return { count: 0, countBeforeReady: 0, transferBytes: 0, encodedBytes: 0, totalMs: 0, maxMs: 0 };
}

export function createStartupTraceState({
  clock = () => 0,
  ownOrigin = '',
  ignore = [],
  resourceCapacity = RESOURCE_CAPACITY,
  topN = TOP_N,
} = {}) {
  return {
    clock,
    ownOrigin,
    ignore,
    resourceCapacity,
    topN,
    entries: [],
    seen: new Set(),
    classes: {},
    totals: { requests: 0, requestsBeforeReady: 0, bytesBeforeReady: 0, transferBytes: 0, encodedBytes: 0, decodedBytes: 0 },
    milestones: {},
    selection: {},
    ready: null,
    readySource: null,
    firstVisibleMs: null,
    dropped: 0,
    opaqueDropped: 0,
    thirdPartyDropped: 0,
    capability: {
      resource: false,
      resourceBuffered: false,
      paint: false,
      lcp: false,
      navigation: false,
    },
    emitted: false,
  };
}

function number(value) {
  return Number.isFinite(value) ? value : 0;
}

/** True when sizing is unavailable, which is how a cross-origin entry without Timing-Allow-Origin looks. */
function isOpaque(entry) {
  return number(entry.transferSize) === 0
    && number(entry.encodedBodySize) === 0
    && number(entry.decodedBodySize) === 0;
}

function shortName(entry) {
  return shortenAssetName(entry.name) || 'other';
}

/**
 * Idempotent on (name, startTime) because the observer path and the emit-time snapshot both
 * feed it: buffered observers can hand the same entry twice across the fallback retry.
 * Returns false when the entry was ignored.
 */
export function addResourceEntry(state, entry) {
  if (!entry || !Number.isFinite(entry.startTime) || !Number.isFinite(entry.duration)) return false;
  const name = typeof entry.name === 'string' ? entry.name : '';
  if (state.ignore.some(pattern => name.includes(pattern))) {
    state.thirdPartyDropped++;
    return false;
  }
  if (state.ownOrigin && !name.startsWith(state.ownOrigin)) {
    state.thirdPartyDropped++;
    return false;
  }
  const key = `${name}|${Math.round(entry.startTime)}`;
  if (state.seen.has(key)) return false;
  state.seen.add(key);

  const asset = shortName(entry);
  const cls = classifyAsset(name);
  const beforeReady = state.ready !== null
    ? number(entry.responseEnd || entry.startTime + entry.duration) <= state.ready
    : true;

  const bucket = state.classes[cls] || (state.classes[cls] = emptyClassBucket());
  bucket.count++;
  bucket.totalMs += number(entry.duration);
  bucket.maxMs = Math.max(bucket.maxMs, number(entry.duration));

  state.totals.requests++;
  state.totals.decodedBytes += number(entry.decodedBodySize);

  if (isOpaque(entry)) {
    state.opaqueDropped++;
  } else {
    bucket.transferBytes += number(entry.transferSize);
    bucket.encodedBytes += number(entry.encodedBodySize);
    state.totals.transferBytes += number(entry.transferSize);
    state.totals.encodedBytes += number(entry.encodedBodySize);
    if (beforeReady) state.totals.bytesBeforeReady += number(entry.transferSize);
  }

  if (beforeReady) {
    bucket.countBeforeReady++;
    state.totals.requestsBeforeReady++;
  }

  state.entries.push({
    name: asset,
    cls,
    start: Math.round(entry.startTime),
    duration: Math.round(entry.duration),
    end: Math.round(number(entry.responseEnd) || entry.startTime + entry.duration),
    encodedBytes: number(entry.encodedBodySize),
    beforeReady,
  });
  if (state.entries.length > state.resourceCapacity) {
    state.entries.shift();
    state.dropped++;
  }
  return true;
}

/** First write wins: the booting-class observer is the authority, the timeout is only a backstop. */
export function noteReady(state, atMs, source = 'booting-class') {
  if (!Number.isFinite(atMs) || state.ready !== null) return false;
  state.ready = Math.round(atMs);
  state.readySource = source;
  return true;
}

export function noteMilestone(state, name, atMs) {
  if (!Number.isFinite(atMs)) return false;
  state.milestones[name] = Math.round(atMs);
  return true;
}

export function noteFirstVisible(state, atMs) {
  if (!Number.isFinite(atMs) || state.firstVisibleMs !== null) return false;
  state.firstVisibleMs = Math.round(atMs);
  return true;
}

export function noteSelection(state, { aircraft, airport, scenario } = {}) {
  state.selection = {
    startupAircraft: aircraft ?? null,
    startupAirport: airport ?? null,
    startupScenario: scenario ?? null,
  };
}

/**
 * One-shot: emit once the settle window after ready has passed (so late-arriving assets are
 * counted), or at the hard deadline if ready never came. Mirrors shouldEmitSummary's policy.
 */
export function shouldEmitTrace(state, nowMs) {
  if (state.emitted || !Number.isFinite(nowMs)) return false;
  if (state.ready !== null) {
    if (nowMs < state.ready + SETTLE_MS) return false;
    state.emitted = true;
    return true;
  }
  if (state.readySource === 'failed') {
    state.emitted = true;
    return true;
  }
  if (nowMs >= HARD_DEADLINE_MS) {
    state.readySource = 'timeout';
    state.emitted = true;
    return true;
  }
  return false;
}

export const BOOT_STAGES = [
  { value: 0, key: 'scene' },
  { value: 1, key: 'aircraft' },
  { value: 2, key: 'world' },
  { value: 3, key: 'controls' },
  { value: 4, key: 'preload' },
  { value: 5, key: 'cockpit' },
  { value: 6, key: 'ready' },
];

/** Duration of each stage: the gap until the next stage mark, or until `ready` for the last one. */
export function stageSpans(state, marks = {}) {
  const spans = {};
  const limit = state.ready;
  for (let i = 0; i < BOOT_STAGES.length; i++) {
    const stage = BOOT_STAGES[i];
    const next = BOOT_STAGES[i + 1];
    const from = marks[`stage:${stage.value}`];
    const to = next ? marks[`stage:${next.value}`] : limit;
    spans[stage.key] = (Number.isFinite(from) && Number.isFinite(to))
      ? Math.max(0, Math.round(to - from))
      : null;
  }
  return spans;
}

function rank(entries, pick, limit) {
  return entries
    .slice()
    .sort((a, b) => pick(b) - pick(a))
    .slice(0, limit)
    .map(entry => ({
      name: entry.name,
      cls: entry.cls,
      start: entry.start,
      duration: entry.duration,
      end: entry.end,
      encodedBytes: entry.encodedBytes,
      beforeReady: entry.beforeReady,
    }));
}

export function buildStartupTraceReport(state, { marks = {}, longTasks = null, nowMs = null } = {}) {
  const ready = state.ready;
  const classes = {};
  for (const cls of ASSET_CLASSES) {
    classes[cls] = state.classes[cls] || emptyClassBucket();
  }

  const duringBoot = state.entries.filter(e => e.beforeReady);
  const assetMsBeforeReady = duringBoot.reduce((sum, e) => sum + e.duration, 0);
  const blocking = duringBoot.length
    ? rank(duringBoot, e => e.duration, 1)[0]
    : null;

  const span = (a, b) => (Number.isFinite(marks[a]) && Number.isFinite(b)) ? Math.max(0, Math.round(b - marks[a])) : null;
  // A forced emit (page hide) can arrive with no ready anchor; naming that state keeps an
  // insight grouped on readySource from dropping exactly the loads that never finished.
  const readySource = state.readySource || (ready === null ? 'never' : null);

  return {
    version: TRACE_VERSION,
    generatedAtMs: Number.isFinite(nowMs) ? Math.round(nowMs) : null,
    readyMs: ready,
    readySource,
    firstFrameMs: Number.isFinite(marks['first-frame']) ? marks['first-frame'] : null,
    cockpitStageMs: span('stage:5', marks['stage:6']),
    assetMsBeforeReady: Math.round(assetMsBeforeReady),
    bytesBeforeReady: state.totals.bytesBeforeReady,
    requestsBeforeReady: state.totals.requestsBeforeReady,
    fcpMs: state.milestones.firstContentfulPaint ?? null,
    backgroundBoot: state.firstVisibleMs !== null && ready !== null
      ? state.firstVisibleMs > ready
      : false,
    ...state.selection,
    capability: { ...state.capability },
    navigation: {
      fetchStartMs: state.milestones.fetchStart ?? null,
      responseStartMs: state.milestones.responseStart ?? null,
      domContentLoadedMs: state.milestones.domContentLoaded ?? null,
      loadMs: state.milestones.loadEventEnd ?? null,
      firstPaintMs: state.milestones.firstPaint ?? null,
      firstContentfulPaintMs: state.milestones.firstContentfulPaint ?? null,
      largestContentfulPaintMs: state.milestones.largestContentfulPaint ?? null,
    },
    boot: {
      marks: { ...marks },
      stagesMs: stageSpans(state, marks),
      moduleStartToReadyMs: span('module-start', ready),
    },
    longTasks: longTasks || { count: 0, totalMs: 0, maxMs: 0 },
    totals: {
      requests: state.totals.requests,
      transferBytes: state.totals.transferBytes,
      encodedBytes: state.totals.encodedBytes,
      decodedBytes: state.totals.decodedBytes,
      dropped: state.dropped,
      opaqueDropped: state.opaqueDropped,
      thirdPartyDropped: state.thirdPartyDropped,
    },
    classes,
    slowest: rank(state.entries, e => e.duration, state.topN),
    largest: rank(state.entries, e => e.encodedBytes, state.topN),
    blocking,
  };
}
