import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { LuklaCircuitScenario } from '../src/director/scenarios/LuklaCircuitScenario.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { EngineModel } from '../src/physics/EngineModel.js';

const STAGES = LuklaCircuitScenario.STAGES;
function setup({ cockpitModelLoading = false } = {}) {
  const inputs = {};
  const modes = [];
  const sim = {
    activeAirport: 'lukla', position: new THREE.Vector3(),
    linearVelocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
    telemetry: { pitchDeg: 7, rollDeg: 0, headingDeg: 58, iasKnots: 110,
      radioAltFt: 0, onGround: true, gearState: 1, isTransit: false },
    aero: new Aerodynamics(), gear: new LandingGear(), engines: new EngineModel(),
    controls: { setVirtualInput: (k, v) => { assert.ok(Number.isFinite(v)); inputs[k] = v; },
      clearVirtualInputs: () => {}, setParkingBrake(v) { this.parkingBrake = v; } },
    aircraft: { cockpit: { cockpitModelLoading } },
    cameraSystem: { setMode(m) { modes.push(m); }, userLookOverridden: false },
    sky: { setTimeOfDay() {} }, showToast() {},
    setPreset() { this.presetCalls = (this.presetCalls || 0) + 1; }
  };
  const director = new DemoFlightDirector(sim);
  director.start('lukla');
  const place = (s, y = 2950, w = 0) => sim.position.set(s * 0.848048 + w * 0.529919, y, -s * 0.529919 + w * 0.848048);
  return { sim, director, scenario: director.luklaScenario, inputs, place, modes };
}

describe('Lukla continuous circuit and truthful completion', () => {
  it('uses explicit light loading and physical transitions without midflight preset changes', () => {
    const { sim, director, scenario, place } = setup();
    assert.equal(sim.aero.mass, 43000);
    director.stageTimer = 60;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.CLIFF_TAKEOFF);
    place(-400, 2850);
    sim.telemetry.onGround = false;
    sim.telemetry.radioAltFt = 100;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.CANYON_CLIMB);
    director.stageTimer = 60;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.CANYON_CLIMB);
    place(-2700);
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.HIMALAYAN_CRUISE);
    director.stageTimer = 20;
    sim.telemetry.headingDeg = 238;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.HIMALAYAN_CRUISE);
    sim.telemetry.headingDeg = 58;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.CANYON_APPROACH);
    place(-210, 2815, -5);
    sim.telemetry.radioAltFt = 0;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.CANYON_APPROACH, 'Height alone is not contact');
    sim.telemetry.onGround = true;
    for (const c of sim.gear.contacts) c.isGrounded = true;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.UPHILL_TOUCHDOWN);
    assert.equal(scenario.result.airborne, true);
    assert.equal(sim.presetCalls, 1);
  });

  it('requires actual ground speed, runway position and two continuous seconds of wheel support', () => {
    const { sim, director, scenario, place } = setup();
    scenario.result.airborne = true;
    director.touchdownConfirmed = true;
    director.setStage(STAGES.UPHILL_TOUCHDOWN);
    for (const c of sim.gear.contacts) c.isGrounded = true;
    place(100, 2851, -5);
    sim.linearVelocity.set(20, 0, 0);
    sim.telemetry.iasKnots = 0; // Wind/telemetry cannot substitute for stopped wheels.
    director.stageTimer = 100;
    director.update(3);
    assert.equal(director.isActive, true);
    sim.linearVelocity.set(0, 0, 0);
    place(250, 2868, -5);
    director.update(3);
    assert.equal(director.isActive, true, 'Past the safe stop envelope');
    place(100, 2851, -5);
    director.update(1);
    sim.gear.contacts[0].isGrounded = false;
    director.update(0.1);
    sim.gear.contacts[0].isGrounded = true;
    director.update(1);
    assert.equal(director.isActive, true, 'Loss of support resets the stop timer');
    director.update(1.01);
    assert.equal(director.isActive, false);
    assert.equal(scenario.result.status, 'completed');
    assert.equal(sim.controls.parkingBrake, true);
    assert.equal(sim.gear.brakes, 1);
  });

  it('defers auto-start until loaded terrain is observed, then starts exactly once', () => {
    const { sim, director, scenario } = setup();
    sim.currentTerrain = { isLoaded: false };
    director.start('lukla');
    assert.equal(director.isActive, true);
    assert.equal(director.waitingForTerrain, true);
    assert.equal(scenario.result.status, 'pending');
    for (let i = 0; i < 10; i++) director.update(1);
    assert.equal(sim.presetCalls, 2, 'Fallback only parks once at the destination runway');
    assert.equal(director.totalTimer, 0);
    sim.currentTerrain.isLoaded = true;
    director.update(0.1);
    assert.equal(director.waitingForTerrain, false);
    assert.equal(director.currentStage, STAGES.CLIFF_TAKEOFF);
    assert.equal(scenario.result.status, 'running');
    director.update(0.1);
    assert.equal(sim.presetCalls, 3, 'Loading completion must not repeatedly reset the flight');
    assert.equal(sim.controls.parkingBrake, false);
  });

  it('does not resurrect a cancelled pending demo when the terrain finishes loading', () => {
    const { sim, director, scenario } = setup();
    sim.currentTerrain = { isLoaded: false };
    director.start('lukla');
    director.stop();
    sim.currentTerrain.isLoaded = true;
    director.update(1);
    assert.equal(director.isActive, false);
    assert.equal(director.waitingForTerrain, false);
    assert.equal(scenario.result.status, 'cancelled');
    assert.equal(sim.presetCalls, 2, 'cancelled pending demo retains only its runway parking reset');
  });

  it('fails and releases the pending UI and parking brake after a DEM load error', () => {
    const { sim, director, scenario } = setup();
    sim.currentTerrain = { isLoaded: false, loadError: null };
    director.start('lukla');
    sim.currentTerrain.loadError = 'Lukla DEM request failed (HTTP 503)';
    director.update(0.1);
    assert.equal(director.isActive, false);
    assert.equal(director.waitingForTerrain, false);
    assert.equal(scenario.result.status, 'failed');
    assert.equal(scenario.result.reason, sim.currentTerrain.loadError);
    assert.equal(sim.controls.parkingBrake, false);
    assert.equal(sim.gear.brakes, 0);
    director.update(10);
    assert.equal(scenario.result.status, 'failed');
    sim.currentTerrain.isLoaded = true;
    sim.currentTerrain.loadError = null;
    director.start('lukla');
    assert.equal(scenario.result.status, 'running', 'A later successful load allows an explicit retry');
  });

  it('marks an in-flight stop as cancelled and preserves terminal outcomes', () => {
    const { director, scenario } = setup();
    director.stop();
    assert.equal(director.isActive, false);
    assert.equal(scenario.result.status, 'cancelled');
    director.update(1);
    assert.equal(scenario.result.status, 'cancelled');
    for (const status of ['completed', 'failed']) {
      director.start('lukla');
      scenario.result.status = status;
      director.stop();
      assert.equal(scenario.result.status, status);
    }
  });

  it('does not overwrite a pending demo crash with cancellation', () => {
    const { sim, director, scenario } = setup();
    sim.currentTerrain = { isLoaded: false };
    director.start('lukla');
    director.stopForCrash({ description: 'Ground collision during terrain wait' });
    assert.equal(director.isActive, false);
    assert.equal(scenario.result.status, 'failed');
    sim.currentTerrain.isLoaded = true;
    director.update(1);
    assert.equal(scenario.result.status, 'failed');
  });

  it('records failure synchronously on the crash-stop path and retains it while inactive', () => {
    const { sim, director, scenario } = setup();
    const crash = { description: 'Nose gear impact' };
    sim.isCrashed = true;
    sim.crashResult = crash;
    director.stopForCrash(crash);
    assert.equal(director.isActive, false);
    assert.equal(scenario.result.status, 'failed');
    assert.equal(scenario.result.reason, crash.description);
    director.update(3);
    assert.equal(scenario.result.status, 'failed');
    assert.equal(scenario.result.reason, crash.description);
  });

  it('reports a crash as failure even if stopped with an expired stage timer', () => {
    const { sim, director, scenario } = setup();
    director.setStage(STAGES.UPHILL_TOUCHDOWN);
    director.stageTimer = 100;
    sim.isCrashed = true;
    director.update(3);
    assert.equal(director.isActive, false);
    assert.equal(scenario.result.status, 'failed');
  });

  it('caps nose-up elevator and commands push-out as AoA approaches the stall (alphaGuarded)', () => {
    const { scenario } = setup();
    // Below the 11 deg guard threshold the demand passes through untouched
    assert.equal(scenario.alphaGuarded(0.5, 10.9), 0.5);
    // Inside the margin the demand shrinks toward zero
    const near = scenario.alphaGuarded(0.5, 12.5);
    assert.ok(near > 0 && near < 0.5, 'Demand must shrink before the stall');
    // At the protection threshold (~13.2 deg) the demand is neutral
    const atLimit = scenario.alphaGuarded(0.5, 13.2);
    assert.ok(Math.abs(atLimit) < 0.05, 'Command must be ~neutral at the protection threshold');
    // Beyond it the limiter pushes the nose out even while the law still wants +0.5
    assert.ok(scenario.alphaGuarded(0.5, 14.5) < -0.2, 'Limiter must command nose-down past the margin');
    // A demanded push-over is never limited
    assert.equal(scenario.alphaGuarded(-0.6, 9.0), -0.6);
    assert.equal(scenario.alphaGuarded(-0.6, 14.5), -0.6);
  });
});

describe('Lukla takeoff view waits for the streamed cockpit interior', () => {
  it('opens on the exterior and cuts into the cockpit once the model resolves', () => {
    const { sim, director, scenario, modes } = setup({ cockpitModelLoading: true });
    assert.equal(modes.at(-1), CameraSystem.MODES.CHASE);
    assert.equal(scenario.pendingCockpitCut, true);

    director.update(0.1);
    assert.equal(modes.at(-1), CameraSystem.MODES.CHASE, 'No interior view while the GLB is still downloading');
    assert.equal(scenario.pendingCockpitCut, true);

    sim.aircraft.cockpit.cockpitModelLoading = false;
    director.stageTimer = 1.0;
    director.update(0.1);
    assert.equal(modes.at(-1), CameraSystem.MODES.COCKPIT);
    assert.equal(scenario.pendingCockpitCut, false);
    assert.equal(scenario.stageCameraCutDone, true,
      'The opening exterior shot replaces the later chase cut instead of flapping between views');
  });

  it('enters the cockpit immediately when the interior model is already available', () => {
    const { scenario, modes } = setup();
    assert.equal(modes.at(-1), CameraSystem.MODES.COCKPIT);
    assert.equal(scenario.pendingCockpitCut, false);
  });

  it('honours a user camera choice instead of cutting into the cockpit', () => {
    const { sim, director, scenario, modes } = setup({ cockpitModelLoading: true });
    director.onUserCameraChange();
    sim.aircraft.cockpit.cockpitModelLoading = false;
    director.update(0.1);
    assert.equal(modes.at(-1), CameraSystem.MODES.CHASE, 'User-selected view must not be overridden');
    assert.equal(scenario.pendingCockpitCut, false);
  });
});
