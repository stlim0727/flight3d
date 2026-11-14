import * as THREE from 'three';

/** Deliberately simplified, omnidirectional optical plume-warning fixture.
 * These are simulation assumptions, not specifications for an F-16 sensor.
 * No target identity, seeker lock or future trajectory is exposed to the pilot.
 */
export const BANDIT_WARNING_MODEL = Object.freeze({
  rangeM: 4000,
  minClosingMps: 50,
  confirmationSeconds: 0.65,
  memorySeconds: 3,
  responseSeconds: 0.45,
  recoverySeconds: 1.5,
  terrainSampleM: 150,
});

export class BanditThreatResponse {
  constructor(enabled = true) {
    this.enabled = enabled;
    this._relative = new THREE.Vector3();
    this._velocity = new THREE.Vector3();
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
    if (!this.enabled) {
      this.reset();
      return;
    }
    const model = BANDIT_WARNING_MODEL;
    let observed = null;
    let urgency = Infinity;
    for (const missile of missiles) {
      // Only burning plumes are visible in this fixture. A spent missile may
      // remain dangerous, but the pilot gets only finite last-observation memory.
      if (!missile.alive || !(missile.propellant > 0)) continue;
      this._relative.subVectors(missile.position, aircraft.position);
      const range = this._relative.length();
      if (range < 1 || range > model.rangeM) continue;
      this._velocity.subVectors(missile.velocity, aircraft.velocity);
      const closing = -this._relative.dot(this._velocity) / range;
      if (closing < model.minClosingMps) continue;
      const time = range / closing;
      if (time >= urgency || !this._visible(aircraft.position, missile.position, range, terrainHeight)) continue;
      observed = missile;
      urgency = time;
    }

    const observedId = observed?.id ?? null;
    this.exposure = observed
      ? (observedId === this.observedId ? this.exposure + dt : dt)
      : 0;
    this.observedId = observedId;

    // Maintain the escape side through one encounter; noisy bearing changes
    // must not flip the requested turn back and forth.
    if (observed && this.exposure >= model.confirmationSeconds) {
      const dx = observed.position.x - aircraft.position.x;
      const dz = observed.position.z - aircraft.position.z;
      if (this.confirmedId !== observedId) {
        this.turnSide = (-dz * aircraft.velocity.x + dx * aircraft.velocity.z) >= 0 ? 1 : -1;
      }
      // A near-vertical sightline has no usable horizontal bearing: retain the
      // aircraft's horizontal course instead of inventing a compass direction.
      this.heading = Math.hypot(dx, dz) < 1
        ? Math.atan2(aircraft.velocity.x, -aircraft.velocity.z)
        : Math.atan2(-dz * this.turnSide, -dx * this.turnSide);
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
