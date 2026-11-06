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
