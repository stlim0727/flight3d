import * as THREE from 'three';
import { Aerodynamics, createAeroResult } from '../../src/physics/Aerodynamics.js';
import { EngineModel } from '../../src/physics/EngineModel.js';
import { LandingGear } from '../../src/physics/LandingGear.js';
import { FlightControls } from '../../src/controls/FlightControls.js';
import { BOEING_737_800 } from '../../src/config/aircraftConfigs.js';
import { Terrain } from '../../src/environment/Terrain.js';
import { Airport } from '../../src/environment/Airport.js';
import { CollisionDetector } from '../../src/physics/CollisionDetector.js';
import { installPhysicsIntegrator } from '../../src/core/PhysicsIntegrator.js';
import { installPresetSpawner } from '../../src/core/PresetSpawner.js';
import { SimulatorMissionAdapter } from '../../src/arena/SimulatorMissionAdapter.js';
import { TakeoffMission } from '../../src/arena/TakeoffMission.js';
import { LandingMission } from '../../src/arena/LandingMission.js';
import { PilotPerception } from '../../src/pilot/PilotPerception.js';
import { createBriefing, validateCommand } from '../../src/pilot/PilotProtocol.js';

class ControlsWithoutDom extends FlightControls { initListeners() {} }
// Terrain sampling, airport bounds and collision metadata are production code.
// Only mesh/texture/asset creation is omitted. No WebGL or software renderer runs.
class PhysicsTerrain extends Terrain { initTerrain() {} }
class PhysicsAirport extends Airport {
  initAirport() {}
  async loadBuildings() {}
}
class PhysicsHost {}
installPhysicsIntegrator(PhysicsHost);
installPresetSpawner(PhysicsHost);

/** Production forces, control response, terrain and contacts without a renderer. */
export function createPilotMissionSimulation() {
  const terrain = new PhysicsTerrain(20000, 16, { textures: {} });
  const airport = new PhysicsAirport();
  const sim = new PhysicsHost();
  Object.assign(sim, {
    currentTerrain: terrain, currentAirport: airport, activeAirport: 'coastal',
    currentAircraftId: 'B738', currentAircraftConfig: BOEING_737_800,
    controls: new ControlsWithoutDom(null, { getGamepads: () => [] }),
    aircraft: { group: new THREE.Group(), useGltf: true },
    autopilot: { master: false, annunciation() { return ''; }, reset() { this.master = false; }, disengage() { this.master = false; } },
    cameraSystem: { autoPaused: true, snapToTarget() {} },
    flightWarnings: { reset() {}, update() { return []; } },
    tireSmokeSystem: { clear() {}, spawnTouchdownSmoke() {} },
    renderPose: { reset() {} }, demoDirector: { isActive: false, stop() {} },
    showToast() {}, refreshTakeoffPerformance() {},
    async setAirport(id) { if (id !== 'coastal') throw new Error('Unsupported test airport'); this.activeAirport = id; },
    setAircraft(id) { if (id !== 'B738') throw new Error('Unsupported test aircraft'); this.currentAircraftId = id; },
    loadAircraftConfig(config) {
      this.currentAircraftConfig = config;
      this.aero = new Aerodynamics(config);
      this.engines = new EngineModel(config);
      this.gear = new LandingGear(config);
    },
    triggerCrash(result) { this.isCrashed = true; this.crashResult = result; },
    position: new THREE.Vector3(), linearVelocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    telemetry: { iasKnots: 0, pitchDeg: 0, rollDeg: 0, headingDeg: 90 },
    bodyContactNotices: new Set(), airborneTime: 0, landingRestTime: 0,
    lastOnGround: true, lastGearTarget: true, actualTakeoffMassKg: null,
    _performanceClock: 0, totalSimTime: 0, physicsDt: 1 / 120, physicsHz: 120,
  });
  sim.loadAircraftConfig(BOEING_737_800);
  for (const key of ['_cgBefore', '_intThrust', '_intGravity', '_intNetForce', '_intNetMoment',
    '_intAngAcc', '_intForward', '_intNonGrav', '_intCabinUp']) sim[key] = new THREE.Vector3();
  sim._rotationBefore = new THREE.Quaternion();
  sim._intDeltaRot = new THREE.Quaternion();
  sim._intEuler = new THREE.Euler();
  sim._aeroResult = createAeroResult();
  sim.collisionDetector = new CollisionDetector(terrain, airport, null, null, null);
  sim.collisionDetector.loadAircraftConfig(BOEING_737_800);
  sim.engines.refuel(sim.aero);
  return sim;
}

/** Synchronous SDK calibration, not Worker isolation or browser acceptance.
 * Physics and observation implementations are identical to the game bridge.
 * Scheduling applies a decision exactly 24 physics ticks after sampling.
 */
export async function flyPilotMission({ missionId, createPilot, environmentProfile = 'mild-disturbance-v1',
  seed = 1, sensorNoise = true, sampleEveryTicks = 120 } = {}) {
  if (typeof createPilot !== 'function') throw new TypeError('createPilot factory required');
  const sim = createPilotMissionSimulation();
  const adapter = new SimulatorMissionAdapter(sim);
  const prepared = await adapter.prepare({ missionId, environmentProfile, seed });
  const manifest = prepared.manifest;
  const mission = manifest.type === 'takeoff' ? new TakeoffMission(manifest) : new LandingMission(manifest);
  const perception = new PilotPerception({ sensorSeed: seed, noise: sensorNoise, mission: manifest.type,
    physicsHz: manifest.physicsHz, runway: { headingDeg: manifest.runwayHeadingDeg, elevationM: manifest.runwayThreshold.y } });
  const pilot = createPilot({ random: () => { throw new Error('Calibration examples must not need hidden randomness'); } });
  const briefing = createBriefing({ ...manifest,
    runway: { headingDeg: manifest.runwayHeadingDeg, elevationM: manifest.runwayThreshold.y,
      lengthM: manifest.runwayEndS - manifest.runwayStartS, widthM: manifest.runwayWidthM },
    configuration: manifest.fixedConfiguration,
    recommendedSpeeds: { rotationKnots: 140, climbKnots: 165, approachKnots: 145 },
  });
  pilot.reset(briefing);
  adapter.acquire();
  let pending = null, snapshot = prepared.initialSnapshot;
  const trace = [], commands = [];
  let outcome;
  try {
    for (let tick = 0; tick < manifest.timeoutTicks; tick++) {
      if (pending && pending.tick === tick) { adapter.apply(pending.command); pending = null; }
      if (tick % manifest.decisionPeriodTicks === 0) {
        const observation = perception.sample(snapshot, tick);
        const result = validateCommand(pilot.onTick(observation));
        if (!result.ok) throw new Error(`invalid-command: ${result.error}`);
        pending = { tick: tick + manifest.decisionPeriodTicks, command: result.command };
        commands.push({ sampleTick: tick, applyTick: pending.tick, ...pending.command });
      }
      sim.totalSimTime += sim.physicsDt;
      adapter.step();
      snapshot = adapter.snapshot(tick + 1);
      perception.updateContact(snapshot.weightOnWheels, tick + 1);
      outcome = mission.update(snapshot);
      if ((tick + 1) % sampleEveryTicks === 0 || outcome.status !== 'running') trace.push(structuredClone(snapshot));
      if (outcome.status !== 'running') break;
    }
    return { missionId, environmentProfile, seed, sensorNoise, manifest, result: mission.result(), final: snapshot,
      trace, commands, crash: sim.crashResult ?? null };
  } finally { adapter.release(); }
}
