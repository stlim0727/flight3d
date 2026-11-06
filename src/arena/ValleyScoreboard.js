import { VALLEY_SLALOM_RULES } from './generatedValley.js';
import { TAKEOFF_SCORE_RULES } from './TakeoffMission.js';
import { LANDING_SCORE_RULES } from './LandingMission.js';

const KEY = 'flight3d.valley-attempts.v1';
const FINGERPRINT_KEY = 'flight3d.valley-attempts.rules-fingerprint.v1';
const CALLSIGN_KEY = 'flight3d.pilot.callsign';
const TERMINAL = new Set(['succeeded', 'failed', 'aborted']);
const SCORED_TYPES = new Set(['valley', 'valley-slalom', 'takeoff', 'landing']);

/** The characteristics every stored score was judged under: the slalom
 * generation/judging numbers and the takeoff and landing scoring formulas. Any
 * change here rewrites the fingerprint and discards the attempts recorded
 * under the old shape. */
export const SCORE_RULES_FINGERPRINT = JSON.stringify(
  [VALLEY_SLALOM_RULES, TAKEOFF_SCORE_RULES, LANDING_SCORE_RULES]);

/** Clean and sanitize a pilot callsign (max 8 uppercase alphanumeric chars, default MAV). */
export function sanitizeCallsign(raw) {
  if (typeof raw !== 'string') return 'MAV';
  const clean = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8).toUpperCase();
  return clean || 'MAV';
}

/** A claimed name belongs to a human line only. Human runs hold the controls from
 * tick 0 (and taking over an AI or demo run aborts it before it can be recorded),
 * so a recorded human attempt always flew under its pilot's control from the
 * start. An AI flight is never attributable to a person: it is stamped AI. */
function attemptCallsign(record, callsign) {
  return record.pilotKind === 'human' ? sanitizeCallsign(callsign) : 'AI';
}

/** Recorded attempts for every judged mission. Only matching comparison keys
 * can be ranked with each other. */
export function valleyAttempt(record, { callsign } = {}) {
  const m = record?.manifest;
  if (!SCORED_TYPES.has(m?.type) || !TERMINAL.has(record.status)) return null;
  const conditions = { mission: m.id, rulesVersion: m.rulesVersion, terrain: m.terrain,
    environmentProfile: m.environmentProfile, environmentSeed: m.environmentSeed,
    sensorSeed: record.sensorSeed, sensorNoiseEnabled: record.noiseEnabled,
    navigationProfile: m.navigationProfile, sensorProfile: m.sensorProfile,
    fixedConfiguration: m.fixedConfiguration, configuredState: m.configuredState };
  return { id: crypto.randomUUID(), recordedAt: new Date().toISOString(),
    callsign: attemptCallsign(record, callsign),
    pilotKind: record.pilotKind, sourceHash: record.sourceHash,
    conditions, comparisonKey: JSON.stringify(conditions),
    status: record.status, reason: record.reason, durationSeconds: record.tick / m.physicsHz,
    metrics: { ...record.result?.metrics,
      finalScore: record.status === 'succeeded' ? record.result?.metrics?.finalScore ?? null : null,
      altitudeCostM: record.status === 'succeeded' ? record.result?.metrics?.altitudeCostM ?? null : null } };
}

export class ValleyScoreboard {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage ?? { getItem: () => null, setItem: () => {} };
    this.error = null;
  }

  getSavedCallsign() {
    try { return sanitizeCallsign(this.storage.getItem(CALLSIGN_KEY)); }
    catch { return 'MAV'; }
  }

  saveCallsign(callsign) {
    const clean = sanitizeCallsign(callsign);
    try { this.storage.setItem(CALLSIGN_KEY, clean); }
    catch (e) { this.error = e.message; }
    return clean;
  }

  /** Discard all stored attempts and stamp the current rules fingerprint. */
  reset() {
    try {
      this.storage.setItem(FINGERPRINT_KEY, SCORE_RULES_FINGERPRINT);
      this.storage.setItem(KEY, '[]');
      this.error = null;
      return true;
    } catch (error) { this.error = error.message; return false; }
  }

  read() {
    try {
      if (this.storage.getItem(FINGERPRINT_KEY) !== SCORE_RULES_FINGERPRINT) {
        this.reset();
        return [];
      }
      const rows = JSON.parse(this.storage.getItem(KEY) ?? '[]');
      if (!Array.isArray(rows)) throw new Error('Invalid local scoreboard');
      return rows.filter(row => row && TERMINAL.has(row.status) && typeof row.comparisonKey === 'string');
    } catch (error) { this.error = error.message; return []; }
  }

  add(record, { callsign } = {}) {
    const resolvedCallsign = callsign ?? this.getSavedCallsign();
    const attempt = valleyAttempt(record, { callsign: resolvedCallsign });
    if (!attempt) return null;
    const rows = this.read();
    try {
      this.storage.setItem(KEY, JSON.stringify([...rows, attempt].slice(-200)));
      this.error = null;
    } catch (error) { this.error = error.message; }
    return attempt;
  }

  updateCallsign(attemptId, newCallsign) {
    if (!attemptId) return false;
    const rows = this.read();
    const target = rows.find(r => r.id === attemptId);
    if (!target || target.pilotKind !== 'human') return false;
    const clean = this.saveCallsign(newCallsign);
    target.callsign = clean;
    try {
      this.storage.setItem(KEY, JSON.stringify(rows));
      return true;
    } catch { return false; }
  }

  getLeaderboard(limit = 5, comparisonKey = null) {
    const rows = this.read().filter(r => (!comparisonKey || r.comparisonKey === comparisonKey) && r.status === 'succeeded');
    rows.sort((a, b) => {
      const scoreA = a.metrics?.finalScore;
      const scoreB = b.metrics?.finalScore;
      if (scoreA != null && scoreB != null) {
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.durationSeconds - b.durationSeconds;
      }
      if (scoreA != null) return -1;
      if (scoreB != null) return 1;
      return (a.metrics?.altitudeCostM ?? Infinity) - (b.metrics?.altitudeCostM ?? Infinity);
    });

    return rows.slice(0, limit).map((r, index) => ({
      rank: index + 1,
      id: r.id,
      callsign: r.callsign || (r.pilotKind === 'human' ? 'HUMAN' : 'AI-BOT'),
      pilotKind: r.pilotKind,
      score: r.metrics?.finalScore ?? Math.round(10000 / Math.max(1, r.metrics?.altitudeCostM ?? 100)),
      altitudeCostM: r.metrics?.altitudeCostM,
      durationSeconds: r.durationSeconds,
      meanSpeedKt: Number.isFinite(r.metrics?.meanIasKnots) ? Math.round(r.metrics.meanIasKnots) : null,
      recordedAt: r.recordedAt,
    }));
  }
}
