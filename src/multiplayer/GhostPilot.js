import { Vector3, MathUtils } from 'three';
import { createHeadlessSimulation } from '../core/HeadlessSimulation.js';
import { flyBank, flyVerticalPath } from '../director/PilotControlLaws.js';
import { wrapHeading } from '../physics/Autopilot.js';

export const GHOST_CONFIG = Object.freeze({ airport: 'coastal', aircraft: 'B738', scenario: 'cruise' });

/** Real controls/forces at 120 Hz, with no scene, renderer, audio or input listeners. */
export class GhostPilot {
  constructor() { this.reset(); }
  reset() {
    this.sim = createHeadlessSimulation({ aircraftId: GHOST_CONFIG.aircraft });
    const s = this.sim;
    s.setPreset('cruise');
    // Prime telemetry and dynamic-pressure inputs before the first AI decision.
    s.integratePhysics(s.physicsDt);
    this.altitude = s.position.y;
    this.speed = s.telemetry.iasKnots;
    const right = new Vector3(1, 0, 0).applyQuaternion(s.quaternion);
    right.y = 0; right.normalize();
    this.radius = 3500;
    this.center = s.position.clone().addScaledVector(right, this.radius);
    this.accumulator = 0;
  }
  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('invalid elapsed time');
    // Never run a large catch-up burst after a suspended process.
    this.accumulator += Math.min(seconds, .25);
    const s = this.sim;
    while (this.accumulator >= s.physicsDt) {
      const dx = s.position.x - this.center.x, dz = s.position.z - this.center.z;
      const radialError = Math.hypot(dx, dz) - this.radius;
      const desiredHeading = MathUtils.radToDeg(Math.atan2(-dz, -dx))
        + MathUtils.clamp(radialError * .02, -25, 25);
      const headingError = wrapHeading(desiredHeading - s.telemetry.headingDeg);
      const bank = MathUtils.clamp(MathUtils.radToDeg(Math.atan(s.linearVelocity.lengthSq() / (9.80665 * this.radius))) + headingError * 1.2, -28, 28);
      flyBank(s, bank, s.telemetry);
      flyVerticalPath(s, MathUtils.clamp((this.altitude - s.position.y) * .12, -4, 4), this.speed, s.telemetry);
      s.controls.setVirtualInput('rudder', 0);
      s.integratePhysics(s.physicsDt);
      s.totalSimTime += s.physicsDt;
      this.accumulator -= s.physicsDt;
      if (s.isCrashed || ![...s.position, ...s.quaternion, ...s.linearVelocity].every(Number.isFinite)) {
        throw new Error('ghost-flight-failed');
      }
    }
  }
  snapshot() {
    const s = this.sim;
    return { p: s.position.toArray(), q: s.quaternion.toArray(), v: s.linearVelocity.toArray(),
      crashed: false, held: false, gear: s.gear.gearState, flaps: s.aero.currentFlapAngle, talking: false };
  }
}
