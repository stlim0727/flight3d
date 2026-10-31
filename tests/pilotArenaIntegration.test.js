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
import { SimulatorClass } from './helpers/simulatorClass.js';
import { GameFlowController, FLOW } from '../src/ui/GameFlowController.js';

function mockFlowDocument(t) {
  const saved = globalThis.document;
  globalThis.document = { body: { dataset: {} }, getElementById: () => null };
  t.after(() => { if (saved === undefined) delete globalThis.document; else globalThis.document = saved; });
}

function attachFlowUi(sim) {
  sim.gameFlow = new GameFlowController();
  sim.gameFlow.enterFlight();
  sim.shadowDemo = { active: false, stop() {} };
  sim.syncAudioPause = sim.updateMenuToggle = () => {};
  sim.cameraSystem.beginPauseView = sim.cameraSystem.endPauseView = () => {};
  sim.syncFlowUi = SimulatorClass.prototype.syncFlowUi;
  sim.devRunner = new DevScenarioRunner(sim, {});
  sim.devRunner.active = { id: 'previous-development-scenario' };
}

test('production physics and isolated pilot runtime complete a takeoff and landing without rendering', async t => {
  mockFlowDocument(t);
  for (const [missionId, source] of [['takeoff-basic-v1', takeoffPilotSource], ['landing-basic-v1', landingPilotSource]]) {
    const sim = createPilotMissionSimulation();
    // Reproduce a developer/shadow scenario being active before the mission.
    attachFlowUi(sim);
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
    assert.equal(sim.controls.inputBlocked, false);
  }
});

test('manual handover recomputes input blocking after developer cleanup, preserving explicit pause', async t => {
  mockFlowDocument(t);
  for (const flow of [FLOW.FLIGHT, FLOW.PAUSED]) {
    const sim = createPilotMissionSimulation();
    attachFlowUi(sim);
    let reply;
    const runner = sim.pilotArena = new MissionRunner(new SimulatorMissionAdapter(sim), {
      hostFactory: () => ({ async start() {}, stop() {},
        tick() { return new Promise(resolve => { reply = resolve; }); } }),
    });
    const run = runner.start('source', { missionId: 'takeoff-basic-v1' });
    while (!reply) await new Promise(resolve => setImmediate(resolve));
    assert.equal(sim.controls.inputBlocked, true, 'preparation blocks inputs while the arena owns flight');
    if (flow === FLOW.PAUSED) sim.gameFlow.pause();
    runner.stop();
    reply({ elevator: 0, aileron: 0, rudder: 0, throttle: 1, brakes: 0 });
    assert.equal((await run).status, 'aborted');
    assert.equal(sim.controls.inputBlocked, flow === FLOW.PAUSED);
    sim.controls.handleKeyDown({ code: 'KeyS' });
    assert.equal(Boolean(sim.controls.keys.KeyS), flow === FLOW.FLIGHT);
  }
});
