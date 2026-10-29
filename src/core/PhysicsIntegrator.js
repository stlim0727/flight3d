import * as THREE from 'three';
import { t, bindText } from '../i18n/index.js';
import { terrainConflictSeconds } from '../systems/FlightWarnings.js';
import { cockpitCasterState } from '../aircraft/CockpitLighting.js';
import { Atmosphere } from '../physics/Atmosphere.js';
import { asymmetricThrustYawMoment } from '../physics/EngineModel.js';
import { BODY_SUPPORT_POINTS, FALLBACK_BODY_SUPPORT_POINTS } from '../physics/groundContacts.js';
import { constrainBodyContact } from '../physics/bodyContactConstraint.js';
import { translateModelOrigin } from '../physics/massKinematics.js';
import { stepPhysics } from './physicsTiming.js';
import { CameraSystem } from '../cameras/CameraSystem.js';
import { FLOW } from '../ui/GameFlowController.js';

class PhysicsIntegratorMethods {
  /**
   * Physics Integration Substep (120 Hz)
   */
  integratePhysics(dt) {
    if (this.shadowDemo?.active) return;
    // Gear/contact queries consume this mesh too. Restore the authoritative
    // transform before physics so a rendered interpolation never feeds back.
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.gear.bodySupportPoints = this.currentAircraftConfig?.landingGear?.bodySupportPoints
      ?? (this.aircraft.useGltf ? BODY_SUPPORT_POINTS : FALLBACK_BODY_SUPPORT_POINTS);
    // If crashed, damp out velocities and rest on terrain
    if (this.isCrashed) {
      this.linearVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 2.8));
      this.angularVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 3.5));
      this.position.addScaledVector(this.linearVelocity, dt);
      this.resolveBodyPenetration();
      this.aircraft.group.position.copy(this.position);
      return;
    }

    // 1. Controls processing
    this.controls.update(dt, this.telemetry.iasKnots);
    this.aero.elevator = this.controls.elevator;
    this.aero.aileron = this.controls.aileron;
    this.aero.rudder = this.controls.rudder;
    this.aero.pitchTrim = this.controls.pitchTrim;

    // Autopilot control laws. Pilot yoke input above the gate overrides the
    // axes; the AP commands surfaces directly, bypassing yoke rate limiters.
    if (this.hangang?.active && this.autopilot.master) {
      this.autopilot.disengage();
      this.showToast(() => t('hangang.manual'));
    }
    if (this.autopilot.master) {
      const apCmd = this.autopilot.update(this.readAutopilotState(), dt);
      if (Math.abs(this.controls.elevator) < 0.075 && Math.abs(this.controls.aileron) < 0.075) {
        this.aero.elevator = apCmd.elevator;
        this.aero.aileron = apCmd.aileron;
        if (this.autopilot.speedMode) this.controls.throttle = apCmd.throttle;
      }
    }

    // Ground steering & brakes
    const groundSpeed = Math.sqrt(this.linearVelocity.x * this.linearVelocity.x + this.linearVelocity.z * this.linearVelocity.z);
    this.gear.setSteering(this.controls.rudder, groundSpeed);
    this.gear.setBrakes(this.controls.brakes);

    // 2. Turbofan Engines Update
    this.engines.setThrottle(this.controls.throttle);
    const altitudeMeters = this.position.y;
    const atmos = Atmosphere.getConditions(altitudeMeters);
    const tas = this.linearVelocity.length();
    // Damage remains until repair, even if an engine restart is commanded.
    if (this.gear.bodyDamage?.engineL !== undefined) {
      this.engines.contactDamage[0] = this.gear.bodyDamage.engineL;
    }
    if (this.engines.numEngines > 1 && this.gear.bodyDamage?.engineR !== undefined) {
      this.engines.contactDamage[1] = this.gear.bodyDamage.engineR;
    }
    this._cgBefore.copy(this.aero.cg);
    this.engines.bindMassProperties(this.aero.massProperties);
    this.gear.advanceConfiguration(dt);
    this.aero.advanceFlaps(dt);
    const engineData = this.engines.update(dt, altitudeMeters, tas, atmos.densityRatio);

    this.aero.massProperties.setConfiguration(this.gear.gearState, this.aero.currentFlapAngle / (this.aero.flapAngles.at(-1) || 1));
    this.aero.syncMassProperties();
    rebaseCgVelocity(this.linearVelocity, this.angularVelocity, this.quaternion, this._cgBefore, this.aero.cg);

    // 3. Terrain Height & Ground Clearance
    const groundHeight = this.currentTerrain.getHeight(this.position.x, this.position.z);
    const heightAboveGround = Math.max(0, this.position.y - groundHeight);

    // Physics may run several substeps before rendering. Refresh the root world
    // matrix so gear contacts use this substep's pose rather than the last frame.
    this.aircraft.group.updateWorldMatrix(true, false);

    // 4. Landing Gear Forces & Ground Friction
    const gearResult = this.gear.update(
      dt,
      this.aircraft.group,
      this.linearVelocity,
      this.angularVelocity,
      (x, z) => this.currentTerrain.getHeight(x, z),
      (x, z) => (this.currentTerrain.getNormal ? this.currentTerrain.getNormal(x, z) : null),
      (x, z) => (this.currentAirport?.isOnRunway ? this.currentAirport.isOnRunway(x, z) : true),
      this.aero.cg, true
    );

    if (gearResult.damageEvents.length || (gearResult.bodyContacts.length && !this.bodyContactStarted)) {
      this.landingIncident = true;
      if (this.demoDirector?.isActive) this.demoDirector.stop();
      const labels = { nose: 'nose.gear', mainLeft: 'left.main.gear', mainRight: 'right.main.gear' };
      for (const event of gearResult.damageEvents) {
        this.showToast(() => t('notice.gearDamage', { value1: t(labels[event.id]), value2: event.state === 'collapsed' ? t('gear.collapsed') : t('gear.damaged') }));
      }
    }
    const newContacts = [...new Map(gearResult.bodyContacts.map(c => [c.id, c])).values()]
      .filter(c => !this.bodyContactNotices.has(c.id));
    for (const contact of newContacts) this.bodyContactNotices.add(contact.id);
    if (newContacts.length) {
      this.bodyContactStarted = true;
      this.showToast(() => t('notice.bodyContact', {
        parts: newContacts.map(c => t(`body.part.${c.id}`)).join(', '),
      }));
    }
    for (const event of gearResult.bodyDamageEvents) {
      this.showToast(() => t('notice.bodyDamage', {
        part: t(`body.part.${event.id}`), state: t(`body.state.${event.state}`),
      }));
    }
    const resting = gearResult.onGround && this.linearVelocity.length() < 0.5 && this.angularVelocity.length() < 0.02;
    this.landingRestTime = resting ? this.landingRestTime + dt : 0;
    if (!resting) this.landingStopped = false;
    if (this.landingIncident && !this.landingStopped && this.landingRestTime >= 1) {
      this.landingStopped = true;
      this.showToast(() => t('emergency.landing.stopped.select.a.preset.to'));
    }

    this.aero.gearHandleDown = this.gear.targetGearState > 0.5;

    // 5. Aerodynamic Forces & Moments
    const aeroResult = this.aero.computeAero(
      dt,
      this.aircraft.group,
      this.linearVelocity,
      this.angularVelocity,
      altitudeMeters,
      heightAboveGround,
      engineData.totalThrust,
      gearResult.gearState,
      this._aeroResult, true
    );

    // Engine-out asymmetric thrust: the surviving engine's moment about the
    // centerline yaws the nose toward the dead engine. Body +Y is positive
    // yaw-left, so the sign follows directly from (T_right - T_left).
    aeroResult.momentBody.y += asymmetricThrustYawMoment(
      engineData.engine1.thrust, engineData.engine2.thrust, this.engines.momentArmMeters);

    // 6. Thrust Force in World Space
    // Engine thrust acts along forward longitudinal axis (-Z in Three.js aircraft space)
    const thrustWorld = this._intThrust.set(0, 0, -engineData.totalThrust).applyQuaternion(this.quaternion);

    // 7. Gravity Force
    const gravityWorld = this._intGravity.set(0, -this.aero.mass * Atmosphere.G0, 0);

    // 8. Total Forces Integration: F = m * a
    const netForceWorld = this._intNetForce.set(0, 0, 0)
      .add(gravityWorld)
      .add(thrustWorld)
      .add(aeroResult.forceWorld)
      .add(gearResult.forces);

    // A connected ground tug contributes forces through the normal integrator.
    const towing = this.demoDirector?.isActive
      ? this.demoDirector.getActiveScenario().towingForces?.() : null;
    if (towing) netForceWorld.add(towing.force);
    const accelerationWorld = netForceWorld.divideScalar(this.aero.mass);
    this.linearVelocity.addScaledVector(accelerationWorld, dt);

    // Clamp near-zero velocity when parked on ground with brakes
    if (gearResult.onGround && this.controls.brakes > 0.5 && this.linearVelocity.length() < 0.4 && this.controls.throttle < 0.1) {
      this.linearVelocity.set(0, 0, 0);
    }

    this._rotationBefore.copy(this.quaternion);

    // 9. Total Moments Integration: M = I * alpha
    // Moment in body frame: aero moment + landing gear moment
    const netMomentBody = this._intNetMoment.set(0, 0, 0)
      .add(aeroResult.momentBody)
      .add(gearResult.moments);

    if (towing) netMomentBody.add(towing.moment);

    // Angular acceleration: [p_dot, q_dot, r_dot] = [Mx/Ixx, My/Iyy, Mz/Izz]
    const angAccBody = this._intAngAcc.set(
      netMomentBody.x * this.aero.invIyy, // Pitch (around X)
      netMomentBody.y * this.aero.invIzz, // Yaw (around Y)
      netMomentBody.z * this.aero.invIxx  // Roll (around Z)
    );

    this.angularVelocity.addScaledVector(angAccBody, dt);

    // Natural rotational damping (heavy transport inertia dissipation)
    this.angularVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 0.35));

    // Update Aircraft Orientation Quaternion
    // Delta rotation from body angular velocity: omega x dt
    const deltaRot = this._intDeltaRot.set(
      this.angularVelocity.x * dt * 0.5,
      this.angularVelocity.y * dt * 0.5,
      this.angularVelocity.z * dt * 0.5,
      1.0
    ).normalize();

    this.quaternion.multiply(deltaRot).normalize();
    translateModelOrigin(this.position, this.linearVelocity, this._rotationBefore, this.quaternion, this.aero.cg, dt);

    // Preserve the incoming pose for obstacle/off-runway collision policy; the
    // terrain constraint must not lift an aircraft out of a fatal collision.
    const collisionPosition = this.position.clone();
    const collisionVelocity = this.linearVelocity.clone();
    this.resolveBodyPenetration();

    // Sync Three.js aircraft mesh transform
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);

    // 10. Update Telemetry State
    const euler = this._intEuler.setFromQuaternion(this.quaternion, 'YXZ');
    const pitchDeg = THREE.MathUtils.radToDeg(euler.x);
    const rollDeg = THREE.MathUtils.radToDeg(-euler.z);
    // Heading: forward vector (-Z in aircraft local space) projected to horizontal XZ plane
    const forwardVec = this._intForward.set(0, 0, -1).applyQuaternion(this.quaternion);
    const headingDeg = (THREE.MathUtils.radToDeg(Math.atan2(forwardVec.x, -forwardVec.z)) + 360) % 360;

    // Track
    const trackDeg = (THREE.MathUtils.radToDeg(Math.atan2(this.linearVelocity.x, -this.linearVelocity.z)) + 360) % 360;

    // Compute authentic load factor Nz (accelerometer along body cabin vertical axis +Y)
    const nonGravForceWorld = this._intNonGrav.set(0, 0, 0)
      .add(thrustWorld)
      .add(aeroResult.forceWorld)
      .add(gearResult.forces);
    const cabinCeilingWorld = this._intCabinUp.set(0, 1, 0).applyQuaternion(this.quaternion);
    const measuredGForce = nonGravForceWorld.dot(cabinCeilingWorld) / (this.aero.mass * Atmosphere.G0);

    if (this._hasGroundContact && this.lastOnGround && !gearResult.onGround && this.actualTakeoffMassKg === null) {
      this.actualTakeoffMassKg = this.aero.mass;
      this.refreshTakeoffPerformance();
    }
    this._hasGroundContact ||= gearResult.onGround;
    this._performanceClock += dt;
    if (this._performanceClock >= 1 || this.stallSpeedKnots === undefined) {
      if (gearResult.onGround) this.refreshTakeoffPerformance();
      else this.stallSpeedKnots = stallSpeedEstimate(this.aero, gearResult.gearState);
      this._performanceClock = 0;
    }
    this.telemetry = {
      massRevision: this.aero.massProperties.revision,
      massKg: this.aero.mass,
      zeroFuelMassKg: this.aero.massProperties.zeroFuelMassKg,
      cgBody: { ...this.aero.cg },
      inertiaBody: { ...this.aero.massProperties.inertia },
      takeoff: this.takeoff,
      actualTakeoffMassKg: this.actualTakeoffMassKg,
      stallSpeedKnots: this.stallSpeedKnots,
      pitchDeg,
      rollDeg,
      headingDeg,
      trackDeg,
      altitudeFt: Atmosphere.metersToFeet(this.position.y),
      radioAltFt: Atmosphere.metersToFeet(heightAboveGround),
      iasKnots: aeroResult.iasKnots,
      tasKnots: aeroResult.tasKnots,
      groundSpeedKnots: Atmosphere.msToKnots(groundSpeed),
      vsiFpm: Atmosphere.metersToFeet(this.linearVelocity.y) * 60.0,
      mach: aeroResult.mach,
      gForce: measuredGForce,
      isStalled: aeroResult.isStalled,
      isPreStall: aeroResult.isPreStall,
      isStallWarning: aeroResult.isStallWarning,
      stallSeverity: aeroResult.stallSeverity,
      buffetVibration: aeroResult.buffetVibration,
      engine1: engineData.engine1,
      engine2: engineData.engine2,
      reverserActive: engineData.reverserActive,
      fuelKg: engineData.fuelKg,
      gearState: gearResult.gearState,
      isTransit: gearResult.isTransit,
      compressions: gearResult.compressions,
      gearDamage: gearResult.gearDamage,
      bodyContacts: [...new Set(gearResult.bodyContacts.map(c => c.id))],
      structuralDamage: gearResult.structuralDamage,
      bodyDamage: gearResult.bodyDamage,
      flapDegree: this.aero.currentFlapAngle,
      flapIndex: this.aero.flapsIndex,
      spoilers: this.aero.spoilers,
      touchdown: gearResult.touchdown,
      onGround: gearResult.onGround,
      apEngaged: this.autopilot.master,
      airportKey: this.activeAirport,
      apModes: this.autopilot.annunciation(),
      apArmed: this.autopilot.appArmed,
      selectedHeading: this.autopilot.master ? Math.round(this.autopilot.targets.headingDeg) : this.telemetry.selectedHeading,
      selectedAltitude: this.autopilot.master ? Math.round(this.autopilot.targets.altitudeFt) : this.telemetry.selectedAltitude,
      selectedSpeed: this.autopilot.master && this.autopilot.speedMode ? Math.round(this.autopilot.targets.iasKnots) : this.telemetry.selectedSpeed,
      elevator: this.controls.elevator,
      aileron: this.controls.aileron,
      rudder: this.controls.rudder,
      throttle: this.controls.throttle,
      pitchTrim: this.aero.pitchTrim,
      x: this.position.x,
      z: this.position.z,
      demoActive: Boolean(this.demoDirector?.isActive),
      parkBrake: Boolean(this.controls.parkingBrake || (gearResult.onGround && this.controls.brakes > 0.8 && Atmosphere.msToKnots(groundSpeed) < 1.0))
    };

    this.telemetry.warnings = this.isCrashed ? [] : this.flightWarnings.update(dt, this.telemetry,
      terrainConflictSeconds(this.position, this.linearVelocity, this.currentTerrain,
        this.telemetry.gearState > 0.95 && this.telemetry.flapDegree >= (this.currentAircraftConfig.id === 'B738' ? 15 : 0)));

    // 11. Touchdown Tire Smoke & Landing Contact Gate
    const gsKnots = Atmosphere.msToKnots(groundSpeed);
    let genuineLandingTouchdown = false;

    if (!gearResult.onGround) {
      this.airborneTime += dt;
      if (this.airborneTime > 2.0) {
        // Once aircraft has climbed out and sustained flight, prime for next landing
        this.hasTouchedDownThisFlight = false;
      }
    } else {
      // Aircraft has gear on ground
      // Genuine touchdown requires coming from sustained flight (> 1.5s), with landing airspeed (> 45 knots),
      // and only triggers on the initial touchdown frame of this landing.
      const isGenuineTouchdown = this.airborneTime >= 1.5 && gsKnots > 45 && !this.hasTouchedDownThisFlight;
      if (isGenuineTouchdown && (gearResult.touchdown || !this.lastOnGround)) {
        genuineLandingTouchdown = true;
        this.hasTouchedDownThisFlight = true;
        const contactsToSmoke = (gearResult.touchdownContacts && gearResult.touchdownContacts.length > 0)
          ? gearResult.touchdownContacts
          : this.gear.contacts.filter(c => c.id !== 'nose');
        this.tireSmokeSystem.spawnTouchdownSmoke(contactsToSmoke, this.linearVelocity);
      }
      this.airborneTime = 0.0;
    }

    // 12. Cinematic Camera Cuts: Automatic temporary gear view for Takeoff, Touchdown, and Gear Retract/Extend
    const allowAutoCut = !this.cameraSystem.autoPaused
      && (!this.cameraSystem.userModeSelected || this.cameraSystem.autoSwitch)
      && !this.cameraSystem.userLookOverridden
      && !(this.demoDirector && this.demoDirector.isActive && this.demoDirector.userCameraOverridden);
    if (allowAutoCut && !this.landingIncident && this.lastOnGround && !gearResult.onGround && gsKnots > 75) {
      // Takeoff liftoff
      this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
      this.showToast(() => t('landing.gear.view.takeoff.climb'));
    } else if (allowAutoCut && !this.landingIncident && genuineLandingTouchdown && this.totalSimTime > 2.0) {
      // Touchdown landing (only on genuine landing touchdown)
      this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 5.0);
      this.showToast(() => t('landing.gear.view.touchdown.suspension.compression'));
    }

    const currentGearTarget = this.gear.targetGearState > 0.5;
    if (this.lastGearTarget !== currentGearTarget && this.totalSimTime > 1.0) {
      if (allowAutoCut) {
        if (!currentGearTarget) {
          // Gear retracting
          this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
          this.showToast(() => t('landing.gear.view.retracting'));
        } else {
          // Gear extending
          this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
          this.showToast(() => t('landing.gear.view.extending'));
        }
      }
      this.lastGearTarget = currentGearTarget;
    }
    this.lastOnGround = gearResult.onGround;

    // 13. Check Multi-Obstacle Collisions (Terrain, Water, Tower, Buildings, Trees, Ships)
    this.hangang?.update(dt);
    if (!this.isCrashed) {
      const crash = this.collisionDetector.checkCollision(
        collisionPosition,
        this.quaternion,
        collisionVelocity,
        gearResult.gearState,
        pitchDeg,
        rollDeg,
        gearResult
      );

      if (crash) {
        this.triggerCrash(crash, collisionVelocity);
      }
    }
  }

  resolveBodyPenetration() {
    constrainBodyContact(this.position, this.quaternion, this.linearVelocity, this.angularVelocity,
      this.aero.mass, { x: this.aero.invIyy, y: this.aero.invIzz, z: this.aero.invIxx },
      (x, z) => this.currentTerrain.getHeight(x, z),
      (x, z) => this.currentTerrain.getNormal?.(x, z), this.gear.bodySupportPoints, this.aero.cg);
  }

  triggerCrash(crashResult, impactVelocity = this.linearVelocity) {
    if (this.isCrashed) return;
    this.isCrashed = true;
    if (this.hangang?.active) this.hangang.run.fail('contact');
    this.flightWarnings.reset();
    this.telemetry.warnings = [];
    this.crashResult = crashResult;

    // 1. Spawn Visual Explosion Particles, Fireball, Smoke & Dynamic Light Flash
    this.explosionSystem.spawnExplosion(crashResult, impactVelocity);

    // 2. Procedural Audio Detonation & Metal Crunch Sound
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

    // 7. Show Crash UI Overlay
    this.showCrashUI(crashResult);
  }

  clearCrashState() {
    this.isCrashed = false;
    this.crashResult = null;
    this.explosionSystem.clear();
    this.aircraftBreakup.clear();
    this.cameraSystem.endCrashView();
    this.aircraft.resetCrashVisuals();

    const crashEl = document.getElementById('crash-overlay');
    if (crashEl) crashEl.style.display = 'none';
  }

  resetCrash() {
    if (this.devRunner.active) { this.devRunner.restart(); return; }
    if (this.hangang?.active) { this.setPreset('hangang'); return; }
    this.clearCrashState();
    this.setPreset('runway');
    this.showToast(() => t(this.activeAirport === 'incheon'
      ? 'incheon.repaired' : 'aircraft.repaired.restarted.on.runway.09l'));
  }

  exitCrashToLobby() {
    if (this.devRunner.active) {
      this.devRunner.stop();
      this.gameFlow.returnToLobby(true);
      return;
    }
    if (!this.isCrashed) return;
    this.clearCrashState();
    this.gameFlow.returnToLobby();
  }

  showCrashUI(crashResult) {
    // Crashes during the lobby cinematic are part of the show: the loop
    // restarts the scenario without a hull-loss UI. Only interrupt the player.
    if (this.gameFlow.state !== FLOW.FLIGHT) return;
    const overlay = document.getElementById('crash-overlay');
    const title = document.getElementById('crash-title');
    const desc = document.getElementById('crash-desc');
    const speed = document.getElementById('crash-speed');
    const type = document.getElementById('crash-type');

    if (title) bindText(title, () => crashResult.name);
    if (desc) bindText(desc, () => crashResult.description);
    if (speed) speed.textContent = `${Math.round(crashResult.speedKnots)} KT`;
    if (type) type.textContent = crashResult.type;

    // Start collapsed so the report never hides the wreckage.
    this.setCrashReportMinimized(true);
    if (overlay) overlay.style.display = 'flex';
  }

  setCrashReportMinimized(minimized) {
    this.isCrashReportMinimized = minimized;
    const overlay = document.getElementById('crash-overlay');
    if (overlay) overlay.classList.toggle('is-minimized', minimized);

    const button = document.getElementById('btn-crash-toggle');
    if (!button) return;
    button.setAttribute('aria-expanded', String(!minimized));
    const label = () => t(this.isCrashReportMinimized ? 'crash.expand' : 'crash.collapse');
    bindText(button, label);
    bindText(button, label, 'title');
    bindText(button, label, 'aria-label');
  }

  /**
   * Deterministic Simulation Step (for automated test harness & replay)
   * Runs the exact 120Hz physics substepping for the requested duration in simulation time.
   * @param {number} simSeconds 
   * @returns {object} updated telemetry state
   */
  stepSimulation(simSeconds) {
    if (this.devRunner.active && this.gameFlow.isPhysicsFrozen()) return this.telemetry;
    this.devRunner.updatePreparation(0);
    if (this.shadowDemo.active) this.shadowDemo.update(simSeconds);
    const numSubsteps = Math.max(1, Math.round(simSeconds * this.physicsHz));
    for (let i = 0; i < numSubsteps; i++) {
      if (this.devRunner.blocksPhysics) break;
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
    this.aircraft.setCockpitMode(isCockpit, !isPhotoCockpit);
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
    if (this.isCrashed) this.cameraSystem.updateCrashView(0, true);
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
