import { ScenarioStartCoordinator } from './ScenarioStartCoordinator.js';
import { applyDeviceTimeOfDay, saveSimulatorPreferences } from '../config/simulatorPreferences.js';
import { saveFlightSelection } from '../config/flightSelection.js';
import { isScenarioAvailable } from '../config/scenarioRegistry.js';
import { t } from '../i18n/index.js';

/** Composition of scenario policy, simulator operations and durable preferences. */
export function createSimulatorScenarioStart(sim) {
  return new ScenarioStartCoordinator({
    prepare({ keepTimeOfDay = false }) {
      sim.devRunner.stop();
      sim.shadowDemo.stop();
      sim.replayDirector.stop();
      const request = Object.freeze({ airport: sim.lobby.airport,
        aircraft: sim.lobby.aircraft ?? sim.currentAircraftId,
        scenario: sim.lobby.preset, demoProfile: sim.lobby.demoProfile,
        pilotMode: sim.lobby.pilotMode || 'human' });
      const wantsDemo = request.scenario === 'demo';
      if (sim.demoDirector?.isActive || sim.demoDirector?.waitingForTerrain) {
        sim.demoDirector.stop(wantsDemo ? null : () => t('manual.control.engaged'));
      }
      if (!wantsDemo && !keepTimeOfDay && sim.demoDirector && !sim.demoDirector.userTimeOfDayOverridden) {
        applyDeviceTimeOfDay(sim);
      }
      sim.gameFlow.setCinematicAvailable(isScenarioAvailable(sim.activeAirport, 'demo'));
      sim.gameFlow.enterFlight();
      return request;
    },
    installers: {
      // PresetSpawner owns the recording after pose installation; mission adapters
      // own recording before course preparation. Neither is restarted at commit.
      preset: request => sim.setPreset(request.scenario),
      demo(request) {
        if (sim.demoDirector.start(null, request.demoProfile) === false) {
          throw new Error('Demo scenario could not start.');
        }
        sim.beginFlightRecording();
      },
      valley(request) {
        sim.lastPresetType = 'valley';
        return sim.startValleyMission({ pilotKind: request.pilotMode });
      },
    },
    commit(request) {
      sim.analytics?.trackFlightStart?.({
        airport: sim.activeAirport, aircraft: sim.currentAircraftId,
        scenario: request.scenario,
        pilotMode: request.scenario === 'valley' ? request.pilotMode : 'human',
        timeOfDay: sim.sky?.timeOfDay,
      });
      saveSimulatorPreferences({ demoProfile: request.demoProfile });
      saveFlightSelection(request);
      if (request.scenario !== 'demo' && sim.touchControls?.gyroRequested && !sim.touchControls?.gyroActive) {
        sim.touchControls.restoreGyroSettings({ userGesture: true });
      }
      if (sim.multiplayer?.active && sim.multiplayer.preparing) sim.gameFlow.pause();
    },
  });
}
