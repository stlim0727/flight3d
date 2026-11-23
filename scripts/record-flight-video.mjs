// Record a hardware-GPU browser sortie and encode it as an mp4.
// Speed is applied at encode time; the simulation itself always runs at 1x.
// Incheon → Jeju is the default; `--destination rkss` flies to the streamed
// Gimpo airport (RW14R). The flight-persona anomaly evaluator samples the
// sortie into `<output>.frames/flight-report.json`.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withBrowserSession } from './lib/browserHarness.mjs';
import {
  approachPhase,
  decelerationThrottle,
} from './lib/recordedSortieController.js';

/** Lobby destination, controller target and default output per supported sortie. */
export const SORTIE_DESTINATIONS = Object.freeze({
  jeju: { lobby: 'jeju', controller: 'jeju', label: 'jeju', output: 'f16-icn-jeju-200m.mp4' },
  rkss: { lobby: 'RKSS', controller: 'RKSS', label: 'gimpo', output: 'f16-icn-gimpo.mp4' },
});

export function resolveSortieDestination(value = 'jeju') {
  const key = String(value).toLowerCase();
  const destination = SORTIE_DESTINATIONS[key];
  if (!destination) {
    throw new Error(`Unknown destination ${value}; supported: ${Object.keys(SORTIE_DESTINATIONS).join(', ')}`);
  }
  return { key, ...destination };
}

const installController = destination => `(async () => {
  const mod = await import('/scripts/lib/recordedSortieController.js');
  return mod.installSortieController(window.s, ${JSON.stringify(destination.controller)});
})()`;

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
  const destination = resolveSortieDestination(args.get('destination') ?? 'jeju');
  return {
    dryRun: args.has('dry-run'),
    controllerCheck: args.has('controller-check'),
    speed,
    destination,
    output: resolve(args.get('output') ?? `.tmp/flight-video/${destination.output}`),
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

async function controllerCheck(options) {
  if (process.env.GPU_ANGLE && process.env.GPU_ANGLE !== 'vulkan') {
    throw new Error(`GPU_ANGLE=${process.env.GPU_ANGLE}; hardware Vulkan is required`);
  }
  process.env.GPU_ANGLE = 'vulkan';
  process.env.CHROME_PATH ||= '/home/stlim/.local/bin/chrome-headless';
  const gpuDir = resolve('.tmp/controller-check');
  await mkdir(gpuDir, { recursive: true });
  const check = (ok, message) => { if (!ok) throw new Error(message); };

  await withBrowserSession({ width: options.width, height: options.height, path: '/' }, async ({
    cdpPort, send, evaluate: ev, delay, exceptions,
  }) => {
    execFileSync(process.execPath, ['scripts/verify-browser-gpu.mjs', `http://127.0.0.1:${cdpPort}`], {
      env: { ...process.env, GPU_REPORT: join(gpuDir, 'gpu-report.json') }, stdio: 'inherit', timeout: 60000,
    });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    for (let i = 0; i < 300; i++) {
      if (await ev('!!window.simulator && window.simulator.startupReady === true')) break;
      await delay(200);
    }
    await ev(`(async () => {
      const s = window.simulator; window.s = s;
      s.lobby.airport = 'incheon'; s.lobby.aircraft = 'F16'; s.lobby.preset = 'runway';
      const select = document.getElementById('lobby-destination');
      if (select) {
        select.value = ${JSON.stringify(options.destination.lobby)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
      } else s.lobby.destination = ${JSON.stringify(options.destination.lobby)};
      await s.fly();
    })()`);
    let ready = false;
    for (let i = 0; i < 600; i++) {
      ready = await ev('!!window.s && !window.s.startingFlight && window.s.gameFlow.state === "flight"');
      if (ready) break;
      await delay(200);
    }
    check(ready, 'flight start did not reach FLIGHT');
    if (options.destination.key === 'rkss') {
      let mounted = false;
      for (let i = 0; i < 600; i++) {
        mounted = await ev("window.s?.airportStreamer?.status?.state === 'ready' && !!window.s?.world?.offsets?.get?.('RKSS') && !!window.s?.world?.regions?.get?.('RKSS')?.terrain?.runways?.length");
        if (mounted) break;
        await delay(200);
      }
      check(mounted, 'RKSS did not mount');
    }

    const installed = await ev(installController(options.destination));
    await delay(1500);
    const started = await ev(`(() => ({ phase: window.__flight.phase,
      samples: window.__flight.log.length, error: window.__flight.error ?? null }))()`);
    check(started.phase !== 'init' && started.samples > 0 && !started.error,
      `controller did not start: ${JSON.stringify(started)}`);

    const forceAt = (phase, alongM, crossM, speedMps = 0, simTime = null) =>
      ev(`(async () => {
        const w = await import('/src/world/UnifiedWorld.js');
        const a = await import('/src/config/approachData.js');
        const c = await import('/scripts/lib/recordedSortieController.js');
        const s = window.s;
        const dest = ${JSON.stringify(options.destination.controller)};
        const [ox, oz] = dest === 'RKSS' ? s.world.offsets.get('RKSS') : w.BASE_OFFSETS.jeju;
        const ap = dest === 'RKSS'
          ? c.streamedApproach(s.world.regions.get('RKSS'))
          : a.APPROACH_DATA.jeju;
        const th = ap.headingDeg * Math.PI / 180;
        const lx = ap.threshold.x - Math.sin(th) * ${alongM} + Math.cos(th) * ${crossM};
        const lz = ap.threshold.z + Math.cos(th) * ${alongM} + Math.sin(th) * ${crossM};
        s.position.set(ox + lx, 200, oz + lz);
        s.linearVelocity.set(${speedMps}, 0, 0);
        ${simTime === null ? '' : `s.totalSimTime = ${simTime};`}
        s.isCrashed = false;
        const f = window.__flight;
        f.done = false; f.crashed = false; f.reason = null; f.error = null;
        f.phase = '${phase}';
        return true;
      })()`);

    await forceAt('enroute', 20000, 0);
    await delay(2000);
    const enroute = await ev(`(() => ({ ias: Math.round(window.s.autopilot.targets.iasKnots),
      gear: +window.s.telemetry.gearState.toFixed(2), error: window.__flight.error ?? null }))()`);
    check(enroute.ias === 250 && enroute.gear > 0 && !enroute.error,
      `enroute gear-down speed: ${JSON.stringify(enroute)}`);

    await forceAt('intercept', 7000, 0);
    await delay(2000);
    const intercept = await ev(`(() => ({ lateral: window.s.autopilot.lateralMode,
      heading: Math.round(window.s.autopilot.targets.headingDeg), course: window.__flight.courseDeg,
      error: window.__flight.error ?? null }))()`);
    check(intercept.lateral === 'HDG' && Math.abs(intercept.heading - intercept.course) <= 5
      && !intercept.error, `intercept guidance: ${JSON.stringify(intercept)}`);

    await forceAt('final', 4000, 0);
    await delay(2000);
    const final = await ev(`(() => ({ master: window.s.autopilot.master,
      aileron: window.s.controls.virtualAileron, elevator: window.s.controls.virtualElevator,
      throttle: window.s.controls.throttle, error: window.__flight.error ?? null }))()`);
    check(!final.master && Number.isFinite(final.aileron) && Number.isFinite(final.elevator)
      && final.throttle >= 0.15 && !final.error, `final guidance: ${JSON.stringify(final)}`);

    await forceAt('flare', 2000, 500);
    await delay(2000);
    const aileronRight = await ev('window.s.controls.virtualAileron');
    await forceAt('flare', 2000, -500);
    await delay(2000);
    const flare = await ev(`(() => ({ aileron: window.s.controls.virtualAileron,
      error: window.__flight.error ?? null }))()`);
    check(Number.isFinite(aileronRight) && Number.isFinite(flare.aileron)
      && Math.abs(aileronRight - flare.aileron) > 0.01 && !flare.error,
    `flare lateral guidance: ${aileronRight} / ${JSON.stringify(flare)}`);

    await forceAt('rollout', 4000, 0, 5, 0);
    await delay(3500);
    const rollout = await ev(`(() => ({ pitch: window.__flight.rolloutPitchDeg,
      elevator: window.s.controls.virtualElevator, done: window.__flight.done,
      reason: window.__flight.reason, crashed: window.__flight.crashed,
      error: window.__flight.error ?? null }))()`);
    check(rollout.pitch < 10 && rollout.pitch >= 6.7 && Number.isFinite(rollout.elevator)
      && !rollout.error, `rollout pitch guidance: ${JSON.stringify(rollout)}`);
    check(exceptions.length === 0, `browser exceptions: ${JSON.stringify(exceptions)}`);

    console.log('CONTROLLER_CHECK', JSON.stringify({ started, enroute, intercept, final,
      flare: { aileronRight, aileronLeft: flare.aileron }, rollout }));
  });
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
      const select = document.getElementById('lobby-destination');
      if (select) {
        select.value = ${JSON.stringify(options.destination.lobby)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
      } else s.lobby.destination = ${JSON.stringify(options.destination.lobby)};
      await s.fly();
    })()`);
    let flightReady = false;
    for (let i = 0; i < 600; i++) {
      flightReady = await ev('!!window.s && !window.s.startingFlight && window.s.gameFlow.state === "flight"');
      if (flightReady) break;
      await delay(200);
    }
    if (!flightReady) throw new Error('flight start did not reach FLIGHT; aborting before screencast');
    if (options.destination.key === 'rkss') {
      let mounted = false;
      for (let i = 0; i < 600; i++) {
        mounted = await ev("window.s?.airportStreamer?.status?.state === 'ready' && !!window.s?.world?.offsets?.get?.('RKSS') && !!window.s?.world?.regions?.get?.('RKSS')?.terrain?.runways?.length");
        if (mounted) break;
        await delay(200);
      }
      if (!mounted) throw new Error('RKSS did not mount; aborting before screencast');
    }
    await ev(`(() => { window.s.cameraSystem.setMode(1); return true; })()`);
    const installed = await ev(installController(options.destination));
    if (installed?.ok !== true) throw new Error(`controller install failed: ${JSON.stringify(installed)}`);
    console.log('CONTROLLER', JSON.stringify(installed));
    await ev(`(async () => {
      const m = await import('/src/persona/flight_persona.js');
      window.__personaModule = m;
      window.__persona = { anomalies: [] };
      const evaluator = m.createAnomalyEvaluator({ sampleIntervalMs: 500,
        onAnomaly: anomaly => window.__persona.anomalies.push(anomaly) });
      window.__personaEvaluator = evaluator;
      evaluator.start(window.s);
      return true;
    })()`);

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
    const persona = await ev(`(() => {
      window.__personaEvaluator?.stop();
      return { anomalies: window.__persona?.anomalies ?? [],
        summary: window.__personaModule?.summarizeFlight?.(window.s) ?? null };
    })()`);
    await writeFile(report, JSON.stringify({ gpuAngle, destination: options.destination.key,
      flight, persona, frames: frameTimes.length,
      exceptions, consoleErrors: consoleMessages.filter(m => m.type === 'error').slice(-20) }, null, 2));
    console.log('FLIGHT', JSON.stringify({ done: flight.done, reason: flight.reason,
      crashed: flight.crashed, samples: flight.log.length,
      anomalies: persona.anomalies.length }));

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
  else if (options.controllerCheck) await controllerCheck(options);
  else await record(options);
}
