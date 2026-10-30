import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Aerodynamics, createAeroResult } from '../../src/physics/Aerodynamics.js';
import { EngineModel } from '../../src/physics/EngineModel.js';
import { LandingGear } from '../../src/physics/LandingGear.js';
import { FlightControls } from '../../src/controls/FlightControls.js';
import { F16_FALCON } from '../../src/config/aircraftConfigs.js';
import { LuklaTerrain } from '../../src/environment/LuklaTerrain.js';
import { LuklaAirport } from '../../src/environment/LuklaAirport.js';
import { CollisionDetector } from '../../src/physics/CollisionDetector.js';
import { installPhysicsIntegrator } from '../../src/core/PhysicsIntegrator.js';
import { installPresetSpawner } from '../../src/core/PresetSpawner.js';
import { F16LuklaScenario } from '../../src/director/scenarios/F16LuklaScenario.js';

class ControlsWithoutDom extends FlightControls {
  initListeners() {} // Input events are absent; virtual input processing is unchanged.
}
class PhysicsHost {}
installPhysicsIntegrator(PhysicsHost);
installPresetSpawner(PhysicsHost);

/** Real 120 Hz controls, forces, contacts, DEM and airport collisions; no renderer. */
export function flyF16Lukla({ Scenario = F16LuklaScenario, maxSeconds = 300 } = {}) {
  const bytes = readFileSync(new URL('../../public/terrain/lukla_dem.bin', import.meta.url));
  const terrain = new LuklaTerrain(undefined, 16,
    new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4));
  const airport = new LuklaAirport();
  const sim = new PhysicsHost();
  const stages = [], cameras = [];
  Object.assign(sim, {
    currentTerrain: terrain, currentAirport: airport, activeAirport: 'lukla',
    currentAircraftId: 'F16', currentAircraftConfig: F16_FALCON,
    aero: new Aerodynamics(F16_FALCON), engines: new EngineModel(F16_FALCON),
    gear: new LandingGear(F16_FALCON), controls: new ControlsWithoutDom(null, { getGamepads: () => [] }),
    aircraft: { group: new THREE.Group(), useGltf: true },
    autopilot: { master: false, annunciation() { return ''; } },
    cameraSystem: { autoPaused: true, setMode(mode) { cameras.push({ stage: director.currentStage, mode }); } },
    // UI, audio and particles do not feed the integrated forces or collision policy.
    flightWarnings: { update() { return []; } }, tireSmokeSystem: { spawnTouchdownSmoke() {} },
    showToast() {}, refreshTakeoffPerformance() {},
    // A fresh host already has reset fuel, damage and controls. The scenario owns
    // the airborne pose/configuration and calls the production trim solver below.
    setPreset() {},
    triggerCrash(result) { this.isCrashed = true; this.crashResult = result; director.stop(); },
    position: new THREE.Vector3(), linearVelocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    telemetry: { iasKnots: 280, pitchDeg: 0, rollDeg: 0, headingDeg: 238 },
    bodyContactNotices: new Set(), airborneTime: 15, landingRestTime: 0,
    lastOnGround: false, lastGearTarget: false, actualTakeoffMassKg: null,
    _performanceClock: 0, totalSimTime: 0,
  });
  for (const key of ['_cgBefore', '_intThrust', '_intGravity', '_intNetForce', '_intNetMoment',
    '_intAngAcc', '_intForward', '_intNonGrav', '_intCabinUp']) sim[key] = new THREE.Vector3();
  sim._rotationBefore = new THREE.Quaternion();
  sim._intDeltaRot = new THREE.Quaternion();
  sim._intEuler = new THREE.Euler();
  sim._aeroResult = createAeroResult();
  sim.collisionDetector = new CollisionDetector(terrain, airport, null, null, null);
  sim.collisionDetector.loadAircraftConfig(F16_FALCON);
  sim.engines.refuel(sim.aero);

  const snapshot = () => ({
    seconds: director.totalTimer,
    along: sim.position.x * .848048 - sim.position.z * .529919,
    cross: sim.position.x * .529919 + sim.position.z * .848048,
    agl: sim.position.y - terrain.getHeight(sim.position.x, sim.position.z),
    iasKnots: sim.telemetry.iasKnots, gear: sim.gear.gearState,
  });
  const director = {
    isActive: true, userCameraOverridden: false, totalTimer: 0, stageTimer: 0,
    setStage(stage) {
      this.currentStage = stage;
      this.stageTimer = 0;
      scenario.enterStage(stage);
      stages.push({ stage, ...snapshot() });
    },
    updateBanner() {}, getActiveScenario() { return scenario; },
    stop() { this.isActive = false; },
  };
  sim.demoDirector = director;
  const scenario = new Scenario(director, sim);
  director.setStage(Scenario.STAGES.ESTABLISH ?? Scenario.STAGES.INGRESS);
  let gearDown = null, touchdown = null, finite = true, stallFrames = 0;
  let runwayPassMin = Infinity, runwayPassMax = -Infinity;
  for (let tick = 0; tick < maxSeconds * 120 && director.isActive; tick++) {
    director.totalTimer += 1 / 120;
    director.stageTimer += 1 / 120;
    sim.totalSimTime += 1 / 120;
    scenario.update(1 / 120);
    if (director.isActive) sim.integratePhysics(1 / 120);
    const state = snapshot();
    finite &&= [...sim.position, ...sim.linearVelocity, ...sim.angularVelocity, ...sim.quaternion].every(Number.isFinite);
    if (!finite) break;
    if (!gearDown && sim.gear.targetGearState > .5) gearDown = { stage: director.currentStage, ...state };
    if (!touchdown && scenario.result.touchdown) touchdown = state;
    if (sim.aero.isStalled && !sim.gear.onGround) stallFrames++;
    if ([Scenario.STAGES.ESTABLISH, Scenario.STAGES.LOW_PASS].includes(director.currentStage)
      && Math.abs(state.along) < 265) {
      runwayPassMin = Math.min(runwayPassMin, state.agl);
      runwayPassMax = Math.max(runwayPassMax, state.agl);
    }
  }
  const stopPosition = sim.position.clone();
  // The real director hands off parking brakes; keep integrating to detect drift.
  if (Scenario.STAGES.ROLLOUT !== undefined) {
    sim.controls.setVirtualInput('brakes', 1);
    sim.controls.setVirtualInput('throttle', 0);
    for (let tick = 0; tick < 1200 && !sim.isCrashed; tick++) sim.integratePhysics(1 / 120);
  }
  return {
    result: scenario.result, stages, cameras, gearDown, touchdown, finite, stallFrames,
    runwayPassMin, runwayPassMax, final: snapshot(), crash: sim.crashResult,
    incident: Boolean(sim.landingIncident),
    gearDamage: sim.gear.contacts.map(c => ({ id: c.id, damage: c.damage, state: c.damageState })),
    holdDrift: sim.position.distanceTo(stopPosition),
  };
}
