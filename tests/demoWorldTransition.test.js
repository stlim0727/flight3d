import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { F16LuklaScenario } from '../src/director/scenarios/F16LuklaScenario.js';
import { NeonDepartureScenario } from '../src/director/scenarios/NeonDepartureScenario.js';
import { BOEING_737_800, F16_FALCON } from '../src/config/aircraftConfigs.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { RenderPose } from '../src/core/RenderPose.js';
import { stepPhysics } from '../src/core/physicsTiming.js';
import { installPresetSpawner } from '../src/core/PresetSpawner.js';

class Spawner {}
installPresetSpawner(Spawner);

function transition() {
  const sim = {
    // Airport/model selection has changed, but the scene still holds Incheon's pose.
    activeAirport: 'lukla', currentAircraftId: 'F16',
    lobby: { preset: 'demo', demoProfile: 'low-pass' },
    currentTerrain: { isLoaded: false, getHeight: () => 2836 },
    position: new THREE.Vector3(0, 3, 0), linearVelocity: new THREE.Vector3(0, 0, -40),
    quaternion: new THREE.Quaternion(), angularVelocity: new THREE.Vector3(),
    telemetry: { iasKnots: 0, onGround: true, pitchDeg: 0, rollDeg: 0, headingDeg: 90 },
    aero: new Aerodynamics(F16_FALCON), engines: new EngineModel(F16_FALCON), gear: new LandingGear(F16_FALCON),
    aircraft: { group: new THREE.Group() }, physicsDt: 1 / 120, integrations: 0,
    controls: { throttle: .2, setVirtualInput() {}, clearVirtualInputs() {}, setParkingBrake() {} },
    cameraSystem: { setMode() {} }, showToast() {}, applyComputedTrim() {},
    setPreset(preset) {
      this.spawnedPreset = preset;
      if (preset === 'runway') {
        this.position.set(0, 2839, 0);
        this.linearVelocity.set(0, 0, 0);
      }
    },
    integratePhysics() {
      assert.ok(this.position.y > this.currentTerrain.getHeight(this.position.x, this.position.z),
        'the old Incheon altitude must never reach Lukla collision integration');
      assert.ok(['runway', 'cruise'].includes(this.spawnedPreset));
      this.integrations++;
    },
  };
  sim.renderPose = new RenderPose(sim.position, sim.quaternion);
  sim.demoDirector = new DemoFlightDirector(sim);
  sim.demoDirector.start('lukla', 'low-pass');
  return sim;
}

test('Incheon B737 to cold Lukla F16 waits for DEM and spawns before collision integration', () => {
  const sim = transition();
  const held = sim.position.toArray();
  assert.equal(sim.spawnedPreset, 'runway', 'cold transition parks at the destination first');
  assert.equal(sim.demoDirector.waitingForTerrain, true);
  for (let i = 0; i < 120; i++) stepPhysics(sim);
  assert.equal(sim.integrations, 0);
  assert.deepEqual(sim.position.toArray(), held);
  sim.currentTerrain.isLoaded = true;
  stepPhysics(sim);
  assert.equal(sim.demoDirector.waitingForTerrain, false);
  assert.equal(sim.demoDirector.currentStage, F16LuklaScenario.STAGES.ESTABLISH);
  assert.equal(sim.integrations, 1);
  assert.ok(sim.linearVelocity.length() > 140);
});

test('DEM load failure does not release the stale pose into collision physics', () => {
  const sim = transition();
  sim.currentTerrain.loadError = 'DEM request failed';
  stepPhysics(sim);
  assert.equal(sim.demoDirector.isActive, false);
  for (let i = 0; i < 10; i++) stepPhysics(sim);
  assert.equal(sim.integrations, 0);
  assert.equal(sim.position.y, 2839);
});

test('cancelling while Lukla loads leaves a safe parked pose when terrain arrives', () => {
  const sim = transition();
  sim.demoDirector.stop();
  stepPhysics(sim);
  assert.equal(sim.integrations, 0);
  sim.currentTerrain.isLoaded = true;
  stepPhysics(sim);
  assert.equal(sim.integrations, 1);
  assert.equal(sim.spawnedPreset, 'runway');
  assert.equal(sim.demoDirector.isActive, false);
  assert.deepEqual(sim.linearVelocity.toArray(), [0, 0, 0]);
});

function createCrossAirportDemoSim({ preloadCoastal = false, preloadNeon = false } = {}) {
  const coastalTerrain = { mesh: new THREE.Group(), getHeight: () => 12 };
  const coastalAirport = { group: new THREE.Group(), getHeight: () => 25 };
  const neonCity = {
    group: new THREE.Group(),
    terrain: { mesh: new THREE.Group(), getHeight: () => 18 },
    airport: {
      group: new THREE.Group(),
      getHeight: () => 20,
      controlTowerData: { x: 10, y: 20, z: 30, height: 40 },
    },
  };
  let resolveNeon = null;
  const neonReady = new Promise(resolve => { resolveNeon = resolve; });

  const sim = Object.assign(new Spawner(), {
    scene: new THREE.Scene(),
    activeAirport: 'incheon',
    currentAircraftId: 'B738',
    aircraftConfig: BOEING_737_800,
    lobby: { airport: 'incheon', preset: 'demo', demoProfile: 'default' },
    gameFlow: { abandonResumableFlight() {}, setCinematicAvailable() {} },
    incheonAirport: {
      group: new THREE.Group(),
      terrain: { mesh: new THREE.Group(), getHeight: () => 7 },
      towerCab: { x: 0, y: 80, z: 0 },
    },
    terrain: preloadCoastal ? coastalTerrain : null,
    airport: preloadCoastal ? coastalAirport : null,
    neonCity: preloadNeon ? neonCity : null,
    position: new THREE.Vector3(0, 7, 0),
    linearVelocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    angularVelocity: new THREE.Vector3(),
    telemetry: { iasKnots: 0, onGround: true, pitchDeg: 0, rollDeg: 0, headingDeg: 90 },
    aero: new Aerodynamics(BOEING_737_800),
    engines: new EngineModel(BOEING_737_800),
    gear: new LandingGear(BOEING_737_800),
    aircraft: { group: new THREE.Group() },
    physicsDt: 1 / 120,
    integrations: 0,
    controls: { throttle: 0.2, setVirtualInput() {}, clearVirtualInputs() {}, setParkingBrake() {} },
    cameraSystem: {
      towerPos: new THREE.Vector3(),
      setTerrain() {},
      setMode() {},
      snapBehind() {},
    },
    showToast() {},
    applyComputedTrim() {},
    syncUnifiedWorld() { return false; },
    ensureCoastalRegion: async function () {
      this.terrain = coastalTerrain;
      this.airport = coastalAirport;
      return { terrain: coastalTerrain, airport: coastalAirport };
    },
    ensureNeonRegion: async function () {
      await neonReady;
      this.neonCity = neonCity;
      return neonCity;
    },
    setPreset(preset) {
      this.spawnedPreset = preset;
      this.spawnedOnAirport = this.activeAirport;
      this.spawnedTerrainHeight = this.currentTerrain?.getHeight?.(0, 0) ?? null;
    },
    integratePhysics() {
      this.integrations++;
    },
  });
  sim.currentTerrain = sim.incheonAirport.terrain;
  sim.currentAirport = sim.incheonAirport;
  sim.renderPose = new RenderPose(sim.position, sim.quaternion);
  sim.demoDirector = new DemoFlightDirector(sim);
  return { sim, resolveNeon };
}

test('DemoFlightDirector.start switches synchronously when target region is already loaded', () => {
  const { sim } = createCrossAirportDemoSim({ preloadCoastal: true });
  sim.demoDirector.start('coastal');

  assert.equal(sim.activeAirport, 'coastal');
  assert.equal(sim.demoDirector.isActive, true);
  assert.equal(sim.demoDirector.waitingForTerrain, false);
  assert.equal(sim.demoDirector.currentStage, DemoFlightDirector.COASTAL_STAGES.PREFLIGHT_ORBIT);
  assert.equal(sim.currentTerrain.getHeight(0, 0), 12);
});

test('DemoFlightDirector.start waits for async region load before entering target airport stage', async () => {
  const { sim, resolveNeon } = createCrossAirportDemoSim({ preloadNeon: false });
  sim.demoDirector.start('neon');

  assert.equal(sim.demoDirector.isActive, true);
  assert.equal(sim.demoDirector.waitingForTerrain, true);
  assert.equal(sim.demoDirector.currentStage, DemoFlightDirector.STAGES.IDLE);
  assert.equal(sim.activeAirport, 'incheon');

  stepPhysics(sim);
  assert.equal(sim.integrations, 0);

  resolveNeon();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sim.activeAirport, 'neon');
  assert.equal(sim.demoDirector.isActive, true);
  assert.equal(sim.demoDirector.waitingForTerrain, false);
  assert.equal(sim.demoDirector.currentStage, NeonDepartureScenario.STAGES.LINEUP);
  assert.equal(sim.currentTerrain.getHeight(0, 0), 18);
});
