import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';

/** The coastal route needs the same live sim objects its control laws read. */
function createMockSimulator() {
  const virtualInputs = {};
  return {
    activeAirport: 'coastal',
    currentAircraftId: 'B738',
    position: new THREE.Vector3(-1200, 12.5, 0),
    linearVelocity: new THREE.Vector3(0, 0, 0),
    angularVelocity: new THREE.Vector3(),
    telemetry: { altitudeFt: 41, radioAltFt: 0, iasKnots: 0, groundSpeedKnots: 0,
      pitchDeg: 0, rollDeg: 0, headingDeg: 90, onGround: true, gearState: 1, isTransit: false },
    controls: {
      brakes: 0, throttle: 0, parkingBrake: false, aircraftControlsDisabled: false,
      setAircraftControlsDisabled(value) { this.aircraftControlsDisabled = Boolean(value); },
      setParkingBrake(value) { this.parkingBrake = Boolean(value); if (value) this.brakes = 1; },
      setVirtualInput: (name, value) => {
        assert.ok(Number.isFinite(value), `virtual input ${name} is not finite`);
        virtualInputs[name] = value;
      },
      clearVirtualInputs: () => { for (const key of Object.keys(virtualInputs)) delete virtualInputs[key]; },
    },
    engines: new EngineModel(),
    gear: new LandingGear(),
    aero: new Aerodynamics(),
    currentTerrain: { getHeight: () => 0, isLoaded: true },
    sky: { setTimeOfDay: () => {}, getSunDirection: () => new THREE.Vector3(0, 1, 0) },
    water: { setSunDirection: () => {} },
    cameraSystem: { mode: CameraSystem.MODES.DRONE, onCycleMode: null,
      setMode(mode) { this.mode = mode; }, resetDroneOrbit: () => {} },
    setPreset: () => {},
    showToast: () => {},
  };
}

function startedDirector() {
  const sim = createMockSimulator();
  const director = new DemoFlightDirector(sim);
  director.start('coastal');
  return { sim, director, scenario: director.coastalScenario };
}

describe('CoastalDemoScenario result contract', () => {
  it('reports running once the route starts and idle before', () => {
    const sim = createMockSimulator();
    const director = new DemoFlightDirector(sim);
    assert.equal(director.coastalScenario.result.status, 'idle');
    director.start('coastal');
    assert.equal(director.coastalScenario.result.status, 'running');
    assert.equal(director.coastalScenario.result.minClearanceM, Infinity);
  });

  it('marks the route completed with elapsed time and the stop position', () => {
    const { director, scenario } = startedDirector();
    director.stageTimer = 12;
    director.totalTimer = 137.5;
    director.setStage(DemoFlightDirector.COASTAL_STAGES.COMPLETED);
    assert.equal(scenario.result.status, 'completed');
    assert.equal(scenario.result.elapsedSeconds, 137.5);
    assert.deepEqual(scenario.result.stopPosition.toArray(), [-1200, 12.5, 0]);
    // Completion hands control back parked: the director must not have re-opened
    // the run, and the scenario must not downgrade its own completed verdict.
    assert.equal(director.isActive, false);
    assert.equal(scenario.result.status, 'completed');
  });

  it('records the arrival state when the rollout stage is entered', () => {
    const { sim, director, scenario } = startedDirector();
    sim.telemetry.iasKnots = 139;
    sim.telemetry.pitchDeg = 1.8;
    sim.telemetry.radioAltFt = 6;
    director.setStage(DemoFlightDirector.COASTAL_STAGES.TOUCHDOWN_ROLLOUT);
    assert.deepEqual(scenario.result.touchdown, { iasKnots: 139, pitchDeg: 1.8, radioAltFt: 6 });
  });

  it('measures clearance only while airborne', () => {
    const { sim, director, scenario } = startedDirector();
    director.currentStage = DemoFlightDirector.COASTAL_STAGES.OCEAN_CRUISE;
    director.stageTimer = 1;
    sim.telemetry.onGround = false;
    sim.position.set(0, 400, 0);
    director.update(1 / 120);
    assert.ok(Math.abs(scenario.result.minClearanceM - 400) < 1,
      `airborne clearance should be ~400 m, got ${scenario.result.minClearanceM}`);
    sim.position.set(0, 3, 0);
    sim.telemetry.onGround = true;
    director.update(1 / 120);
    assert.ok(scenario.result.minClearanceM > 300, 'ground frames must not set the airborne minimum');
  });

  it('fails with the crash reason and keeps that verdict through the handoff', () => {
    const { director, scenario } = startedDirector();
    director.stopForCrash({ description: 'Struck a container ship' });
    assert.equal(scenario.result.status, 'failed');
    assert.equal(scenario.result.reason, 'Struck a container ship');
  });

  it('falls back to the crash type when no description is available', () => {
    const { director, scenario } = startedDirector();
    director.stopForCrash({ type: 'WATER' });
    assert.equal(scenario.result.reason, 'WATER');
  });

  it('cancels an unfinished route without overwriting a decided one', () => {
    const { director, scenario } = startedDirector();
    director.stop();
    assert.equal(scenario.result.status, 'cancelled');

    scenario.result.status = 'completed';
    director.isActive = true;
    director.stop();
    assert.equal(scenario.result.status, 'completed');
  });
});
