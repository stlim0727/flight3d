import * as THREE from 'three';
import { t } from '../../i18n/index.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { Atmosphere } from '../../physics/Atmosphere.js';
import { flyBank } from '../PilotControlLaws.js';
import { TRIM_WHEEL_AUTHORITY } from '../../physics/trimWheel.js';
import { CessnaDemoScenario } from './CessnaDemoScenario.js';

const STAGES = { ESTABLISH: 40, LOW_PASS: 41, CLIMB: 42, RETURN: 44, FINAL: 45, ROLLOUT: 46, COMPLETED: 43 };
const clamp = THREE.MathUtils.clamp;
const SIN = 0.848048, COS = 0.529919;

export function f16FinalCrossTrack(along, entryAlong = -7500, alignedAlong = -3500) {
  const length = alignedAlong - entryAlong;
  const phase = clamp((along - entryAlong) / length, 0, 1);
  return { cross: 1500 * (1 + Math.cos(Math.PI * phase)),
    slope: phase > 0 && phase < 1 ? -1500 * Math.PI / length * Math.sin(Math.PI * phase) : 0 };
}

/** One airborne spawn, followed by normal flight controls and collision physics. */
export class F16LuklaScenario extends CessnaDemoScenario {
  static STAGES = STAGES;

  enterStage(stage) {
    const sim = this.sim;
    if (stage === STAGES.ESTABLISH) {
      this.result = { status: 'running', minClearanceM: Infinity, minPassClearanceM: Infinity, maxBankDeg: 0, touchdown: null };
      this.stopHold = 0;
      sim.setPreset('cruise', true);
      this.heading = 238;
      this.direction = new THREE.Vector3(-0.848048, 0, 0.529919).normalize();
      // Start over the upper runway, not beyond its downhill end. Keep the
      // pass close to the pavement instead of clearing the distant valley.
      this.start = this.direction.clone().multiplyScalar(-200);
      this.baseAltitude = sim.currentTerrain.getHeight(this.start.x, this.start.z) + 45;
      sim.position.set(this.start.x, this.baseAltitude, this.start.z);
      const speed = 280 * 0.514444 / Math.sqrt(Atmosphere.getConditions(this.baseAltitude).densityRatio);
      sim.linearVelocity.copy(this.direction).multiplyScalar(speed);
      sim.angularVelocity.set(0, 0, 0);
      sim.quaternion.setFromEuler(new THREE.Euler(0, -this.heading * Math.PI / 180, 0, 'YXZ'));
      sim.aero.setFlapPosition(0);
      sim.aero.currentFlapAngle = 0;
      sim.aero.spoilers = 0;
      sim.gear.setGearTarget(false);
      sim.gear.gearState = 0;
      sim.applyComputedTrim();
      sim.engines.n1.fill(sim.engines.idleN1 + sim.controls.throttle * (sim.engines.togaN1 - sim.engines.idleN1));
      sim.aircraft.group.position.copy(sim.position);
      sim.aircraft.group.quaternion.copy(sim.quaternion);
      sim.renderPose?.reset(sim.position, sim.quaternion);
    }
    if (stage === STAGES.RETURN) {
      this.returnPhase = 'decelerate';
      sim.aero.setFlapPosition(1);
    }
    if (stage === STAGES.FINAL) {
      sim.aero.spoilers = 0;
      this.finalEntryAlong = sim.position.x * SIN - sim.position.z * COS;
      sim.gear.setGearTarget(true);
    }
    if (stage === STAGES.ROLLOUT) {
      this.rolloutPitch = sim.telemetry.pitchDeg;
      this.stopHold = 0;
    }
    const landingCamera = ({ [STAGES.RETURN]: CameraSystem.MODES.CHASE,
      [STAGES.FINAL]: CameraSystem.MODES.COCKPIT, [STAGES.ROLLOUT]: CameraSystem.MODES.CHASE })[stage];
    if (landingCamera !== undefined && !this.director.userCameraOverridden) {
      sim.cameraSystem.setMode(landingCamera);
    }
    this.cutIndex = -1;
    if (stage === STAGES.COMPLETED) {
      this.result.status = 'completed';
      this.result.elapsedSeconds = this.director.totalTimer;
      this.result.stopPosition = sim.position.toArray();
      this.director.stop(() => t('demo.f16.complete'), true);
    } else {
      const key = ({ [STAGES.RETURN]: 'return', [STAGES.FINAL]: 'final', [STAGES.ROLLOUT]: 'rollout' })[stage];
      this.director.updateBanner(() => t(key ? `demo.f16.${key}` : 'demo.f16.stage'), () => t('demo.f16.lukla.briefing'));
    }
  }

  update(dt = 1 / 120) {
    const sim = this.sim, time = this.director.stageTimer, stage = this.director.currentStage;
    const clearance = sim.position.y - sim.currentTerrain.getHeight(sim.position.x, sim.position.z);
    this.result.minClearanceM = Math.min(this.result.minClearanceM, clearance);
    this.result.maxBankDeg = Math.max(this.result.maxBankDeg, Math.abs(sim.telemetry.rollDeg));
    if (![STAGES.FINAL, STAGES.ROLLOUT].includes(stage)) {
      this.result.minPassClearanceM = Math.min(this.result.minPassClearanceM, clearance);
    }
    if ([STAGES.RETURN, STAGES.FINAL, STAGES.ROLLOUT].includes(stage)) {
      this.updateLanding(dt, stage);
      return;
    }
    const dx = sim.position.x - this.start.x, dz = sim.position.z - this.start.z;
    const cross = dx * -this.direction.z + dz * this.direction.x;
    const along = dx * this.direction.x + dz * this.direction.z;

    const climb = stage === STAGES.CLIMB;
    // In climb, smoothly curve southward down the open valley (heading 195°) away from rising western peaks
    const targetHeading = climb
      ? THREE.MathUtils.lerp(this.heading, 195, Math.min(1, time / 6))
      : this.heading - Math.atan2(cross, 1200) * 180 / Math.PI;

    this.holdHeading(targetHeading, climb ? 45 : 20);
    sim.controls.setVirtualInput('brakes', 0);
    sim.controls.setVirtualInput('rudder', THREE.MathUtils.clamp(-sim.aero.beta * 2, -0.2, 0.2));

    const targetAlt = climb ? 3800 : this.baseAltitude;
    const vzCmd = THREE.MathUtils.clamp((targetAlt - sim.position.y) * 0.35, -8, 35);
    const targetSpeed = climb ? 260 : 280;
    if (climb) this.flyLanding(vzCmd, targetSpeed);
    else this.flyVertical(vzCmd, targetSpeed);
    // The fighter's idle thrust and rapid spool-up need less feed-forward than
    // the Cessna controller: preserve speed margin instead of accelerating into
    // the opposing ridge while the bank is still building.
    sim.controls.setVirtualInput('throttle', THREE.MathUtils.clamp(
      0.10 + (targetSpeed - sim.telemetry.iasKnots) * 0.025 + vzCmd * 0.006, 0, 1));

    if (!this.director.userCameraOverridden) {
      const shot = stage === STAGES.LOW_PASS ? CameraSystem.MODES.FLYBY
        : [CameraSystem.MODES.CHASE, CameraSystem.MODES.COCKPIT, CameraSystem.MODES.FLYBY][Math.floor(this.director.totalTimer / 10) % 3];
      if (shot !== this.cutIndex) {
        sim.cameraSystem.setMode(shot);
        this.cutIndex = shot;
      }
    }
    if (stage === STAGES.ESTABLISH && time >= .5) this.director.setStage(STAGES.LOW_PASS);
    else if (stage === STAGES.LOW_PASS && along >= 750) this.director.setStage(STAGES.CLIMB);
    else if (climb && time >= 15 && clearance > 150 && sim.position.y > 3650
      && Math.abs(((195 - sim.telemetry.headingDeg + 540) % 360) - 180) < 8
      && Math.abs(sim.telemetry.rollDeg) < 15 && sim.linearVelocity.y > 0) {
      this.director.setStage(STAGES.RETURN);
    }
    if (this.director.isActive && (time > 90 || !Number.isFinite(clearance))) {
      this.result.status = 'failed';
      this.director.stop(() => t('demo.f16.failed'));
    }
  }

  // The F-16's configured stall AoA is 28°, unlike the Cessna's conservative
  // 11° pilot limit. Landing uses up to 20° through physical elevator commands.
  flyLanding(targetVz, targetIas, groundPitch = null, pathAcceleration = 0, maxPitchDeg = 90) {
    const sim = this.sim, aero = sim.aero, tel = sim.telemetry;
    const bank = THREE.MathUtils.degToRad(tel.rollDeg);
    const acceleration = clamp(pathAcceleration + (targetVz - sim.linearVelocity.y), -3, 4);
    const cl = aero.mass * (9.80665 + acceleration)
      / Math.max(1, aero.qDyn * aero.wingArea * Math.max(.5, Math.cos(bank)));
    const cl0 = aero.CL0_clean + .95 * aero.currentFlapAngle / 40 - .38 * aero.spoilers;
    const alpha = clamp((cl - cl0) / aero.CLa, .01, THREE.MathUtils.degToRad(20));
    const speed = Math.max(25, Math.hypot(sim.linearVelocity.x, sim.linearVelocity.z));
    const pitch = Math.min(THREE.MathUtils.degToRad(maxPitchDeg), groundPitch === null
      ? Math.atan2(sim.linearVelocity.y, speed) + alpha : THREE.MathUtils.degToRad(groundPitch));
    const desiredRate = clamp((pitch - THREE.MathUtils.degToRad(tel.pitchDeg)) * 1.5, -.18, .18);
    const q = sim.angularVelocity.x;
    const qSc = Math.max(1, aero.qDyn * aero.wingArea * aero.meanChord);
    const thrustMoment = sim.engines.thrust.reduce((sum, v) => sum + v, 0) * aero.thrustPitchArmM;
    const gearMoment = groundPitch === null ? 0 : sim.gear.lastMomentBody.x;
    const cm = (aero.Iyy * (desiredRate - q) * 3 - thrustMoment - gearMoment) / qSc;
    const qHat = q * aero.meanChord / (2 * Math.max(10, aero.tas));
    const effective = (cm - aero.Cm0 - aero.Cma * aero.alpha - aero.Cmq * qHat) / -aero.Cm_de;
    const stiffness = Math.max(.4, 1 - Math.max(0, (tel.iasKnots - 140) / 220) * .55);
    const elevator = (effective - THREE.MathUtils.degToRad(aero.pitchTrim) * TRIM_WHEEL_AUTHORITY)
      / (THREE.MathUtils.degToRad(20) * stiffness);
    sim.controls.setVirtualInput('elevator', clamp(elevator, -.8, .8));
    if (groundPitch === null) sim.controls.setVirtualInput('throttle', clamp(
      .1 + (targetIas - tel.iasKnots) * .04 + targetVz * .015, 0, 1));
  }

  updateLanding(dt, stage) {
    const sim = this.sim, tel = sim.telemetry;
    const s = sim.position.x * SIN - sim.position.z * COS;
    const w = sim.position.x * COS + sim.position.z * SIN;
    const vS = sim.linearVelocity.x * SIN - sim.linearVelocity.z * COS;
    const vW = sim.linearVelocity.x * COS + sim.linearVelocity.z * SIN;
    sim.controls.setVirtualInput('brakes', 0);
    sim.controls.setVirtualInput('rudder', clamp(-sim.aero.beta * 2, -.2, .2));
    if (stage === STAGES.RETURN) {
      // A long centerline final crosses a high ridge. Return on the southeast
      // valley side before curving onto the centerline at landing height.
      const bankLimit = 35;
      let heading = 220;
      if (this.returnPhase === 'turn') {
        flyBank(sim, -45, tel);
        if (tel.headingDeg < 35) this.returnPhase = 'intercept';
      } else {
        if (this.returnPhase === 'intercept') {
          heading = 58 - THREE.MathUtils.radToDeg(Math.atan2(w - 3000, 1200));
          this.holdHeading(heading, 30);
        } else this.holdHeading(heading, bankLimit);
      }
      let floor = -Infinity;
      for (const seconds of [0, 3, 6, 9, 12]) for (const side of [-40, 0, 40]) {
        floor = Math.max(floor, sim.currentTerrain.getHeight(sim.position.x + sim.linearVelocity.x * seconds + COS * side,
          sim.position.z + sim.linearVelocity.z * seconds + SIN * side));
      }
      const approaching = this.returnPhase === 'intercept';
      const altitude = Math.max(approaching ? 3100 : 3350, floor + 250);
      const targetIas = approaching ? 130 : 155;
      sim.aero.spoilers = clamp(.1 + (tel.iasKnots - targetIas) * .04, 0, .8);
      this.flyLanding(clamp((altitude - sim.position.y) * .12, -8, 12), targetIas);
      if (this.returnPhase === 'decelerate' && tel.iasKnots < 205 && s < -8000) {
        this.returnPhase = 'turn';
      }
      const headingError = Math.abs(((58 - tel.headingDeg + 540) % 360) - 180);
      if (this.returnPhase === 'intercept' && Math.abs(w - 3000) < 500
        && headingError < 40 && Math.abs(tel.rollDeg) < 30 && s < -4500 && sim.position.y < 3300) {
        this.director.setStage(STAGES.FINAL);
      }
    } else if (stage === STAGES.FINAL) {
      // The shortened valley join must finish before the flare, leaving a
      // straight segment to settle bank, heading and speed before touchdown.
      const lateralPath = f16FinalCrossTrack(s, this.finalEntryAlong, -2500);
      const crossSpeed = lateralPath.slope * vS - (w - lateralPath.cross) * .12;
      const acceleration = (clamp(crossSpeed, -90, 90) - vW) * .8;
      const bankLimit = s > -600 ? 5 : s > -1800 ? 25 : 35;
      const bank = clamp(THREE.MathUtils.radToDeg(Math.atan2(acceleration, 9.80665)), -bankLimit, bankLimit);
      flyBank(sim, bank, tel);
      // Follow a curved path into the uphill runway; the vertical slope at
      // contact is slightly shallower than the pavement's 11.76% grade.
      const touchdownS = -245, flareLength = 900, slope = .09;
      const distance = Math.max(0, touchdownS - s);
      const curvature = (slope + .055) / flareLength;
      const d = Math.min(distance, flareLength);
      const touchdownAlt = 2836 + touchdownS * .1176 + 1.5;
      const curveAlt = touchdownAlt - slope * d + .5 * curvature * d * d;
      let altitude = distance > flareLength ? curveAlt + (distance - flareLength) * .055
        : s > touchdownS ? touchdownAlt + (s - touchdownS) * slope : curveAlt;
      const pathSlope = distance > flareLength ? -.055 : slope - curvature * distance;
      if (distance > 1600) {
        for (const seconds of [0, 2, 4]) {
          altitude = Math.max(altitude, sim.currentTerrain.getHeight(
            sim.position.x + sim.linearVelocity.x * seconds,
            sim.position.z + sim.linearVelocity.z * seconds) + 100);
        }
      }
      const targetIas = 132;
      const speedbrakeBias = THREE.MathUtils.lerp(.1, .25, clamp((distance - 1000) / 1000, 0, 1));
      sim.aero.spoilers = clamp(speedbrakeBias + (tel.iasKnots - targetIas) * .04, 0, 1);
      this.flyLanding(clamp(pathSlope * vS + (altitude - sim.position.y) * .5, -18, 18), targetIas, null,
        distance > 0 && distance < flareLength ? curvature * vS * vS : 0, 18);
      if (tel.onGround && sim.gear.contacts.slice(1).every(c => c.isGrounded)
        && s > -263.5 && s < 220 && Math.abs(w) < 15) {
        this.result.touchdown = { alongRunwayM: s, crossTrackM: w, iasKnots: tel.iasKnots };
        this.director.setStage(STAGES.ROLLOUT);
      }
    } else {
      this.rolloutPitch = Math.max(6.7, this.rolloutPitch - dt * 3);
      this.flyLanding(0, 0, this.rolloutPitch);
      flyBank(sim, 0, tel);
      const heading = 58 - clamp(w * .4, -3, 3);
      const error = ((heading - tel.headingDeg + 540) % 360) - 180;
      sim.controls.setVirtualInput('rudder', clamp(error * .03 + sim.angularVelocity.y * .4, -.15, .15));
      // Build braking on the mains, then use full lift dump and braking once
      // the nose is supported; an immediate full application slams the nose.
      const noseDown = sim.gear.contacts[0].isGrounded;
      sim.aero.spoilers = noseDown ? 1 : .5;
      sim.controls.setVirtualInput('throttle', 0);
      sim.controls.setVirtualInput('brakes', noseDown ? 1 : .6);
      const stopped = this.result.touchdown && tel.onGround && sim.gear.onGround && !sim.gear.failure
        && sim.gear.contacts.every(c => c.isGrounded && c.damageState === 'normal' && c.damage === 0)
        && !sim.landingIncident && sim.linearVelocity.length() < .5
        && Math.abs(w) < 12 && s > -245 && s < 240;
      this.stopHold = stopped ? this.stopHold + dt : 0;
      if (this.stopHold >= 2) this.director.setStage(STAGES.COMPLETED);
    }
    if (this.director.isActive && (this.director.stageTimer > 450 || this.director.totalTimer > 1000 || s > 270)) {
      this.result.status = 'failed';
      this.result.reason = 'Landing guidance timeout or runway overrun';
      this.director.stop(() => t('demo.f16.failed'));
    }
  }
}
