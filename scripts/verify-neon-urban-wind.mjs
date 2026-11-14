// Integrated Neon urban wind checks in a hardware-GPU Chrome (#697): the runway
// ground roll and climb-out in the light crosswind for C172/B738/F16 with a still-air
// control, the Neon demos, pause/restart/aircraft and region changes, replay of a
// recorded Neon sortie, and real-time frame time with the wind's per-tick cost.
// Preflight the browser first (docs/development/browser-gpu.md), then with Vite at SIM_URL:
//   CDP_URL=http://127.0.0.1:9441 SIM_URL=http://127.0.0.1:5173 node scripts/verify-neon-urban-wind.mjs
// Physics is stepped with stepSimulation while the wall clock is held, except in the
// real-time measurements. A test pilot sets only ordinary virtual control inputs.
// Evidence goes to ARTIFACT_DIR (default review-artifacts/neon-urban-wind/browser/).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cdp = process.env.CDP_URL || 'http://127.0.0.1:9441';
const url = process.env.SIM_URL || 'http://127.0.0.1:5173';
const directory = process.env.ARTIFACT_DIR || 'review-artifacts/neon-urban-wind/browser';
// PARTS=takeoff,demo,lifecycle,replay,realtime selects sections; default all.
const PARTS = new Set((process.env.PARTS || 'takeoff,demo,lifecycle,replay,realtime').split(','));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir(directory, { recursive: true });

const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), exceptions = [];
socket.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails);
  const request = pending.get(m.id);
  if (!request) return;
  pending.delete(m.id);
  if (m.error) request.reject(new Error(m.error.message)); else request.resolve(m.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (fn, ...args) => {
  const r = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const capture = async name => {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  await writeFile(path.join(directory, `${name}.jpg`), Buffer.from(data, 'base64'));
};

// In-page helpers, installed once: lobby start, clock hold and wind description.
const HELPERS = async () => {
  const { UrbanWindField } = await import('/src/physics/UrbanWindField.js');
  const { setSimulationWind } = await import('/src/physics/WindField.js');
  const laws = await import('/src/director/PilotControlLaws.js');
  const s = window.simulator, realDelta = s.clock.getDelta.bind(s.clock);
  window.__w = {
    laws, setSimulationWind,
    hold() { s.clock.getDelta = () => 0; },
    release() { s.clock.getDelta = realDelta; s.clock.getDelta(); },
    wind() {
      const f = s.windField;
      return f ? { urban: f instanceof UrbanWindField, profile: f.profile, seed: f.seed, meanSpeed: f.meanSpeed ?? null,
        meanFromDeg: f.meanFromDeg ?? null, time: s.windTimeSeconds } : null;
    },
    async start(aircraft, airport, preset) {
      s.demoDirector.stop(); s.replayDirector.stop(); s.gameFlow.returnToLobby(true);
      document.getElementById(`lobby-aircraft-${aircraft}`).click();
      document.getElementById(`lobby-airport-${airport}`).click();
      document.getElementById(`lobby-preset-${preset}`).click();
      document.getElementById('btn-fly').click();
      for (let i = 0; i < 3600 && (s.startingFlight || !document.getElementById('startup-overlay').hidden); i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      window.__w.hold();
      s.controls.clearVirtualInputs();
      return { aircraft: s.currentAircraftId, region: s.activeAirport, preset: s.lastPresetType, wind: window.__w.wind() };
    },
  };
  return true;
};

const report = { url, renderer: null, takeoff: [], demos: [], lifecycle: null, replay: null, realtime: [] };
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 240 && !ready; i++) {
    ready = await evaluate(() => Boolean(window.simulator?.startupReady)).catch(() => false);
    if (!ready) await delay(500);
  }
  assert.ok(ready, 'simulator ready');
  report.renderer = await evaluate(() => {
    const gl = window.simulator.renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
  });
  await evaluate(HELPERS);
  await evaluate(() => window.simulator.audio?.setMuted?.(true));

  // 1. Runway: parked hold, then ground roll, rotation and climb-out on 090 in the
  // light northerly crosswind, and the same roll in still air.
  for (const aircraft of PARTS.has('takeoff') ? ['c172', 'b738', 'f16'] : []) {
    for (const windOn of [true, false]) {
      const start = await evaluate(async a => window.__w.start(a, 'neon', 'rwy'), aircraft);
      assert.equal(start.region, 'neon'); assert.equal(start.preset, 'runway');
      assert.ok(start.wind?.urban, `${aircraft}: urban wind on the runway`);
      const roll = await evaluate(async windOn => {
        const s = window.simulator, { flyBank, flyVerticalPath } = window.__w.laws;
        if (!windOn) window.__w.setSimulationWind(s);
        const vr = { C172: 55, B738: 150, F16: 165 }[s.currentAircraftId];
        const p0 = s.position.clone();
        s.stepSimulation(10); // parked, brakes set
        const parkedDrift = s.position.distanceTo(p0);
        const lineZ = p0.z, wrap = d => ((d + 540) % 360) - 180, DEG = 180 / Math.PI;
        let liftoff = null, maxLineDev = 0, maxRoll = 0, minIas = Infinity, stalled = false, t = 0;
        const g = { min: Infinity, max: -Infinity }, wind = { min: Infinity, max: -Infinity };
        for (; t < 60 && !s.isCrashed; t += 0.05) {
          const tel = s.telemetry;
          s.controls.setVirtualInput('brakes', 0); s.controls.setVirtualInput('throttle', 1);
          const track = 90 - Math.atan2(s.position.z - lineZ, 300) * DEG;
          if (tel.onGround) {
            s.controls.setVirtualInput('rudder', Math.max(-1, Math.min(1, wrap(track - tel.headingDeg) * 0.1)));
            s.controls.setVirtualInput('aileron', 0);
            if (tel.iasKnots >= vr) flyVerticalPath(s, 0, vr + 20, tel, 0, s.currentAircraftId === 'C172' ? 8 : 10);
            else s.controls.setVirtualInput('elevator', 0);
          } else {
            liftoff ??= +t.toFixed(2);
            flyBank(s, Math.max(-10, Math.min(10, wrap(track - tel.headingDeg) * 1.2)), tel);
            flyVerticalPath(s, 4, vr + 25, tel);
            s.controls.setVirtualInput('throttle', 1);
            s.controls.setVirtualInput('rudder', Math.max(-0.2, Math.min(0.2, -s.aero.beta * 2)));
          }
          s.stepSimulation(0.05);
          maxLineDev = Math.max(maxLineDev, Math.abs(s.position.z - lineZ));
          if (liftoff !== null) { maxRoll = Math.max(maxRoll, Math.abs(s.telemetry.rollDeg)); minIas = Math.min(minIas, s.telemetry.iasKnots); }
          stalled ||= Boolean(s.telemetry.isStalled);
          g.min = Math.min(g.min, s.telemetry.gForce); g.max = Math.max(g.max, s.telemetry.gForce);
          const w = Math.hypot(s.aero.windWorld.x, s.aero.windWorld.z);
          wind.min = Math.min(wind.min, w); wind.max = Math.max(wind.max, w);
          if (liftoff !== null && t - liftoff > 30) break;
        }
        s.controls.clearVirtualInputs();
        return { aircraft: s.currentAircraftId, wind: windOn, vr, parkedDrift: +parkedDrift.toFixed(3), liftoffS: liftoff,
          maxLineDev: +maxLineDev.toFixed(1), maxRollAirborne: +maxRoll.toFixed(1), minIasAirborne: +minIas.toFixed(1),
          g: [+g.min.toFixed(2), +g.max.toFixed(2)], windSpeed: [+wind.min.toFixed(2), +wind.max.toFixed(2)],
          end: s.position.toArray().map(v => +v.toFixed(1)), crashed: Boolean(s.isCrashed), stalled };
      }, windOn);
      report.takeoff.push(roll);
      if (windOn) { await delay(500); await capture(`${aircraft}-climbout`); }
    }
  }

  // 2. Neon demos fly the same environment wind (C172 city routes, B738 classic). The
  // still-air control removes the field after every preset the demo itself applies.
  for (const [aircraft, profile, windOn] of PARTS.has('demo') ? [['C172', 'proximity'], ['C172', 'scenic'], ['C172', 'maneuvers'], ['B738', 'classic']]
    .flatMap(([a, p]) => [[a, p, true], [a, p, false]]) : []) {
    const armed = await evaluate(async (aircraft, profile, windOn) => {
      const s = window.simulator, d = s.demoDirector;
      d.stop(); s.replayDirector.stop();
      delete s.setPreset;
      if (!windOn) {
        const setPreset = s.setPreset.bind(s);
        s.setPreset = (...args) => { const r = setPreset(...args); window.__w.setSimulationWind(s); return r; };
      }
      s.setAircraft(aircraft); await s.setAirport('neon');
      for (let i = 0; i < 600 && s.startupReady !== true; i++) await new Promise(r => setTimeout(r, 100));
      Object.assign(s.lobby, { aircraft, airport: 'neon', preset: 'demo', demoProfile: profile });
      s.gameFlow.enterFlight();
      if (!s.gameFlow.pause()) s.gameFlow.isPhysicsFrozen = () => true;
      // start() returns false when refused and nothing otherwise.
      const refused = d.start('neon', profile) === false;
      return { started: !refused && d.isActive, profile: d.profile, wind: window.__w.wind() };
    }, aircraft, profile, windOn);
    const flown = await evaluate(async () => {
      const s = window.simulator, d = s.demoDirector;
      let t = 0, maxRoll = 0, minAgl = Infinity, stalled = false;
      const g = { min: Infinity, max: -Infinity }, wind = { min: Infinity, max: -Infinity }, stages = new Set();
      for (; t < 420 && d.isActive && !s.isCrashed; t += 0.25) {
        s.stepSimulation(0.25);
        stages.add(d.currentStage);
        const tel = s.telemetry;
        if (!tel.onGround) { maxRoll = Math.max(maxRoll, Math.abs(tel.rollDeg)); minAgl = Math.min(minAgl, tel.radioAltFt * 0.3048); }
        stalled ||= Boolean(tel.isStalled);
        g.min = Math.min(g.min, tel.gForce); g.max = Math.max(g.max, tel.gForce);
        const w = Math.hypot(s.aero.windWorld.x, s.aero.windWorld.z);
        wind.min = Math.min(wind.min, w); wind.max = Math.max(wind.max, w);
        if (Math.abs(t - 40) < 0.01) window.__w.midShot = true;
      }
      // The scenario's own outcome, read before stop() would turn a running result into 'cancelled'.
      const result = d.getActiveScenario?.()?.result ?? null;
      return { simSeconds: t, active: d.isActive, result: result ? { status: result.status, reason: result.reason ?? null } : null,
        crashed: Boolean(s.isCrashed), crash: s.crashResult?.type ?? null,
        stages: [...stages], maxRoll: +maxRoll.toFixed(1), minAglM: Number.isFinite(minAgl) ? +minAgl.toFixed(1) : null, stalled,
        heading: +s.telemetry.headingDeg.toFixed(1), position: s.position.toArray().map(v => +v.toFixed(1)),
        gear: s.gear.contacts.map(c => c.damageState),
        g: [+g.min.toFixed(2), +g.max.toFixed(2)], windSpeed: [+wind.min.toFixed(2), +wind.max.toFixed(2)],
        windTime: +s.windTimeSeconds.toFixed(2), urban: window.__w.wind()?.urban ?? false };
    });
    report.demos.push({ aircraft, profile, wind: windOn, armed, ...flown });
    if (windOn) { await delay(400); await capture(`demo-${aircraft.toLowerCase()}-${profile}`); }
    await evaluate(() => { const s = window.simulator; s.demoDirector.stop(); delete s.setPreset; s.gameFlow.resume?.(); });
  }

  // 3. Lifecycle: physics-time wind, pause, restart, aircraft and region changes.
  if (PARTS.has('lifecycle')) report.lifecycle = await evaluate(async () => {
    const s = window.simulator, w = window.__w, out = {};
    out.start = await w.start('c172', 'neon', 'cru');
    s.stepSimulation(5);
    out.afterStep = { time: +s.windTimeSeconds.toFixed(4), sample: s.aero.windWorld.toArray() };
    // Real frames run while paused: wind time must not move.
    w.release(); s.gameFlow.pause();
    const pausedAt = s.windTimeSeconds;
    await new Promise(r => setTimeout(r, 1500));
    out.pause = { before: pausedAt, after: s.windTimeSeconds, state: s.gameFlow.state };
    // Restart from the pause menu repeats the spawn, seed and wind clock.
    document.getElementById('btn-pause-restart').click();
    w.hold();
    out.restart = { time: s.windTimeSeconds, wind: w.wind(), state: s.gameFlow.state };
    s.stepSimulation(5);
    out.restart.sample = s.aero.windWorld.toArray();
    out.restart.repeats = out.restart.sample.every((v, i) => Math.abs(v - out.afterStep.sample[i]) < 1e-9);
    out.b738 = await w.start('b738', 'neon', 'cru');
    out.f16 = await w.start('f16', 'neon', 'app');
    out.coastal = await w.start('b738', 'coastal', 'rwy');
    s.stepSimulation(1);
    out.coastal.windWorld = s.aero.windWorld.toArray();
    out.back = await w.start('c172', 'neon', 'bridge');
    return out;
  });

  // 4. Replay is state playback: it never advances the wind or re-integrates physics.
  if (PARTS.has('replay')) report.replay = await evaluate(async () => {
    const s = window.simulator, w = window.__w;
    await w.start('c172', 'neon', 'cru');
    const poses = [];
    for (let i = 1; i <= 20; i++) { s.stepSimulation(1); poses.push({ t: i, p: s.position.toArray() }); }
    const windAtEnd = s.windTimeSeconds;
    const track = s.replayRecorder.finish();
    if (!track) return { recorded: false };
    const loaded = await s.replayDirector.load(track);
    w.hold();
    const windAtLoad = s.windTimeSeconds;
    s.replayDirector.seek(10); s.replayDirector.update(0);
    const at10 = s.position.toArray();
    s.replayDirector.play(); s.stepSimulation(5);
    const out = { recorded: true, loaded, samples: track.samples.length, metadata: track.metadata, windAtEnd: +windAtEnd.toFixed(3),
      windAtLoad, windAfterPlay: s.windTimeSeconds, replayWind: w.wind(),
      poseError10s: Math.hypot(...at10.map((v, i) => v - poses[9].p[i])), progress: s.replayDirector.progressSec };
    s.replayDirector.stop();
    return out;
  });

  // 5. Real time: frame time and the wind's cost per 120 Hz tick, with and without wind.
  // The page clock is coarse (about 0.1 ms without cross-origin isolation), so the
  // wind's own cost is also timed in bulk: 12,000 ticks of three samples (B738 half span)
  // along the canyon line, in the page's JavaScript engine.
  if (PARTS.has('realtime')) report.bench = await evaluate(async () => {
    const { UrbanWindField } = await import('/src/physics/UrbanWindField.js');
    const { NEON_WIND } = await import('/src/config/neonWind.js');
    const field = new UrbanWindField(NEON_WIND), o = {}, runs = [];
    for (let run = 0; run < 5; run++) {
      const a = performance.now();
      for (let i = 0; i < 12000; i++) {
        const x = 200 + (i % 7200) * 0.5;
        for (const dz of [0, -8.95, 8.95]) field.sample({ x, y: 110, z: dz }, i / 120, o);
      }
      runs.push((performance.now() - a) / 12000);
    }
    return { msPerTick: runs.map(v => +v.toFixed(5)) };
  });
  for (const [aircraft, preset] of PARTS.has('realtime') ? [['c172', 'app'], ['b738', 'cru'], ['f16', 'app']] : []) {
    for (const windOn of [true, false]) {
      await evaluate(async (a, p) => window.__w.start(a, 'neon', p), aircraft, preset);
      const result = await evaluate(async windOn => {
        const s = window.simulator, w = window.__w;
        if (!windOn) w.setSimulationWind(s);
        const ticks = [], frames = [];
        let windCost = 0;
        const field = s.windField;
        if (field) {
          const sample = field.sample.bind(field);
          field.sample = (p, t, o) => { const a = performance.now(); const r = sample(p, t, o); windCost += performance.now() - a; return r; };
        }
        const integrate = s.integratePhysics.bind(s), windTicks = [];
        s.integratePhysics = dt => { windCost = 0; const a = performance.now(); integrate(dt); ticks.push(performance.now() - a); if (field) windTicks.push(windCost); };
        w.release();
        const t0 = s.windTimeSeconds;
        await new Promise(resolve => {
          let last = performance.now(), n = 0;
          const frame = now => { frames.push(now - last); last = now; if (++n < 600) requestAnimationFrame(frame); else resolve(); };
          requestAnimationFrame(frame);
        });
        w.hold();
        delete s.integratePhysics;
        if (field) delete field.sample;
        const pct = (a, p) => { const v = [...a].sort((x, y) => x - y); return +v[Math.min(v.length - 1, Math.floor(v.length * p))].toFixed(4); };
        frames.shift();
        return { aircraft: s.currentAircraftId, preset: s.lastPresetType, wind: windOn, frames: frames.length,
          frameP50: pct(frames, 0.5), frameP95: pct(frames, 0.95), ticks: ticks.length, tickP50: pct(ticks, 0.5), tickP95: pct(ticks, 0.95),
          windP50: windTicks.length ? pct(windTicks, 0.5) : null, windP95: windTicks.length ? pct(windTicks, 0.95) : null,
          windSeconds: +(s.windTimeSeconds - t0).toFixed(2), crashed: Boolean(s.isCrashed) };
      }, windOn);
      report.realtime.push(result);
      if (windOn) { await delay(300); await capture(`realtime-${aircraft}-${preset}`); }
    }
  }
} finally {
  report.exceptions = exceptions.map(e => e.exception?.description ?? e.text);
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await fetch(`${cdp}/json/close/${target.id}`).catch(() => {});
  socket.close();
}

console.log(`renderer: ${report.renderer}`);
for (const r of report.takeoff) console.log('takeoff', JSON.stringify(r));
for (const d of report.demos) console.log('demo', JSON.stringify(d));
console.log('lifecycle', JSON.stringify(report.lifecycle));
console.log('replay', JSON.stringify(report.replay));
for (const r of report.realtime) console.log('realtime', JSON.stringify(r));
if (report.bench) console.log('bench', JSON.stringify(report.bench));
console.log(`exceptions: ${report.exceptions.length}`);

for (const r of report.takeoff) {
  assert.equal(r.crashed, false, `${r.aircraft} takeoff crashed (wind ${r.wind})`);
  assert.ok(r.liftoffS !== null, `${r.aircraft} lifted off (wind ${r.wind})`);
  assert.ok(r.parkedDrift < 0.5, `${r.aircraft} parked drift ${r.parkedDrift} m`);
}
// Known before any Neon wind (origin/main 359813e, still air): the C172 city route and
// the B738 classic demo (the coastal choreography flown at Neon) hit a tower. They are
// reported, not asserted; the demo sweep does not cover Neon.
const KNOWN_DEMO_FAULTS = new Set(['C172/scenic', 'B738/classic']);
for (const d of report.demos) {
  const id = `${d.aircraft}/${d.profile}`;
  assert.ok(d.armed.started, `${id} demo started`);
  assert.equal(Boolean(d.armed.wind?.urban), d.wind, `${id} demo wind ${d.wind}`);
  if (KNOWN_DEMO_FAULTS.has(id)) {
    if (d.result?.status !== 'completed') {
      console.log(`known demo fault ${id} (wind ${d.wind}): ${d.crash ?? d.result?.reason ?? d.result?.status} at ${d.simSeconds} s`);
    }
    continue;
  }
  assert.equal(d.crashed, false, `${id} demo crashed (wind ${d.wind}): ${d.crash}`);
  // A scenario can stop itself as failed without a crash (stage timeout, invalid
  // command), and a demo still active at the step limit has not finished either.
  assert.equal(d.active, false, `${id} demo still active at ${d.simSeconds} s (wind ${d.wind})`);
  assert.equal(d.result?.status, 'completed', `${id} demo result ${JSON.stringify(d.result)} (wind ${d.wind})`);
}
const l = report.lifecycle;
if (l) {
  assert.equal(l.pause.after, l.pause.before, 'paused frames do not advance the wind');
  assert.equal(l.restart.time, 0); assert.ok(l.restart.repeats, 'restart repeats the wind sequence');
  assert.ok(l.b738.wind?.urban && l.f16.wind?.urban && l.back.wind?.urban, 'Neon keeps its wind across aircraft and presets');
  assert.equal(l.coastal.wind, null); assert.deepEqual(l.coastal.windWorld, [0, 0, 0]);
}
if (report.replay) {
  assert.ok(report.replay.recorded && report.replay.loaded, 'Neon sortie recorded and loaded');
  assert.equal(report.replay.windAfterPlay, report.replay.windAtLoad, 'replay does not advance the wind');
  assert.ok(report.replay.poseError10s < 1, `replay pose at 10 s within 1 m (${report.replay.poseError10s})`);
}
// Still air has no field, so only the wind run advances wind time.
for (const r of report.realtime) {
  assert.ok(r.ticks > 0 && !r.crashed && (r.wind ? r.windSeconds > 0 : r.windSeconds === 0),
    `${r.aircraft} real-time flight advanced (wind ${r.wind})`);
}
assert.equal(report.exceptions.length, 0, 'page exceptions');
