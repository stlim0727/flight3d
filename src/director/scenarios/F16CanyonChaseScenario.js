import * as THREE from 'three';
import { t } from '../../i18n/index.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { Atmosphere } from '../../physics/Atmosphere.js';
import { flyBank } from '../PilotControlLaws.js';
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

const STAGE_DURATIONS = {
  [STAGES.INGRESS]: 12.0,
  [STAGES.SLALOM]: 16.0,
  [STAGES.SPRINT]: 16.0,
  [STAGES.BREAKOUT]: 11.0
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
    this.totalDuration = 55.0;
    this.totalElapsed = 0;
    this.target = null;
    this.lastCutIndex = -1;
  }

  enterStage(stage) {
    const sim = this.sim;
    if (stage === STAGES.INGRESS) {
      this.result = { status: 'running', minClearanceM: Infinity, maxBankDeg: 0 };
      this.totalElapsed = 0;
      this.lastCutIndex = -1;

      sim.setPreset('cruise', true);

      // Start at initial waypoint
      const p0 = this.curve.getPoint(0);
      const tan0 = this.curve.getTangent(0);
      const heading0 = (Math.atan2(tan0.x, -tan0.z) * 180 / Math.PI + 360) % 360;

      sim.position.copy(p0);
      const density = Atmosphere.getConditions(p0.y).densityRatio;
      const speed = 260 * 0.514444 / Math.sqrt(density);
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

    // Spline progress based on total elapsed time
    const progress = clamp(this.totalElapsed / this.totalDuration, 0, 1);
    const targetPos = this.curve.getPoint(progress);
    const tangent = this.curve.getTangent(progress);

    // Update target bandit aircraft leading ahead by ~0.03 progress (~300m)
    if (this.target) {
      const leadP = clamp(progress + 0.03, 0, 1);
      const leadPos = this.curve.getPoint(leadP);
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

    // Banking control
    const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
    const bankCmd = clamp(hdgDiff * 1.5, -60, 60);
    flyBank(sim, bankCmd, tel);

    // Altitude guidance
    sim.controls.setVirtualInput('brakes', 0);
    sim.controls.setVirtualInput('rudder', clamp(-sim.aero.beta * 2, -0.2, 0.2));

    const altitudeError = targetPos.y - sim.position.y;
    const vzCmd = clamp(altitudeError * 0.35 + tangent.y * 180, -25, 45);
    const targetSpeedKts = stage === STAGES.BREAKOUT ? 380 : 320;
    this.flyVertical(vzCmd, targetSpeedKts);

    // Camera transitions every ~9 seconds
    if (!this.director.userCameraOverridden) {
      const shot = Math.floor(this.totalElapsed / 9) % 3;
      if (shot !== this.lastCutIndex) {
        const modes = [CameraSystem.MODES.CHASE, CameraSystem.MODES.COCKPIT, CameraSystem.MODES.FLYBY];
        sim.cameraSystem?.setMode(modes[shot]);
        this.lastCutIndex = shot;
      }
    }

    // Stage transitions
    if (stage === STAGES.INGRESS && time >= STAGE_DURATIONS[STAGES.INGRESS]) {
      this.director.setStage(STAGES.SLALOM);
    } else if (stage === STAGES.SLALOM && time >= STAGE_DURATIONS[STAGES.SLALOM]) {
      this.director.setStage(STAGES.SPRINT);
    } else if (stage === STAGES.SPRINT && time >= STAGE_DURATIONS[STAGES.SPRINT]) {
      this.director.setStage(STAGES.BREAKOUT);
    } else if (stage === STAGES.BREAKOUT && time >= STAGE_DURATIONS[STAGES.BREAKOUT]) {
      this.director.setStage(STAGES.COMPLETED);
    }

    if (this.director.isActive && (time > 90 || !Number.isFinite(clearance))) {
      this.result.status = 'failed';
      this.target?.dispose();
      this.target = null;
      this.director.stop(() => t('demo.f16.failed'), false, { preserveThrottle: true });
    }
  }

  stop() {
    super.stop();
    this.target?.dispose();
    this.target = null;
  }
}
