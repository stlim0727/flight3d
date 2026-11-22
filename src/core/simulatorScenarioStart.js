import { regionalCruise } from '../config/regionalCruises.js';
import { updateOpenWorldTerrain } from '../environment/OpenWorldTerrain.js';
import { ScenarioStartCoordinator } from './ScenarioStartCoordinator.js';
import { applyDeviceTimeOfDay, saveSimulatorPreferences } from '../config/simulatorPreferences.js';
import { saveFlightSelection } from '../config/flightSelection.js';
import { isScenarioAvailable } from '../config/scenarioRegistry.js';
import { mapCruisePoint } from '../config/mapFlightPlaces.js';
import { resolveMapFlightPlan } from '../config/mapFlightPlan.js';
import { BASE_OFFSETS } from '../world/UnifiedWorld.js';
import { projectToLocal } from '../geospatial/incheon.js';
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
        pilotMode: sim.lobby.pilotMode || 'human',
        mapPlan: resolveLobbyMapPlan(sim) });
      if (request.scenario !== 'demo' && sim.touchControls?.gyroRequested && !sim.touchControls?.gyroActive) {
        sim.touchControls.restoreGyroSettings({ userGesture: true });
      }
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
      async preset(request) {
        const result = sim.setPreset(request.scenario);
        if (request.mapPlan) sim.applyMapSpawn(request.mapPlan.spawn, request.mapPlan.scenario);
        if (request.mapPlan?.airportCode && request.mapPlan.scenario !== 'cruise') {
          await waitForStreamedAirport(sim, request.mapPlan.airportCode);
          alignMapSpawnToContact(sim, request.mapPlan.spawn);
        }
        if (!regionalCruise(request.scenario)) return result;
        return waitForRegionalTerrain(sim);
      },
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

      if (sim.multiplayer?.active && sim.multiplayer.preparing) sim.gameFlow.pause();
    },
  });
}

function resolveLobbyMapPlan(sim) {
  const choice = sim.lobby?.mapPlan;
  if (!choice || choice.state === 'none') return null;
  const catalog = sim.mapPlaces;
  const airport = catalog?.airports?.find(entry => entry.code === choice.airportCode);
  const point = mapCruisePoint(choice, catalog);
  const [runwayId, endId] = (choice.runwayKey ?? '').split(':');
  const baseOffset = airport ? projectToLocal(airport.latitude, airport.longitude) : [0, 0];
  const anchorBase = BASE_OFFSETS[sim.activeAirport] ?? [0, 0];
  return resolveMapFlightPlan({
    state: choice.state,
    airport,
    runwayId,
    endId,
    point,
    baseOffset,
    anchorBase,
    aircraftId: sim.lobby.aircraft ?? sim.currentAircraftId,
  });
}

async function waitForStreamedAirport(sim, code) {
  const streamer = sim.airportStreamer;
  if (!streamer) return;
  // A global search result can share a code with another airport's IATA;
  // its tileId is the only deterministic link to the selected record.
  const tileId = sim.lobby?.mapPlan?.tileId
    ?? sim.mapPlaces?.airports?.find(entry => entry.code === code)?.tileId;
  streamer.releaseGroundHold?.();
  streamer.ensure(code, { tileId });
  do {
    const status = streamer.statusFor?.(code);
    if (status?.state === 'ready') return;
    streamer.update?.({
      x: sim.position.x,
      z: sim.position.z,
      speedMps: 0,
      onGround: Boolean(sim.telemetry?.onGround),
      onRunway: Boolean(sim.currentAirport?.isOnRunway?.(sim.position.x, sim.position.z)),
      destinationCode: code,
    });
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (performance.now() < deadline);
}

function alignMapSpawnToContact(sim, spawn) {
  if (!spawn?.alignToGround) return;
  const sampleX = spawn.state === 'approach' && Number.isFinite(spawn.surfaceX) ? spawn.surfaceX : sim.position.x;
  const sampleZ = spawn.state === 'approach' && Number.isFinite(spawn.surfaceZ) ? spawn.surfaceZ : sim.position.z;
  const ground = sim.currentTerrain?.getHeight?.(sampleX, sampleZ);
  if (!Number.isFinite(ground)) return;
  sim.position.y = ground + spawn.groundClearanceM + (spawn.glideRiseM ?? 0);
}

async function waitForRegionalTerrain(sim) {
  const deadline = performance.now() + 6000;
  do {
    updateOpenWorldTerrain(sim);
    if (sim.currentTerrain.openWorld?.readyAt(sim.position.x, sim.position.z)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (performance.now() < deadline);
}
