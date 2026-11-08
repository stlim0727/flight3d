import * as THREE from 'three';
import { compliantNormalForce, inverseContactMass } from './contactCompliance.js';

const scratchArm = new THREE.Vector3();
const scratchPoint = new THREE.Vector3();
const scratchPointVel = new THREE.Vector3();
const scratchAngVelWorld = new THREE.Vector3();
const scratchNetForce = new THREE.Vector3();
const scratchNetMoment = new THREE.Vector3();
const scratchPointForce = new THREE.Vector3();
const scratchHorizVel = new THREE.Vector3();
const scratchMomentBody = new THREE.Vector3();
const scratchInvQuat = new THREE.Quaternion();
const ZERO_CG = Object.freeze({ x: 0, y: 0, z: 0 });

// Ditching survivability gates
export const WATER_DITCHING_LIMITS = Object.freeze({
  maxSinkRate: 4.5,     // m/s (~900 fpm) - harder impact causes violent structural breakup
  minPitchDeg: -4.0,    // deg - nose-down dive causes nose plow and violent pitch-over/flip
  maxPitchDeg: 20.0,    // deg - extreme stall attitude
  maxRollDeg: 16.0,     // deg - wingtip strike at speed cartwheels the airframe
  maxSpeedMs: 115.0,    // m/s (~225 kt) - excessive kinetic energy destroys hull on contact
});

/**
 * Continuous Hydrodynamic Water Ditching and Sinking System.
 * 
 * Derives all visible behavior from continuous physical state:
 * - Distributed buoyant upward forces along submerged fuselage patches & wings
 * - Planing & form hydrodynamic drag rapidly dissipating forward kinetic energy
 * - Restoring buoyant moments stabilizing wings and pitch attitude on water
 * - Continuous progressive flooding (taking on water) causing slow, realistic sinking
 * - Sea bottom contact stopping descent once the ocean floor is reached
 */
export class WaterDitching {
  constructor() {
    this.reset();
  }

  reset() {
    this.flooding = 0.0;           // Continuous state [0, 1]: water ingress into hull
    this.timeOnWater = 0.0;        // Elapsed seconds in water contact
    this.ditchingContact = false;  // Latched once safe water ditching contact begins
    this.catastrophic = false;     // True if impact exceeded survivability limits
    this.onWater = false;          // True while any contact probe is submerged
    this.submerged = false;        // True when fully flooded and submerged below surface
    this.timeSinceSubmerged = 0.0; // Seconds spent fully submerged
    this.touchdownVsi = 0.0;       // Sink rate recorded at initial water contact (m/s)
    this.submersion = 0.0;         // Maximum current depth of any patch below water level (m)
    this.sprayIntensity = 0.0;     // [0, 1] for visual spray particle emission
    this.contactPoints = [];       // World positions of active water contact points
    this.waterLevel = 0.0;
  }

  /**
   * Derive the discrete annunciation phase from continuous physical state
   */
  get ditchingPhase() {
    if (!this.onWater && !this.ditchingContact) return 'airborne';
    if (this.submerged) return 'submerged';
    if (this.flooding >= 0.20) return 'sinking';
    if (this.timeOnWater > 0.5 && this.sprayIntensity < 0.25) return 'floating';
    return 'planing';
  }

  /**
   * Update hydrodynamic forces, moments, flooding ingress, and sinking progression.
   * 
   * @param {number} dt Timestep in seconds
   * @param {THREE.Object3D} aircraftMesh Aircraft root group
   * @param {THREE.Vector3} linearVelocity World linear velocity (m/s)
   * @param {THREE.Vector3} angularVelocity Body angular velocity (rad/s)
   * @param {Object} terrain Terrain query object with getHeight and optional getWaterLevel
   * @param {Object} aero Aero properties (mass, inertia, cg)
   * @param {Array} bodySupportPoints Contact patch definitions
   * @param {number} gearState Landing gear deployment state [0, 1]
   * @param {number} pitchDeg Pitch angle in degrees
   * @param {number} rollDeg Roll angle in degrees
   * @param {Object} dynamics Optional mass and inertia overrides
   * @returns {{ forces: THREE.Vector3, moments: THREE.Vector3, onWater: boolean, ditchingContact: boolean, flooding: number, ditchingPhase: string, sprayIntensity: number, submerged: boolean, catastrophic: boolean, contactPoints: Array<THREE.Vector3> }}
   */
  update(dt, aircraftMesh, linearVelocity, angularVelocity, terrain, aero, bodySupportPoints, gearState = 0, pitchDeg = 0, rollDeg = 0, dynamics = null) {
    scratchNetForce.set(0, 0, 0);
    scratchNetMoment.set(0, 0, 0);
    this.contactPoints = [];

    const aircraftPos = aircraftMesh.position;
    const worldQuat = aircraftMesh.quaternion;
    scratchInvQuat.copy(worldQuat).invert();

    const mass = dynamics?.mass ?? aero?.mass ?? 66000;
    const inverseInertia = dynamics?.inverseInertia ?? {
      x: aero?.invIyy ?? 1 / 3450000,
      y: aero?.invIzz ?? 1 / 4850000,
      z: aero?.invIxx ?? 1 / 1650000,
    };
    const cg = aero?.cg ?? ZERO_CG;

    // Check terrain and water level at aircraft position
    const waterLevel = terrain?.getWaterLevel?.(aircraftPos.x, aircraftPos.z) ?? 0.0;
    this.waterLevel = waterLevel;
    const terrainH = terrain?.getHeight?.(aircraftPos.x, aircraftPos.z) ?? -45.0;

    // Water surface exists where natural terrain is at or below sea level
    const hasWater = terrainH <= waterLevel + 1.5;
    if (!hasWater) {
      if (!this.ditchingContact) {
        this.onWater = false;
        this.submersion = 0.0;
        this.sprayIntensity = 0.0;
      }
      return {
        forces: scratchNetForce,
        moments: scratchNetMoment,
        onWater: this.onWater,
        ditchingContact: this.ditchingContact,
        flooding: this.flooding,
        ditchingPhase: this.ditchingPhase,
        sprayIntensity: this.sprayIntensity,
        submerged: this.submerged,
        catastrophic: this.catastrophic,
        contactPoints: this.contactPoints,
      };
    }

    const points = bodySupportPoints || [];
    let submergedCount = 0;
    let maxDepth = 0;
    const submergedPoints = [];

    // CG world position
    const cgWorld = scratchArm.copy(cg).applyQuaternion(worldQuat).add(aircraftPos);
    scratchAngVelWorld.copy(angularVelocity).applyQuaternion(worldQuat);

    // Evaluate all body contact points against water surface
    for (const probe of points) {
      const probePosLocal = new THREE.Vector3(...probe.position);
      const probeWorld = probePosLocal.clone().applyMatrix4(aircraftMesh.matrixWorld);
      const patchFloor = terrain?.getHeight?.(probeWorld.x, probeWorld.z) ?? terrainH;
      const patchWaterLevel = terrain?.getWaterLevel?.(probeWorld.x, probeWorld.z) ?? waterLevel;

      const depth = patchWaterLevel - probeWorld.y;
      if (depth > -0.05) {
        submergedCount++;
        maxDepth = Math.max(maxDepth, depth);
        submergedPoints.push({
          probe,
          probePosLocal,
          probeWorld,
          depth,
          patchFloor,
          patchWaterLevel,
        });
        if (depth > 0) {
          this.contactPoints.push(probeWorld);
        }
      }
    }

    this.submersion = maxDepth;
    this.onWater = submergedCount > 0;

    // Check ditching initiation
    const speedMs = linearVelocity.length();
    const sinkRate = -linearVelocity.y;

    if (this.onWater && !this.ditchingContact && !this.catastrophic) {
      // Evaluate survivability upon initial water impact
      const isFatal = sinkRate > WATER_DITCHING_LIMITS.maxSinkRate ||
        pitchDeg < WATER_DITCHING_LIMITS.minPitchDeg ||
        pitchDeg > WATER_DITCHING_LIMITS.maxPitchDeg ||
        Math.abs(rollDeg) > WATER_DITCHING_LIMITS.maxRollDeg ||
        speedMs > WATER_DITCHING_LIMITS.maxSpeedMs;

      if (isFatal) {
        this.catastrophic = true;
        return {
          forces: scratchNetForce,
          moments: scratchNetMoment,
          onWater: this.onWater,
          ditchingContact: false,
          flooding: this.flooding,
          ditchingPhase: 'airborne',
          sprayIntensity: 1.0,
          submerged: false,
          catastrophic: true,
          contactPoints: this.contactPoints,
        };
      }

      // Safe ditching begins!
      this.ditchingContact = true;
      this.touchdownVsi = sinkRate;
    }

    if (!this.ditchingContact) {
      return {
        forces: scratchNetForce,
        moments: scratchNetMoment,
        onWater: this.onWater,
        ditchingContact: false,
        flooding: this.flooding,
        ditchingPhase: this.ditchingPhase,
        sprayIntensity: 0.0,
        submerged: false,
        catastrophic: false,
        contactPoints: this.contactPoints,
      };
    }

    // --- Active Water Ditching Dynamics ---
    this.timeOnWater += dt;

    // Progressive flooding evolution:
    // Once planing speed drops below 25 m/s (~50 kt), hull begins continuously taking on water.
    // Flooding takes ~20 to 25 seconds to reach 1.0.
    const horizSpeed = Math.hypot(linearVelocity.x, linearVelocity.z);
    if (horizSpeed < 25.0) {
      const floodingRate = 0.045; // ~22.2s for complete flooding
      this.flooding = Math.min(1.0, this.flooding + dt * floodingRate);
    }

    // Sinking equilibrium waterline:
    // As flooding progresses, equilibrium draft lowers the airframe down into the water.
    // Hull sinks up to 5.0m below normal floating waterline.
    const sinkSettlingDepth = this.flooding * 5.0;

    // Calibrate buoyant spring stiffness so at ~0.8m nominal draft, buoyancy balances mass * 9.81
    const nominalDraft = 0.85;
    const totalBuoyancyStiffness = (mass * 9.80665) / nominalDraft;

    // Hydrodynamic forces on each submerged patch
    for (const item of submergedPoints) {
      const { probe, probePosLocal, probeWorld, depth, patchFloor } = item;
      const weight = probe.weight || (1 / (submergedPoints.length || 1));

      // Effective penetration relative to shifting flooded waterline
      const effectiveDepth = depth - sinkSettlingDepth;

      // Contact point velocity: V_point = V_cg + omega x r
      const armWorld = scratchArm.copy(probeWorld).sub(cgWorld);
      const pointVel = scratchPointVel.copy(linearVelocity).add(scratchAngVelWorld.clone().cross(armWorld));
      const vNormal = pointVel.y; // Positive = moving upward out of water

      // Patch mass & compliance
      const normalBody = new THREE.Vector3(0, 1, 0).applyQuaternion(scratchInvQuat);
      const localArm = probePosLocal.clone().sub(cg);
      const invMass = inverseContactMass(localArm, normalBody, mass, inverseInertia);

      const kPatch = totalBuoyancyStiffness * weight;
      // Damping ratio ~0.85 (smooth non-oscillatory buoyant absorption)
      const cPatch = 2.0 * Math.sqrt(kPatch * (mass * weight)) * 0.85;

      // Compliance normal force (buoyant upward thrust)
      let normalLoad = 0;
      if (effectiveDepth > 0) {
        normalLoad = compliantNormalForce(
          effectiveDepth,
          vNormal,
          kPatch,
          cPatch,
          invMass,
          dt
        );
      }

      // Sea floor bedrock support: prevent clipping through underwater terrain
      const seabedPenetration = (patchFloor + 0.2) - probeWorld.y;
      if (seabedPenetration > 0) {
        const seabedLoad = compliantNormalForce(
          seabedPenetration,
          vNormal,
          kPatch * 2.5,
          cPatch * 2.0,
          invMass,
          dt
        );
        normalLoad += seabedLoad;
      }

      // Hydrodynamic horizontal water drag:
      // High-speed planing resistance + viscous form drag
      scratchHorizVel.set(pointVel.x, 0, pointVel.z);
      const patchSpeed = scratchHorizVel.length();
      let dragMag = 0;
      if (patchSpeed > 0.05 && depth > 0) {
        // Planing wave drag: scales with dynamic pressure (0.5 * rho * Cd * A * v^2)
        // Plus friction drag proportional to buoyant load
        const immersionRatio = THREE.MathUtils.clamp(depth / 1.5, 0.1, 1.0);
        const dynamicPlaning = Math.min(mass * 9.80665 * 1.5 * weight, 0.5 * 1000.0 * 0.08 * immersionRatio * (patchSpeed * patchSpeed) * weight);
        const frictionDrag = normalLoad * (0.35 + (gearState > 0.5 ? 0.25 : 0.0));
        dragMag = dynamicPlaning + frictionDrag;

        // Cap drag so individual timestep doesn't reverse velocity
        const maxStoppingDrag = (patchSpeed * mass * weight) / Math.max(dt, 0.001);
        dragMag = Math.min(dragMag, maxStoppingDrag);
      }

      // Sum patch force: upward normal + backward drag
      scratchPointForce.set(0, normalLoad, 0);
      if (patchSpeed > 0.05 && dragMag > 0) {
        scratchPointForce.addScaledVector(scratchHorizVel, -dragMag / patchSpeed);
      }

      scratchNetForce.add(scratchPointForce);

      // Moment produced around CG: M = r x F
      const forceBody = scratchPointForce.clone().applyQuaternion(scratchInvQuat);
      const momentBody = scratchMomentBody.copy(localArm).cross(forceBody);
      scratchNetMoment.add(momentBody);
    }

    // Additional rotational viscous damping in water
    if (this.onWater) {
      const immersion = THREE.MathUtils.clamp(maxDepth / 2.0, 0, 1);
      scratchNetMoment.x -= angularVelocity.x * (mass * 18.0) * immersion;
      scratchNetMoment.y -= angularVelocity.y * (mass * 24.0) * immersion;
      scratchNetMoment.z -= angularVelocity.z * (mass * 18.0) * immersion;
    }

    // Calculate spray intensity for visual plumes
    this.sprayIntensity = THREE.MathUtils.clamp((horizSpeed / 35.0) * Math.min(1.0, maxDepth / 0.8), 0.0, 1.0);

    // Submerged state check:
    // Once flooding >= 0.95 and horizontal speed < 1.0 m/s
    if (this.flooding >= 0.95 && horizSpeed < 1.0) {
      this.submerged = true;
      this.timeSinceSubmerged += dt;
    }

    return {
      forces: scratchNetForce,
      moments: scratchNetMoment,
      onWater: this.onWater,
      ditchingContact: this.ditchingContact,
      flooding: this.flooding,
      ditchingPhase: this.ditchingPhase,
      sprayIntensity: this.sprayIntensity,
      submerged: this.submerged,
      catastrophic: this.catastrophic,
      contactPoints: this.contactPoints,
    };
  }
}
