/** Pure aggregation for the shared leaderboard snapshot. Rows arrive from a
 * PostHog HogQL query over `score_submitted` events; only identical run
 * conditions may share a board, and only successful scores are ranked. */
export function groupTop(rows, { limit = 5 } = {}) {
  const byKey = new Map();
  for (const row of rows) {
    if (!row?.comparisonKeyHash || !(Number(row.score) > 0)) continue;
    const board = byKey.get(row.comparisonKeyHash) ?? { mission: row.mission, comparisonKeyHash: row.comparisonKeyHash, top: [] };
    board.top.push(row);
    byKey.set(row.comparisonKeyHash, board);
  }
  return [...byKey.values()].map(board => {
    board.top.sort((a, b) => Number(b.score) - Number(a.score) ||
      Number(a.durationSeconds) - Number(b.durationSeconds));
    return { ...board, top: board.top.slice(0, limit).map((row, index) => ({
      rank: index + 1,
      callsign: row.callsign ?? '?',
      pilotKind: row.pilotKind ?? 'ai',
      score: Number(row.score),
      durationSeconds: Number.isFinite(Number(row.durationSeconds)) ? Number(row.durationSeconds) : null,
      recordedAt: row.recordedAt ?? null,
    })) };
  }).sort((a, b) => a.comparisonKeyHash.localeCompare(b.comparisonKeyHash));
}
