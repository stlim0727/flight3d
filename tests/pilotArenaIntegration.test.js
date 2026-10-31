import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MissionRunner } from '../src/arena/MissionRunner.js';
import { SimulatorMissionAdapter } from '../src/arena/SimulatorMissionAdapter.js';
import { PilotHost } from '../src/pilot/PilotHost.js';
import { takeoffPilotSource } from '../src/pilot/examples/takeoff.js';
import { landingPilotSource } from '../src/pilot/examples/landing.js';
import { createPilotMissionSimulation } from './helpers/pilotMissionFlight.js';
import { PilotThreadWorker } from './helpers/pilotThreadWorker.js';
import { DevScenarioRunner } from '../src/dev/DevScenarioRunner.js';

test('production physics and isolated pilot runtime complete a takeoff and landing without rendering', async () => {
  for (const [missionId, source] of [['takeoff-basic-v1', takeoffPilotSource], ['landing-basic-v1', landingPilotSource]]) {
    const sim = createPilotMissionSimulation();
    // Reproduce a developer/shadow scenario being active before the mission.
    sim.shadowDemo = { stop() {} };
    sim.syncFlowUi = () => {};
    sim.devRunner = new DevScenarioRunner(sim, {});
    sim.devRunner.active = { id: 'previous-development-scenario' };
    const runner = new MissionRunner(new SimulatorMissionAdapter(sim), {
      hostFactory: () => new PilotHost({ workerFactory: () => new PilotThreadWorker(),
        startupTimeoutMs: 5000, tickTimeoutMs: 1000 }),
      yieldFrame: async () => {},
    });
    sim.pilotArena = runner;
    const record = await runner.start(source, { missionId, seed: 1, environmentProfile: 'mild-disturbance-v1' });
    assert.equal(record.status, 'succeeded', `${missionId}: ${record.reason} ${record.detail ?? ''}`);
    assert.ok(record.commands.length > 100);
    assert.ok(record.commands.every(c => c.applyTick === c.sampleTick + 24));
    assert.match(record.sourceHash, /^[a-f0-9]{64}$/);
    assert.match(record.manifestHash, /^[a-f0-9]{64}$/);
    assert.equal(sim.controls.aircraftControlsDisabled, false);
    assert.equal(sim.controls.virtualElevator, null);
    assert.equal(sim.windField, null);
    assert.equal(sim.devRunner.active, null);
  }
});
