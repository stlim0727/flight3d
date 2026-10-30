import * as THREE from 'three';
import { t } from '../../i18n/index.js';
import { Atmosphere } from '../../physics/Atmosphere.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { F16CanyonChaseScenario, DUDH_KOSI_CANYON_SPLINE_POINTS } from './F16CanyonChaseScenario.js';

const clamp = THREE.MathUtils.clamp;
const STAGES = { IDLE: -1, INGRESS: 50, SLALOM: 51, BREAKOUT: 53, COMPLETED: 54 };

/** A separate terrain-hugging run: bank through the gorge, without scripted rolls. */
export class F16CanyonSlalomScenario extends F16CanyonChaseScenario {
  static STAGES = STAGES;

  constructor(director, sim) {
    super(director, sim);
    const offsets = [0, -100, 120, -100, 120, -120, 120, -100, 120, -100, 100, -80, 0, 0, 0];
    this.curve = new THREE.CatmullRomCurve3(DUDH_KOSI_CANYON_SPLINE_POINTS.map((point, i) => {
      const p = point.clone();
      p.x += offsets[i];
      return p;
    }));
  }

  enterStage(stage) {
    if (stage === STAGES.COMPLETED) {
      this.result.status = 'completed';
      this.result.elapsedSeconds = this.director.totalTimer;
      this.director.stop(() => t('demo.f16.slalom.complete'), false, { preserveThrottle: true });
      return;
    }
    super.enterStage(stage);
    if (stage === STAGES.INGRESS) {
      this.target?.dispose();
      this.target = null;
      Object.assign(this.result, { leftBankPeak: 0, rightBankPeak: 0, lowLevelSeconds: 0 });
      const tangent = this.curve.getTangent(0);
      const speed = 300 * .514444 / Math.sqrt(Atmosphere.getConditions(this.sim.position.y).densityRatio);
      this.sim.linearVelocity.copy(tangent).multiplyScalar(speed);
      this.sim.applyComputedTrim();
    }
    if (stage !== STAGES.COMPLETED) {
      this.director.updateBanner(() => t('demo.f16.slalom.name'), () => t('demo.f16.slalom.briefing'));
    }
  }

  pathPoint(progress) {
    const point = this.curve.getPoint(progress);
    let floor = -Infinity;
    for (const ahead of [0, .004, .008, .012]) {
      const p = this.curve.getPoint(clamp(progress + ahead, 0, 1));
      for (const side of [-12, 0, 12]) {
        floor = Math.max(floor, this.sim.currentTerrain.getHeight(p.x + side, p.z));
      }
    }
    point.y = floor + 40 + 400 * THREE.MathUtils.smoothstep(progress, .8, 1);
    return point;
  }

  update(dt) {
    const sim = this.sim, tel = sim.telemetry;
    const stage = this.director.currentStage;
    if (stage === STAGES.IDLE || stage === STAGES.COMPLETED) return;
    this.totalElapsed += dt;
    const agl = sim.position.y - sim.currentTerrain.getHeight(sim.position.x, sim.position.z);
    this.result.minClearanceM = Math.min(this.result.minClearanceM, agl);
    this.result.maxBankDeg = Math.max(this.result.maxBankDeg, Math.abs(tel.rollDeg));
    this.result.maxG = Math.max(this.result.maxG, tel.gForce ?? 0);
    this.result.leftBankPeak = Math.max(this.result.leftBankPeak, -(tel.rollDeg ?? 0));
    this.result.rightBankPeak = Math.max(this.result.rightBankPeak, tel.rollDeg ?? 0);
    if (agl < 100) this.result.lowLevelSeconds += dt;
    if (!Number.isFinite(agl) || sim.isCrashed || agl < 15 || this.totalElapsed > 180) {
      this.result.status = 'failed';
      this.result.reason = 'Slalom terrain clearance or completion limit';
      this.director.stop(() => t('demo.f16.failed'), false, { preserveThrottle: true });
      return;
    }
    let nearest = this.progress, distance = Infinity;
    for (let p = Math.max(0, this.progress - .015); p <= Math.min(1, this.progress + .08); p += .001) {
      const point = this.curve.getPoint(p);
      const d = (point.x - sim.position.x) ** 2 + (point.z - sim.position.z) ** 2;
      if (d < distance) { distance = d; nearest = p; }
    }
    this.progress = Math.max(this.progress, nearest);
    const lead = clamp(this.progress + .018, 0, 1);
    const target = this.pathPoint(lead), tangent = this.curve.getTangent(lead);
    // Track the actual velocity corridor too: the fighter can lag the river
    // spline during a steep reversal, and the outside wall still has to clear.
    for (const seconds of [0, 1, 2, 3, 4]) {
      for (const side of [-12, 0, 12]) {
        target.y = Math.max(target.y, sim.currentTerrain.getHeight(
          sim.position.x + sim.linearVelocity.x * seconds + side,
          sim.position.z + sim.linearVelocity.z * seconds) + 35);
      }
    }
    const dx = sim.position.x - target.x, dz = sim.position.z - target.z;
    const cross = dx * -tangent.z + dz * tangent.x;
    const heading = Math.atan2(tangent.x, -tangent.z) * 180 / Math.PI - clamp(cross * .18, -35, 35);
    const error = ((heading - tel.headingDeg + 540) % 360) - 180;
    this.flyAttitude(clamp(error * 4, -75, 75), target.y, 300, null, 60);
    sim.controls.setVirtualInput('brakes', 0);
    sim.controls.setVirtualInput('rudder', clamp(-sim.aero.beta * 2, -.2, .2));
    if (!this.director.userCameraOverridden && this.lastCutIndex !== stage) {
      sim.cameraSystem?.setMode(stage === STAGES.INGRESS ? CameraSystem.MODES.COCKPIT : CameraSystem.MODES.CHASE);
      this.lastCutIndex = stage;
    }
    if (stage === STAGES.INGRESS && this.progress > .12) this.director.setStage(STAGES.SLALOM);
    if (stage === STAGES.SLALOM && this.progress > .8) this.director.setStage(STAGES.BREAKOUT);
    if (stage === STAGES.BREAKOUT && this.progress > .98 && agl > 200
      && Math.abs(tel.rollDeg) < 20 && sim.linearVelocity.y >= 0) {
      this.director.setStage(STAGES.COMPLETED);
    }
  }
}
