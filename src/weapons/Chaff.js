// Illustrative simulation parameters, not an aircraft's real dispenser or RCS.
export const CHAFF_MODEL = Object.freeze({ capacity: 8, lifetimeS: 12, dragTimeS: 2,
  settlingMps: 4, peakRcsM2: 8, buildTimeS: 0.5, decayTimeS: 4 });

let nextChaffId = 0;

export class ChaffCloud {
  constructor(position, velocity, { sourceId = null } = {}) {
    this.id = ++nextChaffId;
    this.sourceId = sourceId;
    this.type = 'chaff';
    this.alive = true;
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.age = 0;
    this.radarCrossSectionM2 = 0;
  }

  update(dt) {
    if (!this.alive || dt <= 0) return;
    this.age += dt;
    const damping = Math.exp(-dt / CHAFF_MODEL.dragTimeS);
    this.velocity.x *= damping;
    this.velocity.z *= damping;
    this.velocity.y = -CHAFF_MODEL.settlingMps + (this.velocity.y + CHAFF_MODEL.settlingMps) * damping;
    this.position.addScaledVector(this.velocity, dt);
    this.radarCrossSectionM2 = CHAFF_MODEL.peakRcsM2 * (1 - Math.exp(-this.age / CHAFF_MODEL.buildTimeS))
      * Math.exp(-this.age / CHAFF_MODEL.decayTimeS);
    if (this.age >= CHAFF_MODEL.lifetimeS) this.alive = false;
  }
}

export class ChaffDispenser {
  constructor(capacity = CHAFF_MODEL.capacity) { this.capacity = capacity; this.reset(); }
  reset() { this.remaining = this.capacity; }
  dispense(position, velocity, { sourceId = null } = {}) {
    if (this.remaining <= 0) return null;
    this.remaining--;
    return new ChaffCloud(position, velocity, { sourceId });
  }
}
