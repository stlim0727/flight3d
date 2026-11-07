import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFlowController, FLOW } from '../src/ui/GameFlowController.js';
import { SimulatorClass } from './helpers/simulatorClass.js';

function simulator() {
  return Object.assign(Object.create(SimulatorClass.prototype), {
    gameFlow: new GameFlowController(),
    lobby: { airport: 'coastal', aircraft: 'B738', preset: 'runway' },
    activeAirport: 'coastal', currentAircraftId: 'B738',
    starts: 0, rebuilds: 0,
    replayDirector: { active: false, stop() { this.active = false; } },
    startFlight() { this.starts++; this.gameFlow.enterFlight(); },
    async applyPendingScene() { this.rebuilds++; this.startFlight(); },
  });
}

test('menu button toggles between in-play and held menu; resumes without respawn', () => {
  const sim = simulator();
  sim.gameFlow.enterFlight();
  // 1. In-play -> held menu
  sim.toggleMainMenu();
  assert.equal(sim.gameFlow.state, FLOW.LOBBY);
  assert.equal(sim.gameFlow.isPhysicsFrozen(), true);
  assert.equal(sim.gameFlow.canResumeFromLobby(), true);

  // 2. Second press resumes held flight without respawn
  sim.toggleMainMenu();
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT);
  assert.equal(sim.gameFlow.isPhysicsFrozen(), false);
  assert.equal(sim.starts, 0);

  // 3. From PAUSED, toggleMainMenu resumes flight
  sim.gameFlow.pause();
  assert.equal(sim.gameFlow.state, FLOW.PAUSED);
  sim.toggleMainMenu();
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT);
  assert.equal(sim.starts, 0);
});

test('resume ignores pending choices; start new applies them', async () => {
  const sim = simulator();
  sim.gameFlow.enterFlight();
  sim.toggleMainMenu();
  sim.lobby.airport = 'lukla';
  sim.lobby.aircraft = 'C172';
  sim.resumeFlight();
  assert.equal(sim.activeAirport, 'coastal');
  assert.equal(sim.currentAircraftId, 'B738');
  assert.equal(sim.starts, 0);
  sim.toggleMainMenu();
  await sim.fly();
  assert.equal(sim.rebuilds, 1);
  assert.equal(sim.starts, 1);
});

test('start new restarts even with unchanged choices', async () => {
  const sim = simulator();
  sim.gameFlow.enterFlight();
  sim.toggleMainMenu();
  await sim.fly();
  assert.equal(sim.starts, 1);
  assert.equal(sim.rebuilds, 0);
});

test('resume rejects boot lobby, crashes and in-progress starts', () => {
  const sim = simulator();
  sim.resumeFlight();
  assert.equal(sim.gameFlow.state, FLOW.LOBBY);
  sim.gameFlow.enterFlight();
  sim.toggleMainMenu();
  for (const blocked of ['isCrashed', 'startingFlight', 'airportLoading']) {
    sim[blocked] = true;
    sim.resumeFlight();
    assert.equal(sim.gameFlow.state, FLOW.LOBBY);
    sim[blocked] = false;
  }
  sim.resumeFlight();
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT);
});

test('opening the menu during replay exits rather than holding a resumable flight', () => {
  const sim = simulator();
  sim.gameFlow.enterFlight();
  sim.replayDirector.active = true;
  sim.replayPanel = { exit() { sim.gameFlow.returnToLobby(false); sim.replayDirector.stop(); } };
  sim.toggleMainMenu();
  assert.equal(sim.gameFlow.state, FLOW.LOBBY);
  assert.equal(sim.gameFlow.canResumeFromLobby(), false);
  assert.equal(sim.replayDirector.active, false);
});

test('starting another scene releases replay terrain before comparing or rebuilding scenery', async () => {
  const sim = simulator();
  sim.replayDirector.stop = () => { sim.activeAirport = 'lukla'; };
  sim.lobby.airport = 'lukla';
  await sim.fly();
  assert.equal(sim.rebuilds, 0, 'the saved terrain is restored before deciding whether to rebuild');
  assert.equal(sim.starts, 1);
});

test('a lazy scenario holds physics and rejects repeated starts until spawn completes', async () => {
  const { stepPhysics } = await import('../src/core/physicsTiming.js');
  for (const outcome of ['ready', 'failed']) {
    const sim = simulator();
    let complete;
    sim.startFlight = SimulatorClass.prototype.startFlight;
    sim.spawnFlight = async () => {
      sim.starts++;
      sim.gameFlow.enterFlight();
      await new Promise((resolve, reject) => { complete = outcome === 'ready' ? resolve : reject; });
    };
    // A stale pose must never reach collision detection during a lazy import.
    sim.integratePhysics = () => assert.fail('integrated the previous scenario before spawning');
    sim.showToast = sim.syncFlowUi = () => {};
    const savedWarn = console.warn;
    console.warn = () => {};
    try {
      const start = sim.fly();
      assert.equal(sim.startingFlight, true);
      stepPhysics(sim);
      await sim.fly();
      assert.equal(sim.starts, 1);
      complete(outcome === 'failed' ? new Error('module download failed') : undefined);
      await start;
      assert.equal(sim.startingFlight, false);
      assert.equal(sim.gameFlow.isPhysicsFrozen(), outcome === 'failed');
      assert.equal(sim.gameFlow.canResumeFromLobby(), false);
    } finally { console.warn = savedWarn; }
  }
});
