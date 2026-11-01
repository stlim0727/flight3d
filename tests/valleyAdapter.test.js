import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createValleySimulation } from './helpers/valleyFlight.js';
import { ValleyMissionAdapter } from '../src/arena/ValleyMissionAdapter.js';
import { ValleyMission } from '../src/arena/ValleyMission.js';
import { PilotPerception } from '../src/pilot/PilotPerception.js';
import { validatePlainData, createBriefing } from '../src/pilot/PilotProtocol.js';

test('F16 valley spawn and observations use real DEM and never expose live geometry to the guest', async () => {
  const sim = createValleySimulation(), adapter = new ValleyMissionAdapter(sim);
  const { manifest, initialSnapshot } = await adapter.prepare({ environmentProfile: 'calm-debug-v1', noise: false });
  assert.equal(manifest.aircraftId, 'F16');
  assert.equal(manifest.airportId, 'lukla');
  assert.ok(Math.abs(initialSnapshot.aglM - 70) < 1e-4);
  assert.equal(sim.gear.gearState, 0);
  assert.equal(sim.aero.flapsIndex, 0);
  assert.equal(sim.currentTerrain.isLoaded, true);
  const evaluator = new ValleyMission(manifest), perception = new PilotPerception({ noise: false });
  const observation = adapter.observe(perception, initialSnapshot, 0, evaluator);
  assert.equal(observation.terrain.cells.length, 84);
  assert.equal(observation.instruments.pitchRateDegS.status, 'available');
  assert.equal(observation.navigation.currentGateIndex, 1);
  assert.ok(observation.navigation.goalRangeM.mean > 800);
  assert.equal(validatePlainData(observation).ok, true);
  for (const forbidden of ['position', 'quaternion', 'getHeight', 'elevations', 'environmentSeed']) {
    assert.equal(JSON.stringify(observation).includes(`"${forbidden}"`), false, forbidden);
  }
  const briefing = createBriefing(manifest);
  assert.equal(briefing.capabilities.terrainRange, true);
  assert.equal(briefing.course.points.length, 7);
  assert.equal('configuredState' in briefing, false);
  adapter.acquire(); adapter.step();
  assert.equal(evaluator.update(adapter.snapshot(1)).status, 'running');
  adapter.release();
  assert.equal(sim.controls.aircraftControlsDisabled, false);
});
