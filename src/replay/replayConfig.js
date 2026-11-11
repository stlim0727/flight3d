// Budgets are expressed in base64 bytes because that is what localStorage stores.
export const REPLAY_INTERVAL_SEC = 0.2;
export const REPLAY_INTERVAL_LADDER = Object.freeze([0.2, 0.4, 0.8, 1.6]);
export const RECORD_BYTES = 80;
// A multiplayer room track adds one pose-only record per remote aircraft to every frame.
export const REMOTE_RECORD_BYTES = 23;
export const HEADER_BYTES = 18;

export const REPLAY_BUDGET = Object.freeze({
  entryBase64Bytes: 160_000,
  entries: 8,
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

/** Bytes one recorded frame costs: the local record plus one pose record per remote aircraft. */
export function frameBytes(remoteCount = 0) {
  return RECORD_BYTES + remoteCount * REMOTE_RECORD_BYTES;
}

/** Largest sample count whose encoding still fits the per-entry budget at `intervalSec`. */
export function maxSamplesFor(base64Budget = REPLAY_BUDGET.entryBase64Bytes, metadataBytes = 0, remoteCount = 0) {
  const room = decodedByteBudget(base64Budget) - HEADER_BYTES - metadataBytes;
  return Math.max(0, Math.floor(room / frameBytes(remoteCount)));
}

/** Longest sortie representable before the coarsest interval also overflows the budget. */
export function maxTrackSeconds(base64Budget = REPLAY_BUDGET.entryBase64Bytes) {
  return maxSamplesFor(base64Budget) * REPLAY_INTERVAL_LADDER.at(-1);
}
