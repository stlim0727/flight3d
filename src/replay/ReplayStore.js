import { REPLAY_BUDGET } from './replayConfig.js';
import { encodeTrack, decodeTrack, toBase64, fromBase64 } from './ReplayCodec.js';

const INDEX_KEY = 'flight3d.replays.v1';
const EXPORT_KIND = 'flight3d.replay.v1';
const payloadKey = id => `flight3d.replay.${id}.v1`;

function cleanLabel(label) {
  if (typeof label !== 'string') return null;
  const cleaned = label.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 64) : null;
}

function validRow(row) {
  return row && typeof row.id === 'string' && Number.isFinite(row.durationSec)
    && Number.isFinite(row.bytes) && typeof row.metadata === 'object' && row.metadata !== null;
}

/** Default label is what the player remembers the flight by, not a timestamp. */
export function replayLabel(track) {
  const { airport, aircraft, scenario } = track?.metadata || {};
  return [aircraft, airport, scenario].filter(Boolean).join(' · ') || 'flight';
}

/**
 * Saved replay library in localStorage. Payloads are stored one key per entry so a single
 * oversized write cannot lose the whole library, and quota pressure evicts the oldest saves.
 */
export class ReplayStore {
  constructor(storage, { budget = REPLAY_BUDGET } = {}) {
    if (storage === undefined) {
      try { storage = globalThis.localStorage; } catch { storage = null; }
    }
    this.storage = storage ?? {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => { throw new Error('Storage unavailable'); },
    };
    this.budget = budget;
    this.error = null;
  }

  read() {
    try {
      const rows = JSON.parse(this.storage.getItem(INDEX_KEY) ?? '[]');
      if (!Array.isArray(rows)) throw new Error('Invalid replay index');
      return rows.filter(validRow);
    } catch (error) {
      this.error = error.message;
      return [];
    }
  }

  list() {
    return this.read().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }

  /** @returns {{entry: object, error: string|null}} */
  save(track, { label } = {}) {
    if (!track || !Array.isArray(track.samples) || track.samples.length < 2) {
      return { entry: null, error: 'tooShort' };
    }
    if (track.overflow) return { entry: null, error: 'tooLong' };
    let base64;
    try {
      base64 = toBase64(encodeTrack(track));
    } catch (error) {
      return { entry: null, error: error.message };
    }
    if (base64.length > this.budget.entryBase64Bytes) return { entry: null, error: 'tooLong' };
    const entry = {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      label: cleanLabel(label) || replayLabel(track),
      durationSec: track.durationSec,
      intervalSec: track.intervalSec,
      sampleCount: track.samples.length,
      bytes: base64.length,
      metadata: { ...track.metadata },
    };
    const rows = this.read();
    if (!this.writeEntry(entry, base64, rows)) return { entry: null, error: this.error || 'quota' };
    return { entry, error: null };
  }

  get(id) {
    const row = this.read().find(candidate => candidate.id === id);
    if (!row) return null;
    let payload = null;
    try { payload = this.storage.getItem(payloadKey(id)); } catch { payload = null; }
    if (typeof payload !== 'string') { this.error = 'missingPayload'; return null; }
    try {
      return { meta: row, track: decodeTrack(fromBase64(payload)) };
    } catch (error) {
      this.error = error.message;
      return null;
    }
  }

  rename(id, label) {
    const clean = cleanLabel(label);
    if (!clean) return false;
    const rows = this.read();
    const row = rows.find(candidate => candidate.id === id);
    if (!row) return false;
    row.label = clean;
    return this.writeIndex(rows);
  }

  remove(id) {
    const rows = this.read();
    const kept = rows.filter(row => row.id !== id);
    if (kept.length === rows.length) return false;
    try { this.storage.removeItem(payloadKey(id)); } catch { /* an unreadable payload is already gone */ }
    return this.writeIndex(kept);
  }

  exportJson(id) {
    const row = this.read().find(candidate => candidate.id === id);
    if (!row) return null;
    let payload = null;
    try { payload = this.storage.getItem(payloadKey(id)); } catch { payload = null; }
    if (typeof payload !== 'string') return null;
    return JSON.stringify({ kind: EXPORT_KIND, entry: row, payload });
  }

  importJson(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (error) { return { entry: null, error: error.message }; }
    if (parsed?.kind !== EXPORT_KIND || typeof parsed.payload !== 'string') return { entry: null, error: 'notAReplay' };
    if (parsed.payload.length > this.budget.entryBase64Bytes) return { entry: null, error: 'tooLong' };
    let track;
    try {
      track = decodeTrack(fromBase64(parsed.payload));
    } catch (error) {
      return { entry: null, error: error.message };
    }
    return this.save(track, { label: parsed.entry?.label });
  }

  /** Writes payload then index, evicting the oldest saves when the shared budget is exhausted. */
  writeEntry(entry, base64, rows) {
    const purged = [];
    if (!this.writePayload(entry.id, base64, rows, purged)) {
      this.discardPayload(entry.id);
      this.pruneIndex(rows, purged);
      return false;
    }
    let candidates = this.applyBudget([...rows.filter(row => !purged.includes(row.id)), entry]);
    for (let attempt = 0; attempt <= this.budget.entries; attempt++) {
      try {
        this.storage.setItem(INDEX_KEY, JSON.stringify(candidates.rows));
        this.error = null;
        this.dropPayloads(candidates.evicted);
        return true;
      } catch (error) {
        this.error = error.message;
        const [oldest, ...rest] = candidates.rows;
        if (oldest.id === entry.id || !rest.length) break;
        candidates = { rows: rest, evicted: [...candidates.evicted, oldest] };
      }
    }
    const evictedIds = candidates.evicted.map(row => row.id);
    this.discardPayload(entry.id);
    this.dropPayloads(candidates.evicted);
    this.pruneIndex(rows, [...purged, ...evictedIds]);
    return false;
  }

  writePayload(id, base64, rows, purged) {
    const oldestFirst = [...rows].sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
    for (;;) {
      try {
        this.storage.setItem(payloadKey(id), base64);
        return true;
      } catch (error) {
        this.error = error.message;
        const victim = oldestFirst.shift();
        if (!victim) return false;
        purged.push(victim.id);
        this.discardPayload(victim.id);
      }
    }
  }

  applyBudget(rows) {
    const evicted = [];
    const kept = [...rows].sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
    while (kept.length > this.budget.entries) evicted.push(kept.shift());
    let bytes = kept.reduce((total, row) => total + row.bytes, 0);
    while (kept.length > 1 && bytes > this.budget.totalBase64Bytes) {
      const oldest = kept.shift();
      bytes -= oldest.bytes;
      evicted.push(oldest);
    }
    return { rows: kept, evicted };
  }

  dropPayloads(evicted) {
    for (const row of evicted) this.discardPayload(row.id);
  }

  /** Never leave the index listing a save whose payload has been dropped. */
  pruneIndex(rows, ids) {
    const gone = new Set(ids);
    if (!gone.size) return;
    this.writeIndex(rows.filter(row => !gone.has(row.id)));
  }

  discardPayload(id) {
    try { this.storage.removeItem(payloadKey(id)); } catch { /* nothing to clean up */ }
  }

  writeIndex(rows) {
    try {
      this.storage.setItem(INDEX_KEY, JSON.stringify(rows));
      this.error = null;
      return true;
    } catch (error) {
      this.error = error.message;
      return false;
    }
  }
}
