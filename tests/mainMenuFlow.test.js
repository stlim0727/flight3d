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
    startFlight() { this.starts++; this.gameFlow.enterFlight(); },
    async applyPendingScene() { this.rebuilds++; this.startFlight(); },
  });
}

test('menu button opens and holds a flight; repeated presses cannot resume or restart', () => {
  const sim = simulator();
  sim.gameFlow.enterFlight();
  sim.toggleMainMenu();
  assert.equal(sim.gameFlow.state, FLOW.LOBBY);
  assert.equal(sim.gameFlow.isPhysicsFrozen(), true);
  sim.toggleMainMenu();
  assert.equal(sim.gameFlow.state, FLOW.LOBBY);
  assert.equal(sim.starts, 0);
  sim.resumeFlight();
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT);
  assert.equal(sim.gameFlow.isPhysicsFrozen(), false);
  assert.equal(sim.starts, 0);
  sim.gameFlow.pause();
  sim.toggleMainMenu();
  assert.equal(sim.gameFlow.state, FLOW.LOBBY);
  assert.equal(sim.gameFlow.canResumeFromLobby(), true);
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
