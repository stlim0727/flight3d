export const COMBAT_MATRIX_REPORT_VERSION = 1;

const outcomes = {
  'no-lock': 'noLock',
  'fire-failed': 'fireFailed',
  hit: 'kills',
  'detonation-non-lethal': 'nonLethalDetonations',
  'miss-ground': 'groundImpacts',
  'miss-expired': 'expired',
  'miss-other': 'otherMisses',
  'target-destroyed': 'targetDestroyed',
  timeout: 'unresolved',
};

/** Preserve every terminal category and denominator, including empty cohorts. */
export function summarizeCombatResults(results) {
  const summary = { total: results.length, launched: 0 };
  for (const key of Object.values(outcomes)) summary[key] = 0;
  for (const row of results) {
    const outcome = outcomes[row.terminal];
    if (!Object.hasOwn(outcomes, row.terminal) || typeof row.launched !== 'boolean') {
      throw new TypeError(`Invalid combat result: ${row.terminal}`);
    }
    const prelaunch = row.terminal === 'no-lock' || row.terminal === 'fire-failed';
    if (row.launched === prelaunch) throw new TypeError('Inconsistent launch outcome');
    summary[outcome]++;
    if (row.launched) summary.launched++;
  }
  summary.killFractionOfLaunches = summary.launched ? summary.kills / summary.launched : null;
  summary.killFractionOfSituations = summary.total ? summary.kills / summary.total : null;
  return summary;
}

export function combatMatrixCells(results) {
  const cells = new Map();
  for (const row of results) {
    const key = JSON.stringify([row.type, row.rangeM, row.aspectDeg]);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(row);
  }
  return [...cells.values()].map(rows => ({
    type: rows[0].type, rangeM: rows[0].rangeM, aspectDeg: rows[0].aspectDeg,
    ...summarizeCombatResults(rows),
  }));
}
