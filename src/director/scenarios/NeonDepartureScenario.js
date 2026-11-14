import * as THREE from 'three';
import { t } from '../../i18n/index.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { NEON_ISLAND } from '../../config/neonRiver.js';
import { CANYON_FLIGHT } from '../../config/neonBuildings.js';
import { flyBank, flyVerticalPath } from '../PilotControlLaws.js';

const clamp = THREE.MathUtils.clamp;
const STAGES = { IDLE: -1, LINEUP: 60, TAKEOFF: 61, CANYON_CLIMB: 62, SKYLINE: 63, COMPLETED: 64 };
const RUNWAY_HEADING_DEG = 90;
// The runway (z = 0) continues as the canyon line through the city: the one straight
// path the Neon layout keeps clear of towers (#695). The arch bridge on it tops out at
// 48 m near x 2190-2410, which the climb crosses about 230 m above.
const LINE_Z = CANYON_FLIGHT.z;
const ROTATE_IAS_KT = 140;
const CLIMB_IAS_KT = 175;
const CLIMB_VZ_MS = 10;
const GEAR_UP_HEIGHT_M = 15;
// The Neon skyline cruise preset spawns at y = 760 m (2,500 FT); the demo hands over there.
const HANDOFF_ALTITUDE_M = 760;

/**
 * Boeing 737 Neon Metropolis departure: one runway preset, then only physical control
 * inputs. The takeoff roll steers the nosewheel/rudder onto the centreline against the
 * urban crosswind, the climb tracks the canyon line out over the eastern sea, and the
 * demo hands over at the skyline cruise altitude. No landing: the 090 runway points
 * into the city, so a full circuit is outside this demo.
 */
export class NeonDepartureScenario {
  static STAGES = STAGES;

  constructor(director, simulator) {
    this.director = director;
    this.sim = simulator;
    this.result = { status: 'idle' };
  }

  enterStage(stage) {
    const sim = this.sim, director = this.director;
    const banner = key => director.updateBanner(() => t(`demo.b738.neon.stage.${key}`), () => t(`demo.b738.neon.desc.${key}`));
    if (stage === STAGES.LINEUP) {
      this.result = { status: 'running', airborne: false, liftoffX: null, maxCenterlineM: 0, maxAirborneLineM: 0, minClearanceM: Infinity };
      sim.setPreset('runway', true);
      sim.controls.setVirtualInput('brakes', 1);
      sim.controls.setVirtualInput('throttle', 0);
      banner('lineup');
      if (!director.userCameraOverridden) {
        sim.cameraSystem.setMode(CameraSystem.MODES.DRONE);
        sim.cameraSystem.resetDroneOrbit?.(-Math.PI * 0.45, 40, 10);
      }
    } else if (stage === STAGES.TAKEOFF) {
      banner('takeoff');
      if (!director.userCameraOverridden) sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
    } else if (stage === STAGES.CANYON_CLIMB) {
      banner('canyon');
      if (!director.userCameraOverridden) sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
    } else if (stage === STAGES.SKYLINE) {
      banner('skyline');
      if (!director.userCameraOverridden) sim.cameraSystem.setMode(CameraSystem.MODES.FLYBY);
      this.skylineCut = false;
    } else if (stage === STAGES.COMPLETED) {
      this.result.status = 'completed';
      this.result.elapsedSeconds = director.totalTimer;
      director.stop(() => t('demo.b738.neon.complete'), false, { preserveThrottle: true });
    }
  }

  /** Heading that converges on the runway/canyon line, as the Cessna route pass does. */
  lineHeading(lookahead) {
    return RUNWAY_HEADING_DEG - Math.atan2(this.sim.position.z - LINE_Z, lookahead) * 180 / Math.PI;
  }

  headingError(target) {
    return ((target - this.sim.telemetry.headingDeg + 540) % 360) - 180;
  }

  update() {
    const sim = this.sim, tel = sim.telemetry, director = this.director;
    const stage = director.currentStage, time = director.stageTimer;
    // The sea floor lies under the water east of the island; height is above whichever is higher.
    const surface = Math.max(sim.currentTerrain.getHeight(sim.position.x, sim.position.z),
      sim.currentTerrain.getWaterLevel?.() ?? -Infinity);
    const height = sim.position.y - surface - (sim.gear.cgGroundHeightM ?? 0);
    const offLine = Math.abs(sim.position.z - LINE_Z);

    if (stage === STAGES.LINEUP) {
      sim.controls.setVirtualInput('brakes', 1);
      sim.controls.setVirtualInput('throttle', 0);
      sim.controls.setVirtualInput('elevator', 0);
      sim.controls.setVirtualInput('aileron', 0);
      sim.controls.setVirtualInput('rudder', 0);
      if (time >= 6) director.setStage(STAGES.TAKEOFF);
      return;
    }

    sim.controls.setVirtualInput('brakes', 0);
    // The integrator sets the parking brake while the lineup holds the aircraft still on
    // the pedals, and only a pilot's own thrust lever releases it; release it here so the
    // takeoff roll does not sound TAKEOFF CONFIG.
    if (sim.controls.parkingBrake) sim.controls.setParkingBrake?.(false);
    if (sim.gear.onGround) {
      // Nosewheel steering and rudder share the pedal input: steer onto the centreline
      // with yaw-rate damping, so a crosswind cannot weathervane the roll off the runway.
      this.result.maxCenterlineM = Math.max(this.result.maxCenterlineM, offLine);
      const error = this.headingError(this.lineHeading(150));
      sim.controls.setVirtualInput('rudder', clamp(error * 0.05 + sim.angularVelocity.y * 1.5, -0.5, 0.5));
      sim.controls.setVirtualInput('aileron', clamp(-tel.rollDeg * 0.05, -0.2, 0.2));
      sim.controls.setVirtualInput('throttle', 1);
      if (tel.iasKnots >= ROTATE_IAS_KT) flyVerticalPath(sim, CLIMB_VZ_MS, CLIMB_IAS_KT, tel, 0, 8);
      else sim.controls.setVirtualInput('elevator', 0);
    } else {
      if (this.result.liftoffX === null) this.result.liftoffX = sim.position.x;
      this.result.maxAirborneLineM = Math.max(this.result.maxAirborneLineM, offLine);
      this.result.minClearanceM = Math.min(this.result.minClearanceM, height);
      // Steer the ground track, not the nose: the wind correction angle is then flown
      // as crab instead of being left as a standing offset from the canyon line.
      const courseDeg = Math.atan2(sim.linearVelocity.x, -sim.linearVelocity.z) * 180 / Math.PI;
      const courseError = ((this.lineHeading(400) - courseDeg + 540) % 360) - 180;
      const bank = clamp(courseError * 1.5, -10, 10);
      flyBank(sim, bank, tel);
      sim.controls.setVirtualInput('rudder', clamp(-sim.aero.beta * 2, -0.2, 0.2));
      flyVerticalPath(sim, CLIMB_VZ_MS, CLIMB_IAS_KT, tel);
      if (height > GEAR_UP_HEIGHT_M && tel.gearState > 0.1 && !tel.isTransit) sim.gear.setGearTarget(false);
    }

    if (stage === STAGES.TAKEOFF && !sim.gear.onGround && height > GEAR_UP_HEIGHT_M) {
      this.result.airborne = true;
      director.setStage(STAGES.CANYON_CLIMB);
    } else if (stage === STAGES.CANYON_CLIMB && sim.position.x > NEON_ISLAND.east) {
      director.setStage(STAGES.SKYLINE);
    } else if (stage === STAGES.SKYLINE) {
      if (!this.skylineCut && !director.userCameraOverridden && time > 8) {
        this.skylineCut = true;
        sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
      }
      if (sim.position.y >= HANDOFF_ALTITUDE_M) director.setStage(STAGES.COMPLETED);
    }
    if (director.isActive && time > 150) {
      this.result.status = 'failed';
      this.result.reason = `Stage ${stage} timeout`;
      director.stop(() => t('demo.b738.neon.failed'), false, { preserveThrottle: true });
    }
  }

  recordFailure(crash) {
    this.result.status = 'failed';
    this.result.reason = crash?.description || crash?.type || 'Aircraft damage';
  }

  stop() {
    if (['pending', 'running'].includes(this.result.status)) this.result.status = 'cancelled';
  }
}
