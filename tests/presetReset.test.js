import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilotMissionSimulation } from './helpers/pilotMissionFlight.js';

test('fresh ordinary presets clear cached damage even after the global crash flag was cleared', () => {
  for (const aircraftId of ['B738', 'C172', 'F16']) {
    const sim = createPilotMissionSimulation({ aircraftId });
    for (const preset of ['runway', 'approach', 'cruise']) {
      sim.isCrashed = false;
      sim.aircraft.damaged = true;
      sim.aircraft.resetCrashVisuals = function() { this.damaged = false; };
      sim.aero.separation = 0.9;
      sim.physicsAccumulator = 0.05;
      sim.controls.setVirtualInput('elevator', 1);
      sim.setPreset(preset);
      assert.equal(sim.aircraft.damaged, false, `${aircraftId}/${preset}`);
      assert.equal(sim.isCrashed, false);
      assert.equal(sim.aero.separation, 0);
      assert.equal(sim.physicsAccumulator, 0);
      assert.equal(sim.controls.virtualElevator, null);
      assert.equal(sim.engines.failed.some(Boolean), false);
    }
  }
});

test('valley preset sets safe aloft coordinates and zero velocity', () => {
  const sim = createPilotMissionSimulation({ aircraftId: 'F16' });
  sim.activeAirport = 'valley';
  sim.isCrashed = true;
  sim.aircraft.damaged = true;
  sim.aircraft.resetCrashVisuals = function() { this.damaged = false; };
  sim.setPreset('valley');
  assert.equal(sim.isCrashed, false);
  assert.equal(sim.aircraft.damaged, false);
  assert.ok(sim.position.y >= 2200);
  assert.equal(sim.linearVelocity.length(), 0);
  assert.equal(sim.gear.gearState, 0);
});

test('preset reset and clearCrashState reset telemetry pilot physiology state', () => {
  const sim = createPilotMissionSimulation({ aircraftId: 'F16' });
  sim.telemetry.pilot = {
    isGLOC: true,
    consciousness: 0.0,
    blackout: 1.0,
    gZ: 8.0,
  };
  sim.clearCrashState();
  assert.equal(sim.telemetry.pilot.isGLOC, false);
  assert.equal(sim.telemetry.pilot.consciousness, 1.0);

  sim.telemetry.pilot = { isGLOC: true, consciousness: 0.0 };
  sim.setPreset('runway');
  assert.equal(sim.telemetry.pilot.isGLOC, false);
  assert.equal(sim.telemetry.pilot.consciousness, 1.0);
});
