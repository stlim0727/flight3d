import * as THREE from 'three';
import { SimulatorMissionAdapter } from './SimulatorMissionAdapter.js';
import { createValleyManifest, projectValleyPosition } from './valleyCourse.js';
import { solveTrim } from '../physics/TrimSolver.js';
import { WindField } from '../physics/WindField.js';
import { TerrainPerception } from '../pilot/TerrainPerception.js';
import { ValleyWaypointsVisualizer } from './ValleyWaypointsVisualizer.js';

/** Host-only Lukla/F16 bridge. Public observations are built separately. */
export class ValleyMissionAdapter extends SimulatorMissionAdapter {
  async prepare({ missionId = 'valley-low-v1', environmentProfile = 'mild-disturbance-v1', seed = 1,
    sensorSeed = seed, noise = environmentProfile !== 'calm-debug-v1', pilotKind = 'ai', signal } = {}) {
    if (missionId !== 'valley-low-v1' || !Number.isSafeInteger(seed) || !Number.isSafeInteger(sensorSeed) ||
        !['calm-debug-v1', 'mild-disturbance-v1'].includes(environmentProfile) || typeof noise !== 'boolean') {
      throw new Error('invalid-scenario: valley profile/seed');
    }
    const sim = this.sim;
    sim.demoDirector?.stop(); sim.devRunner?.stop({ pilotPreparation: true }); sim.shadowDemo?.stop(); sim.hangang?.stop();
    if (signal?.aborted) throw new Error('pilot-preparation-aborted');
    await sim.setAirport('lukla', true);
    // The regional DEM may still be loading after setAirport returns.
    const started = Date.now();
    while (sim.currentTerrain?.isLoaded === false) {
      if (signal?.aborted) throw new Error('pilot-preparation-aborted');
      if (sim.currentTerrain.loadError || Date.now() - started > 30000) throw new Error('invalid-scenario: Lukla DEM unavailable');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (signal?.aborted) throw new Error('pilot-preparation-aborted');
    sim.setAircraft('F16', true);
    sim.setPreset('cruise', false, true);
    if (sim.activeAirport !== 'lukla' || sim.currentAircraftId !== 'F16' || sim.physicsDt !== 1 / 120) {
      throw new Error('invalid-scenario: Lukla/F16/120Hz required');
    }
    const manifest = createValleyManifest();
    if (pilotKind === 'human') {
      manifest.spawn.iasKnots = 550;
      manifest.spawn.aglM = 25;
    }
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
    const solution = solveTrim(sim.aero, sim.engines, { iasKnots: spawn.iasKnots, altitudeMeters: sim.position.y,
      flightPathAngleDeg: 0, flapsIndex: 0, gearState: 0, spoilers: 0 });
    // The shared F16 model can have more idle thrust than level-flight drag.
    // As with the production preset, accept its feasible idle-limited trim,
    // preserving the real acceleration rather than inventing lower thrust.
    if (!solution.feasible || (!solution.handsOffFeasible && solution.reason !== 'idle')) throw new Error('invalid-scenario: F16 trim');
    const heading = spawn.headingDeg * Math.PI / 180;
    this.forward = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
    this.right = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
    sim.quaternion.setFromEuler(new THREE.Euler(solution.alphaDeg * Math.PI / 180, -heading, 0, 'YXZ'));
    sim.linearVelocity.copy(this.forward).multiplyScalar(solution.tas);
    sim.controls.pitchTrim = sim.aero.pitchTrim = solution.handsOffTrimDeg;
    sim.controls.throttle = solution.throttle; sim.engines.setThrottle(solution.throttle); sim.engines.settleSpool();
    sim.windField = new WindField({ profile: environmentProfile, seed, runwayHeadingDeg: spawn.headingDeg,
      crosswindSign: seed % 2 ? -1 : 1 });
    sim.windTimeSeconds = 0; sim.windField.sample(sim.position, 0, sim.aero.windWorld);
    sim.missionPhysicsFrame = null;
    this.initialControls = Object.fromEntries(['elevator', 'aileron', 'rudder', 'throttle', 'brakes'].map(k => [k, sim.controls[k]]));
    this.manifest = { ...manifest, missionId, environmentProfile, environmentSeed: seed, sensorSeed,
      runwayThreshold: { x: spawn.x, y: ground, z: spawn.z }, runwayHeadingDeg: spawn.headingDeg,
      fixedConfiguration: { gearDown: false, flapIndex: 0, pitchTrimDeg: sim.controls.pitchTrim },
      configuration: { gearDown: false, flapIndex: 0, pitchTrimDeg: sim.controls.pitchTrim,
        referencePitchDeg: solution.alphaDeg, trimThrottle: solution.throttle },
      recommendedSpeeds: { cruiseKnots: spawn.iasKnots }, timeoutSeconds: manifest.timeoutTicks / 120,
      navigationProfile: 'gate-finish-bearing-range-v2', sensorNoiseEnabled: noise,
      sensorProfile: { id: 'valley-navigation-v2', correlatedNoise: noise, physicsHz: 120,
        decisionPeriodTicks: 24, reactionDelayTicks: 24 },
      successConditions: { minimumAglM: manifest.course.minimumAglM, targetAglM: manifest.course.targetAglM,
        minimumIasKnots: manifest.minimumIasKnots, maximumIasKnots: manifest.maximumIasKnots,
        orderedGates: true, noContactOrDamage: true },
      departure: { ...spawn }, destination: { ...manifest.course.points.at(-1),
        headingDeg: (Math.atan2(manifest.course.points.at(-1).x - manifest.course.points.at(-2).x,
          -(manifest.course.points.at(-1).z - manifest.course.points.at(-2).z)) * 180 / Math.PI + 360) % 360 }, terrainSensor: { model: 'forward-terrain-range-v1', maxRangeM: 2000 },
      configuredState: { massKg: sim.aero.mass, fuelKg: sim.engines.fuelKg, position: sim.position.toArray(),
        quaternion: sim.quaternion.toArray(), velocity: sim.linearVelocity.toArray() } };
    this.terrainPerception = new TerrainPerception({ sensorSeed, noise });
    this.syncPose();
    this.visualizer?.dispose();
    this.visualizer = new ValleyWaypointsVisualizer(sim, this.manifest.course);
    sim.valleyVisualizer = this.visualizer;
    return { manifest: this.manifest, initialSnapshot: this.snapshot(0) };
  }

  snapshot(tick) {
    const s = super.snapshot(tick), sim = this.sim;
    const projected = projectValleyPosition(this.manifest.course, sim.position);
    return { ...s, position: { x: sim.position.x, y: sim.position.y, z: sim.position.z },
      aglM: s.radioAltFt * 0.3048, progressM: projected.progressM,
      runwayS: projected.progressM, centerlineOffsetM: projected.crossTrackM,
      pitchRateDegS: sim.angularVelocity.x * 180 / Math.PI,
      rollRateDegS: -sim.angularVelocity.z * 180 / Math.PI,
      yawRateDegS: -sim.angularVelocity.y * 180 / Math.PI };
  }

  observe(perception, snapshot, tick, evaluator) {
    const observation = perception.sample(snapshot, tick);
    const gateIndex = Math.min(evaluator.nextGateIndex, this.manifest.course.points.length - 1);
    const gate = this.manifest.course.points[gateIndex];
    const dx = gate.x - snapshot.position.x, dz = gate.z - snapshot.position.z;
    const bearing = perception.scalar('valley.goalBearingDeg', (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360, 0.5, tick);
    bearing.mean = (bearing.mean + 360) % 360;
    observation.navigation = { goalBearingDeg: bearing,
      goalRangeM: perception.scalar('valley.goalRangeM', Math.hypot(dx, dz), 3 + Math.hypot(dx, dz) * 0.01, tick),
      currentGateIndex: gateIndex, totalGates: this.manifest.course.points.length - 1 };
    const finish = this.manifest.course.points.at(-1);
    const fx = finish.x - snapshot.position.x, fz = finish.z - snapshot.position.z;
    const finishBearing = perception.scalar('valley.finishBearingDeg',
      (Math.atan2(fx, -fz) * 180 / Math.PI + 360) % 360, 0.5, tick);
    finishBearing.mean = (finishBearing.mean + 360) % 360;
    observation.navigation.finishBearingDeg = finishBearing;
    observation.navigation.finishRangeM = perception.scalar('valley.finishRangeM',
      Math.hypot(fx, fz), 3 + Math.hypot(fx, fz) * 0.01, tick);
    observation.terrain = this.terrainPerception.sample({ position: this.sim.position, quaternion: this.sim.quaternion,
      getHeight: (x, z) => this.sim.currentTerrain.getHeight(x, z) }, tick);
    this.visualizer?.setEvaluator(evaluator);
    this.visualizer?.setNextGateIndex(evaluator.nextGateIndex);
    return observation;
  }

  release() {
    this.visualizer?.dispose();
    this.visualizer = null;
    if (this.sim?.valleyVisualizer) {
      this.sim.valleyVisualizer = null;
    }
    super.release();
  }
}
