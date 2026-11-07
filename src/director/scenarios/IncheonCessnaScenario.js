import * as THREE from 'three';
import { t } from '../../i18n/index.js';
import { CessnaDemoScenario } from './CessnaDemoScenario.js';
import { INCHEON_AIRFIELD } from '../../geospatial/IncheonFlightSurface.js';
import { flyVerticalPath } from '../PilotControlLaws.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';

const clamp = THREE.MathUtils.clamp;
const STAGES = { TAKEOFF: 40, TOUR: 41, CIRCUIT: 42, FINAL: 43, ROLLOUT: 44, COMPLETED: 45 };
const approach = INCHEON_AIRFIELD.approach;
const runwayLength = Math.hypot(approach.end.x - approach.threshold.x, approach.end.z - approach.threshold.z);
const angle = approach.headingDeg * Math.PI / 180;
const forward = { x: Math.sin(angle), z: -Math.cos(angle) };
const right = { x: -forward.z, z: forward.x };

function incheonDemoPoint(along, cross, altitude) {
  return { x: approach.threshold.x + forward.x * along + right.x * cross,
    z: approach.threshold.z + forward.z * along + right.z * cross, altitude };
}

// Airport-frame metres. Broad lead-in turns establish the close-pass corridor
// before the mapped concourse, T1/transport centre and business district.
const INCHEON_DEMO_ROUTE = [
  [1600, 0, 85], [2100, 350, 85], [2400, 1000, 55],
  [3100, 1100, 45, 'concourse'], [4050, 1100, 40, 'terminal'],
  [5150, 1100, 55, 'business'], [5700, 1600, 180],
  [5100, 2300, 200], [1000, 2300, 200], [-1400, 2000, 180],
  [-2300, 1100, 150], [-2200, 0, 125], [-1500, 0, 85],
].map(([along, cross, altitude, landmark]) => ({ ...incheonDemoPoint(along, cross, altitude), along, cross, landmark }));

/** A single runway reset followed exclusively by normal physical pilot inputs. */
export class IncheonCessnaScenario extends CessnaDemoScenario {
  static STAGES = STAGES;

  enterStage(stage) {
    const sim = this.sim;
    if (stage === STAGES.TAKEOFF) {
      sim.setPreset('runway', true);
      this.stopHold = 0;
      sim.aero.setFlapPosition(0);
      sim.aero.currentFlapAngle = 0;
      this.index = 0;
      this.previous = incheonDemoPoint(100, 0, 8);
      this.result = { status: 'running', airborne: false, landmarks: [], touchdown: false };
      this.director.setTimeOfDay(9);
    }
    this.cutIndex = -1;
    const name = ({ 40: 'takeoff', 41: 'tour', 42: 'circuit', 43: 'final', 44: 'rollout' })[stage];
    if (name) {
      this.director.updateBanner(() => t(`demo.incheon.stage.${name}`), () => t(`demo.incheon.desc.${name}`));
      const mode = stage === STAGES.FINAL && sim.aircraft.modelLoaded ? CameraSystem.MODES.COCKPIT
        : stage === STAGES.CIRCUIT ? CameraSystem.MODES.FLYBY : CameraSystem.MODES.CHASE;
      if (!this.director.userCameraOverridden) sim.cameraSystem?.setMode(mode);
    }
    if (stage === STAGES.COMPLETED) {
      this.result.status = 'completed';
      this.result.elapsedSeconds = this.director.totalTimer;
      this.director.stop(() => t('demo.incheon.complete'), true);
    }
  }

  coordinates() {
    const dx = this.sim.position.x - approach.threshold.x, dz = this.sim.position.z - approach.threshold.z;
    return { along: dx * forward.x + dz * forward.z, cross: dx * right.x + dz * right.z };
  }

  follow(target, previous, maxBank = 30) {
    const pos = this.sim.position;
    const dx = target.x - previous.x, dz = target.z - previous.z;
    const length = Math.hypot(dx, dz);
    const along = ((pos.x - previous.x) * dx + (pos.z - previous.z) * dz) / length;
    const look = clamp(along + 230, 0, length);
    const x = previous.x + dx * look / length, z = previous.z + dz * look / length;
    this.holdHeading(Math.atan2(x - pos.x, -(z - pos.z)) * 180 / Math.PI, maxBank);
    return Math.hypot(target.x - pos.x, target.z - pos.z) < 160 || along > length;
  }

  update(dt = 1 / 120) {
    const sim = this.sim, tel = sim.telemetry, director = this.director;
    const stage = director.currentStage;
    const { along, cross } = this.coordinates();
    const ground = INCHEON_AIRFIELD.elevationM;
    const wheelHeight = sim.gear.cgGroundHeightM;
    sim.controls.setVirtualInput('brakes', 0);
    sim.controls.setVirtualInput('rudder', clamp(-sim.aero.beta * 2, -.2, .2));
    if (sim.position.y > ground + 12) this.result.airborne = true;

    if (stage === STAGES.TAKEOFF) {
      this.holdHeading(approach.headingDeg, 5);
      sim.controls.setVirtualInput('throttle', 1);
      if (tel.iasKnots < 55) sim.controls.setVirtualInput('elevator', 0);
      else {
        if (sim.gear.onGround) flyVerticalPath(sim, 3, 78, tel, 0, 9);
        else this.flyVertical(3, 78);
        sim.controls.setVirtualInput('throttle', 1);
      }
      if (this.result.airborne && along > 800) director.setStage(STAGES.TOUR);
    } else if (stage === STAGES.TOUR || stage === STAGES.CIRCUIT) {
      const target = INCHEON_DEMO_ROUTE[this.index];
      const reached = this.follow(target, this.previous);
      // Sample a velocity-aligned corridor; climbs remain force-driven and the
      // regular terrain/building collision system stays enabled throughout.
      let floor = 0;
      for (const seconds of [0, 2, 4, 6]) for (const side of [-15, 0, 15]) {
        floor = Math.max(floor, sim.currentTerrain.getHeight(sim.position.x + sim.linearVelocity.x * seconds + right.x * side,
          sim.position.z + sim.linearVelocity.z * seconds + right.z * side));
      }
      this.flyVertical(clamp((Math.max(target.altitude, floor + (stage === STAGES.TOUR ? 20 : 40)) - sim.position.y) * .18, -3, 4), 85);
      if (reached) {
        if (target.landmark) this.result.landmarks.push(target.landmark);
        this.previous = target;
        this.index++;
        if (this.index === 6) director.setStage(STAGES.CIRCUIT);
        if (this.index === INCHEON_DEMO_ROUTE.length) director.setStage(STAGES.FINAL);
      }
    } else if (stage === STAGES.FINAL) {
      this.holdHeading(approach.headingDeg - Math.atan2(cross, 250) * 180 / Math.PI, 20);
      const height = sim.position.y - ground - wheelHeight;
      const glideHeight = Math.max(0, -along * Math.tan(3 * Math.PI / 180));
      const vz = height < 7 ? clamp(-height * .22, -.8, -.18)
        : clamp((glideHeight - height) * .35 - 1.7, -3, -.5);
      this.flyVertical(vz, height < 10 ? 60 : 68);
      if (height < 7) sim.controls.setVirtualInput('throttle', 0);
      if (this.result.airborne && sim.gear.contacts.slice(1).some(c => c.isGrounded)) {
        this.result.touchdown = true;
        this.result.touchdownAlong = along;
        this.result.touchdownCross = cross;
        director.setStage(STAGES.ROLLOUT);
      }
      if (along > 2500) this.fail('Runway overrun before touchdown');
    } else if (stage === STAGES.ROLLOUT) {
      this.holdHeading(approach.headingDeg - cross * .5, 5);
      sim.controls.setVirtualInput('throttle', 0);
      sim.controls.setVirtualInput('elevator', 0);
      sim.controls.setVirtualInput('brakes', sim.gear.contacts[0].isGrounded ? 1 : 0);
      // Incheon's pavement query also accepts taxiways and aprons; require
      // this runway's along/cross envelope before declaring a landing complete.
      const stopped = along >= 0 && along <= runwayLength && Math.abs(cross) < 25
        && sim.linearVelocity.length() < .5 && sim.gear.contacts.every(c => c.isGrounded)
        && sim.currentAirport.isOnRunway(sim.position.x, sim.position.z);
      this.stopHold = stopped ? this.stopHold + dt : 0;
      if (this.stopHold >= 2) director.setStage(STAGES.COMPLETED);
    }
    if (director.stageTimer > 420 || director.totalTimer > 900) this.fail('Flight guidance timeout');
  }

  fail(reason) {
    this.result.status = 'failed';
    this.result.reason = reason;
    this.director.stop(() => t('demo.c172.failed'), false, { preserveThrottle: true });
  }
}
