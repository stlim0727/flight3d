import { FlightStartCoordinator } from './FlightStartCoordinator.js';
import { FlightStartLoadingView } from '../ui/FlightStartLoadingView.js';
import { t } from '../i18n/index.js';

/** Composition boundary: adapt mutable simulator services to narrow start ports. */
export function createSimulatorFlightStart(sim, stage) {
  const loading = new FlightStartLoadingView({
    stage,
    latency: sim.inputLatency,
    setBusy: busy => sim.lobbyScreen?.setSelectionBusy(busy),
  });
  return new FlightStartCoordinator({
    isLocked: () => Boolean(sim.multiplayer?.locked),
    hold: {
      get: () => Boolean(sim.startingFlight),
      set: held => { sim.startingFlight = held; },
    },
    spawn: options => sim.spawnFlight(options),
    loading,
    scene: {
      async prepare() {
        sim.gameFlow.holdForPendingStart();
        if (sim.lobby.airport !== sim.activeAirport) {
          await loading.stage(1, 'startup.world');
          sim.applyingPendingStart = true;
          try {
            await sim.setAirport(sim.lobby.airport);
          } finally {
            sim.applyingPendingStart = false;
          }
        }
        if (sim.lobby.aircraft !== sim.currentAircraftId) {
          await loading.stage(2, 'startup.aircraft');
          sim.setAircraft(sim.lobby.aircraft);
        }
      },
    },
    recover: error => recoverSimulatorFlightStart(sim, error),
  });
}

/** Shared failure recovery for coordinated starts and the pause mission retry. */
export function recoverSimulatorFlightStart(sim, error) {
  sim.pilotArena?.stop('start-failed');
  if (sim.flightRecorder) sim.flightRecorder.active = false;
  if (sim.replayRecorder) sim.replayRecorder.active = false;
  sim.crashDebriefRemaining = null;
  sim.debriefReport = null;
  sim.debriefReplay = null;
  sim.gameFlow.returnToLobby(false);
  sim.gameFlow.setCinematicAvailable(false);
  sim.syncFlowUi();
  console.warn('Flight start failed:', error);
  sim.showToast(() => t('startup.failed'));
}
