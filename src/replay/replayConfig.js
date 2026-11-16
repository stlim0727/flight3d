export const REPLAY_INTERVAL_SEC = 0.2;
export const ROOM_REPLAY_ENABLED = true;
export const REPLAY_INTERVAL_LADDER = Object.freeze([0.2, 0.4, 0.8, 1.6]);
export const RECORD_BYTES = 80;
// A multiplayer room track adds one pose-only record per remote aircraft to every frame.
export const REMOTE_RECORD_BYTES = 23;
export const HEADER_BYTES = 18;
export const CONTAINER_HEADER_BYTES = 13;

// Storage budgets separate uncompressed in-memory / container limits from compressed storage limits.
export const REPLAY_BUDGET = Object.freeze({
  entries: 8,
  // Uncompressed ReplayCodec binary track budget (drives recorder thinning and overflow).
  entryTrackBytes: 120_000,
  // Uncompressed UTF-8 report JSON budget before report.samples decimation.
  entryReportBytes: 240_000,
  // Maximum total decompressed container size allowed before allocating/decoding payloads.
  entryDecompressedBytes: 360_013,
  // Maximum gzip-compressed .f3dr.gz size for a single stored or imported entry.
  entryCompressedBytes: 120_000,
  // Maximum total gzip-compressed bytes retained across all entries in IndexedDB.
  totalCompressedBytes: 750_000,
  // Maximum file size allowed when importing legacy .json exports.
  maxLegacyJsonBytes: 2_000_000,
  // Legacy Base64 limits retained for legacy JSON import checks and compatibility.
  entryBase64Bytes: 160_000,
  totalBase64Bytes: 1_000_000,
});

export const REPLAY_SPEEDS = Object.freeze([0.3, 0.5, 1, 2, 3]);

// Mirrors the debrief's `sufficient` gate: a shorter sortie is not worth storing or replaying.
export const REPLAY_MIN_DURATION_SEC = 5;

export function base64ByteLength(decodedBytes) {
  return Math.ceil(Math.max(0, decodedBytes) / 3) * 4;
}

export function decodedByteBudget(base64Budget) {
  return Math.floor(base64Budget * 3 / 4);
}

/** Merge custom budget overrides with defaults while deriving legacy base64 test budgets cleanly. */
export function resolveReplayBudget(custom = {}) {
  const source = custom && typeof custom === 'object' ? custom : {};
  const hasLegacyEntry = Number.isFinite(source.entryBase64Bytes);
  const hasLegacyTotal = Number.isFinite(source.totalBase64Bytes);
  const entryBase64Bytes = source.entryBase64Bytes ?? REPLAY_BUDGET.entryBase64Bytes;
  const totalBase64Bytes = source.totalBase64Bytes ?? REPLAY_BUDGET.totalBase64Bytes;
  const entryTrackBytes = source.entryTrackBytes
    ?? (hasLegacyEntry ? decodedByteBudget(entryBase64Bytes) : REPLAY_BUDGET.entryTrackBytes);
  const entryReportBytes = source.entryReportBytes
    ?? (hasLegacyEntry ? Math.max(1024, Math.floor(entryBase64Bytes * 3 / 4)) : REPLAY_BUDGET.entryReportBytes);
  const entryDecompressedBytes = source.entryDecompressedBytes
    ?? (CONTAINER_HEADER_BYTES + entryReportBytes + entryTrackBytes);
  const entryCompressedBytes = source.entryCompressedBytes
    ?? (hasLegacyEntry ? entryBase64Bytes : REPLAY_BUDGET.entryCompressedBytes);
  const totalCompressedBytes = source.totalCompressedBytes
    ?? (hasLegacyTotal ? totalBase64Bytes : REPLAY_BUDGET.totalCompressedBytes);
  return Object.freeze({
    entries: source.entries ?? REPLAY_BUDGET.entries,
    entryTrackBytes,
    entryReportBytes,
    entryDecompressedBytes,
    entryCompressedBytes,
    totalCompressedBytes,
    maxLegacyJsonBytes: source.maxLegacyJsonBytes ?? REPLAY_BUDGET.maxLegacyJsonBytes,
    entryBase64Bytes,
    totalBase64Bytes,
  });
}

/** Bytes one recorded frame costs: the local record plus one pose record per remote aircraft. */
export function frameBytes(remoteCount = 0) {
  return RECORD_BYTES + remoteCount * REMOTE_RECORD_BYTES;
}

/** Largest sample count whose binary track encoding still fits `trackBytes`. */
export function maxSamplesForTrack(trackBytes = REPLAY_BUDGET.entryTrackBytes, metadataBytes = 0, remoteCount = 0) {
  const room = trackBytes - HEADER_BYTES - metadataBytes;
  return Math.max(0, Math.floor(room / frameBytes(remoteCount)));
}

/** Largest sample count whose encoding still fits the per-entry budget at `intervalSec`. */
export function maxSamplesFor(base64Budget = REPLAY_BUDGET.entryBase64Bytes, metadataBytes = 0, remoteCount = 0) {
  return maxSamplesForTrack(decodedByteBudget(base64Budget), metadataBytes, remoteCount);
}

/** Longest sortie representable before the coarsest interval also overflows the budget. */
export function maxTrackSeconds(base64Budget = REPLAY_BUDGET.entryBase64Bytes) {
  return maxSamplesFor(base64Budget) * REPLAY_INTERVAL_LADDER.at(-1);
}
