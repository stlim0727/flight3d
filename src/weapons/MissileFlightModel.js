import * as THREE from 'three';

const GRAVITY = 9.80665;
const FORWARD = new THREE.Vector3(0, 0, -1);

/** Velocity-aligned point mass; coefficients use missile frontal reference area.
 * This is an aerodynamic game model, not a validated missile/actuator model.
 * The controller requests acceleration; only achievable force drives the motion.
 */
export class MissileFlightModel {
  constructor() {
    this.lateralAcceleration = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.request = new THREE.Vector3();
    this.turnAxis = new THREE.Vector3();
    this.oldVelocity = new THREE.Vector3();
    this.dynamicPressurePa = 0;
    this.availableLateralMps2 = 0;
    this.requestedLateralMps2 = 0;
    this.deliveredLateralMps2 = 0;
    this.baseDragN = 0;
    this.maneuverDragN = 0;
    this.massKg = 0;
    this.thrustN = 0;
  }

  step(dt, missile, { massKg, thrustN, density, command, tracking = false, gravity = GRAVITY }) {
    const spec = missile.spec;
    const velocity = missile.velocity;
    const speed = velocity.length();
    this.oldVelocity.copy(velocity);
    if (speed > 1e-6) this.direction.copy(velocity).divideScalar(speed);
    else this.direction.copy(FORWARD).applyQuaternion(missile.quaternion);

    this.massKg = massKg;
    this.thrustN = thrustN;
    this.dynamicPressurePa = 0.5 * density * speed * speed;
    const qArea = this.dynamicPressurePa * spec.crossSectionM2;

    // TVC enables high-alpha trimming during motor burn, elevating effective body CLmax
    const burnFraction = (spec.tvc && spec.maxThrustN > 0) ? Math.max(0, thrustN) / spec.maxThrustN : 0;
    const maxCl = spec.tvc
      ? spec.maxLiftCoefficient + ((spec.tvcMaxLiftCoefficient ?? spec.maxLiftCoefficient) - spec.maxLiftCoefficient) * burnFraction
      : spec.maxLiftCoefficient;
    const aeroLateralMps2 = massKg > 0 ? (qArea * maxCl) / massKg : 0;

    // Direct nozzle vane lateral thrust component: F_tvc = thrustN * sin(delta_max)
    const maxDeflectionRad = THREE.MathUtils.degToRad(spec.tvcMaxDeflectionDeg ?? 20);
    const sinMaxDeflection = Math.sin(maxDeflectionRad);
    const maxTvcLatMps2 = (spec.tvc && massKg > 0 && thrustN > 0) ? (thrustN * sinMaxDeflection) / massKg : 0;

    this.availableLateralMps2 = Math.min(spec.maxLateralG * GRAVITY,
      aeroLateralMps2 + maxTvcLatMps2);

    this.request.copy(command);
    // Guidance compensates gravity only while tracking, and pays for that lift.
    this.request.y += tracking ? gravity : 0;
    this.request.addScaledVector(this.direction, -this.request.dot(this.direction));
    this.requestedLateralMps2 = this.request.length();
    this.request.clampLength(0, this.availableLateralMps2);
    const response = 1 - Math.exp(-dt / spec.autopilotTimeConstantS);
    this.lateralAcceleration.lerp(this.request, response);
    this.lateralAcceleration.addScaledVector(this.direction,
      -this.lateralAcceleration.dot(this.direction));
    // Re-limit AFTER response filtering. Stored actuator demand cannot preserve
    // yesterday's force when dynamic pressure or the structural limit falls.
    this.lateralAcceleration.clampLength(0, this.availableLateralMps2);
    this.deliveredLateralMps2 = this.lateralAcceleration.length();

    // Partition lateral acceleration between aerodynamic lift and direct nozzle thrust vectoring
    const aeroDemandMps2 = Math.min(this.deliveredLateralMps2, aeroLateralMps2);
    const tvcDemandMps2 = Math.min(maxTvcLatMps2, Math.max(0, this.deliveredLateralMps2 - aeroDemandMps2));

    const liftCoefficient = qArea > 0 ? (massKg * aeroDemandMps2) / qArea : 0;
    this.baseDragN = qArea * spec.dragCoefficient;
    this.maneuverDragN = qArea * spec.inducedDragFactor * liftCoefficient * liftCoefficient;

    // Axial thrust loss corresponds exactly to nozzle vane deflection: T_axial = T * cos(delta)
    const sinDeflection = (thrustN > 0 && massKg > 0)
      ? Math.min(sinMaxDeflection, (massKg * tvcDemandMps2) / thrustN)
      : 0;
    const cosDeflection = Math.sqrt(Math.max(0, 1 - sinDeflection * sinDeflection));
    const effectiveThrustN = thrustN * cosDeflection;

    // Positive, dissipative scalar drag update (no drag-induced reversal).
    // Rotate velocity for lateral control instead of an Euler vector kick:
    // normal force must not manufacture kinetic energy during a discrete turn.
    const dragRate = speed > 0 ? (this.baseDragN + this.maneuverDragN) / (massKg * speed) : 0;
    const nextSpeed = (speed + effectiveThrustN * dt / massKg) / (1 + dragRate * dt);
    this.turnAxis.crossVectors(this.direction, this.lateralAcceleration);
    const angle = this.deliveredLateralMps2 * dt / Math.max((speed + nextSpeed) * 0.5, 1e-6);
    velocity.copy(this.direction);
    if (this.turnAxis.lengthSq() > 0) velocity.applyAxisAngle(this.turnAxis.normalize(), angle);
    velocity.multiplyScalar(nextSpeed);
    // Full external gravity remains active after lock loss and during coast.
    velocity.y -= gravity * dt;
    missile.position.addScaledVector(this.oldVelocity, dt * 0.5).addScaledVector(velocity, dt * 0.5);
    if (velocity.lengthSq() > 1e-12) {
      this.direction.copy(velocity).normalize();
      missile.quaternion.setFromUnitVectors(FORWARD, this.direction);
    }
  }
}
