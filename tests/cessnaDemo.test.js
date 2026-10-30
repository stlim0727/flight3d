import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { CessnaDemoScenario } from '../src/director/scenarios/CessnaDemoScenario.js';
import { cityRoute, buildingClearance } from '../src/director/scenarios/cessnaRoutes.js';
import { demoProfiles, resolveDemoProfile } from '../src/director/demoProfiles.js';
import { CESSNA_172, F16_FALCON } from '../src/config/aircraftConfigs.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { flyVerticalPath } from '../src/director/PilotControlLaws.js';

function simulator(airport = 'coastal') {
  const inputs = {};
  return {
    activeAirport: airport, currentAircraftId: 'C172', lobby: { demoProfile: 'maneuvers' },
    position: new THREE.Vector3(), linearVelocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    currentTerrain: { getHeight: () => 0, isLoaded: true }, foliage: { buildingData: [] },
    aircraft: { group: new THREE.Group(), modelLoaded: true },
    aero: new Aerodynamics(CESSNA_172), engines: new EngineModel(CESSNA_172), gear: new LandingGear(CESSNA_172),
    telemetry: { pitchDeg: 3, rollDeg: 0, headingDeg: 90, iasKnots: 90, onGround: false },
    controls: { throttle: 0.5, setVirtualInput(key, value) { assert.ok(Number.isFinite(value), `${key} finite`); inputs[key] = value; },
      clearVirtualInputs() { for (const key of Object.keys(inputs)) delete inputs[key]; }, setParkingBrake() {} },
    setPreset() {}, applyComputedTrim() {},
    cameraSystem: { modes: [], setMode(mode) { this.modes.push(mode); }, resetDroneOrbit() {} },
    setAircraft() { assert.fail('demo must not replace the selected Cessna'); }, inputs,
  };
}

describe('aircraft-specific demos', () => {
  it('offers only supported routes, retaining Boeing classic and resolving stale selections', () => {
    assert.deepEqual(demoProfiles('B738').map(p => p.id), ['classic']);
    assert.deepEqual(demoProfiles('C172').map(p => p.id), ['proximity', 'scenic', 'maneuvers']);
    assert.deepEqual(demoProfiles('C172', 'lukla').map(p => p.id), ['scenic', 'maneuvers']);
    assert.equal(resolveDemoProfile('C172', 'lukla', 'classic').id, 'scenic');
    assert.equal(resolveDemoProfile('B738', 'coastal', 'maneuvers').id, 'classic');
    assert.equal(demoProfiles('C172', 'lukla')[0].labelKey, 'demo.c172.canyon');
  });

  it('routes the F16 only to its loaded Lukla low pass and cancels cleanly', () => {
    const sim = simulator('lukla'); sim.currentAircraftId = 'F16';
    sim.aero = new Aerodynamics(F16_FALCON);
    sim.engines = new EngineModel(F16_FALCON);
    sim.gear = new LandingGear(F16_FALCON);
    sim.currentTerrain.isLoaded = false;
    const d = new DemoFlightDirector(sim); d.start();
    assert.equal(d.getActiveScenario(), d.f16Scenario);
    assert.equal(d.waitingForTerrain, true);
    assert.deepEqual(demoProfiles('F16', 'lukla').map(p => p.id), ['low-pass', 'canyon-slalom', 'canyon-chase']);
    assert.deepEqual(demoProfiles('F16', 'coastal'), []);
    sim.currentTerrain.isLoaded = true; d.update(0.1);
    assert.equal(d.f16Scenario.result.status, 'running');
    assert.equal(sim.gear.gearState, 0);
    assert.ok(sim.linearVelocity.length() > 140);
    d.stop();
    assert.equal(d.f16Scenario.result.status, 'cancelled');
    assert.equal(sim.controls.aircraftControlsDisabled, false);
    assert.equal(d.start('coastal'), false);
    assert.equal(d.isActive, false);
  });

  it('runs F16 canyon chase scenario with target bandit and cancels cleanly', () => {
    const sim = simulator('lukla'); sim.currentAircraftId = 'F16';
    sim.lobby.demoProfile = 'canyon-chase';
    sim.aero = new Aerodynamics(F16_FALCON);
    sim.engines = new EngineModel(F16_FALCON);
    sim.gear = new LandingGear(F16_FALCON);
    sim.currentTerrain.isLoaded = true;
    const d = new DemoFlightDirector(sim);
    d.start();
    assert.equal(d.getActiveScenario(), d.f16CanyonScenario);
    assert.equal(d.f16CanyonScenario.result.status, 'running');
    assert.ok(d.f16CanyonScenario.target !== null);
    d.update(0.5);
    assert.ok(sim.linearVelocity.length() > 130);
    d.stop();
    assert.equal(d.f16CanyonScenario.result.status, 'cancelled');
    assert.equal(d.f16CanyonScenario.target, null);
    assert.equal(d.isActive, false);
  });

  it('flies the single-engine control law without producing NaN', () => {
    const sim = simulator();
    sim.aero.qDyn = 1400; sim.aero.tas = 46;
    flyVerticalPath(sim, 0, 90, sim.telemetry);
    assert.ok(Number.isFinite(sim.inputs.elevator));
    assert.ok(Number.isFinite(sim.inputs.throttle));
  });

  it('keeps the Cessna configuration, blocks manual surfaces, and releases inputs with power on handoff', () => {
    const sim = simulator(), d = new DemoFlightDirector(sim);
    d.start();
    assert.equal(d.getActiveScenario(), d.cessnaScenario);
    assert.equal(d.profile, 'maneuvers');
    assert.equal(sim.engines.numEngines, 1);
    assert.equal(sim.aero.mass, CESSNA_172.massProperties.currentMassKg);
    assert.equal(sim.controls.aircraftControlsDisabled, true);
    d.update(0.1);
    d.setStage(CessnaDemoScenario.STAGES.COMPLETED);
    assert.equal(d.isActive, false);
    assert.equal(sim.controls.aircraftControlsDisabled, false);
    assert.deepEqual(sim.inputs, {});
    assert.equal(sim.controls.throttle, 0.5);
    assert.equal(d.cessnaScenario.result.status, 'completed');
    d.start(); d.stop();
    assert.equal(d.cessnaScenario.result.status, 'cancelled');
    assert.equal(sim.controls.throttle, 0);
  });

  it('waits for loaded canyon terrain and retains the maneuver choice when loading completes', () => {
    const sim = simulator('lukla'); sim.currentTerrain.isLoaded = false;
    const d = new DemoFlightDirector(sim); d.start();
    assert.equal(d.waitingForTerrain, true);
    assert.equal(d.currentStage, -1);
    sim.lobby.demoProfile = 'scenic';
    sim.currentTerrain.isLoaded = true; d.update(0.1);
    assert.equal(d.waitingForTerrain, false);
    assert.equal(d.profile, 'maneuvers');
    assert.equal(d.currentStage, CessnaDemoScenario.STAGES.ESTABLISH);
  });

  it('records a terrain loading failure against the selected aircraft scenario', () => {
    const sim = simulator('lukla'); sim.currentTerrain.isLoaded = false;
    const d = new DemoFlightDirector(sim); d.start();
    sim.currentTerrain.loadError = 'DEM unavailable'; d.update(0.1);
    assert.equal(d.isActive, false);
    assert.equal(d.cessnaScenario.result.status, 'failed');
    assert.equal(d.cessnaScenario.result.reason, 'DEM unavailable');
    assert.equal(sim.controls.aircraftControlsDisabled, false);
  });

  it('honors a selected camera through subsequent shots and stages', () => {
    const sim = simulator(), d = new DemoFlightDirector(sim); d.start();
    d.update(0.1); const cuts = sim.cameraSystem.modes.length;
    sim.cameraSystem.autoSwitch = false; d.onUserCameraChange();
    d.update(11);
    assert.equal(sim.cameraSystem.modes.length, cuts);
    // CameraSystem itself preserves userModeSelected between stages. The
    // director must not force a user-action cut to bypass that protection.
    sim.cameraSystem.setMode = () => false;
    d.setStage(CessnaDemoScenario.STAGES.LEFT_TURN); d.update(0.1);
    assert.equal(d.cessnaScenario.cutIndex, -1);
  });

  it('plans against tall buildings and the complete terrain corridor', () => {
    const terrain = { getHeight: (x, z) => 10 + Math.max(0, Math.sin(x / 300) * Math.cos(z / 300) * 10) };
    const buildings = Array.from({ length: 20 }, (_, index) => ({ x: 2300 + index * 50, z: 1400,
      y: 10, height: 120, width: 30, depth: 30 }));
    const route = cityRoute(terrain, buildings);
    assert.ok(route.clearance >= 40);
    assert.ok(route.altitude >= 60);
    assert.equal(buildingClearance({x: 0, z: 0}, {x: 1, z: 0}, 100, 50,
      [{x: 50, z: 0, width: 20, depth: 20, y: 0, height: 100}]), -Math.hypot(20, 20) / 2);
  });
});
