import * as THREE from 'three';
import { F16_FALCON } from '../config/aircraftConfigs.js';
import { Aerodynamics, createAeroResult } from '../physics/Aerodynamics.js';
import { EngineModel } from '../physics/EngineModel.js';
import { Atmosphere } from '../physics/Atmosphere.js';
import { solveTrim } from '../physics/TrimSolver.js';
import { rebaseCgVelocity, translateModelOrigin } from '../physics/massKinematics.js';
import { flyBank } from '../director/PilotControlLaws.js';

const { clamp, radToDeg } = THREE.MathUtils;

/** Airborne F-16 plant. Guidance commands surfaces; only forces move the aircraft.
 * Uses the player's aerodynamic/engine/mass models and airborne integration.
 * Gear is retracted; terrain impact ends flight rather than simulating a landing.
 */
export class BanditFlightModel {
  constructor(position, velocity) {
    this.position = position;
    this.linearVelocity = velocity;
    this.angularVelocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.aero = new Aerodynamics(F16_FALCON);
    this.engines = new EngineModel(F16_FALCON);
    this.engines.bindMassProperties(this.aero.massProperties);
    this.aero.massProperties.setConfiguration(0, 0);
    this.aero.syncMassProperties();
    this.controls = { throttle: 0.5, setVirtualInput: (axis, value) => {
      if (axis === 'throttle') this.controls.throttle = value;
      else this.aero[axis] = value;
    } };
    this.result = createAeroResult();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.force = new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    this.delta = new THREE.Quaternion();
    this.oldRotation = new THREE.Quaternion();
    this.oldCg = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    const atmosphere = Atmosphere.getConditions(position.y);
    const trim = solveTrim(this.aero, this.engines, {
      altitudeMeters: position.y,
      iasKnots: Atmosphere.msToKnots(velocity.length() * Math.sqrt(atmosphere.densityRatio)),
      gearState: 0,
    });
    const heading = Math.atan2(velocity.x, -velocity.z);
    const gamma = Math.atan2(velocity.y, Math.hypot(velocity.x, velocity.z));
    this.quaternion.setFromEuler(this.euler.set(gamma + (trim.alphaDeg ?? 4) * Math.PI / 180, -heading, 0));
    this.aero.elevator = trim.elevator;
    this.aero.pitchTrim = trim.pitchTrimDeg;
    this.controls.throttle = trim.feasible ? trim.throttle : 0.7;
    this.engines.n1.fill(this.engines.idleN1 + this.controls.throttle * (this.engines.togaN1 - this.engines.idleN1));
    this.measure(1 / 120, 0, 1000);
  }

  measure(dt, thrust, clearance) {
    return this.aero.computeAero(dt, this, this.linearVelocity, this.angularVelocity,
      this.position.y, clearance, thrust, 0, this.result);
  }

  /** Guidance limits are pilot commands, never clamps on velocity or forces. */
  guide(heading, altitude, speed) {
    this.euler.setFromQuaternion(this.quaternion, 'YXZ');
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    const currentHeading = Math.atan2(this.forward.x, -this.forward.z);
    const error = Math.atan2(Math.sin(heading - currentHeading), Math.cos(heading - currentHeading));
    const tel = { rollDeg: -radToDeg(this.euler.z), pitchDeg: radToDeg(this.euler.x),
      iasKnots: Atmosphere.msToKnots(this.aero.ias) };
    // Reserve alpha/lift margin and keep commanded normal load below 7G.
    // The 9G structural figure is not a promise of sustained turn capability.
    const availableLoad = this.aero.qDyn * this.aero.wingArea
      * (this.aero.CL0_clean + this.aero.CLa * 12 * Math.PI / 180)
      / (this.aero.mass * Atmosphere.G0);
    const bankLimit = radToDeg(Math.acos(1 / Math.max(1, Math.min(7, availableLoad))));
    flyBank(this, clamp(radToDeg(error) * 1.8, -bankLimit, bankLimit), tel);
    const targetVz = clamp((altitude - this.position.y) * 0.18, -35, 45);
    const bank = -this.euler.z;
    const tas = Math.max(30, this.aero.tas);
    const gamma = Math.atan2(this.linearVelocity.y, Math.hypot(this.linearVelocity.x, this.linearVelocity.z));
    const verticalAcceleration = clamp((targetVz - this.linearVelocity.y) * 0.5, -4, 5);
    const load = clamp((Math.cos(gamma) + verticalAcceleration / Atmosphere.G0)
      / Math.max(0.2, Math.cos(bank)), 0.2, 7);
    const requiredCl = load * this.aero.mass * Atmosphere.G0 / Math.max(1, this.aero.qDyn * this.aero.wingArea);
    const targetAlpha = clamp((requiredCl - this.aero.CL0_clean) / this.aero.CLa, 0, 13.5 * Math.PI / 180);
    // In a coordinated banked turn the body must keep pitching even at steady
    // altitude. Euler-pitch hold alone unloads the wing and spirals downward.
    const desiredRate = (load - Math.cos(bank) * Math.cos(gamma)) * Atmosphere.G0 / tas
      + (targetAlpha - this.aero.alpha) * 1.8;
    const desiredMoment = this.aero.Iyy * (desiredRate - this.angularVelocity.x) * 4;
    const authority = Math.max(1, this.aero.qDyn * this.aero.wingArea * this.aero.meanChord
      * -this.aero.Cm_de * Math.PI / 9 * (1 - 0.8 * this.aero.separation));
    const elevator = clamp(this.aero.elevator + (desiredMoment - this.result.momentBody.x) / authority, -0.8, 0.8);
    this.aero.elevator = elevator;
    const density = Atmosphere.getConditions(this.position.y).densityRatio;
    const targetIas = Atmosphere.msToKnots(speed * Math.sqrt(density));
    this.controls.throttle = clamp(0.5 + (targetIas - tel.iasKnots) * 0.035 + targetVz * 0.02, 0.05, 1);
    // Sideslip and yaw-rate feedback coordinate the turn through the rudder.
    this.aero.rudder = clamp(this.aero.beta * 2 + this.angularVelocity.y * 0.6, -0.6, 0.6);
  }

  step(dt, damage = 0, clearance = 1000, damageZones = null) {
    this.oldCg.copy(this.aero.cg);
    this.aero.damageZones = damageZones;
    this.engines.contactDamage[0] = damageZones
      ? Math.max(damage, damageZones.engine ?? 0)
      : damage;
    this.engines.setThrottle(this.controls.throttle);
    const atmosphere = Atmosphere.getConditions(this.position.y);
    const engine = this.engines.update(dt, this.position.y, this.linearVelocity.length(), atmosphere.densityRatio);
    this.aero.syncMassProperties();
    rebaseCgVelocity(this.linearVelocity, this.angularVelocity, this.quaternion, this.oldCg, this.aero.cg);
    // Damage increases drag continuously; the shared engine model loses thrust.
    this.aero.CD0 = F16_FALCON.aerodynamics.cd0Clean * (1 + damage * (damageZones ? 0.8 : 2));
    const result = this.measure(dt, engine.totalThrust, clearance);
    this.force.set(0, 0, -engine.totalThrust).applyQuaternion(this.quaternion)
      .add(result.forceWorld);
    this.force.y -= this.aero.mass * Atmosphere.G0;
    this.linearVelocity.addScaledVector(this.force, dt / this.aero.mass);
    this.acceleration.set(result.momentBody.x * this.aero.invIyy,
      result.momentBody.y * this.aero.invIzz, result.momentBody.z * this.aero.invIxx);
    this.angularVelocity.addScaledVector(this.acceleration, dt).multiplyScalar(Math.max(0, 1 - dt * 0.35));
    this.oldRotation.copy(this.quaternion);
    this.delta.set(this.angularVelocity.x * dt / 2, this.angularVelocity.y * dt / 2,
      this.angularVelocity.z * dt / 2, 1).normalize();
    this.quaternion.multiply(this.delta).normalize();
    translateModelOrigin(this.position, this.linearVelocity, this.oldRotation, this.quaternion, this.aero.cg, dt);
  }
}
