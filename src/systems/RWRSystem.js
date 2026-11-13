import * as THREE from 'three';

const scratchForward = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchToThreat = new THREE.Vector3();
const scratchThreatForward = new THREE.Vector3();
const scratchMissileToPlayer = new THREE.Vector3();

export const RWR_LEVELS = ['none', 'search', 'lock', 'launch'];

/**
 * Radar warning receiver. Threat emitters are described by position, velocity
 * and hostility; the player is warned in three escalating stages:
 * search (radar visible), lock (emitter bears on the player) and launch
 * (a hostile missile is closing on the player).
 */
export class RWRSystem {
  constructor({
    searchRangeM = 20000,
    lockRangeM = 12000,
    lockFovDeg = 40,
    launchRangeM = 14000,
    launchFovDeg = 25,
  } = {}) {
    this.searchRangeM = searchRangeM;
    this.lockRangeM = lockRangeM;
    this.lockFovCos = Math.cos(THREE.MathUtils.degToRad(lockFovDeg));
    this.launchRangeM = launchRangeM;
    this.launchFovCos = Math.cos(THREE.MathUtils.degToRad(launchFovDeg));
    this.contacts = [];
    this.level = 0;
    this.levelName = 'none';
    this.launchWarning = false;
    this.lockWarning = false;
  }

  reset() {
    this.contacts.length = 0;
    this.level = 0;
    this.levelName = 'none';
    this.launchWarning = false;
    this.lockWarning = false;
  }

  update(dt, { position, quaternion, threats = [], incoming = [] }) {
    void dt;
    this.contacts.length = 0;
    this.launchWarning = false;
    this.lockWarning = false;
    if (!position || !quaternion) {
      this.level = 0;
      this.levelName = 'none';
      return this.state();
    }

    scratchForward.set(0, 0, -1).applyQuaternion(quaternion);
    scratchRight.set(1, 0, 0).applyQuaternion(quaternion);

    for (const threat of threats) {
      if (threat.alive === false || !threat.position) continue;
      scratchToThreat.copy(threat.position).sub(position);
      const rangeM = scratchToThreat.length();
      if (rangeM > this.searchRangeM || rangeM < 1) continue;

      const horizontal = Math.hypot(scratchToThreat.x, scratchToThreat.z);
      const bearingRad = Math.atan2(
        scratchToThreat.x * scratchRight.x + scratchToThreat.z * scratchRight.z,
        scratchToThreat.x * scratchForward.x + scratchToThreat.z * scratchForward.z,
      );
      const elevationRad = Math.atan2(scratchToThreat.y, Math.max(1e-6, horizontal));

      let tracking = false;
      if (threat.velocity && threat.velocity.lengthSq() > 1) {
        scratchThreatForward.copy(threat.velocity).normalize();
        scratchMissileToPlayer.copy(position).sub(threat.position).normalize();
        tracking = rangeM <= this.lockRangeM
          && scratchThreatForward.dot(scratchMissileToPlayer) >= this.lockFovCos;
      }
      if (tracking) this.lockWarning = true;
      this.contacts.push({
        type: threat.type || 'bandit',
        callsign: threat.callsign || '',
        kind: tracking ? 'lock' : 'search',
        bearingRad,
        elevationRad,
        rangeM,
        level: tracking ? 2 : 1,
      });
    }

    for (const missile of incoming) {
      if (!missile || missile.alive === false || !missile.position) continue;
      scratchToThreat.copy(position).sub(missile.position);
      const rangeM = scratchToThreat.length();
      if (rangeM > this.launchRangeM || rangeM < 1) continue;
      if (missile.velocity && missile.velocity.lengthSq() > 1) {
        scratchMissileToPlayer.copy(scratchToThreat).normalize();
        scratchThreatForward.copy(missile.velocity).normalize();
        if (scratchThreatForward.dot(scratchMissileToPlayer) < this.launchFovCos) continue;
      }
      this.launchWarning = true;
      // Approach uses missile-to-player; display uses player-to-missile,
      // matching emitter contacts above (including elevation).
      scratchToThreat.negate();
      const horizontal = Math.hypot(scratchToThreat.x, scratchToThreat.z);
      const bearingRad = Math.atan2(
        scratchToThreat.x * scratchRight.x + scratchToThreat.z * scratchRight.z,
        scratchToThreat.x * scratchForward.x + scratchToThreat.z * scratchForward.z,
      );
      this.contacts.push({
        type: 'missile',
        callsign: '',
        kind: 'launch',
        bearingRad,
        elevationRad: Math.atan2(scratchToThreat.y, Math.max(1e-6, horizontal)),
        rangeM,
        level: 3,
      });
    }

    this.level = this.launchWarning ? 3 : this.lockWarning ? 2 : this.contacts.length ? 1 : 0;
    this.levelName = RWR_LEVELS[this.level];
    return this.state();
  }

  state() {
    return {
      level: this.level,
      levelName: this.levelName,
      launchWarning: this.launchWarning,
      lockWarning: this.lockWarning,
      contacts: this.contacts.map(contact => ({
        type: contact.type,
        callsign: contact.callsign,
        kind: contact.kind,
        bearingRad: contact.bearingRad,
        elevationRad: contact.elevationRad,
        rangeM: contact.rangeM,
        level: contact.level,
      })),
    };
  }
}
