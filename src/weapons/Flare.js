// Illustrative point-source parameters, not measured countermeasure properties.
export const FLARE_MODEL = Object.freeze({ capacity: 8, lifetimeS: 6, dragTimeS: 2,
  gravityMps2: 9.81, peakEmission: 6, riseTimeS: 0.15, decayTimeS: 2 });

let nextFlareId = 0;

export class Flare {
  constructor(position, velocity, { sourceId = null } = {}) {
    this.id = ++nextFlareId;
    this.sourceId = sourceId;
    this.type = 'flare';
    this.alive = true;
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.age = 0;
    this.infraredEmission = 0;
  }

  update(dt) {
    if (!this.alive || dt <= 0) return;
    this.age += dt;
    const damping = Math.exp(-dt / FLARE_MODEL.dragTimeS);
    this.velocity.x *= damping;
    this.velocity.z *= damping;
    const terminal = -FLARE_MODEL.gravityMps2 * FLARE_MODEL.dragTimeS;
    this.velocity.y = terminal + (this.velocity.y - terminal) * damping;
    this.position.addScaledVector(this.velocity, dt);
    this.infraredEmission = FLARE_MODEL.peakEmission * (1 - Math.exp(-this.age / FLARE_MODEL.riseTimeS))
      * Math.exp(-this.age / FLARE_MODEL.decayTimeS);
    if (this.age >= FLARE_MODEL.lifetimeS) this.alive = false;
  }
}

export class FlareDispenser {
  constructor(capacity = FLARE_MODEL.capacity) { this.capacity = capacity; this.reset(); }
  reset() { this.remaining = this.capacity; }
  dispense(position, velocity, { sourceId = null } = {}) {
    if (this.remaining <= 0) return null;
    this.remaining--;
    return new Flare(position, velocity, { sourceId });
  }
}
