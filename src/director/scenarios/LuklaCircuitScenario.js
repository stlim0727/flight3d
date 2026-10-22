import { t } from '../../i18n/index.js';
import * as THREE from 'three';
import { BOEING_737_800 } from '../../config/aircraftConfigs.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';

/**
 * Autonomous Nepal Tenzing-Hillary Airport (Lukla VNLK) Continuous Circuit Scenario
 * 
 * Continuous entertainment circuit with explicit 43t loading; not a validated
 * real-world 737 operation. Flight uses control inputs, without pose/velocity edits.
 * 1. Runway 24 downhill takeoff
 * 2. Dudh Kosi Canyon Gorge Outbound & Climb (Gear Cam, Retraction over gorge)
 * 3. 180° valley turn at 2,950m
 * 4. Full-flap final approach and curved uphill flare
 * 5. Main-gear touchdown, controlled nose lowering, braking to a runway stop
 * 6. Completed -> Seamless Handover to User Manual Flight
 */
export class LuklaCircuitScenario {
  static STAGES = {
    IDLE: -1,
    CLIFF_TAKEOFF: 0,
    CANYON_CLIMB: 1,
    HIMALAYAN_CRUISE: 2, // Aliased to 180° canyon turnaround for backward compatibility
    VALLEY_TURNAROUND: 2,
    CANYON_CIRCUIT: 2,
    CANYON_APPROACH: 3,
    UPHILL_TOUCHDOWN: 4,
    COMPLETED: 5
  };

  constructor(director, simulator) {
    this.director = director;
    this.sim = simulator;
    this.sin58 = 0.848048;
    this.cos58 = 0.529919;
    this.stageCameraCutDone = false;
    this.result = { status: 'idle', airborne: false };
  }

  enterStage(stage) {
    this.stageCameraCutDone = false;
    switch (stage) {
      case LuklaCircuitScenario.STAGES.CLIFF_TAKEOFF:
        this.result = { status: 'running', massKg: 43000, airborne: false };
        if (this.sim.currentTerrain?.isLoaded === false) {
          this.result.status = 'failed';
          this.result.reason = 'DEM not loaded';
          this.director.stop(() => t('load.lukla.terrain.data.before.restarting.the'));
          return;
        }
        this.director.updateBanner(() => t('1.5.lukla.runway.24.downhill.takeoff'), () => t('43.t.light.aircraft.simulation.downhill.takeoff'));
        // Explicit empty-aircraft demonstration loading: no passengers/cargo,
        // ~1.6 t above the configured empty mass. Never inflate lift or braking.
        if (this.sim.aero?.loadConfig) {
          const base = BOEING_737_800.massProperties;
          const ratio = 43000 / base.currentMassKg;
          this.sim.aero.loadConfig({ ...BOEING_737_800, massProperties: {
            ...base, currentMassKg: 43000,
            Ixx: base.Ixx * ratio, Iyy: base.Iyy * ratio, Izz: base.Izz * ratio
          } });
        }
        if (this.sim.setPreset) {
          this.sim.setPreset('cliff', true);
        }
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        if (!this.sim.cameraSystem.userLookOverridden) {
          this.sim.cameraSystem.lookPitch = -0.06;
          this.sim.cameraSystem.lookYaw = 0.0;
        }
        this.director.setTimeOfDay(8.5); // Morning Himalayan sun
        if (this.sim.water && this.sim.water.setSunDirection) {
          this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        }

        this.sim.controls.setVirtualInput('throttle', 1.0);
        this.sim.engines.setThrottle(1.0);
        this.sim.controls.setVirtualInput('brakes', 0.0);
        this.sim.gear.setBrakes(0.0);
        this.director.approachFlarInitiated = false;
        this.director.touchdownConfirmed = false;
        this.stoppedTime = 0;
        break;

      case LuklaCircuitScenario.STAGES.CANYON_CLIMB:
        this.director.updateBanner(() => t('2.5.dudh.kosi.canyon.outbound.climb'), () => t('climb.along.the.valley.gear.retraction.copernicus'));
        this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        this.sim.controls.setVirtualInput('throttle', 0.90);
        this.sim.engines.setThrottle(0.90);
        break;

      case LuklaCircuitScenario.STAGES.HIMALAYAN_CRUISE:
        this.director.updateBanner(() => t('3.5.canyon.turnaround.mountain.views'), () => t('bank.up.to.42.target.elevation.2'));
        // Continuous aerodynamic flight: NO TELEPORT!
        this.sim.cameraSystem.setMode(CameraSystem.MODES.FLYBY);
        this.director.setTimeOfDay(11.5); // Bright daytime summit glare
        break;

      case LuklaCircuitScenario.STAGES.CANYON_APPROACH:
        this.director.updateBanner(() => t('4.5.canyon.final.approach.to.rw06'), () => t('flaps.40.target.112.kias.flare.to'));
        // Continuous approach: NO TELEPORT!
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        if (!this.sim.cameraSystem.userLookOverridden) {
          this.sim.cameraSystem.lookPitch = -0.12;
          this.sim.cameraSystem.lookYaw = 0.0;
        }
        this.director.setTimeOfDay(15.5); // Golden afternoon canyon shadows
        if (this.sim.gear && this.sim.gear.setGearTarget) {
          this.sim.gear.setGearTarget(true);
        }
        if (this.sim.aero && this.sim.aero.setFlapPosition) {
          this.sim.aero.setFlapPosition(6); // Full landing flaps for the uphill flare
        }
        this.director.approachFlarInitiated = false;
        this.director.touchdownConfirmed = false;
        this.stoppedTime = 0;
        break;

      case LuklaCircuitScenario.STAGES.UPHILL_TOUCHDOWN:
        this.director.updateBanner(() => t('5.5.uphill.touchdown.rollout'), () => t('11.7.uphill.deceleration.oleo.suspension.touchdown'));
        this.sim.cameraSystem.setMode(CameraSystem.MODES.GEAR);
        this.rolloutPitch = this.sim.telemetry.pitchDeg;
        this.sim.controls.setVirtualInput('throttle', 0);
        this.sim.controls.setVirtualInput('brakes', 0);
        this.sim.gear.setBrakes(0);
        break;

      case LuklaCircuitScenario.STAGES.COMPLETED:
        this.result.status = 'completed';
        this.result.elapsedSeconds = this.director.totalTimer;
        this.result.stopPosition = this.sim.position.clone();
        this.director.updateBanner(() => t('lukla.challenge.complete.taking.manual.control'), () => t('landing.complete.at.one.of.the.world'));
        this.director.stop(() => t('lukla.demo.complete.enjoy.your.flight'), true);

        break;
    }
  }

  flyBank(targetRollDeg, tel) {
    const aero = this.sim.aero;
    const rate = this.sim.angularVelocity.z;
    const desiredRate = -THREE.MathUtils.clamp(THREE.MathUtils.degToRad(targetRollDeg - tel.rollDeg) * 1.4, -0.35, 0.35);
    const acceleration = (desiredRate - rate) * 3;
    const qSb = Math.max(1, aero.qDyn * aero.wingArea * aero.wingspan);
    const pHat = rate * aero.wingspan / (2 * Math.max(10, aero.tas));
    const coefficient = -aero.Ixx * acceleration / qSb;
    const aileron = (coefficient - aero.Cl_b * aero.beta - Math.abs(aero.Cl_p) * pHat) / (aero.Cl_da * 1.05 * THREE.MathUtils.degToRad(20));
    this.sim.controls.setVirtualInput('aileron', THREE.MathUtils.clamp(aileron, -1, 1));
  }

  // Autoflight alpha protection, like a real flight-director limiter: caps nose-up
  // elevator as AoA climbs and commands an uncommanded-pitch-down recovery above the margin.
  alphaGuarded(elevatorCmd, alphaDeg) {
    if (alphaDeg <= 11.0) return elevatorCmd;
    const cap = THREE.MathUtils.clamp(0.8 - (alphaDeg - 11.0) * 0.37, -0.35, 0.8);
    return Math.min(elevatorCmd, cap);
  }

  flyVerticalPath(targetVz, targetIas, tel, pathAcceleration = 0, groundPitch = null) {
    const aero = this.sim.aero;
    const speed = Math.max(30, Math.hypot(this.sim.linearVelocity.x, this.sim.linearVelocity.z));
    const flapCl0 = aero.CL0_clean + 0.95 * aero.currentFlapAngle / 40;
    const bank = THREE.MathUtils.degToRad(tel.rollDeg);
    const requiredCl = aero.mass * (9.80665 + THREE.MathUtils.clamp(pathAcceleration + (targetVz - this.sim.linearVelocity.y) * 1.2, -3, 4)) / Math.max(1, aero.qDyn * aero.wingArea * Math.cos(bank));
    const alpha = THREE.MathUtils.clamp((requiredCl - flapCl0) / aero.CLa, 0.02, THREE.MathUtils.degToRad(13.5));
    const targetPitch = groundPitch === null ? Math.atan2(this.sim.linearVelocity.y, speed) + alpha : THREE.MathUtils.degToRad(groundPitch);
    const pitch = THREE.MathUtils.degToRad(tel.pitchDeg);
    const q = this.sim.angularVelocity.x;
    const desiredRate = THREE.MathUtils.clamp((targetPitch - pitch) * 1.2, -0.12, 0.12);
    const desiredAcceleration = (desiredRate - q) * 2.5;
    const qSc = Math.max(1, aero.qDyn * aero.wingArea * aero.meanChord);
    const thrustMoment = (this.sim.engines.thrust[0] + this.sim.engines.thrust[1]) * 0.32;
    const gearMoment = groundPitch === null ? 0 : this.sim.gear.lastMomentBody.x;
    const requiredCm = (aero.Iyy * desiredAcceleration - thrustMoment - gearMoment) / qSc;
    const qHat = q * aero.meanChord / (2 * Math.max(10, aero.tas));
    const effectiveElevator = (requiredCm - aero.Cm0 - aero.Cma * aero.alpha - aero.Cmq * qHat) / -aero.Cm_de;
    const elevator = (effectiveElevator - THREE.MathUtils.degToRad(aero.pitchTrim) * 0.35) / THREE.MathUtils.degToRad(20);
    this.sim.controls.setVirtualInput('elevator', this.alphaGuarded(THREE.MathUtils.clamp(elevator, -0.8, 0.8), THREE.MathUtils.radToDeg(aero.alpha)));
    if (groundPitch === null) this.sim.controls.setVirtualInput('throttle', THREE.MathUtils.clamp(0.50 + (targetIas - tel.iasKnots) * 0.035 + targetVz * 0.02, 0.05, 0.95));
  }

  recordFailure(crashResult) {
    this.result.status = 'failed';
    this.result.reason = crashResult?.description || 'Aircraft damage';
  }

  update(dt) {
    const tel = this.sim.telemetry;
    if (this.sim.isCrashed) {
      this.recordFailure(this.sim.crashResult);
      this.director.stop(() => t('lukla.demo.failed.aircraft.damage'));
      return;
    }
    // s: along runway axis (+toward 24 rock wall, -toward 06 cliff)
    // w: lateral offset (+right/SE of 06 heading, -left/NW)
    const s = this.sim.position.x * this.sin58 - this.sim.position.z * this.cos58;
    const w = this.sim.position.x * this.cos58 + this.sim.position.z * this.sin58;

    if (!tel.onGround && s < -263.5 && tel.radioAltFt > 30) this.result.airborne = true;

    switch (this.director.currentStage) {
      // -------------------------------------------------------------
      // STAGE 0: Runway 24 Downhill Cliff Takeoff Roll
      // -------------------------------------------------------------
      case LuklaCircuitScenario.STAGES.CLIFF_TAKEOFF: {
        // Runway 24 heading 238°; track the same 5m offset as the takeoff preset.
        // Keep centerline: if w > 0, steer left (negative rudder)
        const rudderCmd = Math.max(-0.25, Math.min(0.25, -(w + 5) * 0.05));
        this.sim.controls.setVirtualInput('rudder', rudderCmd);

        // Heading alignment
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const aileronCmd = (0.0 - tel.rollDeg) * 0.035 - rollRateDeg * 0.02;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.15, Math.min(0.15, aileronCmd)));

        if (this.sim.aero) this.sim.aero.pitchTrim = 5.5;
        if (this.sim.controls) this.sim.controls.pitchTrim = 5.5;

        // Vr Rotation: Begin rotation when approaching cliff edge
        if (s <= -50.0 || tel.iasKnots >= 80.0 || (!tel.onGround && tel.radioAltFt > 10.0)) {
          const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
          const targetPitch = 4.5;
          const pitchErr = targetPitch - tel.pitchDeg;
          let elevatorCmd = 0.26 + pitchErr * 0.035 - pitchRateDeg * 0.02;

          // Alpha protection shared with the flight-path law: can override the
          // rotation floor and command nose-down once the AoA margin is exceeded.
          const alphaDeg = THREE.MathUtils.radToDeg(this.sim.aero ? this.sim.aero.alpha : 0);
          this.sim.controls.setVirtualInput('elevator', this.alphaGuarded(Math.max(0.12, Math.min(0.50, elevatorCmd)), alphaDeg));

          // Retract gear once safely airborne over the valley
          if (!tel.onGround && tel.radioAltFt > 15.0 && tel.gearState > 0.1 && !tel.isTransit) {
            this.sim.gear.setGearTarget(false);
          }

          if (!this.stageCameraCutDone && !this.director.userCameraOverridden && this.director.stageTimer > 4.5) {
            this.stageCameraCutDone = true;
            this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
          }
        }

        // Require genuine airborne departure; timers cannot prove takeoff.
        const isAirborneOffCliff = !tel.onGround && s < -263.5 && tel.radioAltFt > 30;
        if (isAirborneOffCliff && tel.iasKnots > 95) {
          this.director.setStage(LuklaCircuitScenario.STAGES.CANYON_CLIMB);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 1: Dudh Kosi Canyon Liftoff, Plunge & Outbound Climb
      // -------------------------------------------------------------
      case LuklaCircuitScenario.STAGES.CANYON_CLIMB: {
        if (!tel.onGround && tel.radioAltFt > 20.0 && tel.gearState > 0.1 && !tel.isTransit) {
          this.sim.gear.setGearTarget(false);
        }
        if (this.sim.aero) this.sim.aero.pitchTrim = 5.2;
        if (this.sim.controls) this.sim.controls.pitchTrim = 5.2;

        // Track southwest along deep canyon valley floor (heading 238°)
        // Move toward w = -300m after s = -1100m
        // to set up a spacious teardrop left turnaround
        const targetW = s <= -1100.0 ? -300.0 : -5.0;
        // On heading 238°, steering RIGHT (increasing heading) decreases w (moves toward -w)
        const headingOffset = THREE.MathUtils.clamp((w - targetW) * 0.06, -15.0, 15.0);
        const targetHeading = 238.0 + headingOffset;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
        const targetBankDeg = THREE.MathUtils.clamp(hdgDiff * 0.65, -16.0, 16.0);
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', THREE.MathUtils.clamp(aileronCmd, -0.24, 0.24));

        // Coordinated rudder
        this.sim.controls.setVirtualInput('rudder', THREE.MathUtils.clamp(targetBankDeg * 0.005, -0.06, 0.06));

        this.sim.aero.setFlapPosition(4);
        this.flyVerticalPath(THREE.MathUtils.clamp((2920 - this.sim.position.y) * 0.15, -3, 8), 140, tel);

        // Showcase wing view halfway through canyon climb
        if (!this.stageCameraCutDone && !this.director.userCameraOverridden && this.director.stageTimer > 4.5) {
          this.stageCameraCutDone = true;
          this.sim.cameraSystem.setMode(CameraSystem.MODES.WING);
        }

        // Turn within the measured valley rather than extending into the ridge.
        if ((s <= -2600.0 && this.sim.position.y >= 2880.0 && tel.iasKnots <= 150.0) || s <= -3300.0) {
          this.director.setStage(LuklaCircuitScenario.STAGES.HIMALAYAN_CRUISE);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 2: 180° Canyon Turnaround & Mountain Panorama (NO TELEPORT!)
      // -------------------------------------------------------------
      case LuklaCircuitScenario.STAGES.HIMALAYAN_CRUISE: {
        if (this.sim.aero) {
          this.sim.aero.pitchTrim = 5.2;
          this.sim.aero.setFlapPosition(4); // Flaps 25 for compact high-lift turnaround
        }
        if (this.sim.controls) this.sim.controls.pitchTrim = 5.2;

        // Tactical 180° left valley turnaround back to Runway 06 (inbound heading 058°)
        // When offset to the right/SE (w > 300m), roll out directly toward the localizer intercept course (~020°)
        const desiredInboundHeading = w > 300.0 ? 20.0 : 58.0;
        const leftHdgRemaining = ((tel.headingDeg - desiredInboundHeading + 360) % 360);
        let targetBankDeg = -42.0;
        if (leftHdgRemaining < 32.0) {
          // Smoothly roll out wings as we align with desired inbound heading
          targetBankDeg = THREE.MathUtils.clamp(-leftHdgRemaining * 1.3, -42.0, 0.0);
        } else if (leftHdgRemaining > 330.0) {
          // Slight overshoot to the left: gently steer right
          const overshootErr = 360.0 - leftHdgRemaining;
          targetBankDeg = THREE.MathUtils.clamp(overshootErr * 1.3, 0.0, 22.0);
        }

        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.040 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', THREE.MathUtils.clamp(aileronCmd, -0.45, 0.45));

        // Coordinated turn rudder
        this.sim.controls.setVirtualInput('rudder', THREE.MathUtils.clamp(targetBankDeg * 0.005, -0.15, 0.15));

        this.flyVerticalPath(THREE.MathUtils.clamp((2950 - this.sim.position.y) * 0.2, -4, 6), 130, tel);

        // Switch to chase camera at 10.0s
        if (!this.stageCameraCutDone && !this.director.userCameraOverridden && this.director.stageTimer > 10.0) {
          this.stageCameraCutDone = true;
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        // Once turn is complete and heading is aligned towards inbound course
        const inboundHdgDiff = Math.abs(((desiredInboundHeading - tel.headingDeg + 540) % 360) - 180);
        if ((this.director.stageTimer >= 15.0 && inboundHdgDiff < 25.0)) {
          this.director.setStage(LuklaCircuitScenario.STAGES.CANYON_APPROACH);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 3: Canyon Final Approach to RW06 (NO TELEPORT!)
      // -------------------------------------------------------------
      case LuklaCircuitScenario.STAGES.CANYON_APPROACH: {
        const targetThresholdS = -263.5;
        const distToThreshold = Math.max(0.0, targetThresholdS - s);

        // 1. Cross-track offset (w) & Cross-track rate (vW)
        // w: lateral offset (+right of 058°, -left of 058°)
        // vW: lateral velocity along +w (m/s)
        const vel = this.sim.linearVelocity;
        const vW = vel ? (vel.x * this.cos58 + vel.z * this.sin58) : 0.0;

        const runwayElevation = 2836.0 + THREE.MathUtils.clamp(s, -263.5, 263.5) * 0.1176;
        const heightAboveRunwayM = this.sim.position.y - runwayElevation;
        const isOverRunway = s >= -245 && s < 235 && Math.abs(w) < 11;

        // 3. Ground Clearance Protection (Bank Limiter):
        // Allow up to 26° bank for responsive alignment while in the air.
        // Only when actually crossing over runway tarmac (s >= -260m) and low (heightAboveRunwayM <= 10m or radioAlt <= 28ft),
        // keep wings level (max bank 3.5°) to prevent engine cowling / wingtip strike.
        const isTouchdownRoll = s >= -260.0 && (heightAboveRunwayM <= 10.0 || tel.radioAltFt <= 28.0);
        const maxBankDeg = isTouchdownRoll ? 3.5 : (distToThreshold > 600.0 ? 26.0 : 18.0);
        const desiredVW = THREE.MathUtils.clamp(-w * 0.10, -60, 60);
        const lateralAcceleration = (desiredVW - vW) * 0.8;
        const targetRoll = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.atan2(lateralAcceleration, 9.80665)), -maxBankDeg, maxBankDeg);
        this.flyBank(targetRoll, tel);

        // 4. Rudder control:
        // In flight: coordinated turn rudder (targetRoll * 0.005) to eliminate adverse yaw without opposing roll.
        // Over runway on low approach: decrab rudder to align nose with runway 058°
        const runwayHdgDiff = ((58.0 - tel.headingDeg + 540) % 360) - 180;
        const rudderCmd = isTouchdownRoll
          ? THREE.MathUtils.clamp(runwayHdgDiff * 0.025 - (w + 5) * 0.020, -0.25, 0.25)
          : THREE.MathUtils.clamp(targetRoll * 0.005, -0.08, 0.08);
        this.sim.controls.setVirtualInput('rudder', rudderCmd);

        // Begin the curved flare 650m before the aim point. The final path
        // climbs slightly less steeply than the runway, giving a small normal
        // approach velocity instead of slamming level flight into the slope.
        const touchdownS = -210;
        const flareLength = 650;
        const distance = Math.max(0, touchdownS - s);
        const slope = 0.09;
        const curvature = (slope + 0.06) / flareLength;
        const pathDistance = Math.min(distance, flareLength);
        const touchdownAltitude = 2836 + touchdownS * 0.1176 + 3.55;
        const pathAltitude = touchdownAltitude - slope * pathDistance + 0.5 * curvature * pathDistance ** 2;
        const targetAltitude = distance > flareLength ? pathAltitude + (distance - flareLength) * 0.06 : s > touchdownS ? touchdownAltitude + (s - touchdownS) * slope : pathAltitude;
        const pathSlope = distance > flareLength ? -0.06 : slope - curvature * distance;
        const vS = this.sim.linearVelocity.x * this.sin58 - this.sim.linearVelocity.z * this.cos58;
        const targetVz = THREE.MathUtils.clamp(pathSlope * vS + (targetAltitude - this.sim.position.y) * 0.45, -8, 10);
        this.flyVerticalPath(targetVz, 112, tel, distance > 0 && distance < flareLength ? curvature * vS ** 2 : 0);
        this.director.approachFlarInitiated = distance < flareLength;

        // Detect touchdown over runway tarmac
        if (this.result.airborne && isOverRunway && tel.onGround && tel.gearState >= 0.99 &&
          this.sim.gear.contacts.slice(1).every(c => c.isGrounded)) {
          this.director.touchdownConfirmed = true;
          this.result.touchdown = { alongRunwayM: s, crossTrackM: w, iasKnots: tel.iasKnots };
          this.director.setStage(LuklaCircuitScenario.STAGES.UPHILL_TOUCHDOWN);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 4: 11.7% Uphill Touchdown, Reverser & Full Brake Rollout
      // -------------------------------------------------------------
      case LuklaCircuitScenario.STAGES.UPHILL_TOUCHDOWN: {
        // Deploy full spoilers, reverse thrust, and maximum carbon brakes
        const noseDown = !!this.sim.gear.contacts[0].isGrounded;
        this.rolloutPitch = Math.max(6.7, this.rolloutPitch - dt * 3);
        this.flyVerticalPath(0, 0, tel, 0, this.rolloutPitch);

        // Active wings-level stabilization with roll-rate damping to prevent wingtip scrape on sloped ground
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const groundRollErr = 0.0 - tel.rollDeg;
        const groundAileron = THREE.MathUtils.clamp(groundRollErr * 0.08 - rollRateDeg * 0.02, -0.60, 0.60);
        this.sim.controls.setVirtualInput('aileron', groundAileron);

        // Runway centerline steering: stay parallel to runway 058° with gentle proportional w correction + active yaw damping
        const targetHdg = 58.0 - THREE.MathUtils.clamp((w + 5) * 0.15, -2.5, 2.5);
        const hdgErr = ((targetHdg - tel.headingDeg + 540) % 360) - 180;
        const yawRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.y);
        const maxRudder = tel.iasKnots < 35.0 ? 0.15 : 0.06;
        const rolloutRudder = THREE.MathUtils.clamp(hdgErr * 0.025 - yawRateDeg * 0.035, -maxRudder, maxRudder);
        this.sim.controls.setVirtualInput('rudder', rolloutRudder);

        if (this.sim.aero) this.sim.aero.spoilers = noseDown ? 1 : 0;
        this.sim.controls.setVirtualInput('brakes', noseDown ? 1 : 0);
        this.sim.gear.setBrakes(noseDown ? 1 : 0);
        this.sim.engines.setReverser(noseDown && tel.iasKnots > 25, tel.onGround);
        this.sim.controls.setVirtualInput('throttle', noseDown && tel.iasKnots > 25 ? 1 : 0);

        // Switch to exterior chase camera at 3.0s after showcasing touchdown impact
        if (!this.stageCameraCutDone && !this.director.userCameraOverridden && this.director.stageTimer > 3.0) {
          this.stageCameraCutDone = true;
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        // Aircraft brought to complete safe stop on uphill runway
        const groundSpeedMs = this.sim.linearVelocity?.length() ?? Infinity;
        const stoppedOnRunway = this.result.airborne && this.director.touchdownConfirmed &&
          !this.sim.gear.failure && this.sim.gear.contacts.every(c => c.isGrounded) && tel.onGround &&
          s > -245 && s < 235 && Math.abs(w) < 11 && groundSpeedMs < 0.5;
        this.stoppedTime = stoppedOnRunway ? (this.stoppedTime || 0) + dt : 0;
        if (this.stoppedTime >= 2.0) {
          if (this.sim.engines) {
            this.sim.engines.setReverser(false, true);
            this.sim.engines.setThrottle(0.0);
          }
          this.sim.controls.setVirtualInput('throttle', 0.0);
          this.sim.controls.setVirtualInput('brakes', 1.0); // Keep parking brakes set
          this.sim.controls.setVirtualInput('rudder', 0.0);
          this.sim.controls.setVirtualInput('aileron', 0.0);
          if (this.sim.gear) this.sim.gear.setBrakes(1.0);
          if (this.sim.aero) this.sim.aero.spoilers = 0.0;
          this.director.setStage(LuklaCircuitScenario.STAGES.COMPLETED);
        }
        break;
      }
    }
  }
}
