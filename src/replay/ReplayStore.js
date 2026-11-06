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

  /** Commit payload and index together, restoring old saves if quota retries fail. */
  writeEntry(entry, base64, rows) {
    const backups = new Map();
    try {
      // Read everything we might evict before the first destructive operation.
      for (const row of rows) backups.set(row.id, this.storage.getItem(payloadKey(row.id)));
    } catch (error) {
      this.error = error.message;
      return false;
    }
    const candidates = this.applyBudget([...rows, entry]);
    const removed = new Set();
    const evict = row => {
      this.storage.removeItem(payloadKey(row.id));
      removed.add(row.id);
    };
    try {
      for (const row of candidates.evicted) evict(row);
      for (;;) {
        try {
          this.storage.setItem(payloadKey(entry.id), base64);
          this.storage.setItem(INDEX_KEY, JSON.stringify(candidates.rows));
          this.error = null;
          return true;
        } catch (error) {
          const victim = candidates.rows.find(row => row.id !== entry.id);
          if (!victim) throw error;
          evict(victim);
          candidates.rows = candidates.rows.filter(row => row.id !== victim.id);
        }
      }
    } catch (error) {
      this.discardPayload(entry.id);
      // The old index is unchanged: localStorage.setItem is atomic on failure.
      // Removing the new payload first frees the space held by the original saves.
      for (const id of removed) {
        const payload = backups.get(id);
        if (payload !== null) {
          try { this.storage.setItem(payloadKey(id), payload); }
          catch { /* Storage may have become inaccessible; preserve the original error. */ }
        }
      }
      this.error = error.message;
      return false;
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
