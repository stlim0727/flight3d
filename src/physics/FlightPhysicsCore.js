import * as THREE from 'three';
import { Aerodynamics, createAeroResult } from './Aerodynamics.js';
import { Atmosphere } from './Atmosphere.js';
import { EngineModel, asymmetricThrustYawMoment } from './EngineModel.js';
import { LandingGear } from './LandingGear.js';
import { WaterDitching } from './WaterDitching.js';
import { PilotPhysiology } from './PilotPhysiology.js';
import { normalLoadFactor, GForceFilter } from './loadFactor.js';
import { BODY_SUPPORT_POINTS } from './groundContacts.js';
import { constrainBodyContact } from './bodyContactConstraint.js';
import { rebaseCgVelocity, translateModelOrigin } from './massKinematics.js';
import { stallSpeedEstimate } from './stallSpeedEstimate.js';
import { takeoffPerformance } from './TakeoffPerformance.js';
import { BOEING_737_800 } from '../config/aircraftConfigs.js';

const ONE_SCALE = new THREE.Vector3(1, 1, 1);
const DEFAULT_PHYSICS_HZ = 120;
const DEFAULT_MAX_FRAME_DELTA = 0.05;

function createPoseTransform(position, quaternion) {
  const matrixWorld = new THREE.Matrix4();
  return {
    position,
    quaternion,
    matrixWorld,
    updateWorldMatrix() {
      matrixWorld.compose(this.position, this.quaternion, ONE_SCALE);
    },
  };
}

function defaultGroundHeight() {
  return 0;
}

function defaultGroundNormal() {
  return null;
}

function defaultRunwayCheck() {
  return true;
}

function defaultWaterLevel() {
  return 0;
}

/**
 * Pure headless 6-DOF flight physics core (120 Hz fixed-timestep capable).
 * Depends only on `three` and `src/physics/*` modules—no DOM, UI, audio,
 * particles, cameras, i18n, or analytics.
 */
export class FlightPhysicsCore {
  constructor(options = {}) {
    const config = options.config ?? BOEING_737_800;
    this.config = config;
    this.physicsHz = options.physicsHz ?? DEFAULT_PHYSICS_HZ;
    this.physicsDt = 1 / this.physicsHz;
    this.maxFrameDelta = options.maxFrameDelta ?? DEFAULT_MAX_FRAME_DELTA;
    this.physicsAccumulator = 0;

    this.position = options.position ?? new THREE.Vector3();
    this.quaternion = options.quaternion ?? new THREE.Quaternion();
    this.linearVelocity = options.linearVelocity ?? new THREE.Vector3();
    this.angularVelocity = options.angularVelocity ?? new THREE.Vector3();

    this.aero = options.aero ?? new Aerodynamics(config);
    this.engines = options.engines ?? new EngineModel(config);
    this.gear = options.gear ?? new LandingGear(config);
    if (!options.gear && this.gear.bodySupportPoints === undefined) {
      this.gear.bodySupportPoints = config?.landingGear?.bodySupportPoints ?? BODY_SUPPORT_POINTS;
    }
    this.waterDitching = options.waterDitching ?? new WaterDitching();
    this.pilotPhysiology = options.pilotPhysiology ?? new PilotPhysiology();
    this.gForceFilter = options.gForceFilter ?? new GForceFilter(8.0);

    this.transform = createPoseTransform(this.position, this.quaternion);

    this.isCrashed = Boolean(options.isCrashed);
    this.windTimeSeconds = options.windTimeSeconds ?? 0;
    this.airborneTime = options.airborneTime ?? 0;
    this.hasTouchedDownThisFlight = Boolean(options.hasTouchedDownThisFlight);
    this.lastOnGround = options.lastOnGround ?? true;
    this.lastGearTarget = options.lastGearTarget ?? (this.gear.targetGearState > 0.5);
    this.actualTakeoffMassKg = options.actualTakeoffMassKg ?? null;
    this.stallSpeedKnots = options.stallSpeedKnots;
    this.takeoff = options.takeoff ?? null;
    this._hasGroundContact = Boolean(options._hasGroundContact);
    this._performanceClock = options._performanceClock ?? 0;

    this.landingIncident = Boolean(options.landingIncident);
    this.landingRestTime = options.landingRestTime ?? 0;
    this.landingStopped = Boolean(options.landingStopped);
    this.waterDitchingNoticed = Boolean(options.waterDitchingNoticed);
    this.waterSinkingNoticed = Boolean(options.waterSinkingNoticed);
    this.waterSubmergedNoticed = Boolean(options.waterSubmergedNoticed);
    this.excursionAnnounced = Boolean(options.excursionAnnounced);
    this.bodyContactStarted = Boolean(options.bodyContactStarted);
    this.bodyContactNotices = options.bodyContactNotices ?? new Set();

    this.telemetry = options.telemetry ?? {
      iasKnots: 0,
      tasKnots: 0,
      groundSpeedKnots: 0,
      altitudeFt: 0,
      radioAltFt: 0,
      vsiFpm: 0,
      pitchDeg: 0,
      rollDeg: 0,
      headingDeg: 0,
      trackDeg: 0,
      gForce: 1.0,
      rawGForce: 1.0,
      gearState: this.gear.gearState ?? 1.0,
      onGround: true,
      touchdown: false,
    };

    // Pre-allocated scratch objects for zero-allocation 120 Hz substeps.
    this._cgBefore = new THREE.Vector3();
    this._rotationBefore = new THREE.Quaternion();
    this._gVelocityBefore = new THREE.Vector3();
    this._gRotationBefore = new THREE.Quaternion();
    this._intThrust = new THREE.Vector3();
    this._intGravity = new THREE.Vector3();
    this._intNetForce = new THREE.Vector3();
    this._intNetMoment = new THREE.Vector3();
    this._intAngAcc = new THREE.Vector3();
    this._intDeltaRot = new THREE.Quaternion();
    this._intEuler = new THREE.Euler();
    this._intForward = new THREE.Vector3();
    this._aeroResult = options.aeroResult ?? createAeroResult();
    this._waterTerrainProxy = {
      getHeight: defaultGroundHeight,
      getWaterLevel: defaultWaterLevel,
    };
  }

  /**
   * Reset transient flight/incident state (e.g. on preset spawn or repair).
   */
  reset() {
    this.physicsAccumulator = 0;
    this.isCrashed = false;
    this.windTimeSeconds = 0;
    this.airborneTime = 0;
    this.hasTouchedDownThisFlight = false;
    this.lastOnGround = true;
    this.lastGearTarget = this.gear.targetGearState > 0.5;
    this.actualTakeoffMassKg = null;
    this._hasGroundContact = false;
    this._performanceClock = 0;
    this.landingIncident = false;
    this.landingRestTime = 0;
    this.landingStopped = false;
    this.waterDitchingNoticed = false;
    this.waterSinkingNoticed = false;
    this.waterSubmergedNoticed = false;
    this.excursionAnnounced = false;
    this.bodyContactStarted = false;
    this.bodyContactNotices.clear();
    this.waterDitching?.reset?.();
    this.pilotPhysiology?.reset?.();
    this.gForceFilter?.reset?.();
  }

  /**
   * Resolve body support-point penetration against the ground callback.
   */
  resolveBodyPenetration(getGroundHeight = defaultGroundHeight, getGroundNormal = defaultGroundNormal) {
    constrainBodyContact(
      this.position,
      this.quaternion,
      this.linearVelocity,
      this.angularVelocity,
      this.aero.mass,
      { x: this.aero.invIyy, y: this.aero.invIzz, z: this.aero.invIxx },
      getGroundHeight,
      getGroundNormal,
      this.gear.supportedBodyPoints,
      this.aero.cg
    );
  }

  /**
   * Advance the simulation by `dt` seconds using fixed 120 Hz substeps.
   * Returns the latest physics state, telemetry, and all events emitted across substeps.
   */
  step(dt, inputs = {}, environment = {}) {
    const clampedDt = Number.isFinite(dt) ? Math.max(0, Math.min(this.maxFrameDelta, dt)) : 0;
    this.physicsAccumulator += clampedDt;
    const events = [];
    let substeps = 0;
    let lastResult = null;
    while (this.physicsAccumulator >= this.physicsDt) {
      lastResult = this.integrateSubstep(this.physicsDt, inputs, environment);
      if (lastResult.events.length) events.push(...lastResult.events);
      this.physicsAccumulator -= this.physicsDt;
      substeps++;
    }
    return {
      position: this.position,
      quaternion: this.quaternion,
      linearVelocity: this.linearVelocity,
      angularVelocity: this.angularVelocity,
      telemetry: this.telemetry,
      events,
      substeps,
      lastSubstep: lastResult,
    };
  }

  /**
   * Execute a single physics integration substep of `dt` seconds (typically 1/120 s).
   */
  integrateSubstep(dt, inputs = {}, environment = {}) {
    const getGroundHeight = environment.getGroundHeight ?? defaultGroundHeight;
    const getGroundNormal = environment.getGroundNormal ?? defaultGroundNormal;
    const isOnRunway = environment.isOnRunway ?? defaultRunwayCheck;
    const isRunwaySafetyArea = environment.isRunwaySafetyArea ?? defaultRunwayCheck;
    const getWaterLevel = environment.getWaterLevel ?? defaultWaterLevel;
    const getWindWorld = environment.getWindWorld ?? null;
    const events = [];

    // Sync virtual transform to authoritative pose before any contact/aero queries.
    this.transform.position.copy(this.position);
    this.transform.quaternion.copy(this.quaternion);

    // Crashed state: damp velocities, rest on terrain, and keep kinematic telemetry current.
    if (this.isCrashed) {
      this._gVelocityBefore.copy(this.linearVelocity);
      this._gRotationBefore.copy(this.quaternion);
      this.linearVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 2.8));
      this.angularVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 3.5));
      this.position.addScaledVector(this.linearVelocity, dt);
      this.resolveBodyPenetration(getGroundHeight, getGroundNormal);
      this.transform.position.copy(this.position);
      const rawGForce = normalLoadFactor(
        this._gVelocityBefore,
        this.linearVelocity,
        this._gRotationBefore,
        this.quaternion,
        dt
      );
      const measuredGForce = this.gForceFilter.update(rawGForce, dt);
      if (this.telemetry) {
        const groundSpeed = Math.hypot(this.linearVelocity.x, this.linearVelocity.z);
        const groundHeight = getGroundHeight(this.position.x, this.position.z);
        const wind = this.aero?.windWorld;
        const tas = wind
          ? Math.hypot(this.linearVelocity.x - wind.x, this.linearVelocity.y - wind.y, this.linearVelocity.z - wind.z)
          : this.linearVelocity.length();
        const densityRatio = Atmosphere.getConditions(this.position.y).densityRatio;
        this.telemetry.gForce = measuredGForce;
        this.telemetry.rawGForce = rawGForce;
        this.telemetry.altitudeFt = Atmosphere.metersToFeet(this.position.y);
        this.telemetry.radioAltFt = Atmosphere.metersToFeet(Math.max(0, this.position.y - groundHeight));
        this.telemetry.groundSpeedKnots = Atmosphere.msToKnots(groundSpeed);
        this.telemetry.iasKnots = Atmosphere.msToKnots(tas * Math.sqrt(Math.max(0, densityRatio)));
        this.telemetry.vsiFpm = Atmosphere.metersToFeet(this.linearVelocity.y) * 60.0;
      }
      return {
        position: this.position,
        quaternion: this.quaternion,
        linearVelocity: this.linearVelocity,
        angularVelocity: this.angularVelocity,
        telemetry: this.telemetry,
        events,
      };
    }

    // 0. Environment wind sampling
    if (getWindWorld) {
      getWindWorld(this.position, this.windTimeSeconds, this.aero.windWorld);
      if (this.aero.windLeftWorld && this.aero.windRightWorld) {
        const arm = this.aero.wingspan / 4;
        for (const [target, sign] of [[this.aero.windLeftWorld, -1], [this.aero.windRightWorld, 1]]) {
          target.set(sign * arm, 0, 0).applyQuaternion(this.quaternion).add(this.position);
          getWindWorld(target, this.windTimeSeconds, target);
        }
      }
      this.windTimeSeconds += dt;
    }

    // 1. Controls & Pilot Physiology
    const rawElevator = inputs.elevator ?? 0;
    const rawAileron = inputs.aileron ?? 0;
    const rawRudder = inputs.rudder ?? 0;
    const rawThrottle = inputs.throttle ?? 0;
    const rawBrakes = inputs.brakes ?? 0;
    const bypassPhysiology = Boolean(inputs.bypassPilotPhysiology);

    if (!bypassPhysiology) {
      this.pilotPhysiology.update(dt, this.telemetry?.gForce ?? 1.0, {
        elevator: rawElevator,
        aileron: rawAileron,
        rudder: rawRudder,
      });
      this.aero.elevator = this.pilotPhysiology.effectiveElevator;
      this.aero.aileron = this.pilotPhysiology.effectiveAileron;
      this.aero.rudder = this.pilotPhysiology.effectiveRudder;
    } else {
      this.pilotPhysiology.reset();
      this.pilotPhysiology.effectiveElevator = rawElevator;
      this.pilotPhysiology.effectiveAileron = rawAileron;
      this.pilotPhysiology.effectiveRudder = rawRudder;
      this.aero.elevator = rawElevator;
      this.aero.aileron = rawAileron;
      this.aero.rudder = rawRudder;
    }

    if (inputs.pitchTrim !== undefined) {
      this.aero.pitchTrim = inputs.pitchTrim;
    }
    if (inputs.autopilotElevator !== undefined) {
      this.aero.elevator = inputs.autopilotElevator;
    }
    if (inputs.autopilotAileron !== undefined) {
      this.aero.aileron = inputs.autopilotAileron;
    }
    if (inputs.flapsIndex !== undefined && typeof this.aero.setFlapPosition === 'function') {
      this.aero.setFlapPosition(inputs.flapsIndex);
    }
    if (inputs.spoilers !== undefined) {
      this.aero.spoilers = Math.max(0, Math.min(1, inputs.spoilers));
    }
    if (inputs.gearHandleDown !== undefined && typeof this.gear.setGearTarget === 'function') {
      this.gear.setGearTarget(Boolean(inputs.gearHandleDown));
    }
    if (inputs.reverserActive !== undefined && typeof this.engines.setReverser === 'function') {
      this.engines.setReverser(Boolean(inputs.reverserActive), this.lastOnGround);
    }

    const groundSpeed = Math.hypot(this.linearVelocity.x, this.linearVelocity.z);
    const steeringRudder = bypassPhysiology ? rawRudder : this.pilotPhysiology.effectiveRudder;
    this.gear.setSteering(steeringRudder, groundSpeed);
    this.gear.setBrakes(rawBrakes);

    // 2. Engines & Mass Properties
    this.engines.setThrottle(rawThrottle);
    const altitudeMeters = this.position.y;
    const atmos = Atmosphere.getConditions(altitudeMeters);
    const tas = Math.hypot(
      this.linearVelocity.x - this.aero.windWorld.x,
      this.linearVelocity.y - this.aero.windWorld.y,
      this.linearVelocity.z - this.aero.windWorld.z
    );
    if (this.gear.bodyDamage?.engineL !== undefined) {
      this.engines.contactDamage[0] = this.gear.bodyDamage.engineL;
    }
    if (this.engines.numEngines > 1 && this.gear.bodyDamage?.engineR !== undefined) {
      this.engines.contactDamage[1] = this.gear.bodyDamage.engineR;
    }
    if (this.gear.bodyDamage) {
      this.aero.damageZones = this.gear.bodyDamage;
    }

    this._cgBefore.copy(this.aero.cg);
    this.engines.bindMassProperties(this.aero.massProperties);
    this.gear.advanceConfiguration(dt);
    this.aero.advanceFlaps(dt);
    const engineData = this.engines.update(dt, altitudeMeters, tas, atmos.densityRatio);

    this.aero.massProperties.setConfiguration(
      this.gear.gearState,
      this.aero.currentFlapAngle / (this.aero.flapAngles.at(-1) || 1)
    );
    this.aero.syncMassProperties();
    rebaseCgVelocity(this.linearVelocity, this.angularVelocity, this.quaternion, this._cgBefore, this.aero.cg);

    // Capture after moving-CG velocity rebase, before forces and contact impulses.
    this._gVelocityBefore.copy(this.linearVelocity);
    this._gRotationBefore.copy(this.quaternion);

    // 3. Terrain Height & Ground Clearance
    const groundHeight = getGroundHeight(this.position.x, this.position.z);
    const heightAboveGround = Math.max(0, this.position.y - groundHeight);

    this.transform.updateWorldMatrix();

    // 4. Landing Gear Forces & Ground Friction
    const dynamics = {
      mass: this.aero.mass,
      inverseInertia: { x: this.aero.invIyy, y: this.aero.invIzz, z: this.aero.invIxx },
    };
    const gearResult = this.gear.update(
      dt,
      this.transform,
      this.linearVelocity,
      this.angularVelocity,
      getGroundHeight,
      getGroundNormal,
      isOnRunway,
      this.aero.cg,
      true,
      isRunwaySafetyArea,
      dynamics
    );

    // 4b. Hydrodynamic Water Ditching & Sinking Forces
    const stepEuler = this._intEuler.setFromQuaternion(this.quaternion, 'YXZ');
    const stepPitchDeg = THREE.MathUtils.radToDeg(stepEuler.x);
    const stepRollDeg = THREE.MathUtils.radToDeg(-stepEuler.z);

    this._waterTerrainProxy.getHeight = getGroundHeight;
    this._waterTerrainProxy.getWaterLevel = getWaterLevel;
    const waterResult = this.waterDitching.update(
      dt,
      this.transform,
      this.linearVelocity,
      this.angularVelocity,
      this._waterTerrainProxy,
      this.aero,
      this.gear.supportedBodyPoints,
      gearResult.gearState,
      stepPitchDeg,
      stepRollDeg,
      dynamics
    );
    gearResult.waterDitching = this.waterDitching;
    gearResult.waterResult = waterResult;

    if (waterResult.onWater && waterResult.ditchingContact) {
      if (!this.waterDitchingNoticed) {
        this.waterDitchingNoticed = true;
        this.landingIncident = true;
        this.engines.setThrottle(0.0);
        events.push({ type: 'waterDitching' });
      }
      if (waterResult.ditchingPhase === 'sinking' && !this.waterSinkingNoticed) {
        this.waterSinkingNoticed = true;
        events.push({ type: 'waterSinking' });
      }
      if (waterResult.submerged && !this.waterSubmergedNoticed) {
        this.waterSubmergedNoticed = true;
        events.push({ type: 'waterSubmerged' });
      }
    }

    if (gearResult.damageEvents.length || (gearResult.bodyContacts.length && !this.bodyContactStarted)) {
      this.landingIncident = true;
      for (const event of gearResult.damageEvents) {
        events.push({ type: 'gearDamage', id: event.id, state: event.state, reason: event.reason });
      }
    }
    const newContacts = [...new Map(gearResult.bodyContacts.map(c => [c.id, c])).values()]
      .filter(c => !this.bodyContactNotices.has(c.id));
    for (const contact of newContacts) this.bodyContactNotices.add(contact.id);
    if (newContacts.length) {
      this.bodyContactStarted = true;
      events.push({ type: 'bodyContact', contacts: newContacts });
    }
    for (const event of gearResult.bodyDamageEvents) {
      events.push({ type: 'bodyDamage', id: event.id, state: event.state });
    }

    const groundRoughness = gearResult.groundRoughness || 0;
    if (groundRoughness > 0.5 && !this.excursionAnnounced) {
      this.excursionAnnounced = true;
      events.push({ type: 'excursion', groundRoughness });
    } else if (groundRoughness < 0.2) {
      this.excursionAnnounced = false;
    }

    const resting = (gearResult.onGround || (waterResult.onWater && waterResult.ditchingContact))
      && this.linearVelocity.length() < 0.5
      && this.angularVelocity.length() < 0.02;
    this.landingRestTime = resting ? this.landingRestTime + dt : 0;
    if (!resting) this.landingStopped = false;
    if (this.landingIncident && !this.landingStopped && this.landingRestTime >= 1) {
      this.landingStopped = true;
      events.push({ type: 'landingStopped' });
    }

    this.aero.gearHandleDown = this.gear.targetGearState > 0.5;

    // 5. Aerodynamic Forces & Moments
    const aeroResult = this.aero.computeAero(
      dt,
      this.transform,
      this.linearVelocity,
      this.angularVelocity,
      altitudeMeters,
      heightAboveGround,
      engineData.totalThrust,
      gearResult.gearState,
      this._aeroResult,
      true
    );

    aeroResult.momentBody.y += asymmetricThrustYawMoment(
      engineData.engine1.thrust,
      engineData.engine2.thrust,
      this.engines.momentArmMeters
    );

    // 6. Thrust Force in World Space
    const thrustWorld = this._intThrust.set(0, 0, -engineData.totalThrust).applyQuaternion(this.quaternion);

    // 7. Gravity Force
    const gravityWorld = this._intGravity.set(0, -this.aero.mass * Atmosphere.G0, 0);

    // 8. Total Forces Integration
    const netForceWorld = this._intNetForce.set(0, 0, 0)
      .add(gravityWorld)
      .add(thrustWorld)
      .add(aeroResult.forceWorld)
      .add(gearResult.forces)
      .add(waterResult.forces);

    if (inputs.externalForceWorld) {
      netForceWorld.add(inputs.externalForceWorld);
    }

    const accelerationWorld = netForceWorld.divideScalar(this.aero.mass);
    this.linearVelocity.addScaledVector(accelerationWorld, dt);

    let parkingBrakeEngaged = false;
    if (gearResult.onGround && rawBrakes > 0.5 && this.linearVelocity.length() < 0.4 && rawThrottle < 0.1) {
      this.linearVelocity.set(0, 0, 0);
      parkingBrakeEngaged = true;
    }

    this._rotationBefore.copy(this.quaternion);

    // 9. Total Moments Integration
    const netMomentBody = this._intNetMoment.set(0, 0, 0)
      .add(aeroResult.momentBody)
      .add(gearResult.moments)
      .add(waterResult.moments);

    if (inputs.externalMomentBody) {
      netMomentBody.add(inputs.externalMomentBody);
    }

    const angAccBody = this._intAngAcc.set(
      netMomentBody.x * this.aero.invIyy,
      netMomentBody.y * this.aero.invIzz,
      netMomentBody.z * this.aero.invIxx
    );

    this.angularVelocity.addScaledVector(angAccBody, dt);
    this.angularVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 0.35));

    const deltaRot = this._intDeltaRot.set(
      this.angularVelocity.x * dt * 0.5,
      this.angularVelocity.y * dt * 0.5,
      this.angularVelocity.z * dt * 0.5,
      1.0
    ).normalize();

    this.quaternion.multiply(deltaRot).normalize();
    translateModelOrigin(this.position, this.linearVelocity, this._rotationBefore, this.quaternion, this.aero.cg, dt);

    const collisionPosition = this.position.clone();
    const collisionVelocity = this.linearVelocity.clone();
    this.resolveBodyPenetration(getGroundHeight, getGroundNormal);

    this.transform.position.copy(this.position);
    this.transform.quaternion.copy(this.quaternion);

    // 10. Telemetry State
    const euler = this._intEuler.setFromQuaternion(this.quaternion, 'YXZ');
    const pitchDeg = THREE.MathUtils.radToDeg(euler.x);
    const rollDeg = THREE.MathUtils.radToDeg(-euler.z);
    const forwardVec = this._intForward.set(0, 0, -1).applyQuaternion(this.quaternion);
    const headingDeg = (THREE.MathUtils.radToDeg(Math.atan2(forwardVec.x, -forwardVec.z)) + 360) % 360;
    const trackDeg = (THREE.MathUtils.radToDeg(Math.atan2(this.linearVelocity.x, -this.linearVelocity.z)) + 360) % 360;

    const rawGForce = normalLoadFactor(
      this._gVelocityBefore,
      this.linearVelocity,
      this._gRotationBefore,
      this.quaternion,
      dt
    );
    const measuredGForce = this.gForceFilter.update(rawGForce, dt);
    if (this.pilotPhysiology) this.pilotPhysiology.gZ = measuredGForce;

    if (this._hasGroundContact && this.lastOnGround && !gearResult.onGround && this.actualTakeoffMassKg === null) {
      this.actualTakeoffMassKg = this.aero.mass;
      this.stallSpeedKnots = stallSpeedEstimate(this.aero, this.gear.gearState);
      this.takeoff = takeoffPerformance(this.aero, this.engines, {
        altitudeMeters: this.position.y,
        flapsIndex: this.aero.flapsIndex,
        flapAngle: this.aero.currentFlapAngle,
      });
    }
    this._hasGroundContact ||= gearResult.onGround;
    this._performanceClock += dt;
    if (this._performanceClock >= 1 || this.stallSpeedKnots === undefined) {
      if (gearResult.onGround) {
        this.stallSpeedKnots = stallSpeedEstimate(this.aero, this.gear.gearState);
        this.takeoff = takeoffPerformance(this.aero, this.engines, {
          altitudeMeters: this.position.y,
          flapsIndex: this.aero.flapsIndex,
          flapAngle: this.aero.currentFlapAngle,
        });
      } else {
        this.stallSpeedKnots = stallSpeedEstimate(this.aero, gearResult.gearState);
      }
      this._performanceClock = 0;
    }

    const touchdownSinkRate = Math.max(
      0,
      ...gearResult.touchdownContacts.map(contact => contact.sinkRate),
      waterResult.ditchingContact ? waterResult.touchdownVsi : 0
    );

    this.telemetry = {
      massRevision: this.aero.massProperties.revision,
      massKg: this.aero.mass,
      zeroFuelMassKg: this.aero.massProperties.zeroFuelMassKg,
      cgBody: { ...this.aero.cg },
      inertiaBody: { ...this.aero.massProperties.inertia },
      takeoff: this.takeoff,
      actualTakeoffMassKg: this.actualTakeoffMassKg,
      stallSpeedKnots: this.stallSpeedKnots,
      pitchDeg,
      rollDeg,
      headingDeg,
      trackDeg,
      altitudeFt: Atmosphere.metersToFeet(this.position.y),
      radioAltFt: Atmosphere.metersToFeet(heightAboveGround),
      iasKnots: aeroResult.iasKnots,
      tasKnots: aeroResult.tasKnots,
      groundSpeedKnots: Atmosphere.msToKnots(groundSpeed),
      vsiFpm: Atmosphere.metersToFeet(this.linearVelocity.y) * 60.0,
      mach: aeroResult.mach,
      gForce: measuredGForce,
      rawGForce,
      wow: Boolean(gearResult.contacts?.slice(1).some(c => c.isGrounded)),
      isStalled: aeroResult.isStalled,
      isPreStall: aeroResult.isPreStall,
      isStallWarning: aeroResult.isStallWarning,
      stallSeverity: aeroResult.stallSeverity,
      buffetVibration: aeroResult.buffetVibration,
      engine1: engineData.engine1,
      engine2: engineData.engine2,
      reverserActive: engineData.reverserActive,
      fuelKg: engineData.fuelKg,
      gearState: gearResult.gearState,
      isTransit: gearResult.isTransit,
      compressions: gearResult.compressions,
      gearDamage: gearResult.gearDamage,
      bodyContacts: [...new Set(gearResult.bodyContacts.map(c => c.id))],
      structuralDamage: gearResult.structuralDamage,
      groundRoughness,
      bodyDamage: gearResult.bodyDamage,
      flapDegree: this.aero.currentFlapAngle,
      flapIndex: this.aero.flapsIndex,
      spoilers: this.aero.spoilers,
      onWater: Boolean(waterResult.onWater),
      ditchingPhase: waterResult.ditchingPhase,
      flooding: waterResult.flooding,
      touchdown: gearResult.touchdown || (waterResult.onWater && waterResult.ditchingContact),
      touchdownSinkRate,
      onGround: gearResult.onGround || (waterResult.onWater && waterResult.ditchingContact),
      rawElevator: rawElevator,
      rawAileron: rawAileron,
      rawRudder: rawRudder,
      elevator: bypassPhysiology ? rawElevator : this.pilotPhysiology.effectiveElevator,
      aileron: bypassPhysiology ? rawAileron : this.pilotPhysiology.effectiveAileron,
      rudder: bypassPhysiology ? rawRudder : this.pilotPhysiology.effectiveRudder,
      throttle: rawThrottle,
      pitchTrim: this.aero.pitchTrim,
      pilot: this.pilotPhysiology.getSnapshot(),
      x: this.position.x,
      z: this.position.z,
      parkBrake: Boolean(rawBrakes > 0.8 && Atmosphere.msToKnots(groundSpeed) < 1.0),
    };

    // 11. Touchdown / Liftoff / Gear Transit Events
    const gsKnots = Atmosphere.msToKnots(groundSpeed);
    let genuineLandingTouchdown = false;

    if (!gearResult.onGround) {
      this.airborneTime += dt;
      if (this.airborneTime > 2.0) {
        this.hasTouchedDownThisFlight = false;
      }
    } else {
      const isGenuineTouchdown = this.airborneTime >= 1.5 && gsKnots > 45 && !this.hasTouchedDownThisFlight;
      if (isGenuineTouchdown && (gearResult.touchdown || !this.lastOnGround)) {
        genuineLandingTouchdown = true;
        this.hasTouchedDownThisFlight = true;
        const contactsToSmoke = (gearResult.touchdownContacts && gearResult.touchdownContacts.length > 0)
          ? gearResult.touchdownContacts
          : this.gear.contacts.filter(c => c.id !== 'nose');
        events.push({ type: 'touchdown', contacts: contactsToSmoke, sinkRate: touchdownSinkRate });
      }
      this.airborneTime = 0.0;
    }

    if (this.lastOnGround && !gearResult.onGround && gsKnots > 75) {
      events.push({ type: 'liftoff', groundSpeedKnots: gsKnots });
    }

    const currentGearTarget = this.gear.targetGearState > 0.5;
    if (this.lastGearTarget !== currentGearTarget) {
      events.push({ type: 'gearTransit', extending: currentGearTarget });
      this.lastGearTarget = currentGearTarget;
    }

    this.lastOnGround = gearResult.onGround;

    return {
      position: this.position,
      quaternion: this.quaternion,
      linearVelocity: this.linearVelocity,
      angularVelocity: this.angularVelocity,
      telemetry: this.telemetry,
      events,
      gearResult,
      waterResult,
      aeroResult,
      engineData,
      collisionPosition,
      collisionVelocity,
      pitchDeg,
      rollDeg,
      headingDeg,
      groundSpeed,
      genuineLandingTouchdown,
      parkingBrakeEngaged,
    };
  }
}
