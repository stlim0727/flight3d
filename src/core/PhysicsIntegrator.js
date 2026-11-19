import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { terrainConflictSeconds } from '../systems/FlightWarnings.js';
import { cockpitCasterState } from '../aircraft/CockpitLighting.js';
import { GForceFilter } from '../physics/loadFactor.js';
import { BODY_SUPPORT_POINTS, FALLBACK_BODY_SUPPORT_POINTS } from '../physics/groundContacts.js';
import { FlightPhysicsCore } from '../physics/FlightPhysicsCore.js';
import { stepPhysics } from './physicsTiming.js';
import { CameraSystem } from '../cameras/CameraSystem.js';
import { FLOW } from '../ui/GameFlowController.js';
import { trackFlightCrash } from '../analytics/posthog.js';
import { PilotPhysiology } from '../physics/PilotPhysiology.js';
import { WaterDitching } from '../physics/WaterDitching.js';

const GEAR_LABELS = {
  nose: 'nose.gear',
  mainLeft: 'left.main.gear',
  mainRight: 'right.main.gear',
};

class PhysicsIntegratorMethods {
  /**
   * Whoever claims this frame owns the aircraft pose, so the loop asks one question instead of
   * testing each feature flag. Registry order decides priority.
   */
  activePoseDriver() {
    return this.poseDrivers?.find(driver => driver?.active) ?? null;
  }

  ensurePhysicsCore() {
    this.waterDitching ??= new WaterDitching();
    this.pilotPhysiology ??= new PilotPhysiology();
    this.gForceFilter ??= new GForceFilter(8.0);
    this.bodyContactNotices ??= new Set();

    if (!this._physicsCore) {
      this._physicsCore = new FlightPhysicsCore({
        config: this.currentAircraftConfig,
        position: this.position,
        quaternion: this.quaternion,
        linearVelocity: this.linearVelocity,
        angularVelocity: this.angularVelocity,
        aero: this.aero,
        engines: this.engines,
        gear: this.gear,
        waterDitching: this.waterDitching,
        pilotPhysiology: this.pilotPhysiology,
        gForceFilter: this.gForceFilter,
        bodyContactNotices: this.bodyContactNotices,
        telemetry: this.telemetry,
        aeroResult: this._aeroResult,
      });
    } else {
      const core = this._physicsCore;
      core.config = this.currentAircraftConfig;
      core.position = this.position;
      core.quaternion = this.quaternion;
      core.linearVelocity = this.linearVelocity;
      core.angularVelocity = this.angularVelocity;
      core.aero = this.aero;
      core.engines = this.engines;
      core.gear = this.gear;
      core.waterDitching = this.waterDitching;
      core.pilotPhysiology = this.pilotPhysiology;
      core.gForceFilter = this.gForceFilter;
      core.bodyContactNotices = this.bodyContactNotices;
      core.telemetry = this.telemetry;
    }

    const core = this._physicsCore;
    core.isCrashed = Boolean(this.isCrashed);
    core.windTimeSeconds = this.windTimeSeconds ?? 0;
    core.airborneTime = this.airborneTime ?? 0;
    core.hasTouchedDownThisFlight = Boolean(this.hasTouchedDownThisFlight);
    core.lastOnGround = this.lastOnGround ?? true;
    core.lastGearTarget = this.lastGearTarget ?? (this.gear?.targetGearState > 0.5);
    core.actualTakeoffMassKg = this.actualTakeoffMassKg ?? null;
    core.stallSpeedKnots = this.stallSpeedKnots;
    core.takeoff = this.takeoff ?? null;
    core._hasGroundContact = Boolean(this._hasGroundContact);
    core._performanceClock = this._performanceClock ?? 0;
    core.landingIncident = Boolean(this.landingIncident);
    core.landingRestTime = this.landingRestTime ?? 0;
    core.landingStopped = Boolean(this.landingStopped);
    core.waterDitchingNoticed = Boolean(this.waterDitchingNoticed);
    core.waterSinkingNoticed = Boolean(this.waterSinkingNoticed);
    core.waterSubmergedNoticed = Boolean(this.waterSubmergedNoticed);
    core.excursionAnnounced = Boolean(this.excursionAnnounced);
    core.bodyContactStarted = Boolean(this.bodyContactStarted);
    return core;
  }

  syncFromPhysicsCore(core) {
    this.windTimeSeconds = core.windTimeSeconds;
    this.airborneTime = core.airborneTime;
    this.hasTouchedDownThisFlight = core.hasTouchedDownThisFlight;
    this.lastOnGround = core.lastOnGround;
    this.lastGearTarget = core.lastGearTarget;
    this.actualTakeoffMassKg = core.actualTakeoffMassKg;
    this.stallSpeedKnots = core.stallSpeedKnots;
    this.takeoff = core.takeoff;
    this._hasGroundContact = core._hasGroundContact;
    this._performanceClock = core._performanceClock;
    this.landingIncident = core.landingIncident;
    this.landingRestTime = core.landingRestTime;
    this.landingStopped = core.landingStopped;
    this.waterDitchingNoticed = core.waterDitchingNoticed;
    this.waterSinkingNoticed = core.waterSinkingNoticed;
    this.waterSubmergedNoticed = core.waterSubmergedNoticed;
    this.excursionAnnounced = core.excursionAnnounced;
    this.bodyContactStarted = core.bodyContactStarted;
  }

  /**
   * Physics Integration Substep (120 Hz)
   */
  integratePhysics(dt) {
    if (this.activePoseDriver()) return;
    // Gear/contact queries consume this mesh too. Restore the authoritative
    // transform before physics so a rendered interpolation never feeds back.
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.gear.bodySupportPoints = this.currentAircraftConfig?.landingGear?.bodySupportPoints
      ?? (this.aircraft.useGltf ? BODY_SUPPORT_POINTS : FALLBACK_BODY_SUPPORT_POINTS);

    const core = this.ensurePhysicsCore();
    const environment = this._envCallbacks ??= {
      getGroundHeight: (x, z) => this.currentTerrain?.getHeight?.(x, z) ?? 0,
      getGroundNormal: (x, z) => this.currentTerrain?.getNormal?.(x, z) ?? null,
      isOnRunway: (x, z) => (this.currentAirport?.isOnRunway ? this.currentAirport.isOnRunway(x, z) : true),
      isRunwaySafetyArea: (x, z) => (this.currentAirport?.isRunwaySafetyArea ? this.currentAirport.isRunwaySafetyArea(x, z) : true),
      getWaterLevel: (x, z) => this.currentTerrain?.getWaterLevel?.(x, z) ?? 0.0,
      getWindWorld: null,
    };
    environment.getWindWorld = this.windField
      ? (pos, time, out) => this.windField.sample(pos, time, out)
      : null;

    if (this.isCrashed) {
      core.integrateSubstep(dt, {}, environment);
      this.syncFromPhysicsCore(core);
      this.aircraft.group.position.copy(this.position);
      return;
    }

    // 1. Controls & Autopilot
    this.controls.update(dt, this.telemetry.iasKnots, this.currentAircraftId);
    const isAutonomousDemo = Boolean(this.demoDirector?.isActive);

    if (this.bridgeFlight?.active && this.autopilot.master) {
      this.autopilot.disengage();
      this.showToast(() => t('bridge.manual'));
    }

    let autopilotElevator;
    let autopilotAileron;
    if (this.autopilot.master) {
      const apCmd = this.autopilot.update(this.readAutopilotState(), dt);
      if (Math.abs(this.controls.elevator) < 0.075 && Math.abs(this.controls.aileron) < 0.075) {
        autopilotElevator = apCmd.elevator;
        autopilotAileron = apCmd.aileron;
        if (this.autopilot.speedMode) this.controls.throttle = apCmd.throttle;
      }
    }

    const towing = isAutonomousDemo
      ? this.demoDirector.getActiveScenario()?.towingForces?.()
      : null;

    const inputs = {
      elevator: this.controls.elevator,
      aileron: this.controls.aileron,
      rudder: this.controls.rudder,
      throttle: this.controls.throttle,
      brakes: this.controls.brakes,
      pitchTrim: this.controls.pitchTrim,
      bypassPilotPhysiology: isAutonomousDemo,
      autopilotElevator,
      autopilotAileron,
      externalForceWorld: towing?.force,
      externalMomentBody: towing?.moment,
    };

    const previousTelemetry = this.telemetry;
    const result = core.integrateSubstep(dt, inputs, environment);
    this.syncFromPhysicsCore(core);

    // Preserve this substep's contact kinematics for local mission judging.
    this.missionPhysicsFrame = { gearResult: result.gearResult };

    if (result.parkingBrakeEngaged) {
      this.controls.setParkingBrake?.(true);
    }

    // Sync Three.js aircraft mesh transform
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);

    // Enrich telemetry with simulator/app-level fields
    this.telemetry = result.telemetry;
    this.telemetry.apEngaged = this.autopilot.master;
    this.telemetry.airportKey = this.activeAirport;
    this.telemetry.apModes = this.autopilot.annunciation();
    this.telemetry.apArmed = this.autopilot.appArmed;
    this.telemetry.selectedHeading = this.autopilot.master ? Math.round(this.autopilot.targets.headingDeg) : previousTelemetry?.selectedHeading;
    this.telemetry.selectedAltitude = this.autopilot.master ? Math.round(this.autopilot.targets.altitudeFt) : previousTelemetry?.selectedAltitude;
    this.telemetry.selectedSpeed = this.autopilot.master && this.autopilot.speedMode ? Math.round(this.autopilot.targets.iasKnots) : previousTelemetry?.selectedSpeed;
    this.telemetry.demoActive = isAutonomousDemo;
    this.telemetry.parkBrake = Boolean(this.controls.parkingBrake || result.telemetry.parkBrake);
    this.telemetry.warnings = this.isCrashed ? [] : this.flightWarnings.update(dt, this.telemetry,
      terrainConflictSeconds(this.position, this.linearVelocity, this.currentTerrain,
        this.telemetry.gearState > 0.95 && this.telemetry.flapDegree >= (this.currentAircraftConfig.id === 'B738' ? 15 : 0)));

    // Presentation: water spray/ripples, slide dust, audio, toasts, and camera cuts
    const { gearResult, waterResult, groundSpeed } = result;
    if (waterResult.onWater && waterResult.ditchingContact && this.tireSmokeSystem) {
      if (waterResult.sprayIntensity > 0.04 && groundSpeed > 3.0) {
        this.waterSprayClock = (this.waterSprayClock || 0) + dt;
        if (this.waterSprayClock >= 0.08) {
          this.waterSprayClock = 0;
          const pointsToEmit = waterResult.contactPoints.length > 0 ? waterResult.contactPoints.slice(0, 4) : [this.position];
          for (const pt of pointsToEmit) {
            this.tireSmokeSystem.emitWaterSprayBurst(pt, this.linearVelocity, groundSpeed, 3);
          }
        }
      } else if (waterResult.ditchingPhase === 'sinking' && !waterResult.submerged) {
        this.waterRippleClock = (this.waterRippleClock || 0) + dt;
        if (this.waterRippleClock >= 0.35) {
          this.waterRippleClock = 0;
          this.tireSmokeSystem.emitWaterRipples(this.position, 2);
        }
      }
    }

    const groundRoughness = gearResult.groundRoughness || 0;
    if (groundRoughness > 0.3 && groundSpeed > 5 && gearResult.bodyContacts.length > 0 && this.tireSmokeSystem) {
      this.slideEmitClock = (this.slideEmitClock || 0) + dt;
      if (this.slideEmitClock >= 0.1) {
        this.slideEmitClock = 0;
        for (const contact of gearResult.bodyContacts.slice(0, 3)) {
          this.tireSmokeSystem.emitSmokeBurst(contact.worldPos, this.linearVelocity, groundSpeed, 2);
        }
      }
    } else {
      this.slideEmitClock = 0;
    }

    const allowAutoCut = !this.cameraSystem.autoPaused
      && (!this.cameraSystem.userModeSelected || this.cameraSystem.autoSwitch)
      && !this.cameraSystem.userLookOverridden
      && !(this.demoDirector && this.demoDirector.isActive && this.demoDirector.userCameraOverridden);

    for (const event of result.events) {
      switch (event.type) {
        case 'waterDitching':
          if (this.demoDirector?.isActive) this.demoDirector.stop();
          this.autopilot.disengage();
          this.engines.setThrottle(0.0);
          this.controls.throttle = 0.0;
          this.audio?.playWaterSplash?.();
          this.showToast(() => t('notice.waterDitching'));
          break;
        case 'waterSinking':
          this.showToast(() => t('notice.waterSinking'));
          break;
        case 'waterSubmerged':
          this.showToast(() => t('notice.waterSunken'));
          break;
        case 'gearDamage':
          if (this.demoDirector?.isActive) this.demoDirector.stop();
          this.showToast(() => t('notice.gearDamage', {
            value1: t(GEAR_LABELS[event.id]),
            value2: event.state === 'collapsed' ? t('gear.collapsed') : t('gear.damaged'),
          }));
          break;
        case 'bodyContact':
          if (this.demoDirector?.isActive) this.demoDirector.stop();
          this.showToast(() => t('notice.bodyContact', {
            parts: event.contacts.map(c => t(`body.part.${c.id}`)).join(', '),
          }));
          break;
        case 'bodyDamage':
          this.showToast(() => t('notice.bodyDamage', {
            part: t(`body.part.${event.id}`),
            state: t(`body.state.${event.state}`),
          }));
          break;
        case 'excursion':
          this.showToast(() => t('notice.excursion'));
          break;
        case 'landingStopped':
          this.showToast(() => t('emergency.landing.stopped.select.a.preset.to'));
          break;
        case 'touchdown':
          this.tireSmokeSystem.spawnTouchdownSmoke(event.contacts, this.linearVelocity);
          if (allowAutoCut && !this.landingIncident && this.totalSimTime > 2.0) {
            this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 5.0);
            this.showToast(() => t('landing.gear.view.touchdown.suspension.compression'));
          }
          break;
        case 'liftoff':
          if (allowAutoCut && !this.landingIncident) {
            this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
            this.showToast(() => t('landing.gear.view.takeoff.climb'));
          }
          break;
        case 'gearTransit':
          if (allowAutoCut && this.totalSimTime > 1.0) {
            this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
            this.showToast(() => t(event.extending ? 'landing.gear.view.extending' : 'landing.gear.view.retracting'));
          }
          break;
      }
    }

    // 13. Check Multi-Obstacle Collisions (Terrain, Water, Tower, Buildings, Trees, Ships)
    this.bridgeFlight?.update(dt);
    if (!this.isCrashed) {
      const crash = this.collisionDetector.checkCollision(
        result.collisionPosition,
        this.quaternion,
        result.collisionVelocity,
        gearResult.gearState,
        result.pitchDeg,
        result.rollDeg,
        gearResult
      );

      if (crash) {
        this.triggerCrash(crash, result.collisionVelocity);
      }
    }
  }

  resolveBodyPenetration() {
    const core = this.ensurePhysicsCore();
    core.resolveBodyPenetration(
      (x, z) => this.currentTerrain.getHeight(x, z),
      (x, z) => this.currentTerrain.getNormal?.(x, z)
    );
  }

  triggerCrash(crashResult, impactVelocity = this.linearVelocity) {
    if (this.isCrashed) return;
    this.isCrashed = true;
    this.flightWarnings.reset();
    this.telemetry.warnings = [];
    this.crashResult = crashResult;
    trackFlightCrash({
      airport: this.activeAirport,
      aircraft: this.currentAircraftId,
      scenario: this.lastPresetType,
      crashResult,
      speedKnots: this.telemetry?.iasKnots,
    });

    // 1. Spawn Visual Explosion Particles, Fireball, Smoke & Dynamic Light Flash
    this.explosionSystem.spawnExplosion(crashResult, impactVelocity);

    // 2. Procedural Audio Detonation & Metal Crunch Sound
    // The flag selects the water timbre; both branches start the detonation.
    this.audio.playExplosion(crashResult.type === 'WATER');

    // 3. Aircraft Structural Damage Visuals
    this.aircraft.triggerCrashVisuals(crashResult.type);
    this.aircraftBreakup.spawn(this.aircraft, impactVelocity);
    this.cameraSystem.beginCrashView(this.aircraftBreakup);

    // 4. Catastrophic Camera Trauma Shake
    this.cameraSystem.addTrauma(1.0);

    // Record the outcome before stop() makes scenario.update unreachable.
    this.demoDirector?.stopForCrash(crashResult);

    // 6. Kill Engines and Damp Kinetic Energy
    this.autopilot.disengage();
    this.engines.setThrottle(0.0);
    this.controls.throttle = 0.0;
    this.linearVelocity.multiplyScalar(0.25);
    if (this.linearVelocity.y < 0) this.linearVelocity.y = 0;
    // The recorded sortie's debrief reports the collision after the crash scene (#454).
  }

  clearCrashState() {
    this.crashDebriefRemaining = null;
    this.isCrashed = false;
    this.crashResult = null;
    this.explosionSystem?.clear?.({ preservePersistent: true });
    this.aircraftBreakup?.aircraft?.resetCrashVisuals?.();
    this.aircraftBreakup?.clear?.({ persist: true, duration: 30 });
    this.cameraSystem?.endCrashView?.();
    if (this.aircraft?.group) this.aircraft.group.visible = true;
    this.aircraft?.resetCrashVisuals?.();
    this.audio?.reset?.();
    this.waterDitching?.reset?.();
    this.waterDitchingNoticed = false;
    this.waterSinkingNoticed = false;
    this.waterSubmergedNoticed = false;
    this.pilotPhysiology?.reset?.();
    this.pilotPhysiologyFx?.reset?.();
    this.gForceFilter?.reset();
    if (this.telemetry) {
      this.telemetry.pilot = this.pilotPhysiology ? this.pilotPhysiology.getSnapshot() : {
        gZ: 1.0, consciousness: 1.0, responsiveness: 1.0, isGLOC: false,
        blackout: 0, redout: 0, tunnelVision: 0, grayout: 0, blur: 0, glocIncidents: 0, gFatigueSeconds: 0
      };
    }
  }

  resetCrash() {
    if (this.devRunner.active) { this.devRunner.restart(); return; }
    if (this.bridgeFlight?.active) { this.setPreset('bridge'); return; }
    this.clearCrashState();
    this.setPreset('runway');
    this.showToast(() => t(this.activeAirport === 'jeju'
      ? 'jeju.repaired' : this.activeAirport === 'incheon'
      ? 'incheon.repaired' : 'aircraft.repaired.restarted.on.runway.09l'));
  }

  exitCrashToLobby() {
    if (this.devRunner.active) {
      this.devRunner.stop();
      this.gameFlow.returnToLobby(true);
      return;
    }
    if (!this.isCrashed) return;
    this.gameFlow.returnToLobby(true);
  }

  /**
   * Deterministic Simulation Step (for automated test harness & replay)
   * Runs the exact 120Hz physics substepping for the requested duration in simulation time.
   * @param {number} simSeconds 
   * @returns {object} updated telemetry state
   */
  stepSimulation(simSeconds) {
    if (this.multiplayer?.modalOpen || this.multiplayer?.room?.session.state === 'starting') return this.telemetry;
    if (this.gameFlow.state === FLOW.DEBRIEF) return this.telemetry;
    if (this.devRunner.active && this.gameFlow.isPhysicsFrozen()) return this.telemetry;
    this.devRunner.updatePreparation(0);
    this.activePoseDriver()?.update(simSeconds);
    const numSubsteps = Math.max(1, Math.round(simSeconds * this.physicsHz));
    for (let i = 0; i < numSubsteps; i++) {
      if (this.devRunner.blocksPhysics || this.gameFlow.state === FLOW.DEBRIEF) break;
      stepPhysics(this);
      this.totalSimTime += this.physicsDt;
    }
    // Deterministic stepping displays the current state without interpolation.
    // Discard render history before the real-time loop resumes.
    this.physicsAccumulator = 0;
    this.renderPose.reset(this.position, this.quaternion);
    this.updateFlightDisplays(true);
    const isCockpit = this.cameraSystem.mode === CameraSystem.MODES.COCKPIT;
    const isLookingAway = isCockpit && this.cameraSystem.isLookingAwayFromCenter();
    const isPhotoCockpit = isCockpit && this.cameraSystem.photoCockpit && this.cameraSystem.supportsPhotoCockpit && !isLookingAway;
    this.aircraft.setCockpitMode(isCockpit, !isPhotoCockpit, this.renderQuality);
    if (this.cockpitPhotoOverlay) {
      this.cockpitPhotoOverlay.enabled = isPhotoCockpit && this.cameraSystem.supportsPhotoCockpit;
      if (this.cockpitPhotoOverlay.enabled) {
        this.cockpitPhotoOverlay.update(this.telemetry);
      }
    }
    this.aircraft.update(this.physicsDt, this.telemetry);
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.aircraft.group.updateMatrixWorld(true);
    this.cameraSystem.update(this.physicsDt, this.aircraft.group, this.telemetry, (x, z) => this.currentTerrain.getHeight(x, z));
    this.foliage.updateCityLod(this.camera.position);
    this.foliage.update(this.camera.position);
    this.sky.updateSun(this.position, this.camera.position);
    this.currentAirport?.nightLighting?.update(this.sky.sunPosition.y);
    this.sky.updateCockpitSun({
      position: this.aircraft.group.position,
      quaternion: this.aircraft.group.quaternion,
      cockpitActive: isCockpit && !isPhotoCockpit,
      dt: simSeconds,
      casterState: cockpitCasterState(this.aircraft.cockpit),
    });
    this.aircraft.cockpit.syncLighting(this.sky, this.quaternion, simSeconds);
    this.water.update(simSeconds, this.camera ? this.camera.position : this.position);
    this.explosionSystem.update(simSeconds);
    if (this.isCrashed) this.cameraSystem.updateCrashView(simSeconds);
    this.tireSmokeSystem.update(simSeconds);
    this.touchControls.updateUI();
    this.diagnostics.update(simSeconds, this.telemetry);
    this.updateHUD();
    return this.telemetry;
  }

  updateFlightDisplays(force = false) {
    const frame = this.displayFrame ?? 0;
    this.displayFrame = frame + 1;
    this.pfdCanvas.updateData(this.telemetry);
    this.pfdCanvas.render();
    this.isfdCanvas.updateData(this.telemetry);
    // Initialize both screens; then spread their uploads over alternate frames.
    for (const display of (force || frame === 0 ? [this.ndCanvas, this.eicasCanvas]
      : [frame % 2 === 0 ? this.ndCanvas : this.eicasCanvas])) {
      display.updateData(this.telemetry);
      display.render();
    }
    this.mcpCanvas.updateData(this.telemetry);
    this.cduCanvas.updateData(this.telemetry);
    if (this.aircraft?.hudCanvas) {
      this.aircraft.hudCanvas.updateData(this.telemetry);
      this.aircraft.hudCanvas.render();
    }
  }

}

export function installPhysicsIntegrator(TargetClass) {
  for (const key of Object.getOwnPropertyNames(PhysicsIntegratorMethods.prototype)) {
    if (key !== "constructor") {
      Object.defineProperty(
        TargetClass.prototype,
        key,
        Object.getOwnPropertyDescriptor(PhysicsIntegratorMethods.prototype, key),
      );
    }
  }
}
