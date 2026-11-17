import { REPLAY_BUDGET, CONTAINER_HEADER_BYTES, resolveReplayBudget } from './replayConfig.js';
import {
  REPLAY_CONTAINER_VERSION,
  REPLAY_FILE_EXTENSION,
  REPLAY_MIME_TYPE,
  encodeTrack,
  decodeTrack,
  toBase64,
  fromBase64,
  isGzipBytes,
  isContainerBytes,
  encodeReplayContainer,
  decodeReplayContainer,
  compressGzip,
  decodeCompressedContainer,
  toReplayBytes,
} from './ReplayCodec.js';
import { analyzeCombatEngagement } from '../weapons/engagementAnalysis.js';

const INDEX_KEY = 'flight3d.replays.v1';
export const SORTIE_KIND = 'flight3d.sortie.v1';
export const LEGACY_REPLAY_KIND = 'flight3d.replay.v1';
const payloadKey = id => `flight3d.replay.${id}.v1`;
const ROOM_STAGING_KEY = 'flight3d.roomReplayStaging.v1';

export const REPLAY_DB_NAME = 'flight3d.replays.v1';
export const REPLAY_ENTRIES_STORE = 'entries';
export const REPLAY_PAYLOADS_STORE = 'payloads';

/** Fixed name of the single slot that always holds the most recent flight (#645). */
export const AUTO_SAVE_LABEL = 'auto_save';
export const ROOM_AUTO_SAVE_LABEL = 'room_auto_save';
const ROOM_SAVE_FAILURE_KEY = 'flight3d.roomReplaySaveFailure.v1';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export { REPLAY_CONTAINER_VERSION, REPLAY_FILE_EXTENSION, REPLAY_MIME_TYPE };

function cleanLabel(label) {
  if (typeof label !== 'string') return null;
  const cleaned = label.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 64) : null;
}

function validRow(row) {
  return row && typeof row.id === 'string' && Number.isFinite(row.durationSec)
    && Number.isFinite(row.bytes) && typeof row.metadata === 'object' && row.metadata !== null
    && (row.summary === undefined || row.summary === null || typeof row.summary === 'object');
}

function clonePlain(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof Blob === 'function' && value instanceof Blob) return value;
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return structuredClone(value);
}

function measureValueBytes(value) {
  if (value == null) return 0;
  if (typeof Blob === 'function' && value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return textEncoder.encode(JSON.stringify(value)).byteLength;
}

/**
 * In-memory IndexedDB factory implementing the subset used by ReplayStore so Node tests
 * can exercise async transactions, Blob/ArrayBuffer storage, quota aborts, and rollbacks.
 */
export function createMemoryIndexedDB({ quotaBytes = Infinity, failOnWrite = false } = {}) {
  const databases = new Map();

  const totalUsedBytes = (dbEntry, workingStores = null) => {
    let total = 0;
    for (const [storeName, store] of dbEntry.stores.entries()) {
      const map = workingStores?.get(storeName) ?? store.data;
      for (const value of map.values()) total += measureValueBytes(value);
    }
    return total;
  };

  return {
    _databases: databases,
    open(name, version = 1) {
      const request = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, transaction: null };
      queueMicrotask(() => {
        let entry = databases.get(name);
        if (!entry) {
          entry = { version: 0, stores: new Map() };
          databases.set(name, entry);
        }
        const db = {
          name,
          version: Math.max(entry.version, version),
          objectStoreNames: {
            contains: storeName => entry.stores.has(storeName),
          },
          createObjectStore(storeName, { keyPath = null } = {}) {
            if (!entry.stores.has(storeName)) {
              entry.stores.set(storeName, { keyPath, data: new Map() });
            }
            return { name: storeName, keyPath };
          },
          close() {},
          transaction(storeNames, mode = 'readonly') {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames];
            const workingStores = new Map();
            for (const storeName of names) {
              const store = entry.stores.get(storeName);
              if (!store) throw new Error(`Object store ${storeName} not found`);
              workingStores.set(storeName, new Map(store.data));
            }
            let pendingOps = 0;
            let aborted = false;
            let committed = false;
            let settled = false;
            const tx = {
              mode,
              error: null,
              oncomplete: null,
              onerror: null,
              onabort: null,
              abort() {
                if (aborted || committed) return;
                aborted = true;
                if (!settled) {
                  settled = true;
                  queueMicrotask(() => tx.onabort?.({ target: tx }));
                }
              },
              objectStore(storeName) {
                const storeMeta = entry.stores.get(storeName);
                const working = workingStores.get(storeName);
                if (!storeMeta || !working) throw new Error(`Store ${storeName} not in transaction`);

                const schedule = (fn, opInfo = null) => {
                  pendingOps++;
                  const opReq = { result: undefined, error: null, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    pendingOps--;
                    if (aborted) return;
                    try {
                      if (opInfo && failOnWrite) {
                        const forced = typeof failOnWrite === 'function'
                          ? failOnWrite(opInfo)
                          : Object.assign(new Error('IndexedDB write failed'), { name: 'AbortError' });
                        if (forced) throw forced;
                      }
                      opReq.result = fn();
                      if (opInfo && totalUsedBytes(entry, workingStores) > quotaBytes) {
                        throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
                      }
                      opReq.onsuccess?.({ target: opReq });
                    } catch (error) {
                      opReq.error = error;
                      tx.error = error;
                      aborted = true;
                      opReq.onerror?.({ target: opReq });
                      if (!settled) {
                        settled = true;
                        tx.onerror?.({ target: tx });
                        tx.onabort?.({ target: tx });
                      }
                      return;
                    }
                    if (pendingOps === 0 && !aborted && !committed) {
                      committed = true;
                      for (const [nameToCommit, map] of workingStores.entries()) {
                        entry.stores.get(nameToCommit).data = map;
                      }
                      settled = true;
                      tx.oncomplete?.({ target: tx });
                    }
                  });
                  return opReq;
                };

                return {
                  get: key => schedule(() => {
                    const found = working.get(key);
                    return found === undefined ? undefined : clonePlain(found);
                  }),
                  getAll: () => schedule(() => [...working.values()].map(clonePlain)),
                  getAllKeys: () => schedule(() => [...working.keys()]),
                  put: (value, explicitKey) => schedule(() => {
                    if (mode !== 'readwrite') throw new Error('ReadOnlyError');
                    const key = storeMeta.keyPath ? value?.[storeMeta.keyPath] : explicitKey;
                    if (key === undefined || key === null) throw new Error('DataError');
                    working.set(key, clonePlain(value));
                    return key;
                  }, { op: 'put', storeName, value, key: storeMeta.keyPath ? value?.[storeMeta.keyPath] : explicitKey }),
                  delete: key => schedule(() => {
                    if (mode !== 'readwrite') throw new Error('ReadOnlyError');
                    working.delete(key);
                  }, { op: 'delete', storeName, key }),
                  clear: () => schedule(() => {
                    if (mode !== 'readwrite') throw new Error('ReadOnlyError');
                    working.clear();
                  }, { op: 'clear', storeName }),
                };
              },
            };
            return tx;
          },
        };
        request.result = db;
        if (entry.version < version) {
          const oldVersion = entry.version;
          entry.version = version;
          request.onupgradeneeded?.({ target: request, oldVersion, newVersion: version });
        }
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
}

/** Extract a compact debrief summary suitable for storing inside index rows without blowing quota. */
export function extractReportSummary(report) {
  if (!report || typeof report !== 'object') return null;
  if (report.summary && typeof report.summary === 'object') return report.summary;
  const touchdown = Array.isArray(report.touchdowns) && report.touchdowns.length
    ? report.touchdowns.at(-1)
    : null;
  const summary = {};
  if (typeof report.reason === 'string') summary.reason = report.reason;
  const peakG = report.peaks?.gForce?.gForce;
  if (Number.isFinite(peakG)) summary.peakG = Math.round(peakG * 100) / 100;
  const peakAlt = report.peaks?.altitudeFt?.altitudeFt;
  if (Number.isFinite(peakAlt)) summary.peakAltFt = Math.round(peakAlt);
  const peakIas = report.peaks?.iasKnots?.iasKnots;
  if (Number.isFinite(peakIas)) summary.peakIasKnots = Math.round(peakIas);
  if (touchdown) {
    summary.touchdown = {
      sinkRateFpm: Number.isFinite(touchdown.sinkRateFpm) ? Math.round(touchdown.sinkRateFpm) : null,
      contactG: Number.isFinite(touchdown.contactG) ? Math.round(touchdown.contactG * 100) / 100 : null,
    };
  }
  if (report.crash) {
    summary.crash = {
      type: report.crash.type ?? null,
      speedKnots: Number.isFinite(report.crash.speedKnots) ? Math.round(report.crash.speedKnots) : null,
    };
  }
  return Object.keys(summary).length ? summary : null;
}

function withAttachedEngagement(report, decodedTrack) {
  if (!report) return null;
  if (decodedTrack?.combat) {
    try {
      return {
        ...report,
        engagement: analyzeCombatEngagement({ report, track: decodedTrack }),
      };
    } catch {
      return report;
    }
  }
  return report;
}

function encodePlayableTrackBytes(trackOrReplay) {
  if (trackOrReplay instanceof Uint8Array) {
    return { trackBytes: trackOrReplay, decodedTrack: decodeTrack(trackOrReplay) };
  }
  if (trackOrReplay && Array.isArray(trackOrReplay.samples) && trackOrReplay.samples.length >= 2 && !trackOrReplay.overflow) {
    return { trackBytes: encodeTrack(trackOrReplay), decodedTrack: trackOrReplay };
  }
  return { trackBytes: null, decodedTrack: null };
}

/** Unite telemetry report and encoded pose track into one flight3d.sortie.v1 artifact. */
export function createSortie(report, trackOrReplay) {
  let track = null;
  let decodedTrack = null;
  if (typeof trackOrReplay === 'string') {
    track = trackOrReplay;
    try {
      decodedTrack = decodeTrack(fromBase64(trackOrReplay));
    } catch {
      decodedTrack = null;
    }
  } else {
    try {
      const encoded = encodePlayableTrackBytes(trackOrReplay);
      if (encoded.trackBytes) {
        decodedTrack = encoded.decodedTrack;
        track = toBase64(encoded.trackBytes);
      }
    } catch {
      track = null;
    }
  }

  report = withAttachedEngagement(report, decodedTrack);

  return {
    kind: SORTIE_KIND,
    report: report ?? null,
    track,
  };
}

function findPeakGSampleTime(samples) {
  let peakIndex = -1;
  samples.forEach((entry, index) => {
    if (Number.isFinite(entry?.gForce) && (peakIndex < 0 || entry.gForce > samples[peakIndex].gForce)) peakIndex = index;
  });
  return peakIndex >= 0 ? samples[peakIndex].timeSec : null;
}

function decimateReportSamplesOnce(report, peakTime = null) {
  if (!report || !Array.isArray(report.samples) || report.samples.length === 0) return report;
  const samples = report.samples;
  const targetPeakTime = peakTime ?? findPeakGSampleTime(samples);
  const next = samples.length <= 2
    ? []
    : samples.filter((entry, index) =>
      index === 0 || index === samples.length - 1 || index % 2 === 0
      || (targetPeakTime !== null && entry?.timeSec === targetPeakTime));
  const halved = next.length === samples.length ? samples.slice(0, Math.floor(samples.length / 2)) : next;
  return { ...report, samples: halved, samplesDecimatedForBudget: true };
}

/**
 * Decimate report telemetry samples (keeping endpoints and peak-G) when needed so the
 * UTF-8 report JSON fits the container report/decompressed budgets without discarding the track.
 */
function boundReportForContainer(report, trackBytes, compactReport, budget) {
  if (!report) return null;
  const resolved = resolveReplayBudget(budget);
  const trackLength = trackBytes ? trackBytes.byteLength : 0;
  const fits = candidate => {
    const reportBytes = textEncoder.encode(JSON.stringify(candidate)).byteLength;
    return reportBytes <= resolved.entryReportBytes
      && CONTAINER_HEADER_BYTES + reportBytes + trackLength <= resolved.entryDecompressedBytes;
  };
  let currentReport = report;
  if (fits(currentReport)) return currentReport;

  if (Array.isArray(currentReport.samples) && currentReport.samples.length > 0) {
    const peakTime = findPeakGSampleTime(currentReport.samples);
    while (Array.isArray(currentReport.samples) && currentReport.samples.length > 0 && !fits(currentReport)) {
      currentReport = decimateReportSamplesOnce(currentReport, peakTime);
    }
  }

  if (!fits(currentReport) && compactReport) {
    currentReport = { ...compactReport, reportTruncatedForBudget: true };
  }
  return currentReport;
}

function resolveContainerLimits(limits = {}) {
  return {
    maxCompressedBytes: limits.maxCompressedBytes ?? limits.entryCompressedBytes ?? REPLAY_BUDGET.entryCompressedBytes,
    maxDecompressedBytes: limits.maxDecompressedBytes ?? limits.entryDecompressedBytes ?? REPLAY_BUDGET.entryDecompressedBytes,
    maxReportBytes: limits.maxReportBytes ?? limits.entryReportBytes ?? REPLAY_BUDGET.entryReportBytes,
    maxTrackBytes: limits.maxTrackBytes ?? limits.entryTrackBytes ?? REPLAY_BUDGET.entryTrackBytes,
  };
}

function prepareSortiePayload(report, trackOrReplay) {
  let trackBytes = null;
  let decodedTrack = null;
  if (typeof trackOrReplay === 'string') {
    try {
      const raw = fromBase64(trackOrReplay);
      decodedTrack = decodeTrack(raw);
      trackBytes = raw;
    } catch {
      trackBytes = null;
    }
  } else {
    try {
      const encoded = encodePlayableTrackBytes(trackOrReplay);
      trackBytes = encoded.trackBytes;
      decodedTrack = encoded.decodedTrack;
    } catch {
      trackBytes = null;
    }
  }

  const resolvedReport = withAttachedEngagement(report ? { ...report } : null, decodedTrack);
  const compactReport = resolvedReport ? {
    label: resolvedReport.label ?? null,
    reason: resolvedReport.reason ?? null,
    durationSec: resolvedReport.durationSec ?? decodedTrack?.durationSec ?? null,
    metadata: resolvedReport.metadata ?? decodedTrack?.metadata ?? {},
    ...(extractReportSummary(resolvedReport) ? { summary: extractReportSummary(resolvedReport) } : {}),
  } : null;
  return { trackBytes, resolvedReport, compactReport };
}

async function compressBoundedSortieContainer({ report, compactReport, trackBytes, limits = {} }) {
  const resolvedLimits = resolveContainerLimits(limits);
  const containerBudget = {
    entryReportBytes: resolvedLimits.maxReportBytes,
    entryTrackBytes: resolvedLimits.maxTrackBytes,
    entryDecompressedBytes: resolvedLimits.maxDecompressedBytes,
  };
  let activeReport = boundReportForContainer(report, trackBytes, compactReport, containerBudget);
  let container = encodeReplayContainer({ report: activeReport, trackBytes }, resolvedLimits);
  let compressed = await compressGzip(container);
  const peakTime = Array.isArray(activeReport?.samples) ? findPeakGSampleTime(activeReport.samples) : null;

  while (compressed.byteLength > resolvedLimits.maxCompressedBytes
    && Array.isArray(activeReport?.samples) && activeReport.samples.length > 0) {
    activeReport = decimateReportSamplesOnce(activeReport, peakTime);
    container = encodeReplayContainer({ report: activeReport, trackBytes }, resolvedLimits);
    compressed = await compressGzip(container);
  }

  if (compressed.byteLength > resolvedLimits.maxCompressedBytes && compactReport && activeReport !== compactReport) {
    activeReport = boundReportForContainer(
      { ...compactReport, reportTruncatedForBudget: true },
      trackBytes,
      compactReport,
      containerBudget,
    );
    container = encodeReplayContainer({ report: activeReport, trackBytes }, resolvedLimits);
    compressed = await compressGzip(container);
  }

  if (compressed.byteLength > resolvedLimits.maxCompressedBytes && activeReport !== null) {
    const minimalReport = {
      label: activeReport.label ?? null,
      durationSec: activeReport.durationSec ?? null,
      metadata: activeReport.metadata ?? {},
      reportTruncatedForBudget: true,
    };
    const boundedMinimal = boundReportForContainer(minimalReport, trackBytes, null, containerBudget);
    const minimalCompressed = await compressGzip(
      encodeReplayContainer({ report: boundedMinimal, trackBytes }, resolvedLimits),
    );
    if (minimalCompressed.byteLength <= resolvedLimits.maxCompressedBytes) {
      compressed = minimalCompressed;
    } else {
      const trackOnlyCompressed = await compressGzip(
        encodeReplayContainer({ report: null, trackBytes }, resolvedLimits),
      );
      if (trackOnlyCompressed.byteLength <= resolvedLimits.maxCompressedBytes) {
        compressed = trackOnlyCompressed;
      }
    }
  }

  return { compressed, maxCompressedBytes: resolvedLimits.maxCompressedBytes };
}

/** Build an uncompressed F3DC binary container from a report and playable track. */
export function createSortieContainer(report, trackOrReplay, limits = {}) {
  const { trackBytes, resolvedReport, compactReport } = prepareSortiePayload(report, trackOrReplay);
  const resolvedLimits = resolveContainerLimits(limits);
  const boundedReport = boundReportForContainer(resolvedReport, trackBytes, compactReport, {
    entryReportBytes: resolvedLimits.maxReportBytes,
    entryTrackBytes: resolvedLimits.maxTrackBytes,
    entryDecompressedBytes: resolvedLimits.maxDecompressedBytes,
  });
  return encodeReplayContainer({ report: boundedReport, trackBytes }, resolvedLimits);
}

/** Build a gzip-compressed `.f3dr.gz` binary container ready for download or storage. */
export async function createCompressedSortie(report, trackOrReplay, limits = {}) {
  const { trackBytes, resolvedReport, compactReport } = prepareSortiePayload(report, trackOrReplay);
  const { compressed, maxCompressedBytes } = await compressBoundedSortieContainer({
    report: resolvedReport,
    compactReport,
    trackBytes,
    limits,
  });
  if (compressed.byteLength > maxCompressedBytes) {
    throw new RangeError('Replay compressed payload exceeds size limit');
  }
  return compressed;
}

/** Default label is what the player remembers the flight by, not a timestamp. */
export function replayLabel(track) {
  const { airport, aircraft, scenario } = track?.metadata || {};
  return [aircraft, airport, scenario].filter(Boolean).join(' · ') || 'flight';
}

function parseStoredPayload(raw) {
  if (typeof raw !== 'string') return null;
  if (raw.trimStart().startsWith('{')) {
    const parsed = JSON.parse(raw);
    if (parsed?.kind !== SORTIE_KIND || typeof parsed.track !== 'string') {
      throw new Error('Invalid stored sortie payload');
    }
    return { kind: SORTIE_KIND, report: parsed.report ?? null, trackBase64: parsed.track };
  }
  return { kind: null, report: null, trackBase64: raw };
}

function idbRequestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = event => resolve(event?.target?.result ?? request.result);
    request.onerror = event => reject(event?.target?.error ?? request.error ?? new Error('IndexedDB request failed'));
  });
}

function idbTransactionPromise(tx) {
  return new Promise((resolve, reject) => {
    let settled = false;
    tx.oncomplete = () => {
      if (!settled) { settled = true; resolve(); }
    };
    tx.onerror = () => {
      if (!settled) { settled = true; reject(tx.error ?? new Error('IndexedDB transaction failed')); }
    };
    tx.onabort = () => {
      if (!settled) { settled = true; reject(tx.error ?? new Error('IndexedDB transaction aborted')); }
    };
  });
}

/**
 * Saved replay library backed by IndexedDB with gzip-compressed F3DC binary containers,
 * preserving metadata index, naming, auto-save slots, budget eviction, and safe retryable
 * migration from legacy localStorage entries.
 */
export class ReplayStore {
  constructor(storage, {
    budget = REPLAY_BUDGET,
    indexedDB: customIdb = undefined,
    dbName = REPLAY_DB_NAME,
    payloadType = 'blob',
  } = {}) {
    if (storage === undefined) {
      try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
    }
    let resolvedIdb = customIdb;
    if (resolvedIdb === undefined) {
      try { resolvedIdb = globalThis.indexedDB ?? null; } catch { resolvedIdb = null; }
    }
    this.hasStorage = Boolean(storage);
    this.storage = storage ?? {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => { throw new Error('Storage unavailable'); },
    };
    this.idb = resolvedIdb ?? null;
    this.dbName = dbName;
    this.payloadType = payloadType;
    this.budget = resolveReplayBudget(budget);
    this.error = null;
    this._committedRows = this._seedLegacyIndex();
    this._pendingOps = [];
    this._rows = [...this._committedRows];
    this._listeners = new Set();
    this._dbPromise = null;
    this._queue = Promise.resolve();
    this._readyPromise = this._enqueue(() => this._initialize());
  }

  _seedLegacyIndex() {
    try {
      const raw = this.storage.getItem(INDEX_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.error = 'Invalid replay index';
        return [];
      }
      return parsed.filter(validRow);
    } catch (error) {
      this.error = error.message;
      return [];
    }
  }

  _containerLimits() {
    return {
      maxCompressedBytes: this.budget.entryCompressedBytes,
      maxDecompressedBytes: this.budget.entryDecompressedBytes,
      maxReportBytes: this.budget.entryReportBytes,
      maxTrackBytes: this.budget.entryTrackBytes,
    };
  }

  _packStoredPayload(compressedBytes) {
    if (this.payloadType !== 'arrayBuffer' && typeof Blob === 'function') {
      return new Blob([compressedBytes], { type: REPLAY_MIME_TYPE });
    }
    return compressedBytes.buffer.slice(compressedBytes.byteOffset, compressedBytes.byteOffset + compressedBytes.byteLength);
  }

  _enqueue(task) {
    const next = this._queue.then(task, task);
    this._queue = next.catch(() => {});
    return next;
  }

  _recomputeRows() {
    let rows = this._committedRows.map(row => ({ ...row }));
    for (const op of this._pendingOps) {
      if (op.type === 'save') {
        if (op.entry.auto) {
          const slot = op.entry.autoSlot ?? 'solo';
          rows = rows.filter(row => !(row.auto === true && (row.autoSlot ?? 'solo') === slot));
        }
        rows.push(op.entry);
        rows = this.applyBudget(rows, op.entry.id).rows;
      } else if (op.type === 'rename') {
        const target = rows.find(row => row.id === op.id);
        if (target) {
          target.label = op.label;
          delete target.auto;
          delete target.autoSlot;
        }
      } else if (op.type === 'remove') {
        rows = rows.filter(row => row.id !== op.id);
      }
    }
    this._rows = rows;
    for (const listener of this._listeners) {
      try { listener(); } catch { /* ignore listener errors */ }
    }
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  async _openDb() {
    if (!this.idb) throw new Error('Storage unavailable');
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = this.idb.open(this.dbName, 1);
      } catch (error) {
        this._dbPromise = null;
        reject(error);
        return;
      }
      req.onupgradeneeded = event => {
        const db = event?.target?.result ?? req.result;
        if (!db.objectStoreNames.contains(REPLAY_ENTRIES_STORE)) {
          db.createObjectStore(REPLAY_ENTRIES_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(REPLAY_PAYLOADS_STORE)) {
          db.createObjectStore(REPLAY_PAYLOADS_STORE);
        }
      };
      req.onsuccess = event => resolve(event?.target?.result ?? req.result);
      req.onerror = event => {
        this._dbPromise = null;
        reject(event?.target?.error ?? req.error ?? new Error('Failed to open replay database'));
      };
    });
    return this._dbPromise;
  }

  async _readIdbSnapshot(db) {
    const tx = db.transaction([REPLAY_ENTRIES_STORE, REPLAY_PAYLOADS_STORE], 'readonly');
    const entriesReq = tx.objectStore(REPLAY_ENTRIES_STORE).getAll();
    const keysReq = tx.objectStore(REPLAY_PAYLOADS_STORE).getAllKeys();
    const [rawEntries, rawKeys] = await Promise.all([
      idbRequestPromise(entriesReq),
      idbRequestPromise(keysReq),
      idbTransactionPromise(tx),
    ]);
    return {
      rows: Array.isArray(rawEntries) ? rawEntries.filter(validRow) : [],
      payloadKeys: new Set(Array.isArray(rawKeys) ? rawKeys : []),
    };
  }

  async _withLiveEntriesTx(db, stores, handler) {
    const tx = db.transaction(stores, 'readwrite');
    const entriesStore = tx.objectStore(REPLAY_ENTRIES_STORE);
    const payloadsStore = stores.includes(REPLAY_PAYLOADS_STORE) ? tx.objectStore(REPLAY_PAYLOADS_STORE) : null;
    let outcome;
    const getAllReq = entriesStore.getAll();
    getAllReq.onsuccess = event => {
      const raw = event?.target?.result ?? getAllReq.result;
      const liveRows = Array.isArray(raw) ? raw.filter(validRow) : [];
      outcome = handler({ liveRows, entriesStore, payloadsStore });
    };
    await idbTransactionPromise(tx);
    return outcome;
  }

  async _initialize() {
    if (!this.idb) return { migrated: 0, remaining: 0, error: null };
    try {
      const db = await this._openDb();
      const snapshot = await this._readIdbSnapshot(db);
      this._committedRows = snapshot.rows;
      this._recomputeRows();
      return await this._migrateLegacyEntries(db, snapshot);
    } catch (error) {
      this.error = error?.message || 'Storage error';
      return { migrated: 0, remaining: 0, error: this.error };
    }
  }

  ready() {
    return this._readyPromise;
  }

  async refresh() {
    return this._enqueue(async () => {
      if (!this.idb) return this.list();
      try {
        const db = await this._openDb();
        const snapshot = await this._readIdbSnapshot(db);
        this._committedRows = snapshot.rows;
        this._recomputeRows();
        this.error = null;
      } catch (error) {
        this.error = error?.message || 'Storage error';
      }
      return this.list();
    });
  }

  read() {
    return this._rows.filter(validRow).map(row => ({ ...row }));
  }

  list() {
    return this.read().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }

  async _buildCompressedPayload(trackBytes, report, compactReport) {
    const { compressed, maxCompressedBytes } = await compressBoundedSortieContainer({
      report,
      compactReport,
      trackBytes,
      limits: this._containerLimits(),
    });
    if (compressed.byteLength > maxCompressedBytes) {
      return { error: 'tooLong', compressed: null };
    }
    return { error: null, compressed };
  }

  async _commitWithBudget(db, entry, compressedBytes, { preserveNewerAuto = false, skipIfExists = false } = {}) {
    const payload = this._packStoredPayload(compressedBytes);
    const extraEvictedIds = new Set();

    for (;;) {
      let lastRows = null;
      let txResult = null;
      try {
        await this._withLiveEntriesTx(
          db,
          [REPLAY_ENTRIES_STORE, REPLAY_PAYLOADS_STORE],
          ({ liveRows, entriesStore, payloadsStore }) => {
            const performWrite = () => {
              if (preserveNewerAuto && entry.auto === true) {
                const targetSlot = entry.autoSlot ?? 'solo';
                const newerAuto = liveRows.find(row =>
                  row.auto === true && (row.autoSlot ?? 'solo') === targetSlot
                  && row.id !== entry.id && String(row.savedAt) > String(entry.savedAt));
                if (newerAuto) {
                  lastRows = liveRows;
                  txResult = { rows: liveRows, skipped: true };
                  return;
                }
              }
              const replacedIds = new Set();
              if (entry.auto === true) {
                const targetSlot = entry.autoSlot ?? 'solo';
                for (const row of liveRows) {
                  if (row.auto === true && (row.autoSlot ?? 'solo') === targetSlot && row.id !== entry.id) {
                    replacedIds.add(row.id);
                  }
                }
              }
              const surviving = liveRows.filter(
                row => !replacedIds.has(row.id) && !extraEvictedIds.has(row.id) && row.id !== entry.id,
              );
              const candidates = this.applyBudget([...surviving, entry], entry.id);
              lastRows = candidates.rows;
              const deleteIds = new Set([
                ...replacedIds,
                ...extraEvictedIds,
                ...candidates.evicted.map(row => row.id),
              ]);
              deleteIds.delete(entry.id);
              for (const deleteId of deleteIds) {
                entriesStore.delete(deleteId);
                payloadsStore.delete(deleteId);
              }
              entriesStore.put(entry);
              payloadsStore.put(payload, entry.id);
              txResult = { rows: candidates.rows, skipped: false };
            };

            if (skipIfExists && liveRows.some(row => row.id === entry.id)) {
              const payloadReq = payloadsStore.get(entry.id);
              payloadReq.onsuccess = event => {
                const existingPayload = event?.target?.result ?? payloadReq.result;
                if (existingPayload !== undefined && existingPayload !== null) {
                  lastRows = liveRows;
                  txResult = { rows: liveRows, skipped: true };
                  return;
                }
                performWrite();
              };
              return;
            }

            performWrite();
          },
        );
        this._committedRows = txResult.rows;
        this.error = null;
        return { ok: true, skipped: txResult.skipped };
      } catch (error) {
        const isQuota = error?.name === 'QuotaExceededError' || /quota/i.test(error?.message || '');
        const victim = isQuota ? lastRows?.find(row => row.id !== entry.id) : null;
        if (!victim) {
          this.error = error?.message || 'QuotaExceededError';
          return { ok: false, skipped: false };
        }
        extraEvictedIds.add(victim.id);
      }
    }
  }

  async migrateFromLocalStorage() {
    return this._enqueue(async () => {
      if (!this.idb) return { migrated: 0, remaining: 0, error: 'Storage unavailable' };
      const db = await this._openDb();
      const snapshot = await this._readIdbSnapshot(db);
      this._committedRows = snapshot.rows;
      return this._migrateLegacyEntries(db, snapshot);
    });
  }

  _clearRoomStagingIfMatches(id) {
    try {
      const currentRaw = this.storage.getItem(ROOM_STAGING_KEY);
      if (currentRaw === null) return;
      const current = JSON.parse(currentRaw);
      if (!current || current.id === id) {
        this.storage.removeItem(ROOM_STAGING_KEY);
      }
    } catch {
      try { this.storage.removeItem(ROOM_STAGING_KEY); } catch { /* ignore */ }
    }
  }

  async _migrateLegacyEntries(db, snapshot) {
    let migrated = 0;
    try {
      let rawIndex = null;
      try { rawIndex = this.storage.getItem(INDEX_KEY); } catch { rawIndex = null; }

      const rowById = new Map(this._committedRows.map(row => [row.id, row]));
      const payloadIds = new Set(snapshot.payloadKeys);

      if (rawIndex !== null) {
        let parsedIndex;
        try {
          parsedIndex = JSON.parse(rawIndex);
        } catch (error) {
          this.error = error.message;
          return { migrated: 0, remaining: 0, error: error.message };
        }
        if (!Array.isArray(parsedIndex)) {
          this.error = 'Invalid replay index';
          return { migrated: 0, remaining: 0, error: this.error };
        }
        const validLegacyRows = parsedIndex
          .filter(validRow)
          .sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
        let remaining = [...validLegacyRows];

        const persistRemainingIndex = () => {
          try {
            if (remaining.length === 0) {
              this.storage.removeItem(INDEX_KEY);
            } else {
              this.storage.setItem(INDEX_KEY, JSON.stringify(remaining));
            }
          } catch {
            // Non-fatal if localStorage cleanup is blocked after IndexedDB commit succeeded.
          }
        };

        for (const row of validLegacyRows) {
          const dropFromLegacy = () => {
            remaining = remaining.filter(candidate => candidate.id !== row.id);
            try { this.storage.removeItem(payloadKey(row.id)); } catch { /* ignore */ }
            persistRemainingIndex();
          };

          if (rowById.has(row.id) && payloadIds.has(row.id)) {
            // Previously committed to IndexedDB before localStorage cleanup completed.
            dropFromLegacy();
            continue;
          }

          let replaced = [];
          if (row.auto === true) {
            const slot = row.autoSlot ?? 'solo';
            const existingAuto = this._committedRows.find(
              candidate => candidate.auto === true && (candidate.autoSlot ?? 'solo') === slot && candidate.id !== row.id,
            );
            if (existingAuto && String(existingAuto.savedAt) > String(row.savedAt)) {
              dropFromLegacy();
              continue;
            }
            if (existingAuto) replaced = [existingAuto];
          }

          let rawPayload = null;
          try { rawPayload = this.storage.getItem(payloadKey(row.id)); } catch { rawPayload = null; }
          if (typeof rawPayload !== 'string') {
            dropFromLegacy();
            continue;
          }

          let trackBytes;
          let parsed;
          try {
            parsed = parseStoredPayload(rawPayload);
            trackBytes = fromBase64(parsed.trackBase64);
            decodeTrack(trackBytes);
          } catch (error) {
            this.error = error.message;
            continue;
          }

          const compactReport = {
            label: row.label,
            durationSec: row.durationSec,
            metadata: { ...row.metadata },
            ...(row.summary ? { summary: row.summary } : {}),
          };
          const storedReport = parsed.report ? { ...parsed.report, label: row.label } : compactReport;
          const built = await this._buildCompressedPayload(trackBytes, storedReport, compactReport);
          if (built.error || !built.compressed) {
            this.error = built.error || 'tooLong';
            continue;
          }

          const migratedEntry = {
            ...row,
            bytes: built.compressed.byteLength,
          };
          const commit = await this._commitWithBudget(
            db,
            migratedEntry,
            built.compressed,
            { preserveNewerAuto: true, skipIfExists: true },
          );
          if (!commit.ok) {
            // Preserve unmigrated localStorage entries untouched for retry.
            return { migrated, remaining: remaining.length, error: this.error || 'Migration failed' };
          }
          rowById.clear();
          for (const r of this._committedRows) rowById.set(r.id, r);
          if (!commit.skipped) payloadIds.add(migratedEntry.id);
          dropFromLegacy();
          if (!commit.skipped) migrated++;
        }
        if (remaining.length === 0) {
          try { this.storage.removeItem(INDEX_KEY); } catch { /* ignore */ }
        }
      }

      // Recover any synchronous pagehide room staging entry if present.
      let rawStaged = null;
      try { rawStaged = this.storage.getItem(ROOM_STAGING_KEY); } catch { rawStaged = null; }
      if (typeof rawStaged === 'string') {
        try {
          const staged = JSON.parse(rawStaged);
          if (staged?.id && staged?.sortie?.track) {
            if (rowById.has(staged.id) && payloadIds.has(staged.id)) {
              this._clearRoomStagingIfMatches(staged.id);
            } else {
              const trackBytes = fromBase64(staged.sortie.track);
              const track = decodeTrack(trackBytes);
              const existingRoomAuto = this._committedRows.find(
                candidate => candidate.auto === true && (candidate.autoSlot ?? 'solo') === 'room' && candidate.id !== staged.id,
              );
              if (existingRoomAuto && String(existingRoomAuto.savedAt) > String(staged.savedAt)) {
                this._clearRoomStagingIfMatches(staged.id);
              } else {
                const compactReport = staged.sortie.report ?? {
                  label: staged.label || ROOM_AUTO_SAVE_LABEL,
                  durationSec: track.durationSec,
                  metadata: { ...track.metadata },
                };
                const built = await this._buildCompressedPayload(trackBytes, compactReport, compactReport);
                if (!built.error && built.compressed) {
                  const stagedEntry = {
                    id: staged.id,
                    savedAt: staged.savedAt,
                    label: cleanLabel(staged.label) || ROOM_AUTO_SAVE_LABEL,
                    durationSec: track.durationSec,
                    intervalSec: track.intervalSec,
                    sampleCount: track.samples.length,
                    bytes: built.compressed.byteLength,
                    metadata: { ...track.metadata },
                    auto: true,
                    autoSlot: 'room',
                  };
                  const commit = await this._commitWithBudget(
                    db,
                    stagedEntry,
                    built.compressed,
                    { preserveNewerAuto: true, skipIfExists: true },
                  );
                  if (commit.ok) {
                    this._clearRoomStagingIfMatches(staged.id);
                    if (!commit.skipped) migrated++;
                  }
                }
              }
            }
          } else {
            this.storage.removeItem(ROOM_STAGING_KEY);
          }
        } catch {
          // Leave staged entry intact unless corrupt JSON makes it unrecoverable.
        }
      }

      return { migrated, remaining: 0, error: null };
    } finally {
      this._recomputeRows();
    }
  }

  /** @returns {Promise<{entry: object|null, error: string|null}>} */
  save(track, { label, auto = false, autoSlot = 'solo', summary = null, report = null, id = null, savedAt = null } = {}) {
    if (!track || !Array.isArray(track.samples) || track.samples.length < 2) {
      return Promise.resolve({ entry: null, error: 'tooShort' });
    }
    if (track.overflow) return Promise.resolve({ entry: null, error: 'tooLong' });
    if (!this.idb) return Promise.resolve({ entry: null, error: 'Storage unavailable' });

    let trackBytes;
    try {
      trackBytes = encodeTrack(track);
    } catch (error) {
      return Promise.resolve({ entry: null, error: error.message });
    }
    if (trackBytes.byteLength > this.budget.entryTrackBytes) {
      return Promise.resolve({ entry: null, error: 'tooLong' });
    }

    const resolvedLabel = cleanLabel(label) || replayLabel(track);
    const resolvedSummary = (summary && typeof summary === 'object')
      ? summary
      : (report ? extractReportSummary(report) : null);
    const compactReport = {
      label: resolvedLabel,
      durationSec: track.durationSec,
      metadata: { ...track.metadata },
      ...(resolvedSummary ? { summary: resolvedSummary } : {}),
    };
    const storedReport = withAttachedEngagement(
      report ? { ...report, label: report.label ?? resolvedLabel } : compactReport,
      track,
    );

    const entry = {
      id: id ?? crypto.randomUUID(),
      savedAt: savedAt ?? new Date().toISOString(),
      label: resolvedLabel,
      durationSec: track.durationSec,
      intervalSec: track.intervalSec,
      sampleCount: track.samples.length,
      bytes: Math.min(trackBytes.byteLength, this.budget.entryCompressedBytes),
      metadata: { ...track.metadata },
    };
    if (resolvedSummary) entry.summary = resolvedSummary;
    if (auto) { entry.auto = true; entry.autoSlot = autoSlot; }

    const pendingOp = { type: 'save', entry };
    this._pendingOps.push(pendingOp);
    this._recomputeRows();

    return this._enqueue(async () => {
      try {
        const built = await this._buildCompressedPayload(trackBytes, storedReport, compactReport);
        if (built.error || !built.compressed) {
          this.error = built.error || 'tooLong';
          return { entry: null, error: this.error };
        }
        entry.bytes = built.compressed.byteLength;
        const db = await this._openDb();
        const commit = await this._commitWithBudget(db, entry, built.compressed);
        if (!commit.ok) return { entry: null, error: this.error || 'quota' };
        return { entry: { ...entry }, error: null };
      } catch (error) {
        this.error = error?.message || 'Storage error';
        return { entry: null, error: this.error };
      } finally {
        this._pendingOps = this._pendingOps.filter(op => op !== pendingOp);
        this._recomputeRows();
      }
    });
  }

  /**
   * Keep the most recent flight reachable without a manual save. The newest sortie always
   * replaces the previous auto save, so at most one `auto` entry exists. Renaming it turns
   * it into a permanent save that later flights no longer overwrite (#645).
   * @returns {Promise<{entry: object|null, error: string|null}>}
   */
  saveAuto(track, { summary = null, report = null } = {}) {
    return this.save(track, { label: AUTO_SAVE_LABEL, auto: true, summary, report });
  }

  async saveRoomAuto(track) {
    const id = crypto.randomUUID();
    const savedAt = new Date().toISOString();
    let staged = false;
    // Stage synchronously in localStorage when available so tab close during pagehide
    // cannot drop the recording before the async IndexedDB write completes.
    if (this.hasStorage && track && Array.isArray(track.samples) && track.samples.length >= 2 && !track.overflow) {
      try {
        const trackBytes = encodeTrack(track);
        if (trackBytes.byteLength <= this.budget.entryTrackBytes) {
          const sortie = createSortie({
            label: ROOM_AUTO_SAVE_LABEL,
            durationSec: track.durationSec,
            metadata: { ...track.metadata },
          }, toBase64(trackBytes));
          this.storage.setItem(ROOM_STAGING_KEY, JSON.stringify({
            id,
            savedAt,
            label: ROOM_AUTO_SAVE_LABEL,
            auto: true,
            autoSlot: 'room',
            sortie,
          }));
          staged = true;
        }
      } catch {
        // Best-effort staging; IndexedDB remains authoritative.
      }
    }
    const result = await this.save(track, {
      id,
      savedAt,
      label: ROOM_AUTO_SAVE_LABEL,
      auto: true,
      autoSlot: 'room',
    });
    if (staged && result.entry) {
      this._clearRoomStagingIfMatches(id);
    }
    if (!result.entry) {
      // Best effort: an entirely inaccessible storage cannot persist even a failure notice.
      try { this.storage.setItem(ROOM_SAVE_FAILURE_KEY, '1'); } catch { /* immediate callback still reports it */ }
    }
    return result;
  }

  consumeRoomSaveFailure() {
    try {
      const failed = this.storage.getItem(ROOM_SAVE_FAILURE_KEY) === '1';
      if (failed) this.storage.removeItem(ROOM_SAVE_FAILURE_KEY);
      return failed;
    } catch { return false; }
  }

  async _readEntryAndPayload(id) {
    if (!this.idb) return null;
    const db = await this._openDb();
    const tx = db.transaction([REPLAY_ENTRIES_STORE, REPLAY_PAYLOADS_STORE], 'readonly');
    const rowReq = tx.objectStore(REPLAY_ENTRIES_STORE).get(id);
    const payloadReq = tx.objectStore(REPLAY_PAYLOADS_STORE).get(id);
    const [row, payload] = await Promise.all([
      idbRequestPromise(rowReq),
      idbRequestPromise(payloadReq),
      idbTransactionPromise(tx),
    ]);
    if (!validRow(row)) return null;
    if (payload === undefined || payload === null) {
      this.error = 'missingPayload';
      return { row, payload: null };
    }
    return { row, payload };
  }

  async get(id) {
    return this._enqueue(async () => {
      if (!this.idb) return null;
      let record;
      try {
        record = await this._readEntryAndPayload(id);
      } catch (error) {
        this.error = error?.message || 'Storage error';
        return null;
      }
      if (!record || record.payload === null) return null;
      try {
        const decoded = await decodeCompressedContainer(record.payload, {
          ...this._containerLimits(),
          requireTrack: true,
        });
        const report = decoded.report
          ? { ...decoded.report, label: record.row.label }
          : null;
        this.error = null;
        return { meta: { ...record.row }, track: decoded.track, report };
      } catch (error) {
        this.error = error?.message || 'Corrupt replay payload';
        return null;
      }
    });
  }

  rename(id, label) {
    const clean = cleanLabel(label);
    if (!clean) return Promise.resolve(false);
    if (!this.idb || typeof id !== 'string' || !id) return Promise.resolve(false);

    const exists = this._rows.some(row => row.id === id);
    const pendingOp = exists ? { type: 'rename', id, label: clean } : null;
    if (pendingOp) {
      this._pendingOps.push(pendingOp);
      this._recomputeRows();
    }

    return this._enqueue(async () => {
      try {
        const db = await this._openDb();
        const result = await this._withLiveEntriesTx(db, [REPLAY_ENTRIES_STORE], ({ liveRows, entriesStore }) => {
          const target = liveRows.find(row => row.id === id);
          if (!target) return { rows: liveRows, renamed: false };
          const updated = { ...target, label: clean };
          // Renaming an auto save keeps it: it is no longer the disposable latest-flight slot.
          delete updated.auto;
          delete updated.autoSlot;
          entriesStore.put(updated);
          return {
            rows: liveRows.map(row => (row.id === id ? updated : row)),
            renamed: true,
          };
        });
        this._committedRows = result.rows;
        this.error = null;
        return result.renamed;
      } catch (error) {
        this.error = error?.message || 'Storage error';
        return false;
      } finally {
        if (pendingOp) this._pendingOps = this._pendingOps.filter(op => op !== pendingOp);
        this._recomputeRows();
      }
    });
  }

  remove(id) {
    if (!this.idb || typeof id !== 'string' || !id) return Promise.resolve(false);
    const exists = this._rows.some(row => row.id === id);
    const pendingOp = exists ? { type: 'remove', id } : null;
    if (pendingOp) {
      this._pendingOps.push(pendingOp);
      this._recomputeRows();
    }

    return this._enqueue(async () => {
      try {
        const db = await this._openDb();
        const result = await this._withLiveEntriesTx(
          db,
          [REPLAY_ENTRIES_STORE, REPLAY_PAYLOADS_STORE],
          ({ liveRows, entriesStore, payloadsStore }) => {
            const found = liveRows.some(row => row.id === id);
            if (found) {
              entriesStore.delete(id);
              payloadsStore.delete(id);
            }
            return {
              rows: liveRows.filter(row => row.id !== id),
              removed: found,
            };
          },
        );
        this._committedRows = result.rows;
        this.error = null;
        return result.removed;
      } catch (error) {
        this.error = error?.message || 'Storage error';
        return false;
      } finally {
        if (pendingOp) this._pendingOps = this._pendingOps.filter(op => op !== pendingOp);
        this._recomputeRows();
      }
    });
  }

  /** Export a saved replay as gzip-compressed `.f3dr.gz` container bytes (`Uint8Array`). */
  async exportContainer(id) {
    return this._enqueue(async () => {
      if (!this.idb) return null;
      let record;
      try {
        record = await this._readEntryAndPayload(id);
      } catch {
        return null;
      }
      if (!record || record.payload === null) return null;
      try {
        const compressedBytes = await toReplayBytes(record.payload, this.budget.entryCompressedBytes);
        const decoded = await decodeCompressedContainer(compressedBytes, {
          ...this._containerLimits(),
          requireTrack: true,
        });
        if (decoded.report && decoded.report.label === record.row.label) {
          return compressedBytes;
        }
        const compactReport = {
          label: record.row.label,
          durationSec: record.row.durationSec,
          metadata: { ...record.row.metadata },
          ...(record.row.summary ? { summary: record.row.summary } : {}),
        };
        const updatedReport = decoded.report
          ? { ...decoded.report, label: record.row.label }
          : compactReport;
        const rebuilt = await this._buildCompressedPayload(decoded.trackBytes, updatedReport, compactReport);
        if (rebuilt.error || !rebuilt.compressed) return null;
        return rebuilt.compressed;
      } catch {
        return null;
      }
    });
  }

  /** Export a saved replay as an `application/gzip` Blob suitable for `.f3dr.gz` download. */
  async exportBlob(id) {
    const bytes = await this.exportContainer(id);
    if (!bytes) return null;
    return new Blob([bytes], { type: REPLAY_MIME_TYPE });
  }

  /** Legacy JSON export (`flight3d.sortie.v1`) preserved for diagnostics and comparisons. */
  async exportJson(id) {
    const saved = await this.get(id);
    if (!saved) return null;
    const row = saved.meta;
    const report = saved.report
      ? { ...saved.report, label: row.label }
      : {
        label: row.label,
        durationSec: row.durationSec,
        metadata: row.metadata,
        ...(row.summary ? { summary: row.summary } : {}),
      };
    return JSON.stringify(createSortie(report, saved.track));
  }

  async _importJsonText(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (error) { return { entry: null, error: error.message }; }
    let base64;
    let label = null;
    let summary = null;
    let report = null;
    if (parsed?.kind === SORTIE_KIND) {
      if (typeof parsed.track !== 'string') return { entry: null, error: 'notAReplay' };
      base64 = parsed.track;
      label = parsed.report?.label ?? parsed.entry?.label ?? null;
      summary = extractReportSummary(parsed.report);
      report = parsed.report ?? null;
    } else if (parsed?.kind === LEGACY_REPLAY_KIND) {
      if (typeof parsed.payload !== 'string') return { entry: null, error: 'notAReplay' };
      base64 = parsed.payload;
      label = parsed.entry?.label ?? null;
      summary = parsed.entry?.summary ?? null;
    } else {
      return { entry: null, error: 'notAReplay' };
    }
    if (base64.length > this.budget.entryBase64Bytes) return { entry: null, error: 'tooLong' };
    let rawBytes;
    let track;
    try {
      rawBytes = fromBase64(base64);
      if (rawBytes.byteLength > this.budget.entryTrackBytes) return { entry: null, error: 'tooLong' };
      track = decodeTrack(rawBytes);
    } catch (error) {
      return { entry: null, error: error.message };
    }
    return this.save(track, { label, summary, report });
  }

  /**
   * Import either the compressed `.f3dr.gz` binary container, an uncompressed `F3DC`
   * container, or legacy `flight3d.sortie.v1` / `flight3d.replay.v1` JSON.
   */
  async importReplay(input) {
    if (typeof input === 'string') {
      if (textEncoder.encode(input).byteLength > this.budget.maxLegacyJsonBytes) {
        return { entry: null, error: 'tooLong' };
      }
      return this._importJsonText(input);
    }

    if (typeof Blob === 'function' && input instanceof Blob) {
      const name = typeof input.name === 'string' ? input.name.toLowerCase() : '';
      const gzipHint = input.type === 'application/gzip' || input.type === 'application/x-gzip'
        || name.endsWith('.f3dr.gz') || name.endsWith('.gz');
      if (gzipHint && Number.isFinite(input.size) && input.size > this.budget.entryCompressedBytes) {
        return { entry: null, error: 'tooLong' };
      }
    }

    const maxAcceptableInput = Math.max(this.budget.entryCompressedBytes, this.budget.maxLegacyJsonBytes);
    let bytes;
    try {
      bytes = await toReplayBytes(input, maxAcceptableInput);
    } catch (error) {
      const msg = error?.message || 'notAReplay';
      return { entry: null, error: msg.includes('size limit') ? 'tooLong' : msg };
    }
    if (bytes.byteLength === 0) return { entry: null, error: 'notAReplay' };

    if (isGzipBytes(bytes)) {
      if (bytes.byteLength > this.budget.entryCompressedBytes) {
        return { entry: null, error: 'tooLong' };
      }
      let decoded;
      try {
        decoded = await decodeCompressedContainer(bytes, {
          ...this._containerLimits(),
          requireTrack: true,
        });
      } catch (error) {
        const msg = error?.message || 'notAReplay';
        return { entry: null, error: msg.includes('size limit') ? 'tooLong' : msg };
      }
      const label = decoded.report?.label ?? null;
      const summary = extractReportSummary(decoded.report);
      return this.save(decoded.track, { label, summary, report: decoded.report ?? null });
    }

    if (isContainerBytes(bytes)) {
      let decoded;
      try {
        decoded = decodeReplayContainer(bytes, {
          ...this._containerLimits(),
          requireTrack: true,
        });
      } catch (error) {
        const msg = error?.message || 'notAReplay';
        return { entry: null, error: msg.includes('size limit') ? 'tooLong' : msg };
      }
      const label = decoded.report?.label ?? null;
      const summary = extractReportSummary(decoded.report);
      return this.save(decoded.track, { label, summary, report: decoded.report ?? null });
    }

    if (bytes.byteLength > this.budget.maxLegacyJsonBytes) {
      return { entry: null, error: 'tooLong' };
    }
    let text;
    try {
      text = textDecoder.decode(bytes);
    } catch {
      return { entry: null, error: 'notAReplay' };
    }
    return this._importJsonText(text);
  }

  importFile(file) {
    return this.importReplay(file);
  }

  importJson(text) {
    return this.importReplay(text);
  }

  applyBudget(rows, preserveId = null) {
    const evicted = [];
    const kept = [...rows].sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
    const evictOldest = () => {
      const idx = preserveId ? kept.findIndex(row => row.id !== preserveId) : 0;
      return kept.splice(idx >= 0 ? idx : 0, 1)[0];
    };
    while (kept.length > this.budget.entries) evicted.push(evictOldest());
    let bytes = kept.reduce((total, row) => total + row.bytes, 0);
    while (kept.length > 1 && bytes > this.budget.totalCompressedBytes) {
      const oldest = evictOldest();
      bytes -= oldest.bytes;
      evicted.push(oldest);
    }
    return { rows: kept, evicted };
  }
}
