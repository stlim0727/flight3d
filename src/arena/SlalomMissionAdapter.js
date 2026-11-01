import * as THREE from 'three';
import { SimulatorMissionAdapter } from './SimulatorMissionAdapter.js';
import { createSlalomManifest, projectSlalom } from './slalomCourse.js';
import { solveTrim } from '../physics/TrimSolver.js';
import { WindField } from '../physics/WindField.js';
import { TerrainPerception } from '../pilot/TerrainPerception.js';

const RAD = Math.PI / 180;
const AXES = ['elevator', 'aileron', 'rudder', 'throttle', 'brakes'];

/** Host-only bridge between a generated valley and the production simulator. The
 * terrain is generated with the course, so the walls a pilot meets are the walls
 * the validity gate checked, and nothing about the valley is offered to guest
 * code beyond the chart in the manifest. Navigation, sensor noise, the 5 Hz
 * decision period and the 24-tick delay are the same model `valley-low-v1` uses,
 * which is what makes the two score spaces comparable at all. */
export class SlalomMissionAdapter extends SimulatorMissionAdapter {
  async prepare({ missionId = 'valley-slalom-v1', environmentProfile = 'mild-disturbance-v1', seed = 1,
    sensorSeed = seed, noise = environmentProfile !== 'calm-debug-v1', rules, signal } = {}) {
    if (missionId !== 'valley-slalom-v1' || !Number.isSafeInteger(seed) || !Number.isSafeInteger(sensorSeed) ||
        !['calm-debug-v1', 'mild-disturbance-v1'].includes(environmentProfile) || typeof noise !== 'boolean') {
      throw new Error('invalid-scenario: slalom profile/seed');
    }
    const sim = this.sim;
    sim.demoDirector?.stop(); sim.devRunner?.stop({ pilotPreparation: true });
    sim.shadowDemo?.stop(); sim.hangang?.stop();
    if (signal?.aborted) throw new Error('pilot-preparation-aborted');
    // A generated valley is not a registered spawn scenario, so no preset is
    // applied: the host must arrive with the valley terrain already installed,
    // and everything the aircraft needs is configured here from the manifest.
    if (sim.activeAirport !== 'generated-valley' || sim.currentAircraftId !== 'F16' ||
        sim.currentTerrain?.region !== 'generated-valley' || sim.currentTerrain?.isLoaded !== true ||
        sim.physicsDt !== 1 / 120) {
      throw new Error('invalid-scenario: generated valley/F16/120Hz required');
    }
    const manifest = createSlalomManifest({ seed, rules });
    const { spawn } = manifest;
    const ground = sim.currentTerrain.getHeight(spawn.x, spawn.z);
    if (!Number.isFinite(ground)) throw new Error('invalid-scenario: missing spawn terrain');
    sim.autopilot.disengage(); sim.controls.clearVirtualInputs(); sim.controls.releaseAllKeys();
    sim.controls.setTouchStick?.(0, 0); sim.controls.setTouchRudder?.(0); sim.controls.setTouchBrakes?.(0);
    sim.controls.mouseControl = false; sim.controls.setParkingBrake(false);
    sim.controls.elevator = sim.controls.aileron = sim.controls.rudder = sim.controls.brakes = 0;
    sim.gear.setGearTarget(false); sim.gear.gearState = 0; sim.gear.resetContacts();
    sim.aero.setFlapPosition(0); sim.aero.currentFlapAngle = 0; sim.aero.spoilers = 0;
    sim.engines.setReverser(false, false);
    sim.aero.massProperties.setConfiguration(0, 0); sim.aero.syncMassProperties();
    sim.position.set(spawn.x, ground + spawn.aglM, spawn.z); sim.angularVelocity.set(0, 0, 0);
    const solution = solveTrim(sim.aero, sim.engines, { iasKnots: spawn.iasKnots,
      altitudeMeters: sim.position.y, flightPathAngleDeg: 0, flapsIndex: 0, gearState: 0, spoilers: 0 });
    // The shared F-16 model can have more idle thrust than level-flight drag, as
    // in low-v1: accept its feasible idle-limited trim rather than inventing
    // lower thrust to make the spawn look calmer than the airframe is.
    if (!solution.feasible || (!solution.handsOffFeasible && solution.reason !== 'idle')) {
      throw new Error('invalid-scenario: F16 trim');
    }
    const heading = spawn.headingDeg * RAD;
    this.forward = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
    this.right = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
    sim.quaternion.setFromEuler(new THREE.Euler(solution.alphaDeg * RAD, -heading, 0, 'YXZ'));
    sim.linearVelocity.copy(this.forward).multiplyScalar(solution.tas);
    sim.controls.pitchTrim = sim.aero.pitchTrim = solution.handsOffTrimDeg;
    sim.controls.throttle = solution.throttle; sim.engines.setThrottle(solution.throttle); sim.engines.settleSpool();
    sim.windField = new WindField({ profile: environmentProfile, seed, runwayHeadingDeg: spawn.headingDeg,
      crosswindSign: seed % 2 ? -1 : 1 });
    sim.windTimeSeconds = 0; sim.windField.sample(sim.position, 0, sim.aero.windWorld);
    sim.missionPhysicsFrame = null;
    this.initialControls = Object.fromEntries(AXES.map(axis => [axis, sim.controls[axis]]));
    const destination = manifest.destination;
    this.manifest = { ...manifest, missionId, environmentProfile, environmentSeed: seed, sensorSeed,
      runwayThreshold: { x: spawn.x, y: ground, z: spawn.z }, runwayHeadingDeg: spawn.headingDeg,
      fixedConfiguration: { ...manifest.fixedConfiguration,
        pitchTrimDeg: sim.controls.pitchTrim },
      configuration: { gearDown: false, flapIndex: 0, pitchTrimDeg: sim.controls.pitchTrim,
        referencePitchDeg: solution.alphaDeg, trimThrottle: solution.throttle },
      recommendedSpeeds: { cruiseKnots: spawn.iasKnots },
      timeoutSeconds: manifest.timeoutTicks / 120,
      navigationProfile: 'gate-finish-bearing-range-v2', sensorNoiseEnabled: noise,
      sensorProfile: { id: 'valley-navigation-v2', correlatedNoise: noise, physicsHz: 120,
        decisionPeriodTicks: 24, reactionDelayTicks: 24 },
      successConditions: { orderedGates: true, clearanceFloorM: manifest.course.clearanceFloorM,
        passageCeilingM: manifest.course.gates.map(gate => gate.maxAglM),
        corridorHalfWidthM: manifest.course.gates.map(gate => gate.halfWidthM),
        minimumIasKnots: manifest.minimumIasKnots, maximumIasKnots: manifest.maximumIasKnots,
        noContactOrDamage: true },
      departure: { ...spawn },
      destination: { ...destination, headingDeg: spawn.headingDeg },
      terrainSensor: { model: 'forward-terrain-range-v1', maxRangeM: 2000 },
      configuredState: { massKg: sim.aero.mass, fuelKg: sim.engines.fuelKg, position: sim.position.toArray(),
        quaternion: sim.quaternion.toArray(), velocity: sim.linearVelocity.toArray() } };
    this.terrainPerception = new TerrainPerception({ sensorSeed, noise });
    this.projectionHint = null;
    this.syncPose();
    return { manifest: this.manifest, initialSnapshot: this.snapshot(0) };
  }

  snapshot(tick) {
    const s = super.snapshot(tick), sim = this.sim;
    const projected = projectSlalom(this.manifest.course, sim.position, this.projectionHint);
    this.projectionHint = projected.segmentIndex;
    return { ...s, position: { x: sim.position.x, y: sim.position.y, z: sim.position.z },
      aglM: s.radioAltFt * 0.3048, progressM: projected.progressM,
      runwayS: projected.progressM, centerlineOffsetM: projected.crossM,
      corridorHalfWidthM: projected.halfWidthM, passageCeilingAglM: projected.ceilingAglM,
      pitchRateDegS: sim.angularVelocity.x * 180 / Math.PI,
      rollRateDegS: -sim.angularVelocity.z * 180 / Math.PI,
      yawRateDegS: -sim.angularVelocity.y * 180 / Math.PI };
  }

  /** The same shared navigation measurement as low-v1: the next waypoint and the
   * final destination, both bearing and range, both noisy at the same rate, with
   * the chart kept separate from the live measurement. */
  observe(perception, snapshot, tick, evaluator) {
    const observation = perception.sample(snapshot, tick);
    const gates = this.manifest.course.gates;
    const gateIndex = Math.min(evaluator.nextGateIndex, gates.length - 1);
    const gate = gates[gateIndex];
    const anchor = slalomAnchor(gate);
    const dx = anchor.x - snapshot.position.x, dz = anchor.z - snapshot.position.z;
    const rangeM = Math.hypot(dx, dz);
    const bearing = perception.scalar('valley.goalBearingDeg', (Math.atan2(dx, -dz) / RAD + 360) % 360,
      0.5, tick);
    bearing.mean = (bearing.mean + 360) % 360;
    observation.navigation = { goalBearingDeg: bearing,
      goalRangeM: perception.scalar('valley.goalRangeM', rangeM, 3 + rangeM * 0.01, tick),
      currentGateIndex: gateIndex, totalGates: gates.length - 1 };
    const finish = slalomAnchor(gates.at(-1));
    const fx = finish.x - snapshot.position.x, fz = finish.z - snapshot.position.z;
    const finishRangeM = Math.hypot(fx, fz);
    const finishBearing = perception.scalar('valley.finishBearingDeg',
      (Math.atan2(fx, -fz) / RAD + 360) % 360, 0.5, tick);
    finishBearing.mean = (finishBearing.mean + 360) % 360;
    observation.navigation.finishBearingDeg = finishBearing;
    observation.navigation.finishRangeM = perception.scalar('valley.finishRangeM',
      finishRangeM, 3 + finishRangeM * 0.01, tick);
    observation.terrain = this.terrainPerception.sample({ position: this.sim.position,
      quaternion: this.sim.quaternion,
      getHeight: (x, z) => this.sim.currentTerrain.getHeight(x, z) }, tick);
    return observation;
  }
}

/** A gate's passage space is aimed across the valley; the waypoint a pilot
 * steers to is the middle of that band, which the chart can already describe. */
export function slalomAnchor(gate) {
  return { x: gate.x + Math.cos(gate.headingDeg * RAD) * gate.crossOffsetM,
    z: gate.z + Math.sin(gate.headingDeg * RAD) * gate.crossOffsetM };
}
