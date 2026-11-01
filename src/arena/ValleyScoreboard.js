const KEY = 'flight3d.valley-attempts.v1';
const TERMINAL = new Set(['succeeded', 'failed', 'aborted']);

/** Local, unranked attempts. Only matching comparison keys can be ranked. */
export function valleyAttempt(record) {
  const m = record?.manifest;
  if (m?.type !== 'valley' || !TERMINAL.has(record.status)) return null;
  const conditions = { mission: m.id, rulesVersion: m.rulesVersion, terrain: m.terrain,
    environmentProfile: m.environmentProfile, environmentSeed: m.environmentSeed,
    sensorSeed: record.sensorSeed, sensorNoiseEnabled: record.noiseEnabled,
    navigationProfile: m.navigationProfile, sensorProfile: m.sensorProfile,
    fixedConfiguration: m.fixedConfiguration, configuredState: m.configuredState };
  return { id: crypto.randomUUID(), recordedAt: new Date().toISOString(),
    pilotKind: record.pilotKind, sourceHash: record.sourceHash,
    conditions, comparisonKey: JSON.stringify(conditions),
    status: record.status, reason: record.reason, durationSeconds: record.tick / m.physicsHz,
    metrics: { ...record.result?.metrics,
      finalScore: record.status === 'succeeded' ? record.result?.metrics?.finalScore ?? null : null,
      altitudeCostM: record.status === 'succeeded' ? record.result?.metrics?.altitudeCostM ?? null : null } };
}

export class ValleyScoreboard {
  constructor(storage) { this.storage = storage; this.error = null; }
  read() {
    try {
      const rows = JSON.parse(this.storage.getItem(KEY) ?? '[]');
      if (!Array.isArray(rows)) throw new Error('Invalid local scoreboard');
      return rows.filter(row => row && TERMINAL.has(row.status) && typeof row.comparisonKey === 'string');
    } catch (error) { this.error = error.message; return []; }
  }
  add(record) {
    const attempt = valleyAttempt(record);
    if (!attempt) return null;
    const rows = this.read();
    try { this.storage.setItem(KEY, JSON.stringify([...rows, attempt].slice(-200))); this.error = null; }
    catch (error) { this.error = error.message; }
    return attempt;
  }
}
