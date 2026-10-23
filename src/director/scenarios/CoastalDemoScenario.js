import { t } from '../../i18n/index.js';
import * as THREE from 'three';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { flyVerticalPath } from '../PilotControlLaws.js';

// Runway 09L geometry, mirroring environment/Airport.js: an east-west strip
// centered on z = 0 at the airport mesa elevation, 3,200 m long.
const RUNWAY_ELEVATION_M = 12.0;
const TOUCHDOWN_X_M = -1250;
const GLIDESLOPE_TAN = Math.tan(THREE.MathUtils.degToRad(3.0));
// Roundout law: below the knee the commanded sink is proportional to the height
// still to be flown away, so the target reaches zero sink at the pavement.
const FLARE_SINK_PER_METER = 0.25;
const GLIDESLOPE_TRACKING_GAIN = 0.30;
// Approach thrust is held until the roundout, then retarded with the last 12 m.
const THROTTLE_RETARD_HEIGHT_M = 12.0;
const APPROACH_IAS_KNOTS = 142;

/**
 * Autonomous Pacific Coastal International Airport (Runway 09L) Scenic Demo Scenario
 */
export class CoastalDemoScenario {
  static STAGES = {
    IDLE: -1,
    PREFLIGHT_ORBIT: 0,
    TAKEOFF_ROLL: 1,
    ROTATION_CLIMB: 2,
    COASTAL_BANK: 3,
    OCEAN_CRUISE: 4,
    FINAL_APPROACH: 5,
    TOUCHDOWN_ROLLOUT: 6,
    POSTFLIGHT_ORBIT: 7,
    COMPLETED: 8
  };

  constructor(director, simulator) {
    this.director = director;
    this.sim = simulator;
    this.stageCameraCutDone = false;
    this.rolloutPitchDeg = 0;
    this.stoppedTime = 0;
  }

  enterStage(stage) {
    this.stageCameraCutDone = false;
    switch (stage) {
      case CoastalDemoScenario.STAGES.PREFLIGHT_ORBIT:
        this.director.updateBanner(() => t('1.8.pre.flight.drone.inspection.235'), () => t('360.boeing.737.exterior.inspection.flaps.5'));
        if (this.sim.setPreset) {
          this.sim.setPreset('runway', true);
        }
        this.sim.cameraSystem.setMode(CameraSystem.MODES.DRONE);
        this.sim.cameraSystem.resetDroneOrbit?.(-Math.PI * 0.45, 36.0, 9.5);
        this.director.setTimeOfDay(6.5);
        if (this.sim.water && this.sim.water.setSunDirection) {
          this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        }
        if (this.sim.aero && this.sim.aero.setFlapPosition) {
          this.sim.aero.setFlapPosition(2); // Flaps 5
        }
        this.sim.controls.setVirtualInput('brakes', 1.0);
        if (this.sim.gear) this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        if (this.sim.engines) this.sim.engines.setThrottle(0.0);
        this.director.approachFlarInitiated = false;
        this.director.touchdownConfirmed = false;
        break;

      case CoastalDemoScenario.STAGES.TAKEOFF_ROLL:
        this.director.updateBanner(() => t('2.8.runway.09l.takeoff.roll'), () => t('toga.100.thrust.boeing.glass.cockpit.instruments'));
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        this.director.setTimeOfDay(7.2);
        if (this.sim.water && this.sim.water.setSunDirection) {
          this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        }
        this.sim.controls.setVirtualInput('brakes', 0.0);
        if (this.sim.gear) this.sim.gear.setBrakes(0.0);
        this.sim.controls.setVirtualInput('throttle', 1.0);
        if (this.sim.engines) this.sim.engines.setThrottle(1.0);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', 0.0);
        break;

      case CoastalDemoScenario.STAGES.ROTATION_CLIMB:
        this.director.updateBanner(() => t('3.8.rotation.initial.climb'), () => t('smooth.rotation.at.133.kt.2.2'));
        this.sim.controls.setVirtualInput('elevator', 0.65);
        break;

      case CoastalDemoScenario.STAGES.COASTAL_BANK:
        this.director.updateBanner(() => t('4.8.scenic.coastal.banking.turn'), () => t('20.right.bank.mountains.3.500.trees'));
        this.sim.cameraSystem.setMode(CameraSystem.MODES.WING);
        if (this.sim.aero && this.sim.aero.setFlapPosition) {
          this.sim.aero.setFlapPosition(0);
        }
        break;

      case CoastalDemoScenario.STAGES.OCEAN_CRUISE:
        this.director.updateBanner(() => t('5.8.ocean.waves.fleet.cruise'), () => t('sunlit.water.container.ships.cruise.ships.and'));
        this.sim.cameraSystem.setMode(CameraSystem.MODES.FLYBY);
        break;

      case CoastalDemoScenario.STAGES.FINAL_APPROACH:
        this.director.updateBanner(() => t('6.8.runway.09l.final.approach'), () => t('four.light.papi.3.0.glide.path'));
        this.sim.setPreset('approach', true);
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        this.director.setTimeOfDay(17.6);
        if (this.sim.water && this.sim.water.setSunDirection) {
          this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        }
        this.director.approachFlarInitiated = false;
        this.director.touchdownConfirmed = false;
        break;

      case CoastalDemoScenario.STAGES.TOUCHDOWN_ROLLOUT:
        this.director.updateBanner(() => t('7.8.touchdown.reverse.thrust.rollout'), () => t('landing.gear.view.main.nose.wheel.touchdown'));
        this.sim.cameraSystem.setMode(CameraSystem.MODES.GEAR);
        // Carry the arrival attitude and decay it from here, so the nose gear is
        // placed on the pavement under command instead of dropped onto it.
        this.rolloutPitchDeg = Math.max(0, this.sim.telemetry.pitchDeg);
        this.stoppedTime = 0;
        break;

      case CoastalDemoScenario.STAGES.POSTFLIGHT_ORBIT:
        this.director.updateBanner(() => t('8.8.touchdown.complete.drone.orbit'), () => t('stopped.on.runway.spoilers.reverse.thrust.stowed'));
        this.sim.cameraSystem.setMode(CameraSystem.MODES.DRONE);
        this.sim.cameraSystem.resetDroneOrbit?.(this.sim.cameraSystem.droneOrbitAngle, 38.0, 11.5);
        this.sim.controls.setVirtualInput('brakes', 1.0);
        if (this.sim.gear) this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        if (this.sim.engines) this.sim.engines.setThrottle(0.0);
        break;

      case CoastalDemoScenario.STAGES.COMPLETED:
        this.director.updateBanner(() => t('demo.complete.taking.manual.control'), () => t('choose.a.preset.and.camera.view.to'));
        this.director.stop(() => t('demo.flight.complete.enjoy.your.flight'), true);
        break;
    }
  }

  update(dt) {
    const tel = this.sim.telemetry;

    switch (this.director.currentStage) {
      case CoastalDemoScenario.STAGES.PREFLIGHT_ORBIT: {
        this.sim.controls.setVirtualInput('brakes', 1.0);
        if (this.sim.gear) this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        if (this.sim.engines) this.sim.engines.setThrottle(0.0);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', 0.0);

        if (this.director.stageTimer >= 6.0) {
          this.director.setStage(CoastalDemoScenario.STAGES.TAKEOFF_ROLL);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.TAKEOFF_ROLL: {
        if (tel.iasKnots >= 132 || this.director.stageTimer > 23.0) {
          this.director.setStage(CoastalDemoScenario.STAGES.ROTATION_CLIMB);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.ROTATION_CLIMB: {
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = 0.0 - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.02;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.2, Math.min(0.2, aileronCmd)));

        if (!tel.onGround && tel.radioAltFt > 10.0) {
          if (tel.gearState > 0.1 && !tel.isTransit && this.sim.gear) {
            this.sim.gear.setGearTarget(false);
          }
          const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
          const pitchErr = 12.0 - tel.pitchDeg;
          const elevatorCmd = 0.18 + pitchErr * 0.035 - pitchRateDeg * 0.02;
          this.sim.controls.setVirtualInput('elevator', Math.max(0.08, Math.min(0.35, elevatorCmd)));
        }

        if (!this.stageCameraCutDone && !this.director.userCameraOverridden && this.director.stageTimer > 6.0) {
          this.stageCameraCutDone = true;
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        if (tel.altitudeFt > 650 || this.director.stageTimer > 12.0) {
          this.director.setStage(CoastalDemoScenario.STAGES.COASTAL_BANK);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.COASTAL_BANK: {
        const targetHeading = 155.0;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
        const targetBankDeg = Math.max(-20.0, Math.min(20.0, hdgDiff * 0.65));
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.25, Math.min(0.25, aileronCmd)));

        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const targetPitch = 10.0;
        const pitchErr = targetPitch - tel.pitchDeg;
        const elevatorCmd = 0.12 + pitchErr * 0.035 - pitchRateDeg * 0.02;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.15, Math.min(0.25, elevatorCmd)));
        this.sim.controls.setVirtualInput('rudder', Math.max(-0.10, Math.min(0.10, targetBankDeg * 0.005)));

        const sunTime = 7.2 + Math.min(10.0, this.director.stageTimer * 0.8);
        this.director.setTimeOfDay(sunTime);
        if (this.sim.water && this.sim.water.setSunDirection) {
          this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        }

        if (this.director.stageTimer > 11.0) {
          this.director.setStage(CoastalDemoScenario.STAGES.OCEAN_CRUISE);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.OCEAN_CRUISE: {
        const targetAlt = 1200;
        const altErr = targetAlt - tel.altitudeFt;
        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const elevatorCmd = altErr * 0.002 - pitchRateDeg * 0.02;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.15, Math.min(0.20, elevatorCmd)));

        const targetHeading = 155.0;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
        const targetBankDeg = Math.max(-12.0, Math.min(12.0, hdgDiff * 0.5));
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.25, Math.min(0.25, aileronCmd)));
        this.sim.controls.setVirtualInput('rudder', 0.0);
        this.sim.controls.setVirtualInput('throttle', 0.65);

        if (!this.stageCameraCutDone && !this.director.userCameraOverridden && this.director.stageTimer > 5.5) {
          this.stageCameraCutDone = true;
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        if (this.director.stageTimer > 10.5) {
          this.director.setStage(CoastalDemoScenario.STAGES.FINAL_APPROACH);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.FINAL_APPROACH: {
        const elevation = this.sim.currentAirport?.elevation ?? RUNWAY_ELEVATION_M;
        const halfLength = this.sim.currentAirport?.runwayLength ?? 3200;
        const heightAboveRunway = this.sim.position.y - elevation;
        const toTouchdown = Math.max(0, TOUCHDOWN_X_M - this.sim.position.x);
        const alongSpeed = Math.hypot(this.sim.linearVelocity.x, this.sim.linearVelocity.z);

        // Localizer tracking: bank toward the centerline.
        const targetRoll = Math.max(-10.0, Math.min(10.0, -this.sim.position.z * 0.15));
        const rollDiff = targetRoll - tel.rollDeg;
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const aileronCmd = rollDiff * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.20, Math.min(0.20, aileronCmd)));

        // The 3° path is held as a vertical-speed target with a glide-path
        // correction, and the roundout claims the command once the remaining
        // height can no longer absorb the glide-path sink. Approach thrust is
        // retarded through the roundout instead of being carried to the pavement.
        const pathVz = Math.min(1.5,
          -GLIDESLOPE_TAN * alongSpeed
          - GLIDESLOPE_TRACKING_GAIN * (heightAboveRunway - GLIDESLOPE_TAN * toTouchdown));
        const flareVz = -FLARE_SINK_PER_METER * Math.max(0, heightAboveRunway);
        const retard = THREE.MathUtils.clamp(heightAboveRunway / THROTTLE_RETARD_HEIGHT_M, 0, 1);
        flyVerticalPath(this.sim, Math.max(flareVz, pathVz), APPROACH_IAS_KNOTS, tel, 0, null, retard);

        const mainsDown = this.sim.gear.contacts.slice(1).every(c => c.isGrounded);
        if (this.sim.position.x >= -halfLength / 2 && mainsDown) {
          this.director.setStage(CoastalDemoScenario.STAGES.TOUCHDOWN_ROLLOUT);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.TOUCHDOWN_ROLLOUT: {
        const noseDown = !!this.sim.gear.contacts[0].isGrounded;
        // Hold the arrival attitude, then lower the nose at a commanded rate so
        // the nose gear is placed on the runway instead of falling onto it.
        this.rolloutPitchDeg = Math.max(0, this.rolloutPitchDeg - dt * 2.0);
        flyVerticalPath(this.sim, 0, 0, tel, 0, this.rolloutPitchDeg);

        const groundSpeedMs = Math.hypot(this.sim.linearVelocity.x, this.sim.linearVelocity.z);
        const reversing = noseDown && tel.iasKnots > 25;
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', -this.sim.position.z * 0.02);
        if (this.sim.aero) this.sim.aero.spoilers = noseDown ? 1.0 : 0.0;
        this.sim.controls.setVirtualInput('brakes', noseDown ? 1.0 : 0.0);
        if (this.sim.gear) this.sim.gear.setBrakes(noseDown ? 1.0 : 0.0);
        if (this.sim.engines) this.sim.engines.setReverser(reversing, tel.onGround);
        this.sim.controls.setVirtualInput('throttle', reversing ? 1.0 : 0.0);

        if (!this.stageCameraCutDone && !this.director.userCameraOverridden && this.director.stageTimer > 4.5) {
          this.stageCameraCutDone = true;
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        // Timers cannot prove a stop: require every wheel on the pavement and the
        // wheels actually still, held for two seconds.
        const stopped = this.sim.gear.contacts.every(c => c.isGrounded) && groundSpeedMs < 0.5;
        this.stoppedTime = stopped ? this.stoppedTime + dt : 0;
        if (this.stoppedTime >= 2.0 || this.director.stageTimer > 90.0) {
          if (this.sim.engines) this.sim.engines.setReverser(false, true);
          this.sim.controls.setVirtualInput('throttle', 0.0);
          if (this.sim.engines) this.sim.engines.setThrottle(0.0);
          if (this.sim.aero) this.sim.aero.spoilers = 0.0;
          this.director.setStage(CoastalDemoScenario.STAGES.POSTFLIGHT_ORBIT);
        }
        break;
      }

      case CoastalDemoScenario.STAGES.POSTFLIGHT_ORBIT: {
        this.sim.controls.setVirtualInput('brakes', 1.0);
        if (this.sim.gear) this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        if (this.sim.engines) this.sim.engines.setThrottle(0.0);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', 0.0);

        if (this.director.stageTimer >= 7.0) {
          this.director.setStage(CoastalDemoScenario.STAGES.COMPLETED);
        }
        break;
      }
    }
  }
}
