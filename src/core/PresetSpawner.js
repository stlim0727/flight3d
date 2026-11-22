import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { BridgeFlightScenario } from '../director/BridgeFlightScenario.js';
import { regionalCruise, regionalCruiseSpawn } from '../config/regionalCruises.js';
import { NEON_RIVER } from '../config/neonRiver.js';
import { NEON_WIND } from '../config/neonWind.js';
import { BOEING_737_800 } from '../config/aircraftConfigs.js';
import { Atmosphere } from '../physics/Atmosphere.js';
import { solveTrim } from '../physics/TrimSolver.js';
import { rebaseCgVelocity } from '../physics/massKinematics.js';
import { takeoffPerformance } from '../physics/TakeoffPerformance.js';
import { stallSpeedEstimate } from '../physics/stallSpeedEstimate.js';
import { setSimulationWind, WindField } from '../physics/WindField.js';
import { UrbanWindField } from '../physics/UrbanWindField.js';
import { alignSpawnToWind } from './windSpawn.js';
import { incheonSpawn } from '../geospatial/IncheonFlightSurface.js';
import { jejuSpawn } from '../geospatial/JejuFlightSurface.js';
import { RENDER_QUALITY } from '../config/renderQuality.js';
import { APPROACH_DATA } from '../config/approachData.js';
import { WORLD_REGIONS, REGION_EXTENTS } from '../world/UnifiedWorld.js';
import { createWorldAirportFacade } from '../world/WorldAirportFacade.js';
import {
  defaultScenarioForRegion,
  isScenarioAvailable,
  requiredAircraft,
} from '../config/scenarioRegistry.js';
import { CameraSystem } from '../cameras/CameraSystem.js';
import {
  saveSavedAirport,
  saveSavedScenario,
} from '../config/flightSelection.js';
import { setMapAttributionSource } from '../ui/mapAttribution.js';

export const REGION_STREAM_DISTANCE_M = 65000;
const REGION_STREAM_INTERVAL_MS = 500;
const REGION_STREAM_MOVE_M = 500;

export function distanceToRegionBoundsM(x, z, offset, extent) {
  if (!offset || !extent) return Infinity;
  const minX = offset[0] + extent.minX;
  const maxX = offset[0] + extent.maxX;
  const minZ = offset[1] + extent.minZ;
  const maxZ = offset[1] + extent.maxZ;
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
  return Math.hypot(dx, dz);
}

class PresetSpawnerMethods {
  setPreset(type, isDemoInternal = false, pilotPreparation = false) {
    const regionCruise = regionalCruise(type);
    if (this.multiplayer?.locked) {
      if (this.multiplayer.room.session.state !== 'flying') return;
      type = this.multiplayer.room.session.config.scenario;
    }
    if (this.pilotArena?.active && !pilotPreparation) this.pilotArena.stop('preset-changed');
    // An arena field must not leak into a different mission or ordinary flight.
    if (this.windField) setSimulationWind(this);
    this.bridgeFlight?.stop();
    if (this.activeAirport === 'incheon' && this.incheonAirport) {
      this.incheonAirport.group.visible = this.incheonAirport.terrain.mesh.visible = true;
      this.currentTerrain = this.incheonAirport.terrain;
      this.currentAirport = this.incheonAirport;
    } else if (this.activeAirport === 'jeju' && this.jejuAirport) {
      this.jejuAirport.group.visible = this.jejuAirport.terrain.mesh.visible = true;
      this.currentTerrain = this.jejuAirport.terrain;
      this.currentAirport = this.jejuAirport;
    }
    if (type === 'shadow' && !this.devRunner?.changingState) {
      return this.devRunner?.start('shadow') ?? false;
    }
    this.devRunner?.stop();
    // Scenario availability depends on the active airport; an unavailable
    // pick (e.g. cliff at coastal) falls back instead of leaving a stale pose.
    if (!isScenarioAvailable(this.activeAirport, type)) type = defaultScenarioForRegion(this.activeAirport);
    this.shadowDemo?.stop();
    this.replayDirector?.stop();
    this.lastPresetType = type;
    const aircraft = requiredAircraft(type);
    if (aircraft && this.currentAircraftId !== aircraft) this.setAircraft(aircraft);
    this.audio?.reset();
    // A new sortie re-arms all six rails and removes bandits, missiles and
    // smoke left by the previous one.
    this.missileCombat?.reset();
    this.missileCombatView?.clear();
    this.cannonCombatView?.clear();
    this.rearmSystem?.reset();
    this.aircraft?.setMissileLoadout?.(this.missileCombat?.loaded);
    this.flightWarnings?.reset();
    this.pilotPhysiology?.reset?.();
    this.pilotPhysiologyFx?.reset?.();
    if (this.telemetry) {
      this.telemetry.pilot = this.pilotPhysiology ? this.pilotPhysiology.getSnapshot() : {
        gZ: 1.0, consciousness: 1.0, responsiveness: 1.0, isGLOC: false,
        blackout: 0, redout: 0, tunnelVision: 0, grayout: 0, blur: 0, glocIncidents: 0, gFatigueSeconds: 0
      };
    }
    this.telemetry.warnings = [];
    if (!isDemoInternal) this.loadAircraftConfig(this.currentAircraftConfig || BOEING_737_800);
    if (!isDemoInternal && this.demoDirector && this.demoDirector.isActive) {
      this.demoDirector.stop();
    }
    if (!isDemoInternal && this.cameraSystem) {
      if (this.cameraSystem.temporaryViewTimer > 0) {
        this.cameraSystem.temporaryViewTimer = 0;
        this.cameraSystem.savedMode = null;
      }
      if (!this.cameraSystem.userModeSelected && typeof this.cameraSystem.setMode === 'function') {
        this.cameraSystem.setMode(CameraSystem.MODES.CHASE);
      }
      if (typeof this.cameraSystem.resetLook === 'function') {
        this.cameraSystem.resetLook();
      }
      this.cameraSystem.userLookOverridden = false;
    }

    if (this.tireSmokeSystem) {
      this.tireSmokeSystem.clear();
    }
    this.lastOnGround = (type === 'runway');
    this.lastGearTarget = this.gear.isFixed ? true : (type !== 'cruise');
    this.airborneTime = (type === 'runway') ? 0.0 : 15.0;
    this.hasTouchedDownThisFlight = false;
    this.gear.resetContacts();
    this.autopilot.reset();
    this.cduCanvas?.reset?.();
    this.ndCanvas?.reset?.();
    // A preset reset redoes the aircraft with clean wings: the separation
    // state must not leak across the reset into the new flight.
    this.aero.separation = 0.0;
    this.landingIncident = false;
    this.landingStopped = false;
    this.waterDitching?.reset();
    this.waterDitchingNoticed = false;
    this.waterSinkingNoticed = false;
    this.waterSubmergedNoticed = false;
    this.bodyContactStarted = false;
    this.bodyContactNotices = new Set();
    this.excursionAnnounced = false;
    this.slideEmitClock = 0;
    this.landingRestTime = 0;

    // Cached aircraft and effects can outlive the global crash flag.
    this.clearCrashState();

    const groundClearance = this.gear?.cgGroundHeightM ?? 3.5;

    if (type === 'bridge') {
      // South of the city, trimmed 10 m above the canal, flying north along it.
      this.bridgeFlight ??= new BridgeFlightScenario(this);
      this.bridgeFlight.start();
      this.position.set(...NEON_RIVER.spawn);
      this.linearVelocity.set(0, 0, -NEON_RIVER.speedMs);
      this.angularVelocity.set(0, 0, 0);
      this.quaternion.identity();
      this.controls.throttle = 0.5;
      this.engines.setThrottle(0.5);
      this.engines.setReverser(false, false);
      this.gear.setGearTarget(true);
      this.gear.gearState = 1;
      this.aero.setFlapPosition(0);
      this.aero.spoilers = 0;
    } else if (this.activeAirport === 'neon') {
      const isC172 = this.currentAircraftId === 'C172';
      const c172Clearance = this.gear?.cgGroundHeightM ?? 1.4;
      const clearance = isC172 ? c172Clearance : groundClearance;

      if (type === 'runway') {
        // Lined up on the glowing Neon Highway / Runway (heading 090° East towards skyline & setting retro sun)
        this.position.set(-1800, clearance, 0);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromEuler(new THREE.Euler(0, -Math.PI * 0.5, 0, 'YXZ'));

        this.controls.throttle = 0.0;
        this.engines.setThrottle(0.0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(isC172 ? 1 : 2);
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = isC172 ? 1.2 : 1.8;
        this.controls.pitchTrim = this.aero.pitchTrim;

        this.showToast(() => t('preset.neon.runway'));
      } else if (type === 'approach') {
        // Urban Canyon Slalom: 110m altitude, right between the 350m glowing skyscrapers!
        const speedMs = isC172 ? 46.0 : 70.0;
        this.position.set(200, 110, 0);
        this.linearVelocity.set(speedMs, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromEuler(new THREE.Euler(0, -Math.PI * 0.5, 0, 'YXZ'));

        this.controls.throttle = 0.62;
        this.engines.setThrottle(0.62);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = this.gear.isFixed ? 1.0 : 0.0;
        this.aero.setFlapPosition(0);
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = isC172 ? 0.8 : 1.4;
        this.controls.pitchTrim = this.aero.pitchTrim;

        this.showToast(() => t('preset.neon.canyon'));
      } else if (type === 'cruise') {
        // Skyline Cruise: 2,500 FT (760m), 110 kts, heading 110° overlooking the glowing metropolis
        const speedMs = isC172 ? 52.0 : 120.0;
        this.position.set(-600, 760, -800);
        const headingRad = THREE.MathUtils.degToRad(110);
        this.linearVelocity.set(speedMs * Math.sin(headingRad), 0, -speedMs * Math.cos(headingRad));
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromEuler(new THREE.Euler(0, -headingRad, 0, 'YXZ'));

        this.controls.throttle = 0.65;
        this.engines.setThrottle(0.65);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(false);
        this.gear.gearState = this.gear.isFixed ? 1.0 : 0.0;
        this.aero.setFlapPosition(0);
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = isC172 ? 0.9 : 1.2;
        this.controls.pitchTrim = this.aero.pitchTrim;

        this.showToast(() => t('preset.neon.cruise'));
      }
    } else if (regionCruise) {
      this.currentAirport?.resetTraffic?.();
      const spawn = regionalCruiseSpawn(regionCruise, this.currentAircraftId);
      this.position.set(spawn.x, spawn.y, spawn.z);
      this.linearVelocity.set(spawn.vx, spawn.vy, spawn.vz);
      this.angularVelocity.set(0, 0, 0);
      this.quaternion.setFromEuler(new THREE.Euler(0, spawn.yaw, 0, 'YXZ'));
      this.controls.throttle = 0.5;
      this.engines.setThrottle(this.controls.throttle);
      this.engines.setReverser(false, true);
      this.gear.setGearTarget(false);
      this.gear.gearState = this.gear.isFixed ? 1 : 0;
      this.aero.setFlapPosition(0);
      this.aero.spoilers = 0;
      this.showToast(() => t(`regional.cruise.${type}`));
    } else if (this.activeAirport === 'incheon') {
      this.currentAirport.resetTraffic();
      const spawn = incheonSpawn(type, groundClearance, this.currentAircraftId);
      this.position.set(spawn.x, spawn.y, spawn.z);
      this.linearVelocity.set(spawn.vx, spawn.vy, spawn.vz);
      this.angularVelocity.set(0, 0, 0);
      const pitchAttitude = type === 'approach' ? .04 : type === 'challenge' ? .01 : 0;
      this.quaternion.setFromEuler(new THREE.Euler(pitchAttitude, spawn.yaw, 0, 'YXZ'));
      const airborne = type !== 'runway';
      const cruise = type === 'cruise';
      this.controls.throttle = type === 'challenge' ? .35 : airborne ? .5 : 0;
      this.engines.setThrottle(this.controls.throttle);
      this.engines.setReverser(false, true);
      this.gear.setGearTarget(!cruise);
      this.gear.gearState = this.gear.isFixed || !cruise ? 1 : 0;
      this.aero.setFlapPosition(type === 'approach' ? 5 : (type === 'challenge' || type === 'runway') ? 2 : 0);
      this.aero.spoilers = 0;
      this.controls.pitchTrim = this.aero.pitchTrim = type === 'challenge' ? 1.4 : 1.6;
      if (type === 'challenge') {
        const headingDeg = APPROACH_DATA.incheon?.headingDeg ?? 144.68;
        setSimulationWind(this, new WindField({ profile: 'incheon-crosswind-v1', runwayHeadingDeg: headingDeg, seed: 15, crosswindSign: 1 }));
      }
      const label = { runway: 'incheon.runway', approach: 'incheon.approach', cruise: 'incheon.cruise', challenge: 'incheon.challenge' }[type];
      this.showToast(() => t(label));
    } else if (this.activeAirport === 'jeju') {
      const spawn = jejuSpawn(type, groundClearance, this.currentAircraftId);
      this.position.set(spawn.x, spawn.y, spawn.z);
      this.linearVelocity.set(spawn.vx, spawn.vy, spawn.vz);
      this.angularVelocity.set(0, 0, 0);
      const isChallenge = type === 'challenge';
      const pitchAttitude = type === 'approach' ? 0.04 : isChallenge ? 0.02 : 0;
      this.quaternion.setFromEuler(new THREE.Euler(pitchAttitude, spawn.yaw, 0, 'YXZ'));
      const airborne = type !== 'runway';
      if (isChallenge) {
        // Dual engine failure emergency glide towards Chuja Island / ocean
        this.engines.setEngineFailure(0, true);
        this.engines.setEngineFailure(1, true);
        this.controls.throttle = 0;
        this.engines.setThrottle(0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(false);
        this.gear.gearState = 0;
        this.aero.setFlapPosition(0);
        this.aero.spoilers = 0;
        this.controls.pitchTrim = this.aero.pitchTrim = 1.4;
      } else {
        this.engines.setEngineFailure(0, false);
        this.engines.setEngineFailure(1, false);
        this.controls.throttle = airborne ? 0.5 : 0;
        this.engines.setThrottle(this.controls.throttle);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(type !== 'cruise');
        this.gear.gearState = this.gear.isFixed || type !== 'cruise' ? 1 : 0;
        this.aero.setFlapPosition(type === 'approach' ? 5 : type === 'runway' ? 2 : 0);
        this.aero.spoilers = 0;
        this.controls.pitchTrim = this.aero.pitchTrim = 1.6;
      }
      const label = { runway: 'jeju.runway', approach: 'jeju.approach', cruise: 'jeju.cruise', challenge: 'jeju.challenge' }[type];
      if (label) this.showToast(() => t(label));
    } else if (this.activeAirport === 'lukla') {
      const sin58 = 0.848048;
      const cos58 = 0.529919;
      const isF16 = this.currentAircraftId === 'F16';
      const isC172 = this.currentAircraftId === 'C172';
      const spawnS = isF16 ? 200.0 : 195.0;
      const spawnY = 2836.0 + spawnS * (62 / 527) + groundClearance;
      const luklaTrim = isF16 ? 0.3 : isC172 ? 0.8 : 1.9;

      if (type === 'runway') {
        // Lukla takeoffs line up at the upper Runway 24 threshold and
        // accelerate downhill toward the cliff on heading 238°; Runway 06 is the
        // landing-only direction. Same spawn as the 'cliff' preset: the 5m lateral
        // offset keeps the wide wing clear of the raised apron.
        // Spawned with clearance in front of the retaining wall so chase cameras
        // remain completely clear of the upper stone barrier.
        this.position.set(spawnS * sin58 - 5 * cos58, spawnY, -spawnS * cos58 - 5 * sin58);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);

        // Pitch -6.71° nose-down along the 11.7% downhill gradient, Heading 238° (yaw -238°)
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(-6.71),
          -THREE.MathUtils.degToRad(238.0),
          0,
          'YXZ'
        );
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 0.0;
        this.engines.setThrottle(0.0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(isC172 ? 1 : 2); // Flaps 5 (or 10 for C172)
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = luklaTrim;
        this.controls.pitchTrim = luklaTrim;

        this.showToast(() => t('preset.lukla.runway.24.takeoff.roll'));
      } else if (type === 'approach') {
        // Final Approach 2.0 NM out in Dudh Kosi Canyon (Alt 3,070m / 10,070ft)
        // Distance to threshold 06 (s = -263.5m) is 3,536.5m
        // Elevation drop to threshold (2,805m): 265m -> slope = 4.28°
        // At 69.4 m/s (135 kts), required sink rate is -5.20 m/s (-1,025 FPM)
        const distSW = -3800.0;
        this.position.set(distSW * sin58, 3070.0, -distSW * cos58);
        this.linearVelocity.set(69.4 * sin58, -5.20, -69.4 * cos58);
        this.angularVelocity.set(0, 0, 0);

        // Pitch 1.0° nose-up on 4.3° descent path, Heading 058° (yaw -58°)
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(1.0),
          -THREE.MathUtils.degToRad(58.0),
          0,
          'YXZ'
        );
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 0.56;
        this.engines.setThrottle(0.56);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(5); // Flaps 30 for short runway landing
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 2.2;

        this.showToast(() => t('preset.lukla.canyon.landing.challenge.10.070'));
      } else if (type === 'cliff') {
        // Lukla Runway 24 Downhill Cliff Dive Takeoff!
        // Start near the upper threshold with wheel clearance; a 5m lateral
        // offset keeps the wide wing clear of the raised apron.
        this.position.set(spawnS * sin58 - 5 * cos58, spawnY, -spawnS * cos58 - 5 * sin58);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        // Pitch nose down -6.71° along 11.7% downhill slope, Heading 238° (yaw -238°)
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(-6.71),
          -THREE.MathUtils.degToRad(238.0),
          0,
          'YXZ'
        );
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 1.0; // TOGA 100%
        this.engines.setThrottle(1.0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(isC172 ? 1 : isF16 ? 1 : 3); // Flaps 15 for B738, Flaps 1 for F16/C172
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = luklaTrim;
        this.controls.pitchTrim = luklaTrim;

        this.showToast(() => t('preset.lukla.runway.24.downhill.takeoff.11'));
      } else if (type === 'cruise') {
        // Scenic Himalayan Valley Cruise at 13,000 FT (3,960m)
        this.position.set(-1500, 3960, -800);
        this.linearVelocity.set(80, 0, -60);
        // 100 m/s TAS is ~159 KIAS, beyond what the C172 can hold level (#599).
        if (isC172) this.linearVelocity.setLength(53);
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.3);

        this.controls.throttle = 0.65;
        this.engines.setThrottle(0.65);
        this.gear.setGearTarget(false);
        this.gear.gearState = this.gear.isFixed ? 1.0 : 0.0;
        this.aero.setFlapPosition(0);
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 0.9;

        this.showToast(() => t('preset.himalayan.cruise.13.000.ft'));
      }
    } else if (this.activeAirport === 'valley' || type === 'valley') {
      const ground = this.currentTerrain?.getHeight?.(0, 0) ?? 2100;
      const safeAltitude = Math.max(ground + 100, 2200);
      this.position.set(0, safeAltitude, 0);
      this.linearVelocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      this.quaternion.identity();
      this.controls.throttle = 0;
      this.engines.setThrottle(0);
      this.engines.setReverser(false, false);
      this.gear.setGearTarget(false);
      this.gear.gearState = 0;
      this.aero.setFlapPosition(0);
      this.aero.spoilers = 0.0;
      this.showToast(() => t('valley.slalom.title'));
    } else {
      // Coastal International Airport Presets
      if (type === 'runway') {
        // Aligned on Runway 09L Threshold (Heading 090° East)
        this.position.set(-1350, 12.0 + groundClearance, 0);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.5); // Face East (+X)

        this.controls.throttle = 0.0;
        this.engines.setThrottle(0.0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(2); // Flaps 5 for takeoff
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 1.6; // Takeoff trim

        this.showToast(() => t('preset.coastal.runway'));
      } else if (type === 'approach') {
        // Final Approach 3 NM out on 3° glideslope (5.5 km west: x = -6500m, alt = 320m / 1050ft)
        this.position.set(-6500, 310, 0);
        // Speed 145 knots (74.5 m/s) heading East (+X), descending at -3.9 m/s (-770 fpm)
        this.linearVelocity.set(74.5, -3.9, 0);
        this.angularVelocity.set(0, 0, 0);

        // Pitch slightly nose-up (2.5°) with 3° descent path
        const euler = new THREE.Euler(THREE.MathUtils.degToRad(2.5), -Math.PI * 0.5, 0, 'YXZ');
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 0.52; // Approach thrust
        this.engines.setThrottle(0.52);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(5); // Flaps 30 for landing
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 2.1;

        this.showToast(() => t('preset.coastal.approach'));
      } else if (type === 'cruise') {
        // Scenic Coastal Cruise over Bay & Ships at 2,600 ft (800m), Speed 210 knots (108 m/s);
        // C172 flies the same track at 48 m/s (~90 KIAS), below its 163 KIAS Vne (#599).
        this.position.set(-600, 750, 3200);
        this.linearVelocity.set(96, 0, -49); // Aligned with heading 153° (yaw -0.35pi)
        if (this.currentAircraftId === 'C172') this.linearVelocity.setLength(48);
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.35);

        this.controls.throttle = 0.65;
        this.engines.setThrottle(0.65);
        this.gear.setGearTarget(false);
        this.gear.gearState = this.gear.isFixed ? 1.0 : 0.0;
        this.aero.setFlapPosition(0); // Clean
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 0.9;

        this.showToast(() => t('preset.coastal.cruise'));
      }
    }

    // A fresh segment restores its configured tanks/payload and clears failures.
    // Lukla's 43 t loading contains 1587 kg of fuel, not a full 14200 kg tank set.
    this.engines.refuel(this.aero);
    this.aero.massProperties.setConfiguration(this.gear.gearState, this.aero.currentFlapAngle / (this.aero.flapAngles.at(-1) || 1));
    this.aero.syncMassProperties();
    this.actualTakeoffMassKg = null;
    this.takeoff = null;
    this.stallSpeedKnots = undefined;
    this._hasGroundContact = false;
    this.engines.failed.fill(false);
    this.engines.contactDamage.fill(0);

    if (type === 'approach' || type === 'cruise' || regionCruise || type === 'bridge') {
      // A preset declares a settled state, not a set of control inputs, so the
      // state variables have to be where the declared configuration puts them:
      // the wing at the commanded flap angle, the fans at the commanded N1, the
      // stick centered. Each ramps otherwise (τ = 2.5 s flaps, ~3 s spool,
      // rate-limited surfaces), and whatever the previous segment left behind is
      // not part of the declared state: 1.4° of carried-over elevator costs the
      // B738 approach spawn 0.11 qSc of pitch moment, which flies it off the
      // equilibrium installed below.
      this.aero.currentFlapAngle = this.aero.flapAngles[this.aero.flapsIndex];
      this.controls.elevator = this.controls.aileron = this.controls.rudder = 0;
      this.aero.massProperties.setConfiguration(this.gear.gearState, this.aero.currentFlapAngle / (this.aero.flapAngles.at(-1) || 1));
      this.aero.syncMassProperties();
      this.applyComputedTrim();
      this.engines.settleSpool();
    } else if (type === 'challenge') {
      this.aero.currentFlapAngle = this.aero.flapAngles[this.aero.flapsIndex];
      this.controls.elevator = this.controls.aileron = this.controls.rudder = 0;
      this.aero.massProperties.setConfiguration(this.gear.gearState, this.aero.currentFlapAngle / (this.aero.flapAngles.at(-1) || 1));
      this.aero.syncMassProperties();
      if (this.activeAirport === 'jeju') {
        this.engines.setEngineFailure(0, true);
        this.engines.setEngineFailure(1, true);
        this.controls.throttle = 0;
        this.engines.setThrottle(0);
      }
      this.engines.settleSpool();
    }

    this.controls.clearVirtualInputs();
    // Runway presets spawn stationary at throttle=0; engage the parking brake so
    // the aircraft holds still without the user having to hold the brake key.
    // Any other preset (approach/cruise/bridge) spawns moving, so brakes off.
    // FlightControls auto-releases the parking brake when throttle exceeds 25%.
    const isGroundSpawn = this.controls.throttle === 0.0 &&
      this.linearVelocity.lengthSq() < 0.01;
    this.controls.setParkingBrake?.(isGroundSpawn);
    if (!isGroundSpawn) {
      this.controls.brakes = 0.0;
      this.gear.setBrakes(0.0);
    }
    this.physicsAccumulator = 0;

    // Install the regional default after aircraft reload, bridge setup and trim.
    // Explicit missions own their wind; multiplayer retains its calm contract.
    if (this.activeAirport === 'neon' && !pilotPreparation && !this.multiplayer?.active) {
      const field = new UrbanWindField(NEON_WIND);
      setSimulationWind(this, field);
      if (!isGroundSpawn) {
        // The presets author still-air spawns. Keep the track and airspeed in the local
        // mean wind and point the nose along the relative wind, so the trim stays valid.
        const spawn = alignSpawnToWind(this.linearVelocity, field.meanAt(this.position));
        this.linearVelocity.x = spawn.x;
        this.linearVelocity.z = spawn.z;
        this.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.yaw));
      }
    }

    this.multiplayer?.respawn();
    this.renderPose.reset(this.position, this.quaternion);
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.aircraft.group.updateMatrixWorld(true);
    this.cameraSystem.snapToTarget(this.aircraft.group);
    if (!isDemoInternal && this.gameFlow?.state === 'flight') this.beginFlightRecording?.();
    // setPreset rebinds the pair to the spawn region; keep the composite world
    // authoritative after any preset, scenario start or reset.
    this.syncUnifiedWorld(this.activeAirport);
  }

  // One shared educational performance snapshot for CDU, PFD and loading UI.
  refreshTakeoffPerformance() {
    this.stallSpeedKnots = stallSpeedEstimate(this.aero, this.gear.gearState);
    this.takeoff = takeoffPerformance(this.aero, this.engines, {
      altitudeMeters: this.position.y, flapsIndex: this.aero.flapsIndex,
      flapAngle: this.aero.currentFlapAngle,
    });
    if (this.telemetry) this.telemetry.takeoff = this.takeoff;
    return this.takeoff;
  }

  applyLoading(loading) {
    if (this.isCrashed || !this.telemetry.onGround || this.linearVelocity.length() > 0.5) {
      throw new Error('Loading changes require a stopped aircraft on the ground.');
    }
    this._cgBefore.copy(this.aero.cg);
    this.aero.massProperties.setLoading(loading); // validates before any mutation
    this.aero.syncMassProperties();
    rebaseCgVelocity(this.linearVelocity, this.angularVelocity, this.quaternion, this._cgBefore, this.aero.cg);
    this.refreshTakeoffPerformance();
    Object.assign(this.telemetry, { massKg: this.aero.mass,
      massRevision: this.aero.massProperties.revision,
      zeroFuelMassKg: this.aero.massProperties.zeroFuelMassKg,
      fuelKg: this.engines.fuelKg, cgBody: { ...this.aero.cg } });
    this.telemetry.stallSpeedKnots = this.stallSpeedKnots;
    this.updateFlightDisplays(true);
    if (this.autopilot.master) this.autopilot.refreshTrim(this.readAutopilotState());
    return this.takeoff;
  }

  /** Install a pure map-flight spawn plan after setPreset configured the aircraft. */
  applyMapSpawn(spawn, state) {
    if (!spawn || ![spawn.x, spawn.y, spawn.z, spawn.yaw].every(Number.isFinite)) return false;
    this.position.set(spawn.x, spawn.y, spawn.z);
    this.linearVelocity.set(spawn.vx ?? 0, spawn.vy ?? 0, spawn.vz ?? 0);
    this.angularVelocity.set(0, 0, 0);
    this.quaternion.setFromEuler(new THREE.Euler(0, spawn.yaw, 0, 'YXZ'));
    this._hasGroundContact = state === 'runway';
    if (this.telemetry) this.telemetry.onGround = state === 'runway';
    this.gear.setGearTarget(state !== 'cruise');
    this.gear.gearState = state === 'cruise' && !this.gear.isFixed ? 0 : 1;
    this.aero.setFlapPosition(state === 'approach' ? 5 : state === 'runway' ? 2 : 0);
    this.aero.spoilers = 0;
    this.controls.throttle = state === 'cruise' ? 0.5 : state === 'runway' ? 0 : this.controls.throttle;
    this.engines.setThrottle(this.controls.throttle);
    this.engines.setReverser(false, true);
    if (state === 'runway') this.controls.setParkingBrake?.(true);
    else this.controls.setParkingBrake?.(false);
    if (state !== 'runway') {
      this.aero.currentFlapAngle = this.aero.flapAngles[this.aero.flapsIndex];
      this.controls.elevator = this.controls.aileron = this.controls.rudder = 0;
      this.aero.massProperties.setConfiguration(
        this.gear.gearState,
        this.aero.currentFlapAngle / (this.aero.flapAngles.at(-1) || 1),
      );
      this.aero.syncMassProperties();

    }
    this.applyComputedTrim();
    if (state !== 'runway') this.engines.settleSpool();
    this.refreshTakeoffPerformance();
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.aircraft.group.updateMatrixWorld(true);
    this.renderPose.reset(this.position, this.quaternion);
    this.cameraSystem?.snapToTarget(this.aircraft.group);
    return true;
  }

  applyComputedTrim() {
    const tas = this.linearVelocity.length();
    if (tas < 20) return;
    const altitudeMeters = Math.max(0, this.position.y);
    const atmos = Atmosphere.getConditions(altitudeMeters);
    const gammaRad = Math.asin(THREE.MathUtils.clamp(this.linearVelocity.y / tas, -1, 1));
    const solution = solveTrim(this.aero, this.engines, {
      iasKnots: Atmosphere.msToKnots(Atmosphere.tasToIas(tas, atmos.densityRatio)),
      altitudeMeters,
      flightPathAngleDeg: THREE.MathUtils.radToDeg(gammaRad),
      flapsIndex: this.aero.flapsIndex,
      gearState: this.gear.gearState,
      spoilers: this.aero.spoilers,
    });
    if (!solution.feasible || (!solution.handsOffFeasible && solution.reason !== 'idle')) return;
    this.controls.throttle = solution.throttle;
    this.engines.setThrottle(solution.throttle);
    this.controls.pitchTrim = solution.handsOffTrimDeg;
    this.aero.pitchTrim = solution.handsOffTrimDeg;
    // Pitch attitude = alpha + gamma; keep the preset's heading and roll.
    const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
    euler.x = THREE.MathUtils.degToRad(solution.alphaDeg) + gammaRad;
    this.quaternion.setFromEuler(euler);
  }

  /**
   * Mount every loaded real-world region into one persistent world. The lobby
   * airport only chooses the spawn anchor: the other regions stay in the scene
   * with their own contact surfaces, so an aircraft can depart one and land at
   * another without a scene rebuild.
   */
  syncUnifiedWorld(id) {
    const world = this.world;
    if (!world || !WORLD_REGIONS.includes(id)) return false;
    const previousAnchor = world.anchor;
    const previousTerrain = world.anchorTerrain;
    const previousOpenWorld = previousTerrain?.openWorld;
    const previousBuildings = previousTerrain?.geographicBuildingLayer;
    world.setAnchor(id);
    if (this.incheonAirport) world.register('incheon', {
      terrain: this.incheonAirport.terrain,
      airport: this.incheonAirport,
      group: this.incheonAirport.group,
      mesh: this.incheonAirport.terrain.mesh,
      extent: REGION_EXTENTS.incheon,
    });
    if (this.jejuAirport) world.register('jeju', {
      terrain: this.jejuAirport.terrain,
      airport: this.jejuAirport,
      group: this.jejuAirport.group,
      mesh: this.jejuAirport.terrain.mesh,
      extent: REGION_EXTENTS.jeju,
    });
    if (this.luklaTerrain) world.register('lukla', {
      terrain: this.luklaTerrain,
      airport: this.luklaAirport,
      group: this.luklaAirport.group,
      mesh: this.luklaTerrain.mesh,
      extent: REGION_EXTENTS.lukla,
    });
    if (this.terrain && this.airport) world.register('coastal', {
      terrain: this.terrain,
      airport: this.airport,
      group: this.airport.group,
      mesh: this.terrain.mesh,
      extent: REGION_EXTENTS.coastal,
    });
    if (this.neonCity) world.register('neon', {
      terrain: this.neonCity.terrain,
      airport: this.neonCity.airport,
      group: this.neonCity.group,
      mesh: this.neonCity.group,
      extent: REGION_EXTENTS.neon,
    });
    if (this.persistentValley) {
      const valley = this.persistentValley;
      world.register('valley', {
        terrain: valley,
        airport: null,
        group: valley.group,
        // The coarse mesh is a child of the group; moving it separately would
        // apply the world offset twice.
        extent: {
          minX: valley.centerX - valley.widthX / 2,
          maxX: valley.centerX + valley.widthX / 2,
          minZ: valley.centerZ - valley.lengthZ / 2,
          maxZ: valley.centerZ + valley.lengthZ / 2,
        },
      });
    }
    world.syncMeshes();
    // Coastal foliage and ships are separate scene groups; keep them aligned
    // with the coastal terrain group when the world anchor moves.
    const coastalOffset = world.offsets.get('coastal');
    if (coastalOffset) {
      const [coastalX, coastalZ] = coastalOffset;
      this.foliage?.group?.position.set(coastalX, 0, coastalZ);
      this.ships?.group?.position.set(coastalX, 0, coastalZ);
    }
    if (this.foliage?.group) this.foliage.group.visible = true;
    if (this.ships?.group) this.ships.group.visible = true;
    if (previousAnchor !== id) {
      previousOpenWorld?.dispose?.();
      previousBuildings?.dispose?.();
      if (previousTerrain) {
        previousTerrain.openWorld = null;
        previousTerrain.geographicBuildingLayer = null;
        previousTerrain.geographicRoadLayer = null;
        previousTerrain.geographicGreenLayer = null;
      }
      this.geographicRoadLayer?.dispose?.();
      this.geographicGreenLayer?.dispose?.();
      this.openWorldSurface = null;
      this.geographicBuildingLayer = null;
      this.geographicRoadLayer = null;
      this.geographicGreenLayer = null;
    }
    // Oceans lie between the unified regions; Neon has its own -14 m water
    // surface and Valley mission hides the shared ocean, so leave those alone.
    if (this.water && id !== 'neon' && id !== 'valley') this.water.mesh.visible = true;

    const spawnAirport = id === 'incheon' ? this.incheonAirport
      : id === 'jeju' ? this.jejuAirport
      : id === 'lukla' ? this.luklaAirport
      : id === 'neon' ? this.neonCity?.airport
      : id === 'valley' ? null
      : this.airport;
    const facade = createWorldAirportFacade(world, spawnAirport);
    this.currentTerrain = world;
    this.currentAirport = facade;
    return true;
  }

  /** Static obstacles from all mounted regions, translated into world coordinates. */
  worldObstacles() {
    const world = this.world;
    if (!world) return null;
    const [cx, cz] = world.offsets.get('coastal') ?? [0, 0];
    const [nx, nz] = world.offsets.get('neon') ?? [0, 0];
    const shifted = (data, ox, oz) => (data ?? []).map(item => ({ ...item, x: item.x + ox, z: item.z + oz }));
    return {
      treeData: shifted(this.foliage?.treeData, cx, cz),
      buildingData: [
        ...shifted(this.foliage?.buildingData, cx, cz),
        ...shifted(this.neonCity?.buildingData, nx, nz),
      ],
    };
  }

  async ensureCoastalRegion() {
    if (this.terrain && this.airport) return this.airport;
    this._coastalLoad ??= Promise.all([
      import('../environment/Terrain.js'),
      import('../environment/Airport.js'),
      import('../environment/FoliageAndCities.js'),
      import('../environment/Ships.js'),
    ]).then(([{ Terrain }, { Airport }, { FoliageAndCities }, { Ships }]) => {
      const preset = RENDER_QUALITY[this.renderQuality] ?? RENDER_QUALITY.balanced;
      this.terrain = new Terrain(22000, preset.terrainSegments ?? 256, {
        quality: preset.terrain,
        asyncTextures: true,
      });
      this.terrain.mesh.visible = false;
      this.airport = new Airport();
      this.airport.group.visible = false;
      this.terrain.excludePavement(this.airport.group);
      this.foliage = new FoliageAndCities(this.terrain);
      this.foliage.setQuality?.(this.renderQuality);
      if (this.sky) this.foliage.setTimeOfDay(this.sky.timeOfDay);
      this.foliage.group.visible = false;
      this.ships = new Ships(this.water, { deferAssets: true });
      this.ships.group.visible = false;
      this.scene?.add(this.terrain.mesh, this.airport.group, this.foliage.group, this.ships.group);
      return this.airport;
    }).catch(error => {
      this._coastalLoad = null;
      throw error;
    });
    return this._coastalLoad;
  }

  async ensureNeonRegion() {
    if (this.neonCity) return this.neonCity;
    this._neonLoad ??= import('../environment/NeonCity.js')
      .then(({ NeonCity }) => {
        this.neonCity = new NeonCity();
        this.neonCity.group.visible = false;
        this.scene?.add(this.neonCity.group);
        return this.neonCity;
      })
      .catch(error => {
        this._neonLoad = null;
        throw error;
      });
    return this._neonLoad;
  }

  async ensureValleyRegion() {
    if (this.persistentValley) return this.persistentValley;
    this._valleyLoad ??= Promise.all([
      import('../arena/generatedValley.js'),
      import('../environment/GeneratedValleyTerrain.js'),
    ]).then(([{ generateValley }, { GeneratedValleyTerrain }]) => {
      this.persistentValley = new GeneratedValleyTerrain(generateValley({ seed: 1 }).terrain, this);
      this.persistentValley.group.visible = false;
      return this.persistentValley;
    }).catch(error => {
      this._valleyLoad = null;
      throw error;
    });
    return this._valleyLoad;
  }

  async ensureLuklaRegion() {
    if (this.luklaTerrain && this.luklaAirport) return this.luklaAirport;
    this._luklaLoad ??= Promise.all([
      import('../environment/LuklaTerrain.js'),
      import('../environment/LuklaAirport.js'),
    ]).then(([{ LuklaTerrain }, { LuklaAirport }]) => {
      this.luklaTerrain = new LuklaTerrain();
      this.luklaAirport = new LuklaAirport();
      this.luklaTerrain.mesh.visible = false;
      this.luklaAirport.group.visible = false;
      this.scene?.add(this.luklaTerrain.mesh, this.luklaAirport.group);
      return this.luklaAirport;
    }).catch(error => {
      this._luklaLoad = null;
      throw error;
    });
    return this._luklaLoad;
  }

  async ensureIncheonRegion() {
    if (this.incheonAirport) return this.incheonAirport;
    this.incheonLoad ??= import('../environment/IncheonAirport.js')
      .then(({ loadIncheonAirport }) => loadIncheonAirport(`${import.meta.env.BASE_URL}scenery/incheon/`))
      .then(airport => {
        this.incheonAirport = airport;
        airport.group.visible = airport.terrain.mesh.visible = false;
        this.scene?.add(airport.group, airport.terrain.mesh);
        return airport;
      })
      .catch(error => {
        this.incheonLoad = null;
        throw error;
      });
    return this.incheonLoad;
  }

  async ensureJejuRegion() {
    if (this.jejuAirport) return this.jejuAirport;
    this.jejuLoad ??= import('../environment/JejuAirport.js')
      .then(({ loadJejuAirport }) => loadJejuAirport(`${import.meta.env.BASE_URL}scenery/jeju/`))
      .then(airport => {
        this.jejuAirport = airport;
        airport.group.visible = airport.terrain.mesh.visible = false;
        this.scene?.add(airport.group, airport.terrain.mesh);
        return airport;
      })
      .catch(error => {
        this.jejuLoad = null;
        throw error;
      });
    return this.jejuLoad;
  }

  ensureRegionLoaded(id) {
    if (id === 'coastal') return this.ensureCoastalRegion();
    if (id === 'neon') return this.ensureNeonRegion();
    if (id === 'valley') return this.ensureValleyRegion();
    if (id === 'lukla') return this.ensureLuklaRegion();
    if (id === 'incheon') return this.ensureIncheonRegion();
    if (id === 'jeju') return this.ensureJejuRegion();
    return Promise.resolve(null);
  }

  _isRegionLoadingOrLoaded(id) {
    if (id === 'coastal') return Boolean((this.terrain && this.airport) || this._coastalLoad);
    if (id === 'lukla') return Boolean((this.luklaTerrain && this.luklaAirport) || this._luklaLoad);
    if (id === 'incheon') return Boolean(this.incheonAirport || this.incheonLoad);
    if (id === 'jeju') return Boolean(this.jejuAirport || this.jejuLoad);
    if (id === 'neon') return Boolean(this.neonCity || this._neonLoad);
    if (id === 'valley') return Boolean(this.persistentValley || this._valleyLoad);
    return false;
  }

  /** Load the other unified regions on demand; the world stays flyable meanwhile. */
  ensureUnifiedRegions() {
    if (!this.world) return;
    for (const id of WORLD_REGIONS) {
      if (this._isRegionLoadingOrLoaded(id)) continue;
      this.preloadUnifiedRegion(id).catch(error => console.warn(`Unified world: ${id} preload failed:`, error));
    }
  }

  /** Stream neighboring unified regions only as the aircraft approaches their 65 km perimeter. */
  updateUnifiedRegionStreaming(nowMs = performance.now()) {
    if (!this.world || !this.position || !WORLD_REGIONS.includes(this.activeAirport)) return;
    const x = this.position.x;
    const z = this.position.z;
    const movedSq = this._lastRegionStreamX === undefined
      ? Infinity
      : (x - this._lastRegionStreamX) ** 2 + (z - this._lastRegionStreamZ) ** 2;
    if (movedSq < REGION_STREAM_MOVE_M ** 2
      && this._lastRegionStreamMs !== undefined
      && nowMs - this._lastRegionStreamMs < REGION_STREAM_INTERVAL_MS) {
      return;
    }
    this._lastRegionStreamMs = nowMs;
    this._lastRegionStreamX = x;
    this._lastRegionStreamZ = z;
    for (const id of WORLD_REGIONS) {
      if (this.world.regions.has(id) || this._isRegionLoadingOrLoaded(id)) continue;
      const distM = distanceToRegionBoundsM(x, z, this.world.offsets.get(id), REGION_EXTENTS[id]);
      if (distM <= REGION_STREAM_DISTANCE_M) {
        this.preloadUnifiedRegion(id).catch(error => console.warn(`Unified world: ${id} preload failed:`, error));
      }
    }
  }

  async preloadUnifiedRegion(id) {
    await this.ensureRegionLoaded(id);
    if (WORLD_REGIONS.includes(this.activeAirport)) {
      this.syncUnifiedWorld(this.activeAirport);
      if (this.collisionDetector) {
        this.collisionDetector.setEnvironment(
          this.currentTerrain,
          this.currentAirport,
          this.worldObstacles(),
          this.ships,
          this.activeAirport === 'coastal' ? this.water : null,
        );
      }
      if (id === 'coastal' && this.startupReady && this.ships) {
        this.ships.loadAssets();
      }
      if (id === 'incheon' || id === 'jeju' || id === 'lukla') {
        this.ensureGeographicLayers?.();
      }
    }
  }

  /**
   * Switch the active airport; selected region assets are loaded before committing the selection.
   */
  async setAirport(id, pilotPreparation = false) {
    if (this.multiplayer?.locked) return;
    if (this.pilotArena?.active && !pilotPreparation) this.pilotArena.stop('airport-changed');
    this.renderDiagnosticsPanel?.close();
    if (!['coastal', 'lukla', 'incheon', 'neon', 'valley', 'jeju'].includes(id)) return;
    if (this.activeAirport === id) {
      if (this.syncUnifiedWorld(id)) return;
      if (id === 'incheon' && this.incheonAirport) {
        this.incheonAirport.group.visible = this.incheonAirport.terrain.mesh.visible = true;
        this.currentTerrain = this.incheonAirport.terrain;
        this.currentAirport = this.incheonAirport;
      } else if (id === 'jeju' && this.jejuAirport) {
        this.jejuAirport.group.visible = this.jejuAirport.terrain.mesh.visible = true;
        this.currentTerrain = this.jejuAirport.terrain;
        this.currentAirport = this.jejuAirport;
      }
      return;
    }
    this.bridgeFlight?.stop();
    const request = this.airportRequest = (this.airportRequest || 0) + 1;
    this.airportLoading = false;
    const flyBtn = globalThis.document?.getElementById?.('btn-fly');
    if (flyBtn) flyBtn.disabled = false;
    if (id === 'incheon' && !this.incheonAirport) {
      this.airportLoading = true;
      if (flyBtn) flyBtn.disabled = true;
      this.showToast(() => t('incheon.loading'));
      try {
        await this.ensureIncheonRegion();
      } catch (error) {
        console.warn('Incheon loading failed:', error);
        if (request === this.airportRequest) {
          this.showToast(() => t('incheon.load.failed'));
          // The menu already shows this airport as chosen; put the selection back.
          this.lobby.airport = this.activeAirport || 'coastal';
          this.lobbyScreen?.refresh();
          if (!this.activeAirport) await this.setAirport('coastal');
        }
        return;
      } finally {
        if (request === this.airportRequest) {
          this.airportLoading = false;
          if (flyBtn) flyBtn.disabled = false;
        }
      }
      if (request !== this.airportRequest) return;
    } else if (id === 'jeju' && !this.jejuAirport) {
      this.airportLoading = true;
      if (flyBtn) flyBtn.disabled = true;
      this.showToast(() => t('jeju.loading'));
      try {
        await this.ensureJejuRegion();
      } catch (error) {
        console.warn('Jeju loading failed:', error);
        if (request === this.airportRequest) {
          this.showToast(() => t('jeju.load.failed'));
          this.lobby.airport = this.activeAirport || 'coastal';
          this.lobbyScreen?.refresh();
          if (!this.activeAirport) await this.setAirport('coastal');
        }
        return;
      } finally {
        if (request === this.airportRequest) {
          this.airportLoading = false;
          if (flyBtn) flyBtn.disabled = false;
        }
      }
      if (request !== this.airportRequest) return;
    } else {
      await this.ensureRegionLoaded(id);
      if (request !== this.airportRequest) return;
    }
    this.devRunner?.stop();
    if (this.activeAirport === id) return;
    this.activeAirport = id;
    const isLukla = id === 'lukla';
    const isIncheon = id === 'incheon';
    const isJeju = id === 'jeju';
    const isCoastal = id === 'coastal';
    const isNeon = id === 'neon';
    const isValley = id === 'valley';
    if (isCoastal && this.startupReady && this.ships) this.ships.loadAssets();
    if (isIncheon || isJeju || isLukla) this.ensureGeographicLayers?.();
    setMapAttributionSource('incheon-attribution', isIncheon);

    // Toggle 3D mesh visibility
    if (this.terrain?.mesh) this.terrain.mesh.visible = isCoastal;
    if (this.airport?.group) this.airport.group.visible = isCoastal;
    if (this.water?.mesh) this.water.mesh.visible = !isLukla && !isNeon && !isValley;
    if (this.ships?.group) this.ships.group.visible = isCoastal;
    if (this.foliage?.group) this.foliage.group.visible = isCoastal;

    if (this.luklaTerrain?.mesh) this.luklaTerrain.mesh.visible = isLukla;
    if (this.luklaAirport?.group) this.luklaAirport.group.visible = isLukla;

    if (this.incheonAirport) this.incheonAirport.group.visible = this.incheonAirport.terrain.mesh.visible = isIncheon;
    if (this.jejuAirport) this.jejuAirport.group.visible = this.jejuAirport.terrain.mesh.visible = isJeju;
    if (this.neonCity?.group) this.neonCity.group.visible = isNeon;
    if (this.persistentValley?.group) this.persistentValley.group.visible = isValley;
    this.currentTerrain = isJeju ? this.jejuAirport.terrain
      : isNeon ? this.neonCity.terrain
      : isIncheon ? this.incheonAirport.terrain
      : isLukla ? this.luklaTerrain
      : isValley ? this.persistentValley
      : this.terrain;
    this.currentAirport = isJeju ? this.jejuAirport
      : isNeon ? this.neonCity.airport
      : isIncheon ? this.incheonAirport
      : isLukla ? this.luklaAirport
      : isValley ? null
      : this.airport;
    this.syncUnifiedWorld(id);

    if (this.collisionDetector) {
      const obstacles = this.worldObstacles();
      this.collisionDetector.setEnvironment(this.currentTerrain, this.currentAirport, obstacles, this.ships, isCoastal ? this.water : null);
    }

    if (this.explosionSystem) {
      this.explosionSystem.terrain = this.currentTerrain;
    }

    if (this.tireSmokeSystem) {
      this.tireSmokeSystem.terrain = this.currentTerrain;
    }

    // Relocate tower camera position and update active terrain for the active airport environment
    if (this.cameraSystem) {
      this.cameraSystem.setTerrain(this.currentTerrain);
      if (isNeon) {
        const t = this.neonCity.airport.controlTowerData;
        this.cameraSystem.towerPos.set(t.x, t.y + t.height - 1.5, t.z);
      } else if (isIncheon) {
        const cab = this.incheonAirport.towerCab;
        this.cameraSystem.towerPos.set(cab.x, cab.y, cab.z);
      } else if (isJeju && this.jejuAirport) {
        const cab = this.jejuAirport.towerCab.position;
        this.cameraSystem.towerPos.set(cab.x, cab.y, cab.z);
      } else if (isLukla) {
        const t = this.luklaAirport.controlTowerData;
        this.cameraSystem.towerPos.set(t.x, t.y + t.height - 1.5, t.z);
      } else {
        this.cameraSystem.towerPos.set(120, 78, 280);
      }
    }

    // Sync cloud layer altitude with active airport elevation
    if (this.sky && typeof this.sky.setAirport === 'function') {
      this.sky.setAirport(id);
    }

    // Reconfigure cockpit navigation displays for active airport
    if (this.ndCanvas && typeof this.ndCanvas.setAirport === 'function') {
      this.ndCanvas.setAirport(id);
    }
    if (this.cduCanvas && typeof this.cduCanvas.setAirport === 'function') {
      this.cduCanvas.setAirport(id);
    }

    this.lobby.airport = id;
    if (!isScenarioAvailable(id, this.lobby.preset)) this.lobby.preset = defaultScenarioForRegion(id);
    saveSavedAirport(id);
    saveSavedScenario(this.lobby.preset);
    // A new airport re-spawns the aircraft below, so any flight held behind the
    // menu is no longer the one to return to: release it and let the cinematic back.
    // A pending start is the exception — it parks the scene and spawns once, itself.
    if (!this.applyingPendingStart) {
      this.gameFlow.abandonResumableFlight();
    }
    this.gameFlow.setCinematicAvailable(isScenarioAvailable(id, 'demo'));
    this.lobbyScreen?.refresh();

    if (this.demoDirector && this.demoDirector.isActive) {
      this.demoDirector.stop();
    }

    if (!this.applyingPendingStart) this.setPreset(defaultScenarioForRegion(id), false, pilotPreparation);
    this.lobbyScreen?.refresh();

    const airportKey = isIncheon ? 'incheon.airport' : isLukla
      ? 'tenzing.hillary.airport.nepal.vnlk.runway.24'
      : isValley ? 'valley.region' : isNeon ? 'neon.metropolis'
      : 'pacific.coastal.international.airport.runway.09l.elevation';
    this.showToast(() => t('airport.changed.value', { value: t(airportKey) }));
    this.renderDiagnostics?.refreshScene();
  }

  /**
   * Live autopilot snapshot reusing instance scratch objects (no allocation
   * per 120 Hz substep). Conventions match this.telemetry.
   */
  readAutopilotState() {
    const euler = this._apEuler.setFromQuaternion(this.quaternion, 'YXZ');
    const f = this._apForward.set(0, 0, -1).applyQuaternion(this.quaternion);
    const s = this._apState;
    s.airportKey = this.activeAirport;
    s.pitchDeg = THREE.MathUtils.radToDeg(euler.x);
    s.rollDeg = THREE.MathUtils.radToDeg(-euler.z);
    s.headingDeg = (THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)) + 360) % 360;
    s.altitudeFt = Atmosphere.metersToFeet(this.position.y);
    s.vsiFpm = Atmosphere.metersToFeet(this.linearVelocity.y) * 60.0;
    s.iasKnots = this.telemetry.iasKnots;
    s.tasKnots = this.telemetry.tasKnots;
    s.throttle = this.controls.throttle;
    s.x = this.position.x;
    s.z = this.position.z;
    return s;
  }

}

export function installPresetSpawner(TargetClass) {
  for (const key of Object.getOwnPropertyNames(PresetSpawnerMethods.prototype)) {
    if (key !== "constructor") {
      Object.defineProperty(
        TargetClass.prototype,
        key,
        Object.getOwnPropertyDescriptor(PresetSpawnerMethods.prototype, key),
      );
    }
  }
}
