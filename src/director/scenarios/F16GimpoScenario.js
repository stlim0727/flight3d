import { approachDeviation } from '@stlim0727/flightsim-core/navigation/approachDeviation.js';
import * as THREE from 'three';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { t } from '../../i18n/index.js';
import * as corridor from '../../geospatial/CorridorCoordinateSystem.js';
import { flyBank, flyVerticalPath } from '../PilotControlLaws.js';

const D = Math.PI / 180, R = 180 / Math.PI;
const ALT_M = 200, CLEARANCE_M = 60;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const headingOf = (dx, dz) => (Math.atan2(dx, -dz) * R + 360) % 360;
const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;

const STAGES = {
  IDLE: -1, PREPARE: 60, TAKEOFF: 61, CLIMB: 62, ENROUTE: 63,
  INTERCEPT: 64, FINAL: 65, FLARE: 66, ROLLOUT: 67, COMPLETED: 68,
};

/** Indexed RW14R threshold (airport tile 12-30); the streamed centre fix is ~1 km off. */
export const GIMPO_RW14R = Object.freeze({ latitude: 37.568001, longitude: 126.776001 });

/** Approach geometry from the mounted RKSS runway, in that airport's local frame. */
export function gimpoApproach(region) {
  const ends = region?.terrain?.runways?.[0]?.ends;
  if (!Array.isArray(ends) || ends.length < 2 || !ends[0]?.threshold || !ends[1]?.threshold) return null;
  const a = ends[0].threshold, b = ends[1].threshold;
  return {
    threshold: { x: a.x, z: a.z },
    headingDeg: headingOf(b.x - a.x, b.z - a.z),
    elevationFt: (Number.isFinite(a.elevationM) ? a.elevationM : 11) / 0.3048,
    gsAngleDeg: 3,
  };
}

/** Along-course distance alone reads "final" while still kilometres off the course. */
export function gimpoApproachPhase(crossTrackM, distanceToThresholdM) {
  const distance = Math.hypot(crossTrackM, distanceToThresholdM);
  if (distance > 22000) return 'enroute';
  if (distance < 4200 && Math.abs(crossTrackM) <= 1500) return 'final';
  return 'intercept';
}

/** Keep thrust while decelerating with gear down; flyVerticalPath alone goes idle. */
export function gimpoDecelerationThrottle(iasKnots, targetIasKnots, gearDown = true) {
  return clamp((gearDown ? 0.42 : 0.5) + (targetIasKnots - iasKnots) * 0.008, 0.15, 0.8);
}

/** Lower the goal pitch after touchdown, down to the F-16 rollout floor. */
export function nextRolloutPitch(pitchDeg, dtSeconds) {
  return Math.max(6.7, pitchDeg - 3 * dtSeconds);
}

/**
 * Incheon → streamed Gimpo (RKSS) F-16 sortie: runway takeoff, a heading-led
 * transit to the Seoul metropolitan area, RW14R interception, 3° final and a
 * braked rollout that hands control back on the runway.
 */
export class F16GimpoScenario {
  static STAGES = STAGES;

  constructor(director, simulator) {
    this.director = director;
    this.sim = simulator;
    this.result = { status: 'idle' };
    this.offset = null;
    this.approach = null;
    this.gearDown = false;
    this.flapsDown = false;
    this.interceptCaptured = false;
    this.rolloutPitchDeg = 10;
    this.rolloutStart = 0;
  }

  get routeReady() {
    return Boolean(this.offset && this.approach);
  }

  /** The streamed region mounts at Incheon; hold the takeoff until its runway is readable. */
  syncRoute() {
    const region = this.sim.airportStreamer?.regionFor?.('RKSS');
    const offset = this.sim.world?.offsets?.get?.('RKSS');
    const approach = gimpoApproach(region);
    if (offset && approach) {
      this.offset = offset;
      this.approach = approach;
    }
    return this.routeReady;
  }

  local() {
    return { x: this.sim.position.x - this.offset[0], z: this.sim.position.z - this.offset[1] };
  }

  deviation() {
    const p = this.local();
    return approachDeviation(this.approach, { x: p.x, z: p.z,
      altitudeFt: this.sim.telemetry.altitudeFt, tasKnots: this.sim.telemetry.tasKnots || 250 });
  }

  distanceM() {
    const here = corridor.incheonSceneryLocalToWgs84(this.sim.position.x, this.sim.position.z);
    return corridor.haversineDistanceM(here.latitude, here.longitude, GIMPO_RW14R.latitude, GIMPO_RW14R.longitude);
  }

  terrainAltitude() {
    const here = corridor.incheonSceneryLocalToWgs84(this.sim.position.x, this.sim.position.z);
    const along = corridor.projectPointOnRoute(here.latitude, here.longitude).distanceAlongRouteM;
    const total = corridor.getCorridorDistanceM();
    let cmd = ALT_M;
    const surface = this.sim.currentTerrain;
    for (const ahead of [0, 500, 1500, 3000, 6000, 12000, 20000]) {
      const r = corridor.interpolateRoute(clamp((along + ahead) / total, 0, 1));
      const [x, z] = corridor.wgs84ToIncheonSceneryLocal(r.latitude, r.longitude);
      const ground = surface?.getHeight?.(x, z) ?? 0;
      if (Number.isFinite(ground)) cmd = Math.max(cmd, ground + CLEARANCE_M);
    }
    return cmd;
  }

  banner(titleKey, descKey) {
    this.director.updateBanner(() => t(titleKey), () => t(descKey));
  }

  camera(mode) {
    if (this.sim.cameraSystem?.setMode) this.sim.cameraSystem.setMode(mode);
  }

  clearGroundControls() {
    this.sim.controls.setVirtualInput('brakes', 0);
    this.sim.controls.setVirtualInput('throttle', 0);
  }

  noteTouchdown() {
    if (this.sim.telemetry.touchdown && this.result.touchdown === null) {
      this.result.touchdown = { sinkFpm: this.sim.telemetry.touchdownSinkRate, g: this.sim.telemetry.gForce };
    }
  }

  steerRunway() {
    const dev = this.deviation();
    const courseErr = wrap(this.approach.headingDeg - this.sim.telemetry.headingDeg) -
      clamp(dev.crossTrackM * 0.05, -25, 25);
    flyBank(this.sim, clamp(courseErr * 1.2, -30, 30), this.sim.telemetry);
  }

  enterStage(stage) {
    if (stage === STAGES.PREPARE) {
      this.result = { status: 'running', touchdown: null };
      this.offset = null;
      this.approach = null;
      this.gearDown = false;
      this.flapsDown = false;
      this.interceptCaptured = false;
      this.rolloutPitchDeg = 10;
      this.rolloutStart = 0;
      // The demo owns its destination; the lobby selector is not part of the request.
      this.sim.lobby.destination = 'RKSS';
      this.sim.destinationAirport = 'RKSS';
      this.sim.setPreset?.('runway', true);
      this.sim.airportStreamer?.ensure?.('RKSS');
      this.camera(CameraSystem.MODES.CHASE);
      this.banner('demo.f16.gimpo.stage.prepare', 'demo.f16.gimpo.desc.prepare');
      return;
    }
    if (stage === STAGES.TAKEOFF) {
      this.banner('demo.f16.gimpo.stage.takeoff', 'demo.f16.gimpo.desc.takeoff');
      this.camera(CameraSystem.MODES.CHASE);
      this.sim.gear.setGearTarget(true);
      this.sim.aero.setFlapPosition(20);
      return;
    }
    if (stage === STAGES.CLIMB) {
      this.banner('demo.f16.gimpo.stage.climb', 'demo.f16.gimpo.desc.climb');
      this.camera(CameraSystem.MODES.FLYBY);
      this.sim.gear.setGearTarget(false);
      this.sim.aero.setFlapPosition(0);
      this.sim.controls.clearVirtualInputs();
      const snap = this.sim.readAutopilotState();
      this.sim.autopilot.reset();
      this.sim.autopilot.targets.headingDeg = headingOf(
        this.approach.threshold.x - this.local().x, this.approach.threshold.z - this.local().z);
      this.sim.autopilot.targets.altitudeFt = ALT_M / 0.3048;
      this.sim.autopilot.targets.iasKnots = 450;
      this.sim.autopilot.engage('HDG', snap);
      this.sim.autopilot.engage('ALT', snap);
      this.sim.autopilot.engage('SPD', snap);
      this.sim.autopilot.refreshTrim(this.sim.readAutopilotState());
      return;
    }
    if (stage === STAGES.ENROUTE) {
      this.banner('demo.f16.gimpo.stage.enroute', 'demo.f16.gimpo.desc.enroute');
      return;
    }
    if (stage === STAGES.INTERCEPT) {
      this.banner('demo.f16.gimpo.stage.intercept', 'demo.f16.gimpo.desc.intercept');
      this.camera(CameraSystem.MODES.CHASE);
      return;
    }
    if (stage === STAGES.FINAL) {
      this.banner('demo.f16.gimpo.stage.final', 'demo.f16.gimpo.desc.final');
      this.camera(CameraSystem.MODES.COCKPIT);
      this.sim.autopilot.disengage();
      this.sim.controls.clearVirtualInputs();
      return;
    }
    if (stage === STAGES.FLARE) {
      this.banner('demo.f16.gimpo.stage.flare', 'demo.f16.gimpo.desc.flare');
      return;
    }
    if (stage === STAGES.ROLLOUT) {
      this.banner('demo.f16.gimpo.stage.rollout', 'demo.f16.gimpo.desc.rollout');
      this.camera(CameraSystem.MODES.CHASE);
      this.rolloutPitchDeg = 10;
      this.rolloutStart = this.sim.totalSimTime;
      return;
    }
    if (stage === STAGES.COMPLETED) {
      this.banner('demo.f16.gimpo.complete', 'demo.f16.gimpo.complete.desc');
      this.result.status = 'completed';
      this.result.elapsedSeconds = this.director.totalTimer;
      this.clearGroundControls();
      this.director.stop(() => t('demo.f16.gimpo.handoff'), true);
    }
  }

  update(dt) {
    if (this.sim.isCrashed) {
      this.recordFailure(this.sim.crashResult);
      this.director.stop();
      return;
    }
    const sim = this.sim, tel = sim.telemetry;
    switch (this.director.currentStage) {
      case STAGES.PREPARE:
        if (this.syncRoute()) this.director.setStage(STAGES.TAKEOFF);
        break;
      case STAGES.TAKEOFF: {
        sim.controls.setVirtualInput('throttle', 1);
        sim.controls.setVirtualInput('brakes', 0);
        sim.gear.setGearTarget(true);
        sim.aero.setFlapPosition(20);
        if (tel.iasKnots >= 140) {
          flyVerticalPath(sim, 8, 170, tel, 0, sim.gear.onGround ? 8 : null);
          sim.controls.setVirtualInput('throttle', 1);
        } else flyBank(sim, 0, tel);
        if (!tel.onGround && sim.position.y > 35) this.director.setStage(STAGES.CLIMB);
        break;
      }
      case STAGES.CLIMB:
        this.director.setStage(STAGES.ENROUTE);
        break;
      case STAGES.ENROUTE: {
        const distanceM = this.distanceM();
        const hdg = headingOf(this.approach.threshold.x - this.local().x,
          this.approach.threshold.z - this.local().z);
        sim.autopilot.targets.headingDeg = hdg;
        sim.autopilot.targets.altitudeFt = this.terrainAltitude() / 0.3048;
        sim.autopilot.targets.iasKnots = distanceM < 25000 ? 250 : 450;
        if (!this.gearDown && distanceM < 25000 && tel.iasKnots < 280) {
          sim.gear.setGearTarget(true);
          this.gearDown = true;
        }
        if (distanceM < 22000) this.director.setStage(STAGES.INTERCEPT);
        break;
      }
      case STAGES.INTERCEPT: {
        const p = this.local(), ap = this.approach, course = ap.headingDeg * D;
        const aim = { x: ap.threshold.x - Math.sin(course) * 7000,
          z: ap.threshold.z + Math.cos(course) * 7000 };
        const dev = this.deviation();
        this.interceptCaptured ||= Math.hypot(p.x - aim.x, p.z - aim.z) < 1200;
        const targetHdg = this.interceptCaptured
          ? ap.headingDeg - clamp(dev.crossTrackM * 0.05, -25, 25)
          : headingOf(aim.x - p.x, aim.z - p.z);
        if (sim.autopilot.lateralMode !== 'HDG') sim.autopilot.engage('HDG', sim.readAutopilotState());
        sim.autopilot.targets.headingDeg = targetHdg;
        sim.autopilot.targets.altitudeFt = Math.max(ALT_M, this.terrainAltitude()) / 0.3048;
        sim.autopilot.targets.iasKnots = 250;
        if (!this.gearDown && tel.iasKnots < 280) { sim.gear.setGearTarget(true); this.gearDown = true; }
        if (!this.flapsDown && tel.iasKnots < 260) { sim.aero.setFlapPosition(20); this.flapsDown = true; }
        if (gimpoApproachPhase(dev.crossTrackM, dev.distanceToThresholdM) === 'final') {
          this.director.setStage(STAGES.FINAL);
        }
        break;
      }
      case STAGES.FINAL: {
        const dev = this.deviation();
        this.steerRunway();
        const gsAltM = this.approach.elevationFt * 0.3048 +
          Math.hypot(dev.crossTrackM, dev.distanceToThresholdM) * Math.tan(this.approach.gsAngleDeg * D);
        const vz = clamp((gsAltM - sim.position.y) * 0.45 -
          tel.tasKnots * 0.5144 * Math.tan(this.approach.gsAngleDeg * D) * 0.15, -5, 3);
        const targetIas = dev.distanceToThresholdM > 1500 ? 145 : 132;
        flyVerticalPath(sim, vz, targetIas, tel, 0, null);
        sim.controls.setVirtualInput('throttle',
          gimpoDecelerationThrottle(tel.iasKnots, targetIas, true));
        sim.controls.setVirtualInput('brakes', 0);
        sim.gear.setGearTarget(true);
        sim.aero.setFlapPosition(20);
        sim.aero.spoilers = clamp(0.1 + (tel.iasKnots - targetIas) * 0.02, 0, 0.4);
        this.noteTouchdown();
        if (tel.radioAltFt < 60) this.director.setStage(STAGES.FLARE);
        else if (tel.onGround) this.director.setStage(STAGES.ROLLOUT);
        break;
      }
      case STAGES.FLARE:
        this.steerRunway();
        sim.controls.setVirtualInput('throttle', 0);
        sim.controls.setVirtualInput('brakes', 0);
        sim.aero.spoilers = 0.4;
        flyVerticalPath(sim, 0.2, 130, tel, 0, 10);
        this.noteTouchdown();
        if (tel.onGround) this.director.setStage(STAGES.ROLLOUT);
        break;
      case STAGES.ROLLOUT: {
        if (tel.groundSpeedKnots > 30) this.steerRunway();
        else sim.controls.setVirtualInput('aileron', 0);
        this.rolloutPitchDeg = nextRolloutPitch(this.rolloutPitchDeg, 0.05);
        flyVerticalPath(sim, 0, 0, tel, 0, this.rolloutPitchDeg);
        sim.controls.setVirtualInput('throttle', 0);
        sim.controls.setVirtualInput('brakes', 1);
        sim.aero.spoilers = 1;
        if (tel.groundSpeedKnots < 8 || sim.totalSimTime - this.rolloutStart > 40) {
          this.director.setStage(STAGES.COMPLETED);
        }
        break;
      }
      default:
        break;
    }
  }

  recordFailure(crash) {
    if (['running', 'pending'].includes(this.result.status)) {
      this.result.status = 'failed';
      this.result.crash = crash ?? null;
    }
  }

  stop() {
    if (['running', 'pending'].includes(this.result.status)) this.result.status = 'cancelled';
  }
}
