import * as THREE from 'three';
import { Aerodynamics, createAeroResult } from '../physics/Aerodynamics.js';
import { EngineModel } from '../physics/EngineModel.js';
import { LandingGear } from '../physics/LandingGear.js';
import { FlightControls } from '../controls/FlightControls.js';
import { AIRCRAFT_REGISTRY } from '../config/aircraftConfigs.js';
import { Terrain } from '../environment/Terrain.js';
import { Airport } from '../environment/Airport.js';
import { CollisionDetector } from '../physics/CollisionDetector.js';
import { installPhysicsIntegrator } from '../core/PhysicsIntegrator.js';
import { installPresetSpawner } from '../core/PresetSpawner.js';

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
export function createHeadlessSimulation({ aircraftId = 'B738', airportId = 'coastal',
  terrain: suppliedTerrain, airport: suppliedAirport } = {}) {
  const config = AIRCRAFT_REGISTRY[aircraftId];
  if (!config) throw new TypeError('Unknown aircraft');
  const terrain = suppliedTerrain ?? new PhysicsTerrain(20000, 16, { textures: {} });
  const airport = suppliedAirport ?? new PhysicsAirport();
  const sim = new PhysicsHost();
  Object.assign(sim, {
    currentTerrain: terrain, currentAirport: airport, activeAirport: airportId,
    currentAircraftId: aircraftId, currentAircraftConfig: config,
    controls: new ControlsWithoutDom(null, { getGamepads: () => [] }),
    aircraft: { group: new THREE.Group(), useGltf: true },
    autopilot: { master: false, annunciation() { return ''; }, reset() { this.master = false; }, disengage() { this.master = false; } },
    cameraSystem: { autoPaused: true, snapToTarget() {} },
    flightWarnings: { reset() {}, update() { return []; } },
    tireSmokeSystem: { clear() {}, spawnTouchdownSmoke() {} },
    renderPose: { reset() {} }, demoDirector: { isActive: false, stop() {} },
    showToast() {}, refreshTakeoffPerformance() {},
    async setAirport(id) { if (id !== airportId) throw new Error('Unsupported airport'); this.activeAirport = id; },
    setAircraft(id) { if (id !== aircraftId) throw new Error('Unsupported aircraft'); this.currentAircraftId = id; },
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
  sim.loadAircraftConfig(config);
  for (const key of ['_cgBefore', '_intThrust', '_intGravity', '_intNetForce', '_intNetMoment',
    '_intAngAcc', '_intForward', '_intNonGrav', '_intCabinUp']) sim[key] = new THREE.Vector3();
  sim._rotationBefore = new THREE.Quaternion();
  sim._intDeltaRot = new THREE.Quaternion();
  sim._intEuler = new THREE.Euler();
  sim._aeroResult = createAeroResult();
  sim.collisionDetector = new CollisionDetector(terrain, airport, null, null, null);
  sim.collisionDetector.loadAircraftConfig(config);
  sim.engines.refuel(sim.aero);
  return sim;
}
