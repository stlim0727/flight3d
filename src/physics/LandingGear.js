import * as THREE from 'three';
import { GEAR_DAMAGE_LIMITS, updateGearDamage } from './gearDamage.js';
import { BODY_CONTACTS } from './groundContacts.js';

// Oleo damper is asymmetric: while the strut extends (vNormal > 0) damping is
// multiplied, dissipating the stored spring energy that would otherwise fling
// the airframe back off the runway (bounce/porpoise). Continuous at v = 0.
const OLEO_REBOUND_DAMPING = 3.0;

// Scratch objects reused by the per-contact math in update(). Purely internal:
// returned force/moment vectors stay freshly allocated because callers hold
// them across substeps.
const scratchInvQuat = new THREE.Quaternion();
const scratchHubWorld = new THREE.Vector3();
const scratchGroundNormal = new THREE.Vector3();
const scratchRWorld = new THREE.Vector3();
const scratchAngVelWorld = new THREE.Vector3();
const scratchContactVel = new THREE.Vector3();
const scratchWheelForward = new THREE.Vector3();
const scratchWheelLateral = new THREE.Vector3();
const scratchFWheelWorld = new THREE.Vector3();
const scratchFWheelBody = new THREE.Vector3();
const scratchMoment = new THREE.Vector3();
const scratchBcLocal = new THREE.Vector3();
const scratchBcPoint = new THREE.Vector3();
const scratchBcNormal = new THREE.Vector3();
const scratchBcArm = new THREE.Vector3();
const scratchBcVelocity = new THREE.Vector3();
const scratchBcTangent = new THREE.Vector3();
const scratchBcForce = new THREE.Vector3();
const AXIS_Z_UP = new THREE.Vector3(0, 1, 0);
const AXIS_FWD = new THREE.Vector3(0, 0, -1);

/**
 * Multi-contact Tricycle Landing Gear Physics (Boeing 737 class)
 * Simulates steerable nose gear and dual main gear bogies with independent
 * oleo-pneumatic spring-damper suspension, tire scrub, braking friction,
 * and realistic gear retraction/extension cycle.
 */
export class LandingGear {
  constructor() {
    this.failure = null;
    this.maxImpactSpeed = 0;
    this.lastMomentBody = new THREE.Vector3();
    this.gearState = 1.0; // 0.0 (UP) to 1.0 (DOWN & LOCKED)
    this.targetGearState = 1.0;
    this.gearTransitSpeed = 0.12; // ~8 seconds for full transit
    this.isTransit = false;

    // Contact points relative to aircraft Center of Gravity (m)
    // In Three.js aircraft local coordinates:
    // +X = Right, +Y = Up, -Z = Forward
    // Matches authentic Boeing 737-800 Airport Planning specifications:
    // - Wheel Track: 5.72m (Main bogies at x = ±2.86m)
    // - Wheelbase: 15.60m (Nose gear at z = -13.8m, Main bogies at z = +1.8m)
    this.contacts = [
      {
        id: 'nose',
        localPos: new THREE.Vector3(0.0, -3.27, -12.5), // Front steerable
        wheelRadius: 0.38,
        restLength: 0.9,
        kSpring: 420000, // N/m
        cDamper: 48000,  // N/(m/s)
        isSteerable: true,
        compression: 0,
        isGrounded: false,
        touchdownThisFrame: false,
        worldPos: new THREE.Vector3(),
        prevWorldPos: new THREE.Vector3()
      },
      {
        id: 'mainLeft',
        localPos: new THREE.Vector3(-3.2, -3.30, 1.8), // Left main
        wheelRadius: 0.48,
        restLength: 0.9,
        kSpring: 850000,
        cDamper: 72000,
        isSteerable: false,
        compression: 0,
        isGrounded: false,
        touchdownThisFrame: false,
        worldPos: new THREE.Vector3(),
        prevWorldPos: new THREE.Vector3()
      },
      {
        id: 'mainRight',
        localPos: new THREE.Vector3(3.2, -3.30, 1.8),  // Right main
        wheelRadius: 0.48,
        restLength: 0.9,
        kSpring: 850000,
        cDamper: 72000,
        isSteerable: false,
        compression: 0,
        isGrounded: false,
        touchdownThisFrame: false,
        worldPos: new THREE.Vector3(),
        prevWorldPos: new THREE.Vector3()
      }
    ];

    this.resetDamage();
    this.brakes = 0.0; // 0.0 to 1.0
    this.steerAngle = 0.0; // Radians
    this.onGround = false;
    this.totalWeightOnWheels = 0;
    this.touchdownEvent = false;
  }

  resetContacts() {
    this.resetDamage();
  }

  resetDamage() {
    this.failure = null;
    this.maxImpactSpeed = 0;
    this.lastMomentBody.set(0, 0, 0);
    for (const c of this.contacts) {
      c.damage = 0;
      c.damageState = 'normal';
      c.isGrounded = false;
      c.compression = 0;
      c.touchdownThisFrame = false;
    }
    this.bodyGrounded = new Set();
    this.structuralDamage = 0;
    this.onGround = false;
    this.totalWeightOnWheels = 0;
    this.touchdownEvent = false;
  }

  toggleGear() {
    if (this.targetGearState > 0.5) {
      this.targetGearState = 0.0;
    } else {
      this.targetGearState = 1.0;
    }
  }

  setGearTarget(down) {
    this.targetGearState = down ? 1.0 : 0.0;
  }

  setBrakes(val) {
    this.brakes = Math.max(0.0, Math.min(1.0, val));
  }

  setSteering(rudderInput, groundSpeedMs) {
    // Variable steering ratio: high authority at low taxi speeds, limited authority at takeoff roll
    const speedRatio = Math.max(0.15, 1.0 - Math.min(1.0, groundSpeedMs / 35.0) * 0.82);
    const maxTiller = THREE.MathUtils.degToRad(55.0); // Max nosewheel deflection
    this.steerAngle = -rudderInput * maxTiller * speedRatio;
  }

  /**
   * Update landing gear forces and ground physics
   * @param {number} dt 
   * @param {THREE.Object3D} aircraftMesh 
   * @param {THREE.Vector3} linearVelocity (world m/s)
   * @param {THREE.Vector3} angularVelocity (body rad/s)
   * @param {Function} getTerrainHeight (x, z) => height in meters
   * @param {Function} [getTerrainNormal=null] (x, z) => THREE.Vector3 surface normal
   * @returns {{ forces: THREE.Vector3, moments: THREE.Vector3, onGround: boolean, touchdown: boolean }}
   */
  update(dt, aircraftMesh, linearVelocity, angularVelocity, getTerrainHeight, getTerrainNormal = null) {
    // Animate gear transit
    if (Math.abs(this.targetGearState - this.gearState) > 0.001) {
      this.isTransit = true;
      const step = Math.sign(this.targetGearState - this.gearState) * this.gearTransitSpeed * dt;
      this.gearState = Math.max(0.0, Math.min(1.0, this.gearState + step));
    } else {
      this.isTransit = false;
      this.gearState = this.targetGearState;
    }

    const netForceWorld = new THREE.Vector3(0, 0, 0);
    const netMomentBody = new THREE.Vector3(0, 0, 0);

    this.onGround = false;
    this.touchdownEvent = false;
    this.totalWeightOnWheels = 0;

    const gearDeploy = this.gearState;
    const damageEvents = [];
    const bodyContacts = [];
    let catastrophicImpact = false;
    // World transformation matrices
    const worldQuat = aircraftMesh.quaternion;
    const invWorldQuat = scratchInvQuat.copy(worldQuat).invert();
    const touchdownContacts = [];

    for (const c of this.contacts) {
      c.touchdownThisFrame = false;
      if (gearDeploy < 0.1 || c.damageState === 'collapsed') {
        c.isGrounded = false;
        c.compression = 0;
        continue;
      }
      // Deployed position scaled by gear deployment
      const hubWorld = scratchHubWorld.copy(c.localPos);
      hubWorld.y *= gearDeploy;

      // Calculate world position of wheel hub
      hubWorld.applyMatrix4(aircraftMesh.matrixWorld);
      const groundH = getTerrainHeight(hubWorld.x, hubWorld.z);
      const wheelRadius = c.wheelRadius !== undefined ? c.wheelRadius : 0.48;
      const contactY = groundH + wheelRadius;

      c.worldPos.copy(hubWorld);
      c.worldPos.y = groundH; // Bottom of tire touching terrain

      const penetration = contactY - hubWorld.y;

      if (penetration > 0) {
        // Strut is compressed!
        const wasGrounded = c.isGrounded;
        c.isGrounded = true;
        this.onGround = true;
        c.compression = Math.min(c.restLength, penetration);

        // Surface normal at contact point (defaults to vertical up)
        const groundNormal = scratchGroundNormal.set(0, 1, 0);
        if (typeof getTerrainNormal === 'function') {
          const norm = getTerrainNormal(hubWorld.x, hubWorld.z);
          if (norm && norm.isVector3 && norm.lengthSq() > 0.0001) {
            groundNormal.copy(norm).normalize();
          }
        }

        const normalPenetration = penetration * groundNormal.y;
        c.compression = Math.min(c.restLength, normalPenetration);

        // Contact point velocity in world space = linearVel + angularVel x r
        const rWorld = scratchRWorld.copy(c.worldPos).sub(aircraftMesh.position);
        const angVelWorld = scratchAngVelWorld.copy(angularVelocity).applyQuaternion(worldQuat);
        const contactVel = scratchContactVel.copy(linearVelocity).add(angVelWorld.cross(rWorld));
        const groundSpeed = Math.sqrt(linearVelocity.x * linearVelocity.x + linearVelocity.z * linearVelocity.z);
        const sinkRate = Math.max(0, -contactVel.dot(groundNormal));
        if (!wasGrounded) this.maxImpactSpeed = Math.max(this.maxImpactSpeed, sinkRate);

        // Touchdown impact requires descending from the air into the runway surface (sinkRate > 0.25 m/s)
        if (!wasGrounded && sinkRate > 0.25) {
          c.touchdownThisFrame = true;
          this.touchdownEvent = true;
          touchdownContacts.push({
            id: c.id,
            worldPos: c.worldPos.clone(),
            groundSpeed,
            sinkRate,
            compression: c.compression
          });
        } else {
          c.touchdownThisFrame = false;
        }

        // Suspension normal force along terrain surface normal (Hooke's spring +
        // asymmetric oleo damping: extension is braked ~3x harder than compression)
        const vNormal = contactVel.dot(groundNormal);
        let normalForceMag = c.kSpring * c.compression
          - c.cDamper * (vNormal > 0 ? OLEO_REBOUND_DAMPING : 1.0) * vNormal;
        if (normalForceMag < 0) normalForceMag = 0; // Strut can only push away

        // Wheel forward and lateral vectors in world space tangent to surface
        const wheelForwardWorld = scratchWheelForward.copy(AXIS_FWD);
        if (c.isSteerable && c.damageState === 'normal') {
          wheelForwardWorld.applyAxisAngle(AXIS_Z_UP, this.steerAngle);
        }
        wheelForwardWorld.applyQuaternion(worldQuat);
        // Project onto terrain tangent plane: vTangent = v - (v . n) * n
        wheelForwardWorld.addScaledVector(groundNormal, -wheelForwardWorld.dot(groundNormal));
        if (wheelForwardWorld.lengthSq() > 0.0001) {
          wheelForwardWorld.normalize();
        } else {
          wheelForwardWorld.set(0, 0, -1);
        }

        // Wheel lateral vector on the sloped surface tangent plane (Forward x Normal)
        const wheelLateralWorld = scratchWheelLateral.copy(wheelForwardWorld).cross(groundNormal).normalize();

        // Decompose contact velocity onto wheel tangent plane
        const vForward = contactVel.dot(wheelForwardWorld);
        const vLateral = contactVel.dot(wheelLateralWorld);

        // Tire forces, Coulomb-limited by the strut load. These are both what
        // pushes the airframe around and what the leg structure has to react,
        // so the damage model reads the same numbers the solver delivers.
        let muBrake = 0.02; // Baseline rolling resistance
        if (this.brakes > 0.01) {
          muBrake += this.brakes * 0.58; // Boeing 737 anti-skid carbon brake friction
        }
        // Preserve static braking on sloped taxiways/runways.
        const stoppingGain = this.brakes > 0.5 ? normalForceMag / (9.80665 * Math.max(dt, 0.001)) : 25000;
        const fForwardMag = -Math.sign(vForward) * Math.min(Math.abs(vForward) * stoppingGain, normalForceMag * muBrake);

        const muLateral = 0.75;
        const fLateralMag = -Math.sign(vLateral) * Math.min(Math.abs(vLateral) * 35000.0, normalForceMag * muLateral);

        const limits = GEAR_DAMAGE_LIMITS[c.id === 'nose' ? 'nose' : 'main'];
        const stateBefore = c.damageState;
        updateGearDamage(c, {
          sinkRate,
          firstContact: !wasGrounded,
          normalLoad: normalForceMag,
          lateralLoad: Math.abs(fLateralMag),
          longitudinalLoad: Math.abs(fForwardMag),
          overtravel: Math.max(0, normalPenetration - c.restLength),
          locked: gearDeploy >= 0.99 && this.targetGearState === 1,
        }, dt, limits);
        if (stateBefore !== c.damageState) {
          this.failure ??= { contact: c.id, sinkRate, penetration,
            reason: sinkRate > limits.impact ? 'impact' : normalPenetration > c.restLength + 0.08 ? 'bottom-out' : gearDeploy < 0.99 || this.targetGearState !== 1 ? 'unlocked' : 'overload' };
          damageEvents.push({ id: c.id, state: c.damageState, damage: c.damage });
        }
        if (c.damageState === 'collapsed') {
          c.isGrounded = false;
          c.touchdownThisFrame = false;
          c.compression = 0;
          continue;
        }
        // A bent leg supports and grips less than an intact one.
        const damageScale = c.damageState === 'damaged' ? 0.65 : 1;
        normalForceMag *= damageScale;
        this.totalWeightOnWheels += normalForceMag;

        // Net wheel force in world space: normal (pushes perpendicular to the
        // surface) + longitudinal friction + lateral scrub.
        const fWheelWorld = scratchFWheelWorld.copy(groundNormal).multiplyScalar(normalForceMag);
        fWheelWorld.addScaledVector(wheelForwardWorld, fForwardMag * damageScale);
        fWheelWorld.addScaledVector(wheelLateralWorld, fLateralMag * damageScale);
        netForceWorld.add(fWheelWorld);

        // Calculate moment produced around CG: M = r x F
        const fWheelBody = scratchFWheelBody.copy(fWheelWorld).applyQuaternion(invWorldQuat);
        const momentBody = scratchMoment.copy(rWorld).applyQuaternion(invWorldQuat).cross(fWheelBody);
        netMomentBody.add(momentBody);
      } else {
        c.isGrounded = false;
        c.compression = 0;
        c.touchdownThisFrame = false;
      }
    }

    // Body support is always active, including a single collapsed leg with gear DOWN.
    const groundedNow = new Set();
    for (const probe of BODY_CONTACTS) {
      const local = scratchBcLocal.set(...probe.position);
      const point = scratchBcPoint.copy(local).applyMatrix4(aircraftMesh.matrixWorld);
      const groundH = getTerrainHeight(point.x, point.z);
      const normal = scratchBcNormal.set(0, 1, 0);
      const terrainNormal = getTerrainNormal?.(point.x, point.z);
      if (terrainNormal && terrainNormal.lengthSq() >= 0.0001) {
        normal.copy(terrainNormal).normalize();
      }
      const depth = (groundH - point.y) * normal.y;
      if (depth <= 0) continue;
      const arm = scratchBcArm.copy(point).sub(aircraftMesh.position);
      const velocity = scratchBcVelocity.copy(angularVelocity).applyQuaternion(worldQuat).cross(arm).add(linearVelocity);
      const vNormal = velocity.dot(normal);
      const tangent = scratchBcTangent.copy(velocity).addScaledVector(normal, -vNormal);
      const speed = tangent.length();
      const load = Math.max(0, 1800000 * Math.min(depth, 0.75) - 160000 * vNormal);
      const force = scratchBcForce.copy(normal).multiplyScalar(load);
      if (speed > 0) force.addScaledVector(tangent, -Math.min(18000, load * 0.45 / speed));
      netForceWorld.add(force);
      netMomentBody.add(scratchMoment.copy(local).cross(scratchFWheelBody.copy(force).applyQuaternion(invWorldQuat)));
      groundedNow.add(probe.id);
      this.onGround = true;
      if (!this.bodyGrounded.has(probe.id) && -vNormal > 12.5) catastrophicImpact = true;
      this.structuralDamage = Math.min(1, this.structuralDamage + speed * dt / 100000);
      bodyContacts.push({ id: probe.id, worldPos: point.clone(), sinkRate: -vNormal, speed });
    }
    this.bodyGrounded = groundedNow;
    catastrophicImpact ||= this.structuralDamage >= 1;
    // Recompute after collapse; a failed contact must not report weight on wheels.
    this.onGround = bodyContacts.length > 0 || this.contacts.some(c => c.isGrounded);

    const supportedTouchdowns = touchdownContacts.filter(event =>
      this.contacts.find(c => c.id === event.id).damageState !== 'collapsed');
    this.touchdownEvent = supportedTouchdowns.length > 0;
    this.lastMomentBody.copy(netMomentBody);
    return {
      failure: this.failure,
      maxImpactSpeed: this.maxImpactSpeed,
      forces: netForceWorld,
      moments: netMomentBody,
      onGround: this.onGround,
      touchdown: this.touchdownEvent,
      gearState: this.gearState,
      isTransit: this.isTransit,
      weightOnWheels: this.totalWeightOnWheels,
      damageEvents,
      gearDamage: Object.fromEntries(this.contacts.map(c => [c.id, c.damageState])),
      bodyContacts,
      structuralDamage: this.structuralDamage,
      catastrophicImpact,
      touchdownContacts: supportedTouchdowns,
      compressions: {
        nose: this.contacts[0].compression,
        mainLeft: this.contacts[1].compression,
        mainRight: this.contacts[2].compression
      }
    };
  }
}
