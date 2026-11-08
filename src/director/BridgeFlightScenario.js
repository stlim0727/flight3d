import { BridgeCollision } from './BridgeCollision.js';
import { t } from '../i18n/index.js';

// Neon Metropolis bridge flight (#551): the canal and its bridges are part of the city, so
// the scenario only holds calm wind and adds the swept C172 contact with the bridges,
// water and quay walls on top of the city's own collision.
export class BridgeFlightScenario {
  constructor(sim) {
    this.sim = sim; this.collision = new BridgeCollision();
  }
  get active() { return Boolean(this.saved); }
  start() {
    const s = this.sim;
    this.saved ??= { wind: s.aero.windWorld.clone() };
    s.cameraSystem.trauma = 0;
    s.aero.windWorld.set(0, 0, 0);
    this.collision.reset();
  }
  stop() {
    if (!this.saved) return;
    const s = this.sim, saved = this.saved; this.saved = null;
    s.aero.windWorld.copy(saved.wind);
  }
  update() {
    if (!this.active) return;
    const s = this.sim;
    if (s.isCrashed) return;
    const contact = this.collision.update(s.position, s.quaternion);
    if (contact) {
      const structure = contact.structure;
      s.triggerCrash({ collided: true, type: structure === 'water' ? 'WATER' : structure === 'wall' ? 'TERRAIN' : 'BUILDING',
        name: t('bridge.contact'), description: t('bridge.contact'), point: s.position.clone(), speedKnots: s.linearVelocity.length() * 1.94384 });
    }
  }
}
