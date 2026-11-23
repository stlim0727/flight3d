// Low-level Incheon → Jeju/Gimpo F-16 controller used by scripts/record-flight-video.mjs.
// Browser-safe: imported directly by the page from /scripts/lib/... via Vite.
import { approachDeviation as calculateDeviation } from '@stlim0727/flightsim-core/navigation/approachDeviation.js';
import { flyBank, flyVerticalPath } from '../../src/director/PilotControlLaws.js';
import * as corridor from '../../src/geospatial/CorridorCoordinateSystem.js';
import { BASE_OFFSETS } from '../../src/world/UnifiedWorld.js';
import * as approach from '../../src/config/approachData.js';

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Along-course distance alone can read "4 km to go" while 13 km off the course. */
export function approachPhase({ alongCourseM, crossTrackM, absoluteDistanceM,
  finalRangeM = 4200, interceptRangeM = 22000, maxCrossTrackM = 1500 }) {
  const distance = Number.isFinite(absoluteDistanceM)
    ? absoluteDistanceM
    : Math.hypot(alongCourseM, crossTrackM);
  if (distance > interceptRangeM) return 'enroute';
  if (distance < finalRangeM && Math.abs(crossTrackM) <= maxCrossTrackM) return 'final';
  return 'intercept';
}

/** Keep thrust while decelerating with gear down; flyVerticalPath goes idle. */
export function decelerationThrottle({ iasKnots, targetIasKnots, gearDown = false }) {
  const computed = (gearDown ? 0.42 : 0.5) + (targetIasKnots - iasKnots) * 0.008;
  return clamp(computed, gearDown ? 0.15 : 0.1, 0.8);
}

/** Only low ground speed is a successful landing. */
export function rolloutReason(groundSpeedKnots, elapsedSeconds) {
  if (groundSpeedKnots < 8) return 'landed';
  if (elapsedSeconds > 40) return 'rollout-timeout';
  return null;
}

/** Lower the goal pitch 3 deg/s after touchdown, down to the F-16 rollout floor. */
export function nextRolloutPitch(pitchDeg, dtSeconds) {
  return Math.max(6.7, pitchDeg - 3 * dtSeconds);
}

/** Terrain clearance along the actual bearing to a target, not a fixed corridor. */
export function terrainAltitudeAhead(position, target, surface, { minAltM = 200, clearanceM = 60 } = {}) {
  const dx = target.x - position.x, dz = target.z - position.z;
  const remaining = Math.hypot(dx, dz) || 1;
  const ux = dx / remaining, uz = dz / remaining;
  let cmd = minAltM;
  for (const ahead of [0, 500, 1500, 3000, 6000, 12000, 20000]) {
    const distance = Math.min(ahead, remaining);
    const ground = surface?.getHeight?.(position.x + ux * distance, position.z + uz * distance) ?? 0;
    if (Number.isFinite(ground)) cmd = Math.max(cmd, ground + clearanceM);
  }
  return cmd;
}

const degrees = radians => (radians * 180 / Math.PI + 360) % 360;
const headingOf = (dx, dz) => degrees(Math.atan2(dx, -dz));

/**
 * Approach geometry for a streamed airport's first runway, in that airport's
 * local frame. RKSS is mounted from the indexed airport tile; its runway
 * descriptors carry local threshold coordinates and elevation.
 */
export function streamedApproach(region) {
  const ends = region?.terrain?.runways?.[0]?.ends;
  if (!Array.isArray(ends) || ends.length < 2 || !ends[0]?.threshold || !ends[1]?.threshold) return null;
  const a = ends[0].threshold, b = ends[1].threshold;
  return {
    threshold: { x: a.x, z: a.z },
    headingDeg: headingOf(b.x - a.x, b.z - a.z),
    gsAngleDeg: 3,
    elevationFt: (Number.isFinite(a.elevationM) ? a.elevationM : 11) / 0.3048,
  };
}

function makeRoute(s, destination) {
  const wgs = () => corridor.incheonSceneryLocalToWgs84(s.position.x, s.position.z);
  const alongRouteM = () => corridor.projectPointOnRoute(wgs().latitude, wgs().longitude).distanceAlongRouteM;
  const common = {
    routeDistanceM: alongRouteM,
    terrainAltitude: () => {
      const along = alongRouteM();
      const total = corridor.getCorridorDistanceM();
      let cmd = 200;
      const surface = s.currentTerrain;
      for (const ahead of [0, 500, 1500, 3000, 6000, 12000, 20000]) {
        const r = corridor.interpolateRoute(Math.max(0, Math.min(1, (along + ahead) / total)));
        const [x, z] = corridor.wgs84ToIncheonSceneryLocal(r.latitude, r.longitude);
        const ground = surface.getHeight?.(x, z) ?? 0;
        if (Number.isFinite(ground)) cmd = Math.max(cmd, ground + 60);
      }
      return cmd;
    },
  };

  if (destination === 'RKSS' || destination === 'rkss' || destination === 'gimpo') {
    const offset = s.world?.offsets?.get?.('RKSS');
    const data = streamedApproach(s.world?.regions?.get?.('RKSS'));
    if (!offset || !data) return null;
    const [OX, OZ] = offset;
    const local = () => ({ x: s.position.x - OX, z: s.position.z - OZ });
    return {
      ...common,
      key: 'RKSS',
      lateralMode: 'HDG',
      approach: data,
      local,
      deviation: () => {
        const p = local();
        return calculateDeviation(data, { x: p.x, z: p.z,
          altitudeFt: s.telemetry.altitudeFt, tasKnots: s.telemetry.tasKnots || 250 });
      },
      // Indexed RW14R threshold (airport tile 12-30). Centre fixes are ~1 km off.
      distanceM: () => {
        const here = wgs();
        return corridor.haversineDistanceM(here.latitude, here.longitude, 37.568001, 126.776001);
      },
      enrouteHeading: () => {
        const p = local();
        return headingOf(data.threshold.x - p.x, data.threshold.z - p.z);
      },
      // The Jeju corridor projection is meaningless for a north-east Gimpo
      // sortie; sample the terrain actually ahead of the aircraft instead.
      terrainAltitude: () => terrainAltitudeAhead(s.position,
        { x: OX + data.threshold.x, z: OZ + data.threshold.z }, s.currentTerrain),
    };
  }

  if (destination !== 'jeju') return null;
  const [JX, JZ] = BASE_OFFSETS.jeju;
  const data = approach.APPROACH_DATA.jeju;
  const local = () => ({ x: s.position.x - JX, z: s.position.z - JZ });
  return {
    ...common,
    key: 'jeju',
    // The Incheon → Jeju corridor is the LNAV flight plan; a streamed Gimpo
    // destination has no corridor and must be steered in HDG.
    lateralMode: 'LNAV',
    approach: data,
    local,
    deviation: () => {
      const p = local();
      return approach.approachDeviation('jeju', { x: p.x, z: p.z,
        altitudeFt: s.telemetry.altitudeFt, tasKnots: s.telemetry.tasKnots || 250 });
    },
    distanceM: () => {
      const here = wgs();
      return corridor.haversineDistanceM(here.latitude, here.longitude, 33.5113, 126.493);
    },
    enrouteHeading: null,
  };
}

/** Install the 20 Hz controller on a live simulator. Returns {ok:true} when armed. */
export function installSortieController(s, destination = 'jeju') {
  const route = makeRoute(s, destination);
  if (!route) return { ok: false, error: `destination ${destination} is not ready` };
  const R = 180 / Math.PI, D = Math.PI / 180;
  const state = { phase: 'init', destination: route.key, courseDeg: route.approach.headingDeg,
    done: false, crashed: false, reason: null,
    log: [], touchdowns: [], rolloutPitchDeg: 10 };
  window.__flight = state;

  const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const deviation = route.deviation;
  const terrainAltitude = route.terrainAltitude;

  let apEngaged = false, gearDown = false, flapsDown = false, interceptCaptured = false;
  let lastLog = -1, ticks = 0, rolloutStart = 0, rolloutPitchDeg = 10;
  const log = force => {
    const t = Math.floor(s.totalSimTime);
    if (!force && t === lastLog) return;
    lastLog = t;
    const dev = deviation();
    state.log.push({ t, phase: state.phase, altFt: Math.round(s.telemetry.altitudeFt),
      ias: +s.telemetry.iasKnots.toFixed(1), hdg: +s.telemetry.headingDeg.toFixed(0),
      vsi: Math.round(s.telemetry.vsiFpm), g: +(s.telemetry.gForce ?? 0).toFixed(2),
      routeKm: +(route.routeDistanceM() / 1000).toFixed(1),
      destKm: +(route.distanceM() / 1000).toFixed(1),
      crossTrackM: Math.round(dev.crossTrackM), fuel: Math.round(s.telemetry.fuelKg ?? 0),
      onGround: !!s.telemetry.onGround, ap: s.autopilot.annunciation() });
    if (state.log.length > 5000) state.log.shift();
  };
  const finish = (reason, crashed = false) => {
    if (state.done) return;
    state.done = true; state.crashed = crashed; state.reason = reason;
    s.controls.clearVirtualInputs(); s.autopilot.disengage(); log(true);
  };
  const takeoff = () => {
    s.controls.setVirtualInput('throttle', 1);
    s.controls.setVirtualInput('brakes', 0);
    s.gear.setGearTarget(true);
    s.aero.setFlapPosition(20);
    if (s.telemetry.iasKnots >= 140) {
      flyVerticalPath(s, 8, 170, s.telemetry, 0, s.gear.onGround ? 8 : null);
      s.controls.setVirtualInput('throttle', 1);
    } else flyBank(s, 0, s.telemetry);
    if (!s.telemetry.onGround && s.position.y > 35) state.phase = 'climb';
  };
  const climb = () => {
    s.gear.setGearTarget(false); s.aero.setFlapPosition(0);
    s.controls.clearVirtualInputs();
    if (!apEngaged) {
      const snap = s.readAutopilotState();
      s.autopilot.reset();
      if (route.enrouteHeading) s.autopilot.targets.headingDeg = route.enrouteHeading();
      s.autopilot.engage(route.lateralMode, snap);
      s.autopilot.engage('ALT', snap);
      s.autopilot.engage('SPD', snap);
      apEngaged = true;
    }
    s.autopilot.targets.altitudeFt = 200 / 0.3048;
    s.autopilot.targets.iasKnots = 450;
    s.autopilot.refreshTrim(s.readAutopilotState());
    state.phase = 'enroute';
  };
  const enroute = () => {
    s.autopilot.targets.altitudeFt = terrainAltitude() / 0.3048;
    const distanceM = route.distanceM();
    if (!gearDown && distanceM < 25000) {
      s.gear.setGearTarget(true);
      gearDown = true;
    }
    s.autopilot.targets.iasKnots = gearDown ? 250 : 450;
    if (route.enrouteHeading) s.autopilot.targets.headingDeg = route.enrouteHeading();
    if (distanceM < 22000) state.phase = 'intercept';
  };
  const intercept = () => {
    const p = route.local(), apData = route.approach;
    const course = apData.headingDeg * D;
    const aim = { x: apData.threshold.x - Math.sin(course) * 7000,
      z: apData.threshold.z + Math.cos(course) * 7000 };
    const dev = deviation();
    if (s.autopilot.lateralMode !== 'HDG') {
      s.autopilot.engage('HDG', s.readAutopilotState());
    }
    interceptCaptured ||= dist(p, aim) < 1200;
    const targetHeading = interceptCaptured
      ? apData.headingDeg - clamp(dev.crossTrackM * 0.05, -25, 25)
      : headingOf(aim.x - p.x, aim.z - p.z);
    s.autopilot.targets.headingDeg = targetHeading;
    s.autopilot.targets.altitudeFt = Math.max(200, terrainAltitude()) / 0.3048;
    s.autopilot.targets.iasKnots = 250;
    if (!gearDown) { s.gear.setGearTarget(true); gearDown = true; }
    if (!flapsDown && s.telemetry.iasKnots < 260) { s.aero.setFlapPosition(20); flapsDown = true; }
    const absolute = Math.hypot(dev.crossTrackM, dev.distanceToThresholdM);
    if (approachPhase({ alongCourseM: dev.distanceToThresholdM,
      crossTrackM: dev.crossTrackM, absoluteDistanceM: absolute }) === 'final') {
      state.phase = 'final';
    }
  };
  const steerRunway = () => {
    const apData = route.approach;
    const dev = deviation();
    const courseErr = wrap(apData.headingDeg - s.telemetry.headingDeg) -
      clamp(dev.crossTrackM * 0.05, -25, 25);
    flyBank(s, clamp(courseErr * 1.2, -30, 30), s.telemetry);
  };
  const finalApproach = () => {
    if (apEngaged || s.autopilot.master) { s.autopilot.disengage(); apEngaged = false; s.controls.clearVirtualInputs(); }
    const apData = route.approach;
    const dev = deviation();
    steerRunway();
    const gsAltM = apData.elevationFt * 0.3048 +
      Math.hypot(dev.crossTrackM, dev.distanceToThresholdM) * Math.tan(apData.gsAngleDeg * D);
    const vz = clamp((gsAltM - s.position.y) * 0.45 -
      s.telemetry.tasKnots * 0.5144 * Math.tan(apData.gsAngleDeg * D) * 0.15, -5, 3);
    const targetIas = dev.distanceToThresholdM > 1500 ? 145 : 132;
    flyVerticalPath(s, vz, targetIas, s.telemetry, 0, null);
    s.controls.setVirtualInput('throttle', decelerationThrottle({
      iasKnots: s.telemetry.iasKnots, targetIasKnots: targetIas, gearDown: true }));
    s.controls.setVirtualInput('brakes', 0);
    s.gear.setGearTarget(true); s.aero.setFlapPosition(20);
    s.aero.spoilers = clamp(0.1 + (s.telemetry.iasKnots - targetIas) * 0.02, 0, 0.4);
    if (s.telemetry.radioAltFt < 30) state.phase = 'flare';
    if (s.telemetry.onGround) { state.phase = 'rollout'; rolloutPitchDeg = 10; }
  };
  const flare = () => {
    steerRunway();
    s.controls.setVirtualInput('throttle', 0);
    s.controls.setVirtualInput('brakes', 0);
    s.aero.spoilers = 0.4;
    flyVerticalPath(s, -0.4, 130, s.telemetry, 0, 10);
    if (s.telemetry.onGround) { state.phase = 'rollout'; rolloutPitchDeg = 10; }
  };
  const rollout = () => {
    s.autopilot.disengage();
    if (s.telemetry.groundSpeedKnots > 30) steerRunway();
    else s.controls.setVirtualInput('aileron', 0);
    rolloutPitchDeg = nextRolloutPitch(rolloutPitchDeg, 0.05);
    state.rolloutPitchDeg = rolloutPitchDeg;
    flyVerticalPath(s, 0, 0, s.telemetry, 0, rolloutPitchDeg);
    s.controls.setVirtualInput('throttle', 0);
    s.controls.setVirtualInput('brakes', 1);
    s.aero.spoilers = 1;
    const reason = rolloutReason(s.telemetry.groundSpeedKnots, s.totalSimTime - rolloutStart);
    if (reason) finish(reason);
  };

  setInterval(() => {
    ticks++;
    if (state.done) return;
    if (s.isCrashed) { finish('crash', true); return; }
    if (ticks > 60 * 60 * 20) { finish('timeout'); return; }
    try {
      if (state.phase === 'init' && s.gameFlow.state === 'flight' && !s.startingFlight) state.phase = 'takeoff';
      if (state.phase === 'takeoff') takeoff();
      else if (state.phase === 'climb') climb();
      else if (state.phase === 'enroute') enroute();
      else if (state.phase === 'intercept') intercept();
      else if (state.phase === 'final') finalApproach();
      else if (state.phase === 'flare') flare();
      else if (state.phase === 'rollout') {
        if (!rolloutStart) rolloutStart = s.totalSimTime;
        rollout();
      }
      if (s.telemetry.touchdown && !state.touchdowns.some(t => Math.abs(t.t - s.totalSimTime) < 2)) {
        state.touchdowns.push({ t: s.totalSimTime, sink: s.telemetry.touchdownSinkRate });
      }
      log();
    } catch (error) {
      state.error = String(error?.stack || error);
      finish('controller-error');
    }
  }, 50);

  return { ok: true };
}
