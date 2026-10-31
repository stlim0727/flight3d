import { createMissionManifest, validateMissionManifest } from './missionConfig.js';

export const headingError = (heading, runway) => ((heading - runway + 540) % 360) - 180;
const numeric = ['iasKnots', 'groundSpeedKnots', 'rollDeg', 'headingDeg', 'vsiFpm', 'radioAltFt',
  'runwayS', 'centerlineOffsetM', 'heightAboveRunwayM'];
const ids = ['nose', 'mainLeft', 'mainRight'];

/** Trusted post-physics snapshot. Gear locations are actual contact points in runway coordinates.
 * sinkRateMs is max(0,-contactVelocity.dot(groundNormal)), even at first gentle contact.
 * Do not derive contact onset only from touchdownContacts: the gear model omits <=0.25m/s events.
 */
export function validMissionSnapshot(s) {
  return s && Number.isInteger(s.tick) && s.tick > 0 && numeric.every(k => Number.isFinite(s[k])) &&
    s.iasKnots >= 0 && s.groundSpeedKnots >= 0 &&
    ['crashed', 'damaged', 'bodyContact'].every(k => typeof s[k] === 'boolean') &&
    Array.isArray(s.gearContacts) && s.gearContacts.length === 3 && ids.every(id =>
      s.gearContacts.filter(c => c?.id === id).length === 1) && s.gearContacts.every(c =>
      typeof c.grounded === 'boolean' && ['runwayS', 'centerlineOffsetM', 'sinkRateMs'].every(k => Number.isFinite(c[k])) &&
      c.sinkRateMs >= 0);
}

export class MissionState {
  constructor(type, manifest) {
    this.manifest = structuredClone(manifest ?? createMissionManifest(type));
    validateMissionManifest(this.manifest);
    if (this.manifest.type !== type) throw new TypeError('Wrong mission manifest');
    this.status = 'running'; this.reason = null; this.tick = 0; this.metrics = {};
  }
  finish(status, reason) { this.status = status; this.reason = reason; return this.result(); }
  fail(reason) { return this.finish('failed', reason); }
  result() { return structuredClone({ status: this.status, reason: this.reason, tick: this.tick, metrics: this.metrics }); }
  accept(s) {
    if (this.status !== 'running') return false;
    if (!validMissionSnapshot(s) || s.tick !== this.tick + 1) { this.fail('invalid-snapshot'); return false; }
    this.tick = s.tick;
    if (s.crashed || s.damaged || s.bodyContact) {
      this.fail(s.crashed ? 'crash' : s.bodyContact ? 'body-strike' : 'damage'); return false;
    }
    // The deadline tick is terminal; a fixed-length sweep must never return
    // 'running' merely because its last step reached the time limit exactly.
    if (this.tick >= this.manifest.timeoutTicks) { this.fail('timeout'); return false; }
    return true;
  }
  outside(c) {
    const m = this.manifest;
    return c.runwayS < m.runwayStartS || c.runwayS > m.runwayEndS || Math.abs(c.centerlineOffsetM) > m.runwayWidthM / 2;
  }
}
