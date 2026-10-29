import * as THREE from 'three';
import { t } from '../../i18n/index.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { Atmosphere } from '../../physics/Atmosphere.js';
import { CessnaDemoScenario } from './CessnaDemoScenario.js';

const STAGES = { ESTABLISH: 40, LOW_PASS: 41, CLIMB: 42, COMPLETED: 43 };

/** One airborne spawn, followed by normal flight controls and collision physics. */
export class F16LuklaScenario extends CessnaDemoScenario {
  static STAGES = STAGES;

  enterStage(stage) {
    const sim = this.sim;
    if (stage === STAGES.ESTABLISH) {
      this.result = { status: 'running', minClearanceM: Infinity, maxBankDeg: 0 };
      sim.setPreset('cruise', true);
      this.heading = 238;
      this.direction = new THREE.Vector3(-0.848048, 0, 0.529919).normalize();
      this.start = this.direction.clone().multiplyScalar(200);
      this.baseAltitude = -Infinity;
      // Sample the low pass, including a wingspan margin.
      for (let along = -200; along <= 4200; along += 40) {
        for (const side of [-50, 0, 50]) {
          this.baseAltitude = Math.max(this.baseAltitude, sim.currentTerrain.getHeight(
            this.start.x + this.direction.x * along - this.direction.z * side,
            this.start.z + this.direction.z * along + this.direction.x * side) + 120);
        }
      }
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
    this.cutIndex = -1;
    if (stage === STAGES.COMPLETED) {
      this.result.status = 'completed';
      this.result.elapsedSeconds = this.director.totalTimer;
      const forwardVec = sim.linearVelocity.clone().setY(0).normalize();
      const speed = 300 * 0.514444 / Math.sqrt(Atmosphere.getConditions(sim.position.y).densityRatio);
      sim.linearVelocity.copy(forwardVec).multiplyScalar(speed);
      sim.angularVelocity.set(0, 0, 0);
      const headingRad = Math.atan2(forwardVec.x, -forwardVec.z);
      sim.quaternion.setFromEuler(new THREE.Euler(0, -headingRad, 0, 'YXZ'));
      sim.renderPose?.reset(sim.position, sim.quaternion);
      sim.aircraft.group.position.copy(sim.position);
      sim.aircraft.group.quaternion.copy(sim.quaternion);
      sim.applyComputedTrim();
      this.director.stop(() => t('demo.f16.complete'), false, { preserveThrottle: true });
    } else {
      this.director.updateBanner(() => t('demo.f16.stage'), () => t('demo.f16.lukla.briefing'));
    }
  }

  update() {
    const sim = this.sim, time = this.director.stageTimer, stage = this.director.currentStage;
    const clearance = sim.position.y - sim.currentTerrain.getHeight(sim.position.x, sim.position.z);
    this.result.minClearanceM = Math.min(this.result.minClearanceM, clearance);
    this.result.maxBankDeg = Math.max(this.result.maxBankDeg, Math.abs(sim.telemetry.rollDeg));
    const dx = sim.position.x - this.start.x, dz = sim.position.z - this.start.z;
    const cross = dx * -this.direction.z + dz * this.direction.x;
    const along = dx * this.direction.x + dz * this.direction.z;

    const climb = stage === STAGES.CLIMB;
    // In climb, smoothly curve southward down the open valley (heading 195°) away from rising western peaks
    const targetHeading = climb
      ? THREE.MathUtils.lerp(this.heading, 195, Math.min(1, time / 6))
      : this.heading - Math.atan2(cross, 1200) * 180 / Math.PI;

    this.holdHeading(targetHeading, climb ? 35 : 20);
    sim.controls.setVirtualInput('brakes', 0);
    sim.controls.setVirtualInput('rudder', THREE.MathUtils.clamp(-sim.aero.beta * 2, -0.2, 0.2));

    const targetAlt = climb ? 4600 : this.baseAltitude;
    const vzCmd = THREE.MathUtils.clamp((targetAlt - sim.position.y) * 0.35, -8, 55);
    const targetSpeed = climb ? 340 : 280;
    this.flyVertical(vzCmd, targetSpeed);

    if (!this.director.userCameraOverridden) {
      const shot = Math.floor(this.director.totalTimer / 10) % 3;
      if (shot !== this.cutIndex) {
        sim.cameraSystem.setMode([CameraSystem.MODES.CHASE, CameraSystem.MODES.COCKPIT, CameraSystem.MODES.FLYBY][shot]);
        this.cutIndex = shot;
      }
    }
    if (stage === STAGES.ESTABLISH && time >= 5) this.director.setStage(STAGES.LOW_PASS);
    else if (stage === STAGES.LOW_PASS && along >= 2600) this.director.setStage(STAGES.CLIMB);
    else if (climb && (time >= 16 || sim.position.y >= 4500)) this.director.setStage(STAGES.COMPLETED);
    if (this.director.isActive && (time > 90 || !Number.isFinite(clearance))) {
      this.result.status = 'failed';
      this.director.stop(() => t('demo.f16.failed'));
    }
  }
}
