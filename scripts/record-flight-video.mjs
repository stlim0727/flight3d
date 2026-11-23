// Record a hardware-GPU browser sortie and encode it as an mp4.
// Speed is applied at encode time; the simulation itself always runs at 1x.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withBrowserSession } from './lib/browserHarness.mjs';

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Phase gate for the low-level Incheon→Jeju profile. Along-course distance
 * alone is unsafe: an aircraft abeam the threshold but 13 km off course reads
 * "4 km to go". Require absolute distance AND lateral alignment.
 */
export function approachPhase({ alongCourseM, crossTrackM, absoluteDistanceM,
  finalRangeM = 4200, interceptRangeM = 22000, maxCrossTrackM = 1500 }) {
  const distance = Number.isFinite(absoluteDistanceM)
    ? absoluteDistanceM
    : Math.hypot(alongCourseM, crossTrackM);
  if (distance > interceptRangeM) return 'enroute';
  if (distance < finalRangeM && Math.abs(crossTrackM) <= maxCrossTrackM) return 'final';
  return 'intercept';
}

/**
 * Thrust while decelerating with gear down. flyVerticalPath's proportional
 * throttle goes idle when IAS is far above target, which made the F16 sink.
 */
export function decelerationThrottle({ iasKnots, targetIasKnots, gearDown = false }) {
  const computed = (gearDown ? 0.42 : 0.5) + (targetIasKnots - iasKnots) * 0.008;
  return clamp(computed, gearDown ? 0.15 : 0.1, 0.8);
}

/** Concat durations in ms. Dividing by speed here is the whole playback change. */
export function playbackDurations(frameTimesMs, speed = 1) {
  if (!(speed > 0)) throw new RangeError('speed must be positive');
  const durations = [];
  for (let i = 0; i + 1 < frameTimesMs.length; i++) {
    durations.push(Math.max(1, Math.min(1000, frameTimesMs[i + 1] - frameTimesMs[i])) / speed);
  }
  const last = durations.at(-1) ?? 1000 / 20;
  durations.push(last);
  return durations;
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args.set(key, next); i++; }
    else args.set(key, true);
  }
  const speed = Number(args.get('speed') ?? 1);
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('--speed must be a positive number');
  return {
    dryRun: args.has('dry-run'),
    speed,
    output: resolve(args.get('output') ?? '.tmp/flight-video/f16-icn-jeju-200m.mp4'),
    maxSeconds: Number(args.get('max-seconds') ?? 3600),
    width: Number(args.get('width') ?? 1280),
    height: Number(args.get('height') ?? 720),
  };
}

function dryRun() {
  const abeam = approachPhase({ alongCourseM: 320, crossTrackM: -13451, absoluteDistanceM: 13455 });
  const aligned = approachPhase({ alongCourseM: 4000, crossTrackM: 200, absoluteDistanceM: 4005 });
  const far = approachPhase({ alongCourseM: 60000, crossTrackM: 0, absoluteDistanceM: 60000 });
  if (abeam !== 'intercept' || aligned !== 'final' || far !== 'enroute') {
    throw new Error(`phase gates: abeam=${abeam} aligned=${aligned} far=${far}`);
  }
  const thr = decelerationThrottle({ iasKnots: 250, targetIasKnots: 145, gearDown: true });
  if (thr < 0.15) throw new Error(`deceleration throttle ${thr} would starve the approach`);
  const durations = playbackDurations([0, 100, 250], 2);
  if (Math.abs(durations[0] - 50) > 1e-9 || Math.abs(durations[1] - 75) > 1e-9) {
    throw new Error(`playback durations ${JSON.stringify(durations)}`);
  }
  console.log('dry-run: phase gates, thrust floor and encode timing OK');
}

export function buildControllerSource() {
  return `(() => {
    const clamp = ${clamp.toString()};
    const approachPhase = ${approachPhase.toString()};
    const decelerationThrottle = ${decelerationThrottle.toString()};
    return (async () => {
      const [
        { flyBank, flyVerticalPath },
        corridor,
        world,
        approach,
      ] = await Promise.all([
        import('/src/director/PilotControlLaws.js'),
        import('/src/geospatial/CorridorCoordinateSystem.js'),
        import('/src/world/UnifiedWorld.js'),
        import('/src/config/approachData.js'),
      ]);
      const s = window.sim;
      const R = 180 / Math.PI, D = Math.PI / 180;
      const ALT_M = 200, CLEARANCE_M = 60;
      const [JX, JZ] = world.BASE_OFFSETS.jeju;
      const state = { phase: 'init', done: false, crashed: false, reason: null,
        log: [], touchdowns: [] };
      window.__flight = state;
      const jejuLocal = () => ({ x: s.position.x - JX, z: s.position.z - JZ });
      const headingOf = (dx, dz) => (Math.atan2(dx, -dz) * R + 360) % 360;
      const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;
      const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      const deviation = () => {
        const p = jejuLocal();
        return approach.approachDeviation('jeju', { x: p.x, z: p.z,
          altitudeFt: s.telemetry.altitudeFt, tasKnots: s.telemetry.tasKnots || 250 });
      };
      const routeDistanceM = () => {
        const wgs = corridor.incheonSceneryLocalToWgs84(s.position.x, s.position.z);
        return corridor.projectPointOnRoute(wgs.latitude, wgs.longitude).distanceAlongRouteM;
      };
      const jejuDistanceM = () => {
        const wgs = corridor.incheonSceneryLocalToWgs84(s.position.x, s.position.z);
        return corridor.haversineDistanceM(wgs.latitude, wgs.longitude, 33.5113, 126.493);
      };
      const terrainAltitude = () => {
        const wgs = corridor.incheonSceneryLocalToWgs84(s.position.x, s.position.z);
        const along = corridor.projectPointOnRoute(wgs.latitude, wgs.longitude).distanceAlongRouteM;
        const total = corridor.getCorridorDistanceM();
        let cmd = ALT_M;
        const surface = s.currentTerrain;
        for (const ahead of [0, 500, 1500, 3000, 6000, 12000, 20000]) {
          const r = corridor.interpolateRoute(clamp((along + ahead) / total, 0, 1));
          const [x, z] = corridor.wgs84ToIncheonSceneryLocal(r.latitude, r.longitude);
          const ground = surface.getHeight?.(x, z) ?? 0;
          if (Number.isFinite(ground)) cmd = Math.max(cmd, ground + CLEARANCE_M);
        }
        return cmd;
      };
      let apEngaged = false, gearDown = false, flapsDown = false, interceptCaptured = false;
      let lastLog = -1, ticks = 0, rolloutStart = 0;
      const log = force => {
        const t = Math.floor(s.totalSimTime);
        if (!force && t === lastLog) return;
        lastLog = t;
        const dev = deviation();
        state.log.push({ t, phase: state.phase, altFt: Math.round(s.telemetry.altitudeFt),
          ias: +s.telemetry.iasKnots.toFixed(1), hdg: +s.telemetry.headingDeg.toFixed(0),
          vsi: Math.round(s.telemetry.vsiFpm), g: +(s.telemetry.gForce ?? 0).toFixed(2),
          routeKm: +(routeDistanceM() / 1000).toFixed(1),
          jejuKm: +(jejuDistanceM() / 1000).toFixed(1),
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
          s.autopilot.engage('LNAV', snap);
          s.autopilot.engage('ALT', snap);
          s.autopilot.engage('SPD', snap);
          apEngaged = true;
        }
        s.autopilot.targets.altitudeFt = ALT_M / 0.3048;
        s.autopilot.targets.iasKnots = 450;
        s.autopilot.refreshTrim(s.readAutopilotState());
        state.phase = 'enroute';
      };
      const enroute = () => {
        s.autopilot.targets.altitudeFt = terrainAltitude() / 0.3048;
        const distanceM = jejuDistanceM();
        if (!gearDown && distanceM < 25000) {
          s.gear.setGearTarget(true);
          gearDown = true;
        }
        s.autopilot.targets.iasKnots = gearDown ? 250 : 450;
        if (distanceM < 22000) state.phase = 'intercept';
      };

      const intercept = () => {
        const p = jejuLocal(), apData = approach.APPROACH_DATA.jeju;
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
        s.autopilot.targets.altitudeFt = Math.max(ALT_M, terrainAltitude()) / 0.3048;
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
        const apData = approach.APPROACH_DATA.jeju;
        const dev = deviation();
        const courseErr = wrap(apData.headingDeg - s.telemetry.headingDeg) -
          clamp(dev.crossTrackM * 0.05, -25, 25);
        flyBank(s, clamp(s.telemetry.rollDeg + courseErr, -35, 35), s.telemetry);
      };
      const finalApproach = () => {
        if (apEngaged) { s.autopilot.disengage(); apEngaged = false; s.controls.clearVirtualInputs(); }
        const p = jejuLocal(), apData = approach.APPROACH_DATA.jeju;
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
        if (s.telemetry.onGround) state.phase = 'rollout';
      };
      const flare = () => {
        steerRunway();
        s.controls.setVirtualInput('throttle', 0);
        s.controls.setVirtualInput('brakes', 0);
        s.aero.spoilers = 0.4;
        flyVerticalPath(s, -0.4, 130, s.telemetry, 0, 10);
        if (s.telemetry.onGround) state.phase = 'rollout';
      };
      const rollout = () => {
        s.autopilot.disengage();
        if (s.telemetry.groundSpeedKnots > 30) steerRunway();
        else s.controls.setVirtualInput('aileron', 0);
        s.controls.setVirtualInput('throttle', 0);
        s.controls.setVirtualInput('brakes', 1);
        s.aero.spoilers = 1;
        if (s.telemetry.groundSpeedKnots < 8 || s.totalSimTime - rolloutStart > 40) finish('landed');
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
    })();
  })()`;
}

async function record(options) {
  if (process.env.GPU_ANGLE && process.env.GPU_ANGLE !== 'vulkan') {
    throw new Error(`GPU_ANGLE=${process.env.GPU_ANGLE}; hardware Vulkan is required`);
  }
  process.env.GPU_ANGLE = 'vulkan';
  process.env.CHROME_PATH ||= '/home/stlim/.local/bin/chrome-headless';
  const framesDir = `${options.output}.frames`;
  await mkdir(framesDir, { recursive: true });
  const report = join(framesDir, 'flight-report.json');
  const gpuReport = join(framesDir, 'gpu-report.json');

  await withBrowserSession({ width: options.width, height: options.height, path: '/' }, async ({
    cdpPort, gpuAngle, send, evaluate: ev, delay, exceptions, consoleMessages,
  }) => {
    execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
      env: { ...process.env, GPU_REPORT: gpuReport }, stdio: 'inherit', timeout: 60000,
    });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    for (let i = 0; i < 300; i++) {
      if (await ev('!!window.simulator && window.simulator.startupReady === true')) break;
      await delay(200);
    }
    await ev(`(async () => {
      const s = window.simulator; window.s = s;
      try { (await import('/src/i18n/index.js')).setLanguage('en'); } catch {}
      s.lobby.airport = 'incheon';
      s.lobby.aircraft = 'F16';
      s.lobby.preset = 'runway';
      s.lobby.destination = 'jeju';
      await s.fly();
    })()`);
    let flightReady = false;
    for (let i = 0; i < 600; i++) {
      flightReady = await ev('!!window.s && !window.s.startingFlight && window.s.gameFlow.state === "flight"');
      if (flightReady) break;
      await delay(200);
    }
    if (!flightReady) throw new Error('flight start did not reach FLIGHT; aborting before screencast');
    await ev(`(() => { window.s.cameraSystem.setMode(1); return true; })()`);
    console.log('CONTROLLER', JSON.stringify(await ev(buildControllerSource())));

    const target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find(t => t.type === 'page');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', fail, { once: true });
    });
    let seq = 0;
    const pending = new Map();
    const frameTimes = [];
    let frameNo = 0;
    ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.method === 'Page.screencastFrame') {
        const { data: jpeg, sessionId, metadata } = msg.params;
        frameNo++;
        writeFileSync(join(framesDir, `frame_${String(frameNo).padStart(6, '0')}.jpg`),
          Buffer.from(jpeg, 'base64'));
        frameTimes.push((metadata?.timestamp ?? Date.now() / 1000) * 1000);
        ws.send(JSON.stringify({ id: ++seq, method: 'Page.screencastFrameAck', params: { sessionId } }));
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    });
    const raw = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    await raw('Page.enable');
    await raw('Page.startScreencast', { format: 'jpeg', quality: 78,
      maxWidth: options.width, maxHeight: options.height, everyNthFrame: 3 });
    console.log('RECORDING', JSON.stringify({ gpuAngle, framesDir, speed: options.speed }));

    let lastPhase = '';
    const polls = Math.ceil(options.maxSeconds / 5);
    for (let i = 0; i < polls; i++) {
      await delay(5000);
      const status = await ev(`(() => { const f = window.__flight, s = window.s; return {
        done: f?.done, phase: f?.phase, reason: f?.reason, crashed: f?.crashed,
        t: Math.round(s.totalSimTime), altFt: Math.round(s.telemetry.altitudeFt),
        ias: Math.round(s.telemetry.iasKnots) }; })()`);
      if (status.phase !== lastPhase) {
        lastPhase = status.phase;
        console.log('PHASE', JSON.stringify(status));
      }
      if (status.done) break;
    }
    await raw('Page.stopScreencast');
    ws.close();

    const flight = await ev(`(() => ({ ...window.__flight,
      log: window.__flight?.log ?? [], touchdowns: window.__flight?.touchdowns ?? [] }))()`);
    await writeFile(report, JSON.stringify({ gpuAngle, flight, frames: frameTimes.length,
      exceptions, consoleErrors: consoleMessages.filter(m => m.type === 'error').slice(-20) }, null, 2));
    console.log('FLIGHT', JSON.stringify({ done: flight.done, reason: flight.reason,
      crashed: flight.crashed, samples: flight.log.length }));

    const durations = playbackDurations(frameTimes, options.speed);
    const lines = [];
    for (let i = 0; i < frameTimes.length; i++) {
      const name = `frame_${String(i + 1).padStart(6, '0')}.jpg`;
      lines.push(`file '${join(framesDir, name)}'`, `duration ${(durations[i] / 1000).toFixed(5)}`);
    }
    if (frameTimes.length) {
      lines.push(`file '${join(framesDir, `frame_${String(frameTimes.length).padStart(6, '0')}.jpg`)}'`);
      const concat = join(framesDir, 'frames.txt');
      await writeFile(concat, lines.join('\n') + '\n');
      execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-f', 'concat', '-safe', '0',
        '-i', concat, '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', options.output],
      { stdio: 'inherit', timeout: 900000 });
    }
    console.log('VIDEO', JSON.stringify({ output: options.output, frames: frameTimes.length,
      speed: options.speed }));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryRun) dryRun();
  else await record(options);
}
