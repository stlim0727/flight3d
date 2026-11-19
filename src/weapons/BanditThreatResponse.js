import * as THREE from 'three';

/** Deliberately simplified, omnidirectional optical plume-warning fixture.
 * These are simulation assumptions, not specifications for an F-16 sensor.
 * No target identity, seeker lock or future trajectory is exposed to the pilot.
 */
export const BANDIT_WARNING_MODEL = Object.freeze({
  rangeM: 4000,
  confirmationSeconds: 0.65,
  memorySeconds: 3,
  responseSeconds: 0.45,
  recoverySeconds: 1.5,
  terrainSampleM: 150,
  rwrRangeM: 8000,
});

export class BanditThreatResponse {
  constructor(enabled = true, { rwr = true } = {}) {
    this.enabled = enabled;
    this.rwr = rwr;
    this._relative = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.phase = 'patrol';
    this.observedId = null;
    this.confirmedId = null;
    this.exposure = 0;
    this.memory = 0;
    this.weight = 0;
    this.heading = 0;
    this.turnSide = 1;
  }

  update(dt, aircraft, missiles, terrainHeight) {
    const warnings = this.enabled ? this.sampleWarnings(aircraft, missiles, terrainHeight) : [];
    const courseRad = Math.atan2(aircraft.velocity.x, -aircraft.velocity.z);
    this.updateFromWarnings(dt, courseRad, warnings);
  }

  sampleWarnings(aircraft, missiles, terrainHeight) {
    const model = BANDIT_WARNING_MODEL;
    const warnings = [];
    for (const missile of missiles) {
      if (!missile.alive) continue;
      this._relative.subVectors(missile.position, aircraft.position);
      const range = this._relative.length();
      if (range < 1) continue;

      const hasPlume = missile.propellant > 0 && range <= model.rangeM;
      let hasRadarWarning = false;
      if (this.rwr && missile.spec?.seekerType === 'ACTIVE_RADAR' && range <= model.rwrRangeM) {
        const speed = missile.velocity.length();
        if (speed > 1e-3) {
          const dot = (-missile.velocity.x * this._relative.x
            - missile.velocity.y * this._relative.y - missile.velocity.z * this._relative.z) / (speed * range);
          const gimbalDeg = missile.spec?.gimbalDeg ?? 65;
          hasRadarWarning = dot >= Math.cos(gimbalDeg * Math.PI / 180);
        }
      }

      if ((!hasPlume && !hasRadarWarning)
        || !this._visible(aircraft.position, missile.position, range, terrainHeight)) continue;
      const bearingRad = Math.hypot(this._relative.x, this._relative.z) < 1
        ? null : Math.atan2(this._relative.x, -this._relative.z);
      warnings.push({ id: missile.id, channel: hasPlume ? 'optical' : 'radar', bearingRad });
    }
    return warnings;
  }

  updateFromWarnings(dt, courseRad, warnings) {
    if (!this.enabled) {
      this.reset();
      return;
    }
    const model = BANDIT_WARNING_MODEL;
    // Keep an existing track while it remains visible. Track selection uses only
    // the warnings delivered by the simulated sensor.
    const observed = warnings.find(warning => warning.id === this.observedId) ?? warnings[0];
    const observedId = observed?.id ?? null;
    this.exposure = observed
      ? (observedId === this.observedId ? this.exposure + dt : dt)
      : 0;
    this.observedId = observedId;

    // Maintain the escape side through one encounter; noisy bearing changes
    // must not flip the requested turn back and forth.
    if (observed && this.exposure >= model.confirmationSeconds) {
      const bearing = observed.bearingRad;
      if (this.confirmedId !== observedId && bearing !== null) {
        this.turnSide = Math.sin(bearing - courseRad) <= 0 ? 1 : -1;
      }
      this.heading = bearing === null ? courseRad : bearing + this.turnSide * Math.PI / 2;
      this.confirmedId = observedId;
      this.memory = model.memorySeconds;
    } else {
      this.memory = Math.max(0, this.memory - dt);
    }

    const demand = this.memory > 0 ? 1 : 0;
    const tau = demand ? model.responseSeconds : model.recoverySeconds;
    this.weight += (demand - this.weight) * (1 - Math.exp(-dt / tau));
    this.phase = demand ? 'evade' : this.weight > 0.01 ? 'recover' : observed ? 'detect' : 'patrol';
    if (!demand && this.weight <= 0.01) this.confirmedId = null;
  }

  _visible(from, to, range, terrainHeight) {
    // Sample the whole sightline at <=150 m spacing. This fixture checks
    // terrain height only; buildings/clouds and real optical signatures remain
    // future sensor work. It never grants sight through sampled terrain.
    const steps = Math.ceil(range / BANDIT_WARNING_MODEL.terrainSampleM);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const z = from.z + (to.z - from.z) * t;
      if (terrainHeight(x, z) >= y) return false;
    }
    return true;
  }
}
