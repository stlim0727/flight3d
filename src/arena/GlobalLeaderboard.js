import { SCORE_RULES_FINGERPRINT } from './ValleyScoreboard.js';

/** Client for the globally shared leaderboard: a static leaderboard.json
 * published with the site by the Pages build, refreshed from PostHog
 * `score_submitted` events. The browser only reads it; submission happens as
 * an analytics event, so there is no write endpoint to trust. */

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export const scoreFingerprintHash = () => sha256Hex(SCORE_RULES_FINGERPRINT);

/** Rows for one exact set of run conditions, or none if the snapshot was
 * generated under different rules or the fetch failed. */
export function rowsForComparison(board, comparisonKeyHash, fingerprintHash) {
  if (!Array.isArray(board?.boards) || board.fingerprintHash !== fingerprintHash) return [];
  const matched = board.boards.find(entry => entry.comparisonKeyHash === comparisonKeyHash);
  return Array.isArray(matched?.top) ? matched.top : [];
}

export async function fetchGlobalLeaderboard(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
