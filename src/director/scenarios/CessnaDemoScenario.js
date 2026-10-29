import * as THREE from 'three';
import { t } from '../../i18n/index.js';
import { Atmosphere } from '../../physics/Atmosphere.js';
import { TRIM_WHEEL_AUTHORITY } from '../../physics/trimWheel.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { flyBank, alphaGuarded } from '../PilotControlLaws.js';
import { cityRoute, canyonRoute } from './cessnaRoutes.js';

const clamp = THREE.MathUtils.clamp;
const STAGES = { IDLE: -1, ESTABLISH: 20, LOW_PASS: 21, CLIMB: 22, LEFT_TURN: 23, RIGHT_TURN: 24, WINGOVER: 25, RECOVER: 26, COMPLETED: 27 };

/** Airborne scenic demos: one initial spawn, then only physical control inputs. */
export class CessnaDemoScenario {
  static STAGES = STAGES;

  constructor(director, simulator) {
    this.director = director;
    this.sim = simulator;
    this.result = { status: 'idle' };
  }

  enterStage(stage) {
    const sim = this.sim;
    if (stage === STAGES.ESTABLISH) {
      this.result = { status: 'running', minClearanceM: Infinity, maxBankDeg: 0 };
      // Reset damage, fuel, control histories and timing through the normal preset lifecycle.
      sim.setPreset('cruise', true);
      this.route = this.director.activeDemoAirport === 'lukla'
        ? canyonRoute(sim.currentTerrain) : cityRoute(sim.currentTerrain, sim.foliage.buildingData);
      const { start, direction, altitude } = this.route;
      this.heading = Math.atan2(direction.x, -direction.z) * 180 / Math.PI;
      this.maneuvers = this.director.profile === 'maneuvers';
      this.baseAltitude = altitude + (this.maneuvers ? 400 : 0);
      sim.position.set(start.x, this.baseAltitude, start.z);
      const density = Atmosphere.getConditions(sim.position.y).densityRatio;
      const speed = 90 * 0.514444 / Math.sqrt(density);
      sim.linearVelocity.set(direction.x * speed, 0, direction.z * speed);
      sim.angularVelocity.set(0, 0, 0);
      sim.quaternion.setFromEuler(new THREE.Euler(0, -this.heading * Math.PI / 180, 0, 'YXZ'));
      sim.aero.setFlapPosition(0);
      sim.aero.currentFlapAngle = 0;
      sim.aero.spoilers = 0;
      sim.gear.setGearTarget(true);
      sim.gear.gearState = 1;
      sim.applyComputedTrim();
      // Start the physical engine in the solved airborne trim, not at runway idle.
      const n1 = sim.engines.idleN1 + sim.controls.throttle * (sim.engines.togaN1 - sim.engines.idleN1);
      sim.engines.n1.fill(n1);
      sim.aircraft.group.position.copy(sim.position);
      sim.aircraft.group.quaternion.copy(sim.quaternion);
      sim.renderPose?.reset(sim.position, sim.quaternion);
      this.cutIndex = -1;
    }

    if (stage === STAGES.CLIMB) this.climbAltitude = this.sim.position.y + 170;
    if (stage === STAGES.LEFT_TURN || stage === STAGES.RIGHT_TURN || stage === STAGES.WINGOVER) {
      this.maneuverAltitude = this.sim.position.y;
    }
    if (stage === STAGES.RECOVER) {
      this.recoveryAltitude = this.sim.position.y;
      this.recoveryHeading = this.sim.telemetry.headingDeg;
    }
    const key = ({ [STAGES.ESTABLISH]: 'establish', [STAGES.LOW_PASS]: 'pass', [STAGES.CLIMB]: 'climb',
      [STAGES.LEFT_TURN]: 'left', [STAGES.RIGHT_TURN]: 'right', [STAGES.WINGOVER]: 'wingover', [STAGES.RECOVER]: 'recover' })[stage];
    if (key) {
      const steps = this.maneuvers ? ['establish', 'left', 'right', 'wingover', 'recover'] : ['establish', 'pass', 'climb', 'recover'];
      const progress = `[${steps.indexOf(key) + 1}/${steps.length}]`;
      this.director.updateBanner(() => t(`demo.c172.stage.${key}`, { progress }), () => t(`demo.c172.desc.${key}`));
      this.cutIndex = -1;
    }
    if (stage === STAGES.COMPLETED) {
      this.result.status = 'completed';
      this.result.elapsedSeconds = this.director.totalTimer;
      this.director.stop(() => t('demo.c172.complete'), false, { preserveThrottle: true });
    }
  }

  camera() {
    const director = this.director;
    const stage = director.currentStage;
    // Long shots give the viewer time to read the flight. A pilot-selected view
    // (including mouse look) is retained throughout the remaining demo.
    const shots = stage === STAGES.LOW_PASS ? [CameraSystem.MODES.COCKPIT, CameraSystem.MODES.CHASE, CameraSystem.MODES.FLYBY]
      : stage === STAGES.WINGOVER || stage === STAGES.LEFT_TURN || stage === STAGES.RIGHT_TURN
        ? [CameraSystem.MODES.CHASE, CameraSystem.MODES.FLYBY]
        : [CameraSystem.MODES.CHASE, CameraSystem.MODES.DRONE];
    const index = Math.min(shots.length - 1, Math.floor(director.stageTimer / 10));
    if (director.userCameraOverridden || index === this.cutIndex) return;
    let mode = shots[index];
    if (mode === CameraSystem.MODES.COCKPIT && !this.sim.aircraft.modelLoaded) mode = CameraSystem.MODES.CHASE;
    if (this.sim.cameraSystem.setMode(mode) !== false) {
      this.cutIndex = index;
      if (mode === CameraSystem.MODES.DRONE) this.sim.cameraSystem.resetDroneOrbit?.(1.5, 23, 7);
    }
  }

  holdHeading(heading, maxBank = 25) {
    const tel = this.sim.telemetry;
    const difference = ((heading - tel.headingDeg + 540) % 360) - 180;
    flyBank(this.sim, clamp(difference * 1.2, -maxBank, maxBank), tel);
  }

  update(dt) {
    const sim = this.sim, tel = sim.telemetry;
    const stage = this.director.currentStage, time = this.director.stageTimer;
    this.camera();
    const clearance = sim.position.y - sim.currentTerrain.getHeight(sim.position.x, sim.position.z);
    this.result.minClearanceM = Math.min(this.result.minClearanceM, clearance);
    this.result.maxBankDeg = Math.max(this.result.maxBankDeg, Math.abs(tel.rollDeg));
    sim.controls.setVirtualInput('brakes', 0);
    sim.controls.setVirtualInput('rudder', clamp(-sim.aero.beta * 2, -0.2, 0.2));
    let altitude = this.baseAltitude, targetVz = 0, speed = 90;

    if (stage === STAGES.ESTABLISH || stage === STAGES.LOW_PASS) {
      const { start, direction, length } = this.route;
      const dx = sim.position.x - start.x, dz = sim.position.z - start.z;
      const cross = dx * -direction.z + dz * direction.x;
      const along = dx * direction.x + dz * direction.z;
      this.holdHeading(this.heading - Math.atan2(cross, 250) * 180 / Math.PI, 20);
      if (stage === STAGES.ESTABLISH && time >= 7) this.director.setStage(this.maneuvers ? STAGES.LEFT_TURN : STAGES.LOW_PASS);
      if (stage === STAGES.LOW_PASS && along >= length) this.director.setStage(STAGES.CLIMB);
    } else if (stage === STAGES.CLIMB) {
      altitude = this.climbAltitude;
      this.holdHeading(this.director.activeDemoAirport === 'lukla' ? this.heading - 180 : this.heading, 35);
      speed = 85;
      if (time >= 30) this.director.setStage(STAGES.RECOVER);
    } else if (stage === STAGES.LEFT_TURN || stage === STAGES.RIGHT_TURN) {
      altitude = this.maneuverAltitude;
      flyBank(sim, stage === STAGES.LEFT_TURN ? -40 : 40, tel);
      speed = 95;
      if (time >= 16) this.director.setStage(stage === STAGES.LEFT_TURN ? STAGES.RIGHT_TURN : STAGES.WINGOVER);
    } else if (stage === STAGES.WINGOVER) {
      // A smooth climbing turn followed by a descending recovery; no forced pose,
      // no inverted-flight assumptions in the general-aviation flight model.
      const phase = clamp(time / 24, 0, 1);
      const bank = 50 * Math.sin(phase * Math.PI);
      flyBank(sim, bank, tel);
      altitude = this.maneuverAltitude + 45 * Math.sin(phase * Math.PI);
      targetVz = 45 * Math.PI / 24 * Math.cos(phase * Math.PI);
      speed = 95;
      if (time >= 24) this.director.setStage(STAGES.RECOVER);
    } else if (stage === STAGES.RECOVER) {
      altitude = this.recoveryAltitude;
      this.holdHeading(this.recoveryHeading, 15);
      if (time >= 12) this.director.setStage(STAGES.COMPLETED);
    }
    if (!this.director.isActive) return;
    // Look ahead along actual velocity, across a wingspan-wide corridor. This
    // remains a physical climb command; collision detection stays enabled.
    let terrainAhead = -Infinity;
    const heading = tel.headingDeg * Math.PI / 180;
    for (const seconds of [0, 2, 4, 6]) {
      for (const side of [-25, 0, 25]) {
        terrainAhead = Math.max(terrainAhead, sim.currentTerrain.getHeight(
          sim.position.x + sim.linearVelocity.x * seconds + Math.cos(heading) * side,
          sim.position.z + sim.linearVelocity.z * seconds + Math.sin(heading) * side));
      }
    }
    altitude = Math.max(altitude, terrainAhead + 55);
    const vz = clamp(targetVz + (altitude - sim.position.y) * 0.22, -3.5, 4);
    this.flyVertical(vz, speed);
    if (time > 120 || !Number.isFinite(vz)) {
      this.result.status = 'failed';
      this.director.stop(() => t('demo.c172.failed'), false, { preserveThrottle: true });
    }
  }

  flyVertical(targetVz, targetIas) {
    const sim = this.sim, aero = sim.aero;
    const bank = THREE.MathUtils.degToRad(sim.telemetry.rollDeg);
    const cosBank = Math.max(0.4, Math.cos(bank));
    const acceleration = clamp((targetVz - sim.linearVelocity.y) * 0.8, -3, 4);
    const requiredCl = aero.mass * (9.80665 + acceleration) / Math.max(1, aero.qDyn * aero.wingArea * cosBank);
    const alpha = clamp((requiredCl - aero.CL0_clean) / aero.CLa, 0.005, THREE.MathUtils.degToRad(11));
    // Control measured angle of attack directly. The coordinated-turn pitch
    // rate supplies the normal acceleration as the horizon rotates in a bank.
    const turnPitchRate = 9.80665 * Math.sin(bank) ** 2 / (Math.max(25, aero.tas) * cosBank);
    const q = sim.angularVelocity.x;
    const desiredRate = (alpha - aero.alpha) * 2.5 + turnPitchRate;
    const desiredAcceleration = (desiredRate - q) * 3;
    const qSc = Math.max(1, aero.qDyn * aero.wingArea * aero.meanChord);
    const thrustMoment = sim.engines.thrust.reduce((sum, thrust) => sum + thrust, 0) * aero.thrustPitchArmM;
    const requiredCm = (aero.Iyy * desiredAcceleration - thrustMoment) / qSc;
    const qHat = q * aero.meanChord / (2 * Math.max(10, aero.tas));
    const effectiveElevator = (requiredCm - aero.Cm0 - aero.Cma * aero.alpha - aero.Cmq * qHat) / -aero.Cm_de;
    const elevator = (effectiveElevator - THREE.MathUtils.degToRad(aero.pitchTrim) * TRIM_WHEEL_AUTHORITY) / THREE.MathUtils.degToRad(20);
    sim.controls.setVirtualInput('elevator', alphaGuarded(clamp(elevator, -0.8, 0.8), THREE.MathUtils.radToDeg(aero.alpha)));
    sim.controls.setVirtualInput('throttle', clamp(0.55 + (targetIas - sim.telemetry.iasKnots) * 0.04 + targetVz * 0.035, 0.05, 1));
  }

  recordFailure(crash) {
    this.result.status = 'failed';
    this.result.reason = crash.description || crash.type;
  }

  stop() {
    if (['pending', 'running'].includes(this.result.status)) this.result.status = 'cancelled';
  }
}
