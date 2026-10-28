import * as THREE from 'three';
import { t } from '../../i18n/index.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { Atmosphere } from '../../physics/Atmosphere.js';
import { TRIM_WHEEL_AUTHORITY } from '../../physics/trimWheel.js';
import { CessnaDemoScenario } from './CessnaDemoScenario.js';

const clamp = THREE.MathUtils.clamp;

export const DUDH_KOSI_CANYON_SPLINE_POINTS = [
  new THREE.Vector3(-450, 2790, 300),    // Cliff ingress
  new THREE.Vector3(-850, 2740, 600),    // Shoulder pass
  new THREE.Vector3(-1250, 2600, 1000),  // Gorge entry
  new THREE.Vector3(-1640, 2330, 1500),  // River valley alignment
  new THREE.Vector3(-1900, 2260, 2100),  // Canyon descent
  new THREE.Vector3(-2420, 2220, 2800),  // S-Turn apex 1
  new THREE.Vector3(-2410, 2420, 3500),  // S-Turn apex 2
  new THREE.Vector3(-2680, 2240, 4200),  // River contour
  new THREE.Vector3(-2830, 2100, 5000),  // Chasm entry
  new THREE.Vector3(-3100, 2040, 5900),  // Narrow gorge
  new THREE.Vector3(-3180, 1960, 6800),  // Deep chasm sprint
  new THREE.Vector3(-3310, 1900, 7700),  // Low canyon run
  new THREE.Vector3(-3500, 2400, 8400),  // Breakout pullup initiation
  new THREE.Vector3(-3750, 3100, 9300),  // High-G vertical zoom climb
  new THREE.Vector3(-3950, 3600, 10500)  // Clear Himalayan summit cruise
];

const STAGES = {
  IDLE: -1,
  INGRESS: 50,
  SLALOM: 51,
  SPRINT: 52,
  BREAKOUT: 53,
  COMPLETED: 54
};

export class CanyonChaseTarget {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'CanyonChaseTargetBandit';

    // Low-poly delta adversary airframe
    const fuseGeo = new THREE.ConeGeometry(1.2, 12, 6);
    fuseGeo.rotateX(Math.PI * 0.5);
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e272e, roughness: 0.3, metalness: 0.8 });
    const fuse = new THREE.Mesh(fuseGeo, darkMat);
    this.group.add(fuse);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 3.5);
    wingShape.lineTo(4.8, -3.5);
    wingShape.lineTo(0, -1.8);
    wingShape.lineTo(-4.8, -3.5);
    wingShape.closePath();
    const wingGeo = new THREE.ShapeGeometry(wingShape);
    wingGeo.rotateX(-Math.PI * 0.5);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xd63031, roughness: 0.4 });
    const wings = new THREE.Mesh(wingGeo, wingMat);
    wings.position.y = 0.05;
    this.group.add(wings);

    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0, 1.8);
    finShape.lineTo(-1.8, 0);
    finShape.closePath();
    const finGeo = new THREE.ShapeGeometry(finShape);
    finGeo.rotateY(Math.PI * 0.5);
    const fin = new THREE.Mesh(finGeo, darkMat);
    fin.position.set(0, 0.3, -2.0);
    this.group.add(fin);

    // Glowing afterburner plume
    const glowGeo = new THREE.SphereGeometry(0.4, 8, 8);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7675 });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(0, 0, -5.5);
    this.group.add(glow);

    if (scene) {
      scene.add(this.group);
    }
  }

  update(pos, quat) {
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
  }

  dispose() {
    if (this.scene) {
      this.scene.remove(this.group);
    }
    this.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }
}

export class F16CanyonChaseScenario extends CessnaDemoScenario {
  static STAGES = STAGES;

  constructor(director, simulator) {
    super(director, simulator);
    this.curve = new THREE.CatmullRomCurve3(DUDH_KOSI_CANYON_SPLINE_POINTS);
    this.totalElapsed = 0;
    this.target = null;
    this.lastCutIndex = -1;
  }

  enterStage(stage) {
    const sim = this.sim;
    if (stage === STAGES.INGRESS) {
      this.result = { status: 'running', minClearanceM: Infinity, maxBankDeg: 0, maxG: 0, rollTravelDeg: 0, invertedSeconds: 0 };
      this.totalElapsed = 0;
      this.progress = 0;
      this.rollTravel = 0;
      this.lastRoll = 0;
      this.lastCutIndex = -1;

      sim.setPreset('cruise', true);

      // Start at initial waypoint
      const p0 = this.pathPoint(0);
      const tan0 = this.curve.getTangent(0);
      const heading0 = (Math.atan2(tan0.x, -tan0.z) * 180 / Math.PI + 360) % 360;

      sim.position.copy(p0);
      const density = Atmosphere.getConditions(p0.y).densityRatio;
      const speed = 420 * 0.514444 / Math.sqrt(density);
      sim.linearVelocity.copy(tan0).multiplyScalar(speed);
      sim.angularVelocity.set(0, 0, 0);
      sim.quaternion.setFromEuler(new THREE.Euler(0, -heading0 * Math.PI / 180, 0, 'YXZ'));

      sim.aero.setFlapPosition(0);
      sim.aero.currentFlapAngle = 0;
      sim.aero.spoilers = 0;
      sim.gear.setGearTarget(false);
      sim.gear.gearState = 0;
      sim.applyComputedTrim();

      // Full military throttle
      sim.controls.throttle = 1.0;
      sim.engines.setThrottle(1.0);
      sim.engines.n1.fill(sim.engines.togaN1);

      sim.aircraft.group.position.copy(sim.position);
      sim.aircraft.group.quaternion.copy(sim.quaternion);
      sim.renderPose?.reset(sim.position, sim.quaternion);

      // Create bandit adversary target
      this.target?.dispose();
      this.target = new CanyonChaseTarget(sim.scene);
    }

    this.lastCutIndex = -1;
    const key = ({
      [STAGES.INGRESS]: 'ingress',
      [STAGES.SLALOM]: 'slalom',
      [STAGES.SPRINT]: 'sprint',
      [STAGES.BREAKOUT]: 'breakout'
    })[stage];

    if (key) {
      this.director.updateBanner(
        () => t(`demo.f16.chase.stage.${key}`),
        () => t(`demo.f16.chase.desc.${key}`)
      );
    }

    if (stage === STAGES.COMPLETED) {
      this.result.status = 'completed';
      this.result.elapsedSeconds = this.director.totalTimer;
      this.target?.dispose();
      this.target = null;
      this.director.stop(() => t('demo.f16.chase.complete'), false, { preserveThrottle: true });
    }
  }

  update(dt) {
    const sim = this.sim, tel = sim.telemetry;
    const stage = this.director.currentStage, time = this.director.stageTimer;
    if (stage === STAGES.IDLE || stage === STAGES.COMPLETED) return;

    this.totalElapsed += dt;
    const clearance = sim.position.y - sim.currentTerrain.getHeight(sim.position.x, sim.position.z);
    this.result.minClearanceM = Math.min(this.result.minClearanceM, clearance);
    this.result.maxBankDeg = Math.max(this.result.maxBankDeg, Math.abs(tel.rollDeg));

    if (time > 90 || clearance < 15 || sim.isCrashed || !Number.isFinite(clearance)) {
      this.result.status = 'failed';
      this.target?.dispose();
      this.target = null;
      this.director.stop(() => t('demo.f16.failed'), false, { preserveThrottle: true });
      return;
    }

    // Locate the aircraft on the corridor; the bandit cannot drag guidance
    // ahead just because the aircraft lost speed in a turn.
    let nearest = this.progress, distance = Infinity;
    for (let p = Math.max(0, this.progress - 0.015); p <= Math.min(1, this.progress + 0.08); p += 0.001) {
      const point = this.curve.getPoint(p);
      const d = (point.x - sim.position.x) ** 2 + (point.z - sim.position.z) ** 2;
      if (d < distance) { distance = d; nearest = p; }
    }
    this.progress = Math.max(this.progress, nearest);
    const progress = clamp(this.progress + 0.025, 0, 1);
    const targetPos = this.pathPoint(progress);
    const tangent = this.curve.getTangent(progress);

    // Update target bandit aircraft leading ahead by ~0.03 progress (~300m)
    if (this.target) {
      const leadP = clamp(progress + 0.03, 0, 1);
      const leadPos = this.pathPoint(leadP);
      const leadTan = this.curve.getTangent(leadP);
      const leadHdg = (Math.atan2(leadTan.x, -leadTan.z) * 180 / Math.PI + 360) % 360;

      // Bandit banks into turns along spline curvature
      const leadTanAhead = this.curve.getTangent(clamp(leadP + 0.015, 0, 1));
      const dh = Math.atan2(leadTanAhead.x, -leadTanAhead.z) - Math.atan2(leadTan.x, -leadTan.z);
      const leadBank = clamp(dh * 300, -Math.PI * 0.42, Math.PI * 0.42);

      const targetEuler = new THREE.Euler(0, -leadHdg * Math.PI / 180, leadBank, 'YXZ');
      const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
      this.target.update(leadPos, targetQuat);
    }

    // Steering guidance toward spline target corridor
    const dx = sim.position.x - targetPos.x;
    const dz = sim.position.z - targetPos.z;
    const cross = dx * -tangent.z + dz * tangent.x; // lateral cross-track error

    const pathHeading = (Math.atan2(tangent.x, -tangent.z) * 180 / Math.PI + 360) % 360;
    const correctionHdg = clamp(-cross * 0.15, -25, 25);
    const targetHeading = pathHeading + correctionHdg;

    const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
    let bankCmd = clamp(hdgDiff * 3, -78, 78);
    let load = null;
    // A climbing barrel, followed by a half roll over the shoulder. Commands
    // act on the physical airframe; neither pose nor velocity is animated.
    if (stage === STAGES.SPRINT) {
      const phase = clamp(time / 9, 0, 1);
      bankCmd = phase * 360;
      load = 1.5;
    }
    if (stage === STAGES.BREAKOUT) {
      if (time < 4) { bankCmd = 180; load = -0.6; }
      else if (time < 7) { bankCmd = 360; load = 1; }
      else if (time < 8.2) { bankCmd = 360; load = 8; }
      else { bankCmd = 360; load = null; }
    }
    this.flyAttitude(bankCmd, targetPos.y, stage === STAGES.BREAKOUT ? 440 : 420, load);
    sim.controls.setVirtualInput('brakes', 0);
    sim.controls.setVirtualInput('rudder', clamp(-sim.aero.beta * 2, -0.2, 0.2));
    this.result.maxG = Math.max(this.result.maxG, tel.gForce ?? sim.aero.gForce);
    const rollDelta = ((tel.rollDeg - this.lastRoll + 540) % 360) - 180;
    this.rollTravel += Math.abs(rollDelta);
    this.lastRoll = tel.rollDeg;
    this.result.rollTravelDeg = this.rollTravel;
    if (Math.abs(tel.rollDeg) > 150) this.result.invertedSeconds += dt;

    // Camera transitions every ~9 seconds
    if (!this.director.userCameraOverridden) {
      const shot = Math.floor(this.totalElapsed / 9) % 3;
      if (shot !== this.lastCutIndex) {
        const modes = [CameraSystem.MODES.CHASE, CameraSystem.MODES.COCKPIT, CameraSystem.MODES.FLYBY];
        sim.cameraSystem?.setMode(stage === STAGES.SPRINT || stage === STAGES.BREAKOUT
          ? CameraSystem.MODES.CHASE : modes[shot]);
        this.lastCutIndex = shot;
      }
    }

    if (stage === STAGES.INGRESS && this.progress >= 0.22) {
      this.director.setStage(STAGES.SLALOM);
    } else if (stage === STAGES.SLALOM && this.progress >= 0.48) {
      this.director.setStage(STAGES.SPRINT);
    } else if (stage === STAGES.SPRINT && time >= 10 && Math.abs(tel.rollDeg) < 20) {
      this.director.setStage(STAGES.BREAKOUT);
    } else if (stage === STAGES.BREAKOUT && time >= 10 && Math.abs(tel.rollDeg) < 15 && Math.abs(tel.pitchDeg) < 15) {
      this.director.setStage(STAGES.COMPLETED);
    }
  }

  pathPoint(progress) {
    const point = this.curve.getPoint(progress);
    // Sample wingspan and look ahead so low-level guidance follows the loaded
    // DEM rather than assuming the authored river heights match every tile.
    let floor = -Infinity;
    for (let ahead = 0; ahead <= 0.025; ahead += 0.005) {
      const p = this.curve.getPoint(clamp(progress + ahead, 0, 1));
      for (const side of [-20, 0, 20]) {
        floor = Math.max(floor, this.sim.currentTerrain.getHeight(p.x + side, p.z));
      }
    }
    point.y = floor + 100 + 550 * THREE.MathUtils.smoothstep(progress, 0.38, 0.50);
    return point;
  }

  flyAttitude(bankDeg, altitude, speed, load) {
    const sim = this.sim, aero = sim.aero, tel = sim.telemetry;
    // FlightControls attenuates virtual stick input at high indicated speed.
    // Invert that mapping when requesting a physical surface deflection.
    const stiffness = Math.max(0.40, 1 - Math.max(0, (tel.iasKnots - 140) / 220) * 0.55);
    const bankError = ((bankDeg - tel.rollDeg + 540) % 360) - 180;
    const rollRate = -clamp(bankError * Math.PI / 180 * 2, -1.2, 1.2);
    const qSb = Math.max(1, aero.qDyn * aero.wingArea * aero.wingspan);
    const pHat = sim.angularVelocity.z * aero.wingspan / (2 * Math.max(10, aero.tas));
    const cl = -aero.Ixx * (rollRate - sim.angularVelocity.z) * 5 / qSb;
    sim.controls.setVirtualInput('aileron', clamp((cl - aero.Cl_b * aero.beta - Math.abs(aero.Cl_p) * pHat) /
      (aero.Cl_da * 1.05 * Math.PI / 9 * stiffness), -1, 1));
    const cosBank = Math.cos(tel.rollDeg * Math.PI / 180);
    const vz = clamp((altitude - sim.position.y) * 0.5, -30, 65);
    const normalG = load ?? clamp((1 + (vz - sim.linearVelocity.y) * 0.15) / Math.max(0.13, cosBank), -1, 8);
    const desiredCl = normalG * aero.mass * 9.80665 / Math.max(1, aero.qDyn * aero.wingArea);
    const alpha = clamp((desiredCl - aero.CL0_clean) / aero.CLa, -0.10, 0.40);
    const rate = (alpha - aero.alpha) * 3 + 9.80665 * (normalG - cosBank) / Math.max(40, aero.tas);
    const qSc = Math.max(1, aero.qDyn * aero.wingArea * aero.meanChord);
    const thrustMoment = sim.engines.thrust.reduce((sum, thrust) => sum + thrust, 0) * aero.thrustPitchArmM;
    const cm = (aero.Iyy * (rate - sim.angularVelocity.x) * 4 - thrustMoment) / qSc;
    const qHat = sim.angularVelocity.x * aero.meanChord / (2 * Math.max(10, aero.tas));
    const elevator = ((cm - aero.Cm0 - aero.Cma * aero.alpha - aero.Cmq * qHat) / -aero.Cm_de
      - THREE.MathUtils.degToRad(aero.pitchTrim) * TRIM_WHEEL_AUTHORITY) / (Math.PI / 9);
    sim.controls.setVirtualInput('elevator', clamp(elevator / stiffness, -1, 1));
    sim.controls.setVirtualInput('throttle', clamp(0.65 + (speed - tel.iasKnots) * 0.03 + vz * 0.02, 0.1, 1));
  }

  stop() {
    super.stop();
    this.target?.dispose();
    this.target = null;
  }
}
