// Flies the Neon canyon line through every wind comparison site (#695) in C172, B738
// and F16 with production physics and the region's background wind, and captures the
// slot, canal, lee and rooftop. Run against a checked hardware-GPU Chrome
// (docs/development/browser-gpu.md) with Vite serving SIM_URL:
//   CDP_URL=http://127.0.0.1:9441 SIM_URL=http://127.0.0.1:5173 node scripts/verify-neon-canyon.mjs
// A test pilot sets only ordinary virtual control inputs (no teleport, force or pose
// override after the preset): wings toward z = 0 and the path toward 110 m.
// Jets accelerate to 180 kt; the C172 keeps its spawn speed. Evidence goes
// to ARTIFACT_DIR (default review-artifacts/neon-canyon/).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cdp = process.env.CDP_URL || 'http://127.0.0.1:9441';
const url = process.env.SIM_URL || 'http://127.0.0.1:5173';
const directory = process.env.ARTIFACT_DIR || 'review-artifacts/neon-canyon';
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const capture = async name => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(directory, `${name}.png`), Buffer.from(data, 'base64'));
};

const report = { url, renderer: null, flights: [] };
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

  for (const aircraft of ['c172', 'b738', 'f16']) {
    const start = await evaluate(async aircraft => {
      const s = window.simulator;
      s.demoDirector.stop(); s.gameFlow.returnToLobby(true);
      document.getElementById(`lobby-aircraft-${aircraft}`).click();
      document.getElementById('lobby-airport-neon').click();
      document.getElementById('lobby-preset-app').click();
      document.getElementById('btn-fly').click();
      for (let i = 0; i < 3600 && (s.startingFlight || !document.getElementById('startup-overlay').hidden); i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      // Hold real time still: only stepSimulation advances physics; the loop keeps rendering.
      s.clock.getDelta = () => 0;
      s.cameraSystem.setMode(1, true);
      return { aircraft: s.currentAircraftId, region: s.activeAirport, preset: s.lastPresetType,
        wind: s.windField ? { profile: s.windField.profile } : null, position: s.position.toArray(), speed: s.linearVelocity.length() };
    }, aircraft);
    assert.equal(start.region, 'neon'); assert.equal(start.preset, 'approach');
    assert.ok(start.wind, `${aircraft}: Neon background wind installed`);

    // The C172 holds its spawn speed; the jets spawn at 70 m/s (136 kt), close to a
    // clean B738's stall, and the pilot accelerates them to 180 kt.
    const targetIas = start.aircraft === 'C172' ? start.speed * 1.943844 : 180;
    const flight = { start, targetIas, legs: [] };
    // Fly leg by leg to each site's centre, capturing it, then on past the east shore.
    const stops = await evaluate(async () => (await import('/src/config/neonBuildings.js')).NEON_WIND_SITES.map(s => ({ id: s.id, x: s.x })));
    for (const stop of [...stops, { id: 'east-shore', x: 4100 }]) {
      const leg = await evaluate(async (stopX, targetIas) => {
        const { flyBank, flyVerticalPath } = await import('/src/director/PilotControlLaws.js');
        const { NEON_WIND_SITES, NEON_TOWERS, towerCorners } = await import('/src/config/neonBuildings.js');
        const s = window.simulator, out = { samples: 0, maxAbsZ: 0, minY: Infinity, maxY: -Infinity, minGap: Infinity, sites: {} };
        const near = NEON_TOWERS.filter(t => t.h + 8 > 60);
        for (let i = 0; i < 2400 && !s.isCrashed && s.position.x < stopX; i++) {
          const tel = s.telemetry;
          // Aim 250 m ahead on the canyon line.
          const heading = 90 - Math.atan2(s.position.z, 250) * 180 / Math.PI;
          const error = ((heading - tel.headingDeg + 540) % 360) - 180;
          flyBank(s, Math.max(-15, Math.min(15, error * 1.5)), tel);
          flyVerticalPath(s, Math.max(-2, Math.min(2, (110 - s.position.y) * 0.4)), targetIas, tel);
          s.controls.setVirtualInput('rudder', Math.max(-0.2, Math.min(0.2, -s.aero.beta * 2)));
          s.stepSimulation(0.05);
          const p = s.position, w = s.aero.windWorld;
          out.samples++; out.maxAbsZ = Math.max(out.maxAbsZ, Math.abs(p.z));
          out.minY = Math.min(out.minY, p.y); out.maxY = Math.max(out.maxY, p.y);
          for (const t of near) {
            if (Math.abs(t.x - p.x) > 200 || p.y > t.h + 8) continue;
            for (const [, cz] of towerCorners(t)) out.minGap = Math.min(out.minGap, Math.abs(cz - p.z));
          }
          for (const site of NEON_WIND_SITES) {
            if (Math.hypot(p.x - site.x, p.z) > site.region.radius) continue;
            const a = out.sites[site.id] ??= { n: 0, sum: [0, 0, 0], sq: [0, 0, 0] };
            a.n++; [w.x, w.y, w.z].forEach((v, k) => { a.sum[k] += v; a.sq[k] += v * v; });
          }
        }
        return { ...out, crashed: s.isCrashed, crash: s.isCrashed ? String(s.crashReason ?? s.lastCrash?.type ?? 'crash') : null,
          position: s.position.toArray(), ias: s.telemetry.iasKnots ?? null, roll: s.telemetry.rollDeg, simTime: s.windTimeSeconds };
      }, stop.x, targetIas);
      flight.legs.push({ stop: stop.id, ...leg });
      if (leg.crashed) break;
      if (['slot', 'canal', 'lee', 'rooftop'].includes(stop.id)) { await delay(700); await capture(`${aircraft}-${stop.id}`); }
    }
    report.flights.push(flight);
    await evaluate(() => window.simulator.controls.clearVirtualInputs());
  }
} finally {
  report.exceptions = exceptions.map(e => e.exception?.description ?? e.text);
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await fetch(`${cdp}/json/close/${target.id}`).catch(() => {});
  socket.close();
}

// Summary: per aircraft, crashes, worst lateral and height deviation, nearest tower edge,
// and the wind RMS (about the site mean, m/s) inside each site.
for (const f of report.flights) {
  const legs = f.legs, crashed = legs.some(l => l.crashed);
  const sites = {};
  for (const l of legs) {
    for (const [id, a] of Object.entries(l.sites)) {
      const t = sites[id] ??= { n: 0, sum: [0, 0, 0], sq: [0, 0, 0] };
      t.n += a.n; for (let k = 0; k < 3; k++) { t.sum[k] += a.sum[k]; t.sq[k] += a.sq[k]; }
    }
  }
  const rms = Object.fromEntries(Object.entries(sites).map(([id, a]) => [id,
    a.sum.map((s, k) => Math.sqrt(Math.max(0, a.sq[k] / a.n - (s / a.n) ** 2)).toFixed(2)).join('/')]));
  console.log(JSON.stringify({ aircraft: f.start.aircraft, wind: f.start.wind?.profile, crashed,
    reached: legs.at(-1).position.map(v => Math.round(v)), maxAbsZ: +Math.max(...legs.map(l => l.maxAbsZ)).toFixed(1),
    y: [Math.min(...legs.map(l => l.minY)), Math.max(...legs.map(l => l.maxY))].map(v => +v.toFixed(1)),
    minTowerGap: +Math.min(...legs.map(l => l.minGap ?? Infinity)).toFixed(1), windRmsXYZ: rms }));
  assert.equal(crashed, false, `${f.start.aircraft} crashed: ${legs.find(l => l.crashed)?.crash}`);
  assert.ok(legs.at(-1).position[0] >= 4100, `${f.start.aircraft} reached the east shore`);
  // Wings stay clear of every tower edge beside the line (largest half span 17.9 m).
  assert.ok(Math.min(...legs.map(l => l.minGap ?? Infinity)) > 30, `${f.start.aircraft} passed within 30 m of a tower`);
}
console.log(`renderer: ${report.renderer}; exceptions: ${report.exceptions.length}`);
assert.equal(report.exceptions.length, 0, 'page exceptions');
