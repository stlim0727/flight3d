import { regionalCruise } from '../config/regionalCruises.js';
import { ScenarioStartCoordinator } from './ScenarioStartCoordinator.js';
import { applyDeviceTimeOfDay, saveSimulatorPreferences } from '../config/simulatorPreferences.js';
import { saveFlightSelection } from '../config/flightSelection.js';
import { isScenarioAvailable } from '../config/scenarioRegistry.js';
import { mapCruisePoint, mapPlanCustomOrigin, mapPlanLabel } from '../config/mapFlightPlaces.js';
import { resolveMapFlightPlan } from '../config/mapFlightPlan.js';
import { BASE_OFFSETS } from '../world/UnifiedWorld.js';
import { projectToLocal } from '../geospatial/incheon.js';
import { t } from '../i18n/index.js';
import { applyAirportOverrides } from '../config/airportOverrides.js';
import { airportSpawnPlan } from '../config/airportSpawnPlan.js';
/** Composition of scenario policy, simulator operations and durable preferences. */
export function createSimulatorScenarioStart(sim) {
  return new ScenarioStartCoordinator({
    prepare({ keepTimeOfDay = false }) {
      sim.freezePhysics = false;
      sim.devRunner.stop();
      sim.shadowDemo.stop();
      sim.replayDirector.stop();
      sim.lobbyCameraModal?.close();
      if (sim.cameraSystem) {
        sim.cameraSystem.userModeSelected = false;
      }
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
        sim.setCustomWorldOrigin?.(request.mapPlan?.origin ?? null);
        sim.activeMapPlace = request.mapPlan
          ? {
            pointId: request.mapPlan.pointId,
            label: request.mapPlan.placeLabel ?? null,
            code: request.mapPlan.placeCode ?? request.mapPlan.airportCode ?? null,
            tileId: request.mapPlan.placeTileId ?? null,
          }
          : null;
        const result = sim.setPreset(request.scenario);
        if (request.mapPlan) sim.applyMapSpawn(request.mapPlan.spawn, request.mapPlan.scenario);
        const clearHandoff = () => {
          for (const objects of Object.values(sim._handedOffRunways ?? {})) {
            for (const object of objects) if (object) object.visible = true;
          }
          sim._handedOffRunways = {};
        };
        const registerHandoff = (code, objects) => {
          clearHandoff();
          sim._handedOffRunways = { [code]: objects.filter(Boolean) };
          sim.syncLegacyRunwayHandoff?.();
        };
        const incheonRunwayMeshes = () => {
          const airport = sim.incheonAirport;
          if (!airport) return [];
          return [airport.legacyRunwayDetails, ...(airport.pavement?.children ?? [])
            .filter(child => (child.name ?? '').startsWith('incheon-runway'))];
        };
        clearHandoff();
        if (!request.mapPlan && request.airport === 'jeju'
          && (request.scenario === 'runway' || request.scenario === 'approach')) {
          const spawn = airportSpawnPlan('RKPC', request.scenario, {
            groundClearanceM: sim.gear?.cgGroundHeightM ?? 3.5,
            aircraftId: request.aircraft,
          });
          sim.airportStreamer?.setHome?.('RKPC');
          await waitForStreamedAirport(sim, 'RKPC');
          alignMapSpawnToContact(sim, spawn);
        }
        if (!request.mapPlan && request.airport === 'lukla'
          && ['runway', 'cliff', 'approach'].includes(request.scenario)) {
          sim.airportStreamer?.setHome?.('VNLK');
          await waitForStreamedAirport(sim, 'VNLK');
        }
        if (!request.mapPlan && request.airport === 'incheon'
          && ['runway', 'approach', 'challenge'].includes(request.scenario)) {
          sim.airportStreamer?.setHome?.('RKSI');
          await waitForStreamedAirport(sim, 'RKSI');
          if (sim.airportStreamer?.regionFor?.('RKSI')) registerHandoff('RKSI', incheonRunwayMeshes());
        }
        if (request.mapPlan?.airportCode && request.mapPlan.scenario !== 'cruise') {
          sim.airportStreamer?.setHome?.(request.mapPlan.airportCode);
          await waitForStreamedAirport(sim, request.mapPlan.airportCode);
          alignMapSpawnToContact(sim, request.mapPlan.spawn);
        }
        const needsRegionalTerrain = Boolean(
          regionalCruise(request.scenario)
          || request.mapPlan?.scenario === 'cruise'
          || (request.scenario === 'cruise' && (request.airport === 'patagonia' || request.airport === 'lukla')),
        );
        if (!needsRegionalTerrain) return result;
        await waitForRegionalTerrain(sim);
        alignCruiseSpawnToTerrain(sim, { isMapPlan: Boolean(request.mapPlan) });
        return result;
      },
      async demo(request) {
        sim.setCustomWorldOrigin?.(null);
        sim.activeMapPlace = null;
        if (request.airport === 'lukla') {
          sim.airportStreamer?.setHome?.('VNLK');
          await waitForStreamedAirport(sim, 'VNLK');
        }
        if (sim.demoDirector.start(null, request.demoProfile) === false) {
          throw new Error('Demo scenario could not start.');
        }
        sim.beginFlightRecording();
      },
      valley(request) {
        sim.setCustomWorldOrigin?.(null);
        sim.activeMapPlace = null;
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
  const origin = mapPlanCustomOrigin(choice, catalog, sim.lobby?.airport ?? sim.activeAirport);
  const baseOffset = origin ? [0, 0] : (airport ? projectToLocal(airport.latitude, airport.longitude) : [0, 0]);
  const anchorBase = origin ? [0, 0] : (BASE_OFFSETS[sim.activeAirport] ?? [0, 0]);
  const normalized = applyAirportOverrides(airport);
  let plan = resolveMapFlightPlan({
    state: choice.state,
    airport: normalized,
    runwayId,
    endId,
    point,
    baseOffset,
    anchorBase,
    aircraftId: sim.lobby.aircraft ?? sim.currentAircraftId,
    origin,
  });
  // A saved selection may name a runway hidden by declarative overrides; use
  // the first visible runway rather than silently dropping the map spawn.
  if (!plan && normalized && choice.state !== 'cruise' && (runwayId || endId)) {
    plan = resolveMapFlightPlan({
      state: choice.state,
      airport: normalized,
      point,
      baseOffset,
      anchorBase,
      aircraftId: sim.lobby.aircraft ?? sim.currentAircraftId,
      origin,
    });
  }
  if (!plan) return null;
  return {
    ...plan,
    origin,
    pointId: plan.scenario === 'cruise' ? point?.id ?? null : null,
    placeLabel: mapPlanLabel(choice, catalog),
    placeCode: airport?.code ?? null,
    placeTileId: choice.tileId ?? airport?.tileId ?? null,
  };
}

async function waitForStreamedAirport(sim, code) {
  const deadline = performance.now() + 6000;
  const streamer = sim.airportStreamer;
  if (!streamer) return;
  // A global search result can share a code with another airport's IATA;
  // its tileId is the only deterministic link to the selected record.
  const tileId = sim.lobby?.mapPlan?.tileId
    ?? sim.mapPlaces?.airports?.find(entry => entry.code === code)?.tileId;
  streamer.holdDestination?.(code);
  try {
    streamer.ensure(code, { tileId });
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
  } finally {
    streamer.releaseDestinationHold?.();
  }

}
function alignMapSpawnToContact(sim, spawn) {
  if (!spawn?.alignToGround) return;
  const sampleX = spawn.state === 'approach' && Number.isFinite(spawn.surfaceX) ? spawn.surfaceX : sim.position.x;
  const sampleZ = spawn.state === 'approach' && Number.isFinite(spawn.surfaceZ) ? spawn.surfaceZ : sim.position.z;
  const ground = sim.currentTerrain?.getHeight?.(sampleX, sampleZ);
  if (!Number.isFinite(ground)) return;
  sim.position.y = ground + spawn.groundClearanceM + (spawn.glideRiseM ?? 0);
}

const DEFAULT_CRUISE_CLEARANCE_M = 750;
const CRUISE_LOOKAHEAD_DISTANCES_M = [500, 1000];

function sampleCruiseGroundM(sim) {
  const getHeight = sim.currentTerrain?.getHeight;
  if (typeof getHeight !== 'function' || !sim.position) return null;
  const { x, z } = sim.position;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  let maxGround = getHeight.call(sim.currentTerrain, x, z);
  if (!Number.isFinite(maxGround)) return null;
  const vx = sim.linearVelocity?.x ?? 0;
  const vz = sim.linearVelocity?.z ?? 0;
  const speed = Math.hypot(vx, vz);
  if (speed > 1) {
    const dx = vx / speed;
    const dz = vz / speed;
    const openWorld = sim.currentTerrain?.openWorld;
    for (const distM of CRUISE_LOOKAHEAD_DISTANCES_M) {
      const sx = x + dx * distM;
      const sz = z + dz * distM;
      if (openWorld?.readyAt && !openWorld.readyAt(sx, sz)) continue;
      const h = getHeight.call(sim.currentTerrain, sx, sz);
      if (Number.isFinite(h) && h > maxGround) maxGround = h;
    }
  }
  return maxGround;
}

/**
 * Re-align a cruise spawn once open-world DEM tiles have loaded so high-elevation
 * destinations (e.g. GeoNames places with elevationM: 0 or mountain map clicks)
 * never start underground, while preserving intentionally low authored showcases.
 */
export function alignCruiseSpawnToTerrain(sim, { isMapPlan = false } = {}) {
  const maxGround = sampleCruiseGroundM(sim);
  if (!Number.isFinite(maxGround)) return false;
  const currentY = sim.position.y;
  if (!Number.isFinite(currentY)) return false;
  let targetY = currentY;
  if (isMapPlan) {
    const minAglM = Math.min(200, Math.max(60, currentY * 0.5));
    if (currentY < maxGround + minAglM) {
      targetY = maxGround + DEFAULT_CRUISE_CLEARANCE_M;
    }
  } else {
    const desiredY = maxGround + DEFAULT_CRUISE_CLEARANCE_M;
    if (currentY < desiredY) targetY = desiredY;
  }
  if (Math.abs(targetY - currentY) < 1e-3) return false;
  sim.position.y = targetY;
  sim.applyComputedTrim?.();
  sim.engines?.settleSpool?.();
  sim.refreshTakeoffPerformance?.();
  sim.aircraft?.group?.position?.copy?.(sim.position);
  sim.aircraft?.group?.quaternion?.copy?.(sim.quaternion);
  sim.aircraft?.group?.updateMatrixWorld?.(true);
  sim.renderPose?.reset?.(sim.position, sim.quaternion);
  sim.cameraSystem?.snapToTarget?.(sim.aircraft?.group);
  return true;
}

async function waitForRegionalTerrain(sim) {
  if (!sim.currentTerrain || !sim.position) return;
  const layers = sim.ensureGeographicLayers
    ? await sim.ensureGeographicLayers()
    : await import('../environment/OpenWorldTerrain.js');
  const updateTerrain = layers?.updateOpenWorldTerrain;
  if (typeof updateTerrain !== 'function') return;
  const deadline = performance.now() + 6000;
  do {
    updateTerrain(sim);
    const openWorld = sim.currentTerrain?.openWorld;
    if (!openWorld || openWorld.readyAt?.(sim.position.x, sim.position.z)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (performance.now() < deadline);
}
