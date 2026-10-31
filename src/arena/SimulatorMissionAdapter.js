import * as THREE from 'three';
import { Atmosphere } from '../physics/Atmosphere.js';
import { solveTrim } from '../physics/TrimSolver.js';
import { createMissionManifest } from './missionConfig.js';
import { WindField } from '../physics/WindField.js';

const RAD = Math.PI / 180;
const AXES = ['elevator', 'aileron', 'rudder', 'throttle', 'brakes'];
const requireFinite = (value, name) => {
  if (!Number.isFinite(value)) throw new Error(`invalid-scenario: ${name}`);
  return value;
};

/** Trusted simulator bridge. Only snapshot() output goes to perception/evaluators.
 * Does not own wall-clock rendering or Worker scheduling. prepare is destructive:
 * it starts a new coastal/B738 scenario, rather than saving an old flight.
 */
export class SimulatorMissionAdapter {
  constructor(simulation, { windFactory = options => new WindField(options) } = {}) {
    this.sim = simulation;
    this.windFactory = windFactory;
    this.manifest = null;
    this.acquired = false;
    this.savedFlags = null;
    this.initialControls = null;
  }

  async prepare({ missionId, environmentProfile = 'mild-disturbance-v1', seed = 1, signal } = {}) {
    const type = missionId === 'takeoff-basic-v1' ? 'takeoff'
      : missionId === 'landing-basic-v1' ? 'landing' : null;
    if (!type || !['calm-debug-v1', 'mild-disturbance-v1'].includes(environmentProfile) ||
        !Number.isSafeInteger(seed)) throw new Error('invalid-scenario: mission/profile/seed');
    if (environmentProfile !== 'calm-debug-v1' && !this.windFactory) {
      throw new Error('invalid-scenario: wind factory is required for disturbance profile');
    }
    const sim = this.sim;
    if (this.acquired) this.release();
    sim.demoDirector?.stop();
    sim.devRunner?.stop();
    sim.shadowDemo?.stop();
    sim.hangang?.stop();
    if (signal?.aborted) throw new Error('pilot-preparation-aborted');
    await sim.setAirport('coastal', true);
    if (signal?.aborted) throw new Error('pilot-preparation-aborted');
    sim.setAircraft('B738', true);
    sim.setPreset(type === 'takeoff' ? 'runway' : 'approach', false, true);
    if (sim.activeAirport !== 'coastal' || sim.currentAircraftId !== 'B738' ||
        !sim.currentTerrain || sim.currentTerrain.isLoaded === false) {
      throw new Error('invalid-scenario: terrain/aircraft not ready');
    }
    if (sim.physicsDt !== 1 / 120) throw new Error('invalid-scenario: physics must be 120 Hz');
    sim.autopilot.disengage();
    sim.controls.clearVirtualInputs();
    sim.controls.releaseAllKeys();
    sim.controls.setTouchStick?.(0, 0);
    sim.controls.setTouchRudder?.(0);
    sim.controls.setTouchBrakes?.(0);
    sim.controls.mouseControl = false;
    sim.controls.setParkingBrake(false);
    sim.controls.brakes = 0;
    sim.controls.elevator = sim.controls.aileron = sim.controls.rudder = 0;
    sim.gear.setGearTarget(true);
    sim.gear.gearState = 1;
    sim.aero.setFlapPosition(type === 'takeoff' ? 2 : 5);
    sim.aero.currentFlapAngle = sim.aero.flapAngles[sim.aero.flapsIndex];
    sim.aero.spoilers = 0;
    sim.engines.setReverser(false, false);
    sim.windField = null;
    sim.windTimeSeconds = 0;
    sim.aero.windWorld.set(0, 0, 0);
    sim.missionPhysicsFrame = null;

    this.manifest = createMissionManifest(type, { environmentProfile });
    const m = this.manifest;
    const origin = m.runwayThreshold;
    const heading = m.runwayHeadingDeg * RAD;
    this.forward = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
    this.right = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
    sim.position.set(origin.x, origin.y, origin.z)
      .addScaledVector(this.forward, m.spawn.runwayS)
      .addScaledVector(this.right, m.spawn.centerlineOffsetM);
    sim.angularVelocity.set(0, 0, 0);
    if (type === 'takeoff') {
      sim.position.y = origin.y + sim.gear.cgGroundHeightM;
      sim.quaternion.setFromEuler(new THREE.Euler(0, -heading, 0, 'YXZ'));
      sim.linearVelocity.set(0, 0, 0);
      sim.controls.throttle = 0;
      sim.engines.setThrottle(0);
      sim.controls.pitchTrim = sim.aero.pitchTrim = 1.6;
      sim.engines.settleSpool();
      // Settling is preparation, outside mission ticks and outside the wind clock.
      const flags = { disabled: sim.controls.aircraftControlsDisabled, blocked: sim.controls.inputBlocked };
      sim.controls.setAircraftControlsDisabled(true);
      sim.controls.inputBlocked = true;
      try {
        for (let i = 0; i < 120; i++) sim.integratePhysics(sim.physicsDt);
      } finally {
        sim.controls.setAircraftControlsDisabled(flags.disabled);
        sim.controls.inputBlocked = flags.blocked;
      }
      if (sim.isCrashed || !sim.gear.contacts.some(c => c.isGrounded)) {
        throw new Error('invalid-scenario: takeoff spawn did not settle');
      }
    } else {
      sim.position.y = origin.y + m.spawn.heightAboveRunwayM;
      const solution = solveTrim(sim.aero, sim.engines, {
        iasKnots: m.spawn.iasKnots, altitudeMeters: sim.position.y,
        flightPathAngleDeg: m.spawn.flightPathAngleDeg,
        flapsIndex: sim.aero.flapsIndex, gearState: 1, spoilers: 0,
      });
      if (!solution.feasible || !solution.handsOffFeasible) throw new Error('invalid-scenario: approach trim');
      const gamma = m.spawn.flightPathAngleDeg * RAD;
      sim.controls.pitchTrim = sim.aero.pitchTrim = solution.handsOffTrimDeg;
      sim.controls.throttle = solution.throttle;
      sim.engines.setThrottle(solution.throttle);
      sim.engines.settleSpool();
      sim.quaternion.setFromEuler(new THREE.Euler(solution.alphaDeg * RAD + gamma, -heading, 0, 'YXZ'));
      sim.linearVelocity.copy(this.forward).multiplyScalar(solution.tas * Math.cos(gamma));
      sim.linearVelocity.y = solution.tas * Math.sin(gamma);
      sim.gear.resetContacts();
    }
    if (this.windFactory) sim.windField = this.windFactory({ profile: environmentProfile, seed, runwayHeadingDeg: m.runwayHeadingDeg, crosswindSign: seed % 2 === 0 ? 1 : -1 });
    sim.windTimeSeconds = 0;
    sim.windField?.sample(sim.position, 0, sim.aero.windWorld);
    // Preserve the declared ground track in a mean crosswind. Gusts stay physical
    // perturbations; they are not secretly cancelled by an initial velocity fix.
    if (type === 'landing' && typeof sim.windField?.mean === 'function') {
      const mean = sim.windField.mean(new THREE.Vector3());
      const lateral = mean.dot(this.right);
      const horizontalAirSpeed = sim.linearVelocity.clone().setY(0).length();
      if (Math.abs(lateral) >= horizontalAirSpeed) throw new Error('invalid-scenario: crosswind');
      const crab = -Math.asin(lateral / horizontalAirSpeed);
      const euler = new THREE.Euler().setFromQuaternion(sim.quaternion, 'YXZ');
      euler.y = -(heading + crab);
      sim.quaternion.setFromEuler(euler);
      sim.linearVelocity.copy(this.forward).multiplyScalar(Math.sqrt(horizontalAirSpeed ** 2 - lateral ** 2) + mean.dot(this.forward));
      const tas = Atmosphere.iasToTas(Atmosphere.knotsToMs(m.spawn.iasKnots), Atmosphere.getConditions(sim.position.y).densityRatio);
      sim.linearVelocity.y = tas * Math.sin(m.spawn.flightPathAngleDeg * RAD) + mean.y;
    }
    this.initialControls = Object.fromEntries(AXES.map(axis => [axis, sim.controls[axis]]));
    this.manifest = {
      ...m,
      missionId: m.id,
      runway: { id: 'coastal-09L', headingDeg: m.runwayHeadingDeg,
        lengthM: m.runwayEndS - m.runwayStartS, widthM: m.runwayWidthM, elevationM: origin.y },
      timeoutSeconds: m.timeoutTicks / m.physicsHz,
      configuration: { gearDown: true, flapIndex: sim.aero.flapsIndex,
        pitchTrimDeg: sim.controls.pitchTrim, spoilers: 0, reverser: false },
      recommendedSpeeds: { rotationKnots: 140, climbKnots: 165, approachKnots: 145 },
      calibration: 'pending', environmentSeed: seed,
      sensorVersion: '1.0.0', runtimeVersion: 'trusted-worker-v1',
      fixedConfiguration: { ...m.fixedConfiguration, flapIndex: sim.aero.flapsIndex,
        pitchTrimDeg: sim.controls.pitchTrim },
      configuredState: {
        massKg: requireFinite(sim.aero.mass, 'mass'), fuelKg: requireFinite(sim.engines.fuelKg, 'fuel'),
        cgBody: { ...sim.aero.cg },
        position: sim.position.toArray(), velocity: sim.linearVelocity.toArray(), quaternion: sim.quaternion.toArray(),
        controls: { ...this.initialControls }, radioAltitudeReference: 'model-origin-above-terrain',
      },
    };
    this.syncPose();
    const initialSnapshot = this.snapshot(0);
    if (type === 'landing' && (initialSnapshot.weightOnWheels || initialSnapshot.radioAltFt < 100)) {
      throw new Error('invalid-scenario: landing spawn is not airborne');
    }
    return { manifest: this.manifest, initialSnapshot };
  }

  syncPose() {
    const sim = this.sim;
    sim.aircraft.group.position.copy(sim.position);
    sim.aircraft.group.quaternion.copy(sim.quaternion);
    sim.aircraft.group.updateMatrixWorld(true);
    sim.renderPose.reset(sim.position, sim.quaternion);
    sim.physicsAccumulator = 0;
  }

  pose() {
    return { position: this.sim.position.toArray(), quaternion: this.sim.quaternion.toArray() };
  }

  acquire() {
    if (!this.manifest || this.acquired) throw new Error('pilot-owner-unavailable');
    const { controls } = this.sim;
    this.savedFlags = { disabled: controls.aircraftControlsDisabled, blocked: controls.inputBlocked };
    controls.setAircraftControlsDisabled(true);
    controls.inputBlocked = true;
    if (this.sim.touchControls) this.sim.touchControls.throttleActive = false;
    this.sim.autopilot.disengage();
    this.acquired = true;
    this.apply(this.initialControls);
  }

  apply(command) {
    if (!this.acquired) throw new Error('pilot-does-not-own-controls');
    for (const axis of AXES) {
      const value = command?.[axis];
      if (!Number.isFinite(value) || value < (['throttle', 'brakes'].includes(axis) ? 0 : -1) || value > 1) {
        throw new Error('invalid-command');
      }
    }
    for (const axis of AXES) this.sim.controls.setVirtualInput(axis, command[axis]);
    this.command = { ...command };
  }

  step() {
    if (!this.acquired) throw new Error('pilot-does-not-own-controls');
    if (this.sim.currentTerrain?.isLoaded === false || this.sim.demoDirector?.isActive || this.sim.autopilot.master) {
      throw new Error('pilot-control-conflict');
    }
    const sim = this.sim, config = this.manifest.fixedConfiguration;
    if (sim.gear.targetGearState !== 1 || sim.gear.gearState !== 1 ||
        sim.aero.flapsIndex !== config.flapIndex || sim.aero.spoilers !== 0 ||
        sim.engines.reverserActive || sim.controls.parkingBrake ||
        sim.controls.pitchTrim !== config.pitchTrimDeg || sim.aero.pitchTrim !== config.pitchTrimDeg) {
      throw new Error('pilot-fixed-configuration-changed');
    }
    // A pointer drag or UI callback cannot steal a held throttle target.
    this.apply(this.command);
    this.sim.integratePhysics(this.sim.physicsDt);
    this.syncPose();
  }

  snapshot(tick) {
    if (!this.manifest || !Number.isSafeInteger(tick) || tick < 0) throw new Error('invalid-snapshot-tick');
    const sim = this.sim, m = this.manifest;
    const relative = sim.position.clone().sub(new THREE.Vector3(m.runwayThreshold.x, m.runwayThreshold.y, m.runwayThreshold.z));
    const euler = new THREE.Euler().setFromQuaternion(sim.quaternion, 'YXZ');
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(sim.quaternion);
    const airVelocity = sim.linearVelocity.clone().sub(sim.aero.windWorld);
    const tas = airVelocity.length();
    const terrainHeight = sim.currentTerrain.getHeight(sim.position.x, sim.position.z);
    const cgWorld = new THREE.Vector3(sim.aero.cg.x, sim.aero.cg.y, sim.aero.cg.z)
      .applyQuaternion(sim.quaternion).add(sim.position);
    const contactList = sim.gear.contacts.map(c => {
      const position = tick === 0 ? c.localPos.clone().applyQuaternion(sim.quaternion).add(sim.position) : c.worldPos;
      const contactRelative = position.clone().sub(new THREE.Vector3(m.runwayThreshold.x, m.runwayThreshold.y, m.runwayThreshold.z));
      if (tick > 0 && !Number.isFinite(c.sinkRateMs)) throw new Error('infrastructure-error: missing contact sink rate');
      return { id: c.id, grounded: Boolean(c.isGrounded),
        runwayS: contactRelative.dot(this.forward), centerlineOffsetM: contactRelative.dot(this.right),
        sinkRateMs: tick === 0 ? 0 : c.sinkRateMs };
    });
    return {
      tick,
      iasKnots: Atmosphere.msToKnots(Atmosphere.tasToIas(tas, Atmosphere.getConditions(sim.position.y).densityRatio)),
      tasKnots: Atmosphere.msToKnots(tas),
      groundSpeedKnots: Atmosphere.msToKnots(Math.hypot(sim.linearVelocity.x, sim.linearVelocity.z)),
      pitchDeg: euler.x / RAD, rollDeg: -euler.z / RAD,
      headingDeg: (Math.atan2(forward.x, -forward.z) / RAD + 360) % 360,
      altitudeFt: Atmosphere.metersToFeet(sim.position.y),
      radioAltFt: Atmosphere.metersToFeet(Math.max(0, sim.position.y - terrainHeight)),
      vsiFpm: Atmosphere.metersToFeet(sim.linearVelocity.y) * 60,
      runwayS: relative.dot(this.forward), centerlineOffsetM: relative.dot(this.right),
      heightAboveRunwayM: cgWorld.y - m.runwayThreshold.y,
      weightOnWheels: contactList.some(c => c.grounded),
      ...Object.fromEntries(AXES.map(axis => [axis, sim.controls[axis]])),
      crashed: Boolean(sim.isCrashed),
      damaged: sim.gear.contacts.some(c => (c.damage ?? 0) > 0 || (c.damageState && c.damageState !== 'normal')) ||
        (sim.gear.structuralDamage ?? 0) > 0 || Object.values(sim.gear.bodyDamage ?? {}).some(v => v > 0),
      bodyContact: Boolean(sim.missionPhysicsFrame?.gearResult?.bodyContacts?.length),
      gearContacts: contactList,
    };
  }

  release() {
    this.sim.windField = null;
    this.sim.aero.windWorld.set(0, 0, 0);
    this.sim.windTimeSeconds = 0;
    if (!this.acquired) return;
    const controls = this.sim.controls;
    controls.clearVirtualInputs();
    controls.virtualBrakes = null;
    controls.brakes = 0;
    controls.setAircraftControlsDisabled(this.savedFlags.disabled);
    controls.inputBlocked = this.savedFlags.blocked;
    this.acquired = false;
    this.savedFlags = null;
  }
}
