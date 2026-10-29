#!/usr/bin/env node
/**
 * @file Cinematic demo sweep: fast-play every demo route and judge the flight.
 *
 * The routes are flown by the app's own deterministic 120 Hz physics, not by
 * wall-clock frames: `sim.stepSimulation(s)` runs `s * 120` true substeps and the
 * demo director's stage timers advance inside those substeps, so the slice length is
 * only a sampling resolution — the choreography can neither be fooled by it nor faked
 * by it. Wall-clock integration is frozen with the sanctioned
 * `gameFlow.enterFlight()` + `gameFlow.pause()`.
 *
 * Route declarations live in scripts/lib/demoSweepSpec.mjs and the rules in
 * scripts/lib/abnormalityChecks.mjs, both covered by tests/demoSweepChecks.test.js.
 * Exit status is non-zero when any route has a FAIL, or any REPORT under
 * `--strict` / `STRICT=1`.
 *
 *   node scripts/demo-sweep.mjs [--tier core|full|all] [--only id,id] [--shots]
 *                               [--strict] [--retries N] [--update-baseline]
 *   Environment: TIER ONLY SHOTS STRICT RETRIES APP_URL PORT CDP_PORT CHROME_BIN
 *                ARTIFACT_DIR DEV_SERVER FORCE_GPU SLICE
 *
 * Ports come from the OS and the browser is private to this process, so it runs
 * anywhere Chrome runs: no fixed 5173, no shared debug profile, no external network
 * (the Lukla DEM ships in `public/terrain/`).
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES, routesForTier } from './lib/demoSweepSpec.mjs';
import { createState, classifySample, finalizeRoute } from './lib/abnormalityChecks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = path.join(ROOT, 'scripts', 'demo-sweep-baseline.json');
const argv = process.argv.slice(2);

function flag(name) {
  const index = argv.indexOf(name);
  if (index < 0) return false;
  argv.splice(index, 1);
  return true;
}

function take(name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith('--')) return fallback;
  const value = argv[index + 1];
  argv.splice(index, 2);
  return value;
}

const TIER = take('--tier', process.env.TIER || 'core');
const ONLY = String(take('--only', process.env.ONLY || '')).split(',').map(id => id.trim()).filter(Boolean);
const SHOTS = flag('--shots') || process.env.SHOTS === '1';
const STRICT = flag('--strict') || process.env.STRICT === '1';
const RETRIES = Math.max(1, Number(take('--retries', process.env.RETRIES || '1')) || 1);
const UPDATE_BASELINE = flag('--update-baseline');
if (argv.length) {
  console.error(`Unknown argument(s): ${argv.join(' ')}`);
  console.error('Usage: node scripts/demo-sweep.mjs [--tier core|full|all] [--only id,id] [--shots] [--strict] [--retries N] [--update-baseline]');
  process.exit(2);
}
const SLICE = Number(process.env.SLICE || 0.25);
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(ROOT, '.cache', 'demo-sweep');
/** `KEEP_SAMPLES=1` writes every slice into the report, for reading a finding in context. */
const KEEP_SAMPLES = process.env.KEEP_SAMPLES === '1';
/** Slices flown past the handoff, so the cockpit state after `stop()` is sampled, not guessed. */
const IDLE_SLICES = 4;

const selected = ONLY.length
  ? ROUTES.filter(route => ONLY.includes(route.id))
  : routesForTier(TIER);
if (!selected.length) {
  console.error(`No routes matched (tier "${TIER}", only "${ONLY.join(',')}"). Known ids:\n  ${ROUTES.map(r => r.id).join('\n  ')}`);
  process.exit(2);
}
const unknown = ONLY.filter(id => !ROUTES.some(route => route.id === id));
if (unknown.length) {
  console.error(`Unknown route id(s): ${unknown.join(', ')}\n  Known: ${ROUTES.map(r => r.id).join(', ')}`);
  process.exit(2);
}

const log = (...args) => console.log(...args);

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function findChrome() {
  return [process.env.CHROME_BIN, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome']
    .filter(Boolean).find(binary => fs.existsSync(binary));
}

/** The real GPU when this account may open it, SwiftShader when it may not. */
function gpuFlags() {
  const device = '/dev/dri/renderD128';
  let usable = false;
  try { fs.accessSync(device, fs.constants.W_OK); usable = true; } catch { /* container without a render node */ }
  if (process.env.FORCE_GPU === '0') usable = false;
  if (process.env.FORCE_GPU === '1') usable = true;
  return usable
    ? ['--use-gl=angle', '--use-angle=vulkan']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
}

/** Chrome refuses to start its own sandbox as root (containers); a normal user keeps it. */
function sandboxFlags() {
  return typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : [];
}

async function waitForUrl(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error(`nothing answered at ${url}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function startServer() {
  if (process.env.APP_URL) {
    await waitForUrl(process.env.APP_URL);
    return { url: process.env.APP_URL, label: 'external', stop() {} };
  }
  const port = Number(process.env.PORT || await freePort());
  const url = `http://127.0.0.1:${port}/`;
  const vite = path.join(ROOT, 'node_modules', '.bin', 'vite');
  const preview = process.env.DEV_SERVER !== '1' && fs.existsSync(path.join(ROOT, 'dist', 'index.html'));
  if (preview && !fs.existsSync(path.join(ROOT, 'dist'))) throw new Error('run `npm run build` first');
  log(`· vite ${preview ? 'preview (dist/)' : 'dev'} on ${url}`);
  const child = spawn(vite, preview
    ? ['preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1']
    : ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
  let exited = null;
  child.once('exit', (code, signal) => { exited = signal || code; });
  try {
    await waitForUrl(url);
  } catch (error) {
    throw new Error(`${error.message} (vite exited with ${exited})`);
  }
  return { url, label: preview ? 'preview' : 'dev', stop() { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } } };
}

async function startChrome() {
  const binary = findChrome();
  if (!binary) throw new Error('no Chrome binary found; set CHROME_BIN');
  const port = Number(process.env.CDP_PORT || await freePort());
  const profileDir = path.join(process.env.TMPDIR || '/tmp', `flight3d-demo-sweep-${port}`);
  const child = spawn(binary, [
    '--headless=new', `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`,
    '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage',
    '--window-size=1280,720', '--hide-scrollbars', ...gpuFlags(), ...sandboxFlags(), 'about:blank',
  ], { stdio: 'ignore', detached: true });

  let targets = [];
  const deadline = Date.now() + 45000;
  for (;;) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some(target => target.type === 'page')) break;
    } catch { /* still starting */ }
    if (Date.now() > deadline) {
      throw new Error(`headless Chrome never exposed a debug target on ${port} — check CHROME_BIN, `
        + 'the GPU flags (FORCE_GPU=0 for SwiftShader) and that this user may create sandboxes');
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return {
    version: targets[0]?.browser || path.basename(binary),
    openPage: async url => (await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json()),
    closePage: async target => { await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {}); },
    stop() {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** A small Chrome DevTools Protocol client: one socket per page, values returned by value. */
class Page {
  constructor(target) {
    this.target = target;
    this.problems = [];
    this.sequence = 0;
    this.pending = new Map();
  }

  static async connect(target) {
    const page = new Page(target);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    page.socket = socket;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && page.pending.has(message.id)) {
        const { resolve, reject, timer } = page.pending.get(message.id);
        clearTimeout(timer);
        page.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      const problem = describe(message);
      if (problem) page.problems.push(problem);
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
    });
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Log.enable').catch(() => { /* older builds drop this domain */ });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    return page;
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      // A page that stops answering must not hang the whole CI job.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 180000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(functionBody, arg) {
    const expression = arg === undefined ? `(${functionBody})()` : `(${functionBody})(${JSON.stringify(arg)})`;
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(`in-page failure: ${result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails).slice(0, 500)}`);
    }
    return result.result.value;
  }

  async screenshot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  }

  close() { try { this.socket.close(); } catch { /* already gone */ } }
}

function describe(message) {
  if (message.method === 'Runtime.exceptionThrown') {
    const detail = message.params.exceptionDetails || {};
    return String(detail.exception?.description || detail.text || 'uncaught exception').split('\n')[0].slice(0, 300);
  }
  if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') {
    const entry = message.params.entry;
    // Chrome asks for /favicon.ico whether or not the page declares one; the app ships
    // none, so that 404 is the browser's own request rather than a broken flight asset.
    if (entry.networkUrl?.endsWith('/favicon.ico') || /favicon\.ico/.test(entry.url || '')) return null;
    return `${String(entry.text).slice(0, 200)}${entry.url ? ` <${String(entry.url).slice(0, 200)}>` : ''}`;
  }
  return null;
}

/** Once per page. `window.__sweep` is swapped per route, so the wrappers stay installed. */
const INSTRUMENT = `() => {
  const sim = window.simulator, director = sim.demoDirector;
  if (!director.__sweepStages) {
    const setStage = director.setStage.bind(director);
    director.setStage = (stage, options) => { window.__sweep?.stages.push(stage); return setStage(stage, options); };
    director.__sweepStages = true;
  }
  if (!sim.gear.__sweepTouchdowns) {
    const update = sim.gear.update.bind(sim.gear);
    sim.gear.update = (...args) => {
      const result = update(...args);
      const sweep = window.__sweep;
      if (sweep) for (const contact of result?.touchdownContacts || []) {
        sweep.touchdowns.push({ id: contact.id, sink: Number(Number(contact.sinkRate).toFixed(2)) });
      }
      return result;
    };
    sim.gear.__sweepTouchdowns = true;
  }
  if (!sim.flightWarnings.__sweepWarnings) {
    const update = sim.flightWarnings.update.bind(sim.flightWarnings);
    sim.flightWarnings.update = (...args) => {
      const active = update(...args) || [];
      const sweep = window.__sweep;
      if (sweep) for (const warning of active) sweep.warnings.add(warning.id);
      return active;
    };
    sim.flightWarnings.__sweepWarnings = true;
  }
  return true;
}`;

const ARM = `({ aircraft, airport, profile, slice }) => {
  const sim = window.simulator, director = sim.demoDirector;
  window.__sweep = { stages: [], touchdowns: [], warnings: new Set(), slice };
  director.stop();
  sim.audio?.setMuted?.(true);
  sim.setAircraft(aircraft);
  return sim.setAirport(airport).then(() => {
    if (sim.lobby) {
      sim.lobby.aircraft = aircraft; sim.lobby.airport = airport;
      sim.lobby.preset = 'demo'; sim.lobby.demoProfile = profile;
    }
    sim.gameFlow.enterFlight();
    // The sanctioned freeze; patching isPhysicsFrozen is the fallback only.
    if (!sim.gameFlow.pause()) sim.gameFlow.isPhysicsFrozen = () => true;
    const started = director.start(airport, profile);
    return { started, active: director.isActive, aircraft: sim.currentAircraftId,
      airport: sim.activeAirport, profile: director.profile };
  });
}`;

const WAIT = `() => {
  const director = window.simulator.demoDirector;
  director.update(0);
  return { waiting: director.waitingForTerrain, active: director.isActive, stage: director.currentStage };
}`;

/**
 * Step one slice without draining anything. Re-posing the airframe between routes on a
 * shared page leaves the *previous* route's cached telemetry for the first sample
 * (measured: IAS and altitude lag the preset by one slice), and the buffers stay
 * untouched here, so the evidence a stage entry produced still reaches the judged slice.
 */
const PRIME = `() => {
  const sim = window.simulator;
  sim.stepSimulation(window.__sweep.slice);
  return sim.telemetry.iasKnots;
}`;

const SAMPLE = `() => {
  const sim = window.simulator, director = sim.demoDirector, tel = sim.telemetry, sweep = window.__sweep;
  const n = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
  sim.stepSimulation(sweep.slice);
  // Drain after the slice, so nothing that happened while the route was armed is lost and
  // nothing is reported a slice late.
  const stages = sweep.stages.splice(0);
  const touchdowns = sweep.touchdowns.splice(0);
  const warningIds = [...sweep.warnings];
  sweep.warnings = new Set();
  const controls = sim.controls, airport = sim.currentAirport, position = sim.position;
  const terrain = sim.currentTerrain?.getHeight ? sim.currentTerrain.getHeight(position.x, position.z) : 0;
  const surface = Math.max(terrain, sim.water ? sim.water.waterLevel : -Infinity);
  const finite = [...position.toArray(), ...sim.quaternion.toArray(), ...sim.linearVelocity.toArray(),
    ...sim.angularVelocity.toArray(), ...Object.values(sim.gear.bodyDamage)].every(Number.isFinite);
  return {
    simTime: n(director.totalTimer), active: director.isActive, stage: director.currentStage,
    stageTransitions: stages, aircraft: sim.currentAircraftId,
    finite, crashed: Boolean(sim.isCrashed),
    crashType: sim.crashResult?.type ?? null, crashDescription: sim.crashResult?.description ?? null,
    iasKnots: n(tel.iasKnots, 1), mach: n(tel.mach, 3), altitudeFt: n(tel.altitudeFt, 0),
    radioAltFt: n(tel.radioAltFt, 0), pitchDeg: n(tel.pitchDeg, 1), rollDeg: n(tel.rollDeg, 1),
    headingDeg: n(tel.headingDeg, 1), gForce: n(tel.gForce), vsiFpm: n(tel.vsiFpm, 0),
    angularRates: sim.angularVelocity.toArray().map(rate => n(rate, 3)),
    onGround: Boolean(tel.onGround), groundSpeedMs: n(Math.hypot(sim.linearVelocity.x, sim.linearVelocity.z)),
    position: [n(position.x, 1), n(position.y, 1), n(position.z, 1)],
    aglM: n(position.y - surface, 1),
    onRunway: airport?.isOnRunway ? Boolean(airport.isOnRunway(position.x, position.z)) : null,
    inSafetyArea: airport?.isRunwaySafetyArea ? Boolean(airport.isRunwaySafetyArea(position.x, position.z)) : null,
    stalled: Boolean(tel.isStalled), landingIncident: Boolean(sim.landingIncident),
    gearStates: sim.gear.contacts.map(contact => contact.damageState),
    gearDamageMax: n(Math.max(0, ...sim.gear.contacts.map(contact => contact.damage)), 4),
    bodyContacts: (tel.bodyContacts || []).map(contact => contact.id),
    touchdowns, warningIds,
    spoilers: n(sim.aero.spoilers), reverser: n(sim.engines.reverserDeployment),
    brakes: n(controls.brakes), throttle: n(controls.throttle),
    controlsDisabled: Boolean(controls.aircraftControlsDisabled),
    virtualInputs: { elevator: controls.virtualElevator, aileron: controls.virtualAileron,
      rudder: controls.virtualRudder, brakes: controls.virtualBrakes },
    result: director.getActiveScenario?.()?.result ?? null,
    heapMb: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576),
  };
}`;

const DISARM = `() => {
  const sim = window.simulator;
  sim.demoDirector.stop();
  window.__sweep = null;
  return true;
}`;

/** Fly one route and return its classified state; the caller judges it. */
async function flyRoute(page, route) {
  const armed = await page.evaluate(ARM, { aircraft: route.aircraft, airport: route.airport, profile: route.profile, slice: SLICE });
  // `start()` returns false only when the demo menu refuses the pairing; a fly-off is undefined.
  if (armed.started === false || !armed.active) throw new Error(`the demo menu refused ${route.id}: ${JSON.stringify(armed)}`);
  if (armed.aircraft !== route.aircraft) throw new Error(`setAircraft did not stick: ${JSON.stringify(armed)}`);
  if (armed.airport !== route.airport) throw new Error(`setAirport did not stick: ${JSON.stringify(armed)}`);
  if (armed.profile !== route.profile) throw new Error(`the lobby resolved profile "${route.profile}" to "${armed.profile}"`);

  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (!(await page.evaluate(WAIT)).waiting) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await page.evaluate(PRIME);

  const state = createState(route, { sliceSeconds: SLICE });
  const recorded = KEEP_SAMPLES ? [] : null;
  let slices = 0, inactive = 0, shot = false;
  const ceiling = Math.ceil(route.budgetSimSeconds / SLICE) + IDLE_SLICES;
  while (inactive < IDLE_SLICES && slices < ceiling) {
    const sample = await page.evaluate(SAMPLE);
    slices += 1;
    if (recorded) recorded.push(sample);
    classifySample(sample, state);
    if (sample.active) {
      if (SHOTS && !shot && state.visitedStages.includes(route.shotStage)) {
        shot = true;
        await page.screenshot(`${route.id}-${route.shotStage}`).catch(() => {});
      }
      inactive = 0;
    } else {
      inactive += 1;
    }
  }
  const meta = { slices, simTime: state.last?.simTime ?? 0, heapMb: state.last?.heapMb ?? null, recorded };
  if (SHOTS) await page.screenshot(`${route.id}-handoff`).catch(() => {});
  await page.evaluate(DISARM);
  return { state, meta };
}

/** Worst-of across attempts: the baseline is a ceiling, not an average. */
function mergeSoft(previous, outcome) {
  const m = outcome.measures || {};
  const entry = { ...(previous || {}) };
  const peaks = ['maxRollDeg', 'maxIasKnots', 'maxMach', 'maxAbsG', 'maxSinkFpm',
    'maxAngularRateRadS', 'maxHeadingRateDegPerS', 'maxBankRateDegPerS'];
  for (const key of peaks) {
    if (Number.isFinite(m[key])) entry[key] = Math.max(entry[key] ?? 0, m[key]);
  }
  if (Number.isFinite(m.minAglM)) entry.minAglM = Math.min(entry.minAglM ?? Infinity, m.minAglM);
  entry.warningSeconds = { ...(previous?.warningSeconds || {}) };
  for (const [id, seconds] of Object.entries(outcome.warningSeconds || {})) {
    entry.warningSeconds[id] = Math.max(entry.warningSeconds[id] ?? 0, seconds);
  }
  if (Number.isFinite(outcome.result?.elapsedSeconds)) {
    entry.elapsedSeconds = Math.max(entry.elapsedSeconds ?? 0, Math.round(outcome.result.elapsedSeconds));
  }
  return entry;
}

/** Round a limit outward: a baseline written from 5.24° must not flag the next 5.24°. */
const roundOut = (value, digits, ceiling = true) => {
  const scale = 10 ** digits;
  return (ceiling ? Math.ceil(value * scale) : Math.floor(value * scale)) / scale;
};

function tidy(entry) {
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'warningSeconds') {
      const seconds = {};
      for (const [id, active] of Object.entries(value)) seconds[id] = roundOut(active, 1);
      out[key] = seconds;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      // minAglM is a floor rather than a peak, so it rounds the other way.
      out[key] = roundOut(value, key === 'maxMach' ? 3 : 1, key !== 'minAglM');
    }
  }
  return out;
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {};
  const server = await startServer();
  const browser = await startChrome();
  log(`· ${browser.version} on its own CDP port, ${selected.length} route(s) of tier ${TIER}`
    + ` · slice ${SLICE}s · ${STRICT ? 'STRICT' : 'reports advisory'}${SHOTS ? ' · screenshots on' : ''}`);

  const byAirport = new Map();
  for (const route of selected) {
    if (!byAirport.has(route.airport)) byAirport.set(route.airport, []);
    byAirport.get(route.airport).push(route);
  }

  const report = { generatedAt: new Date().toISOString(), tier: TIER, strict: STRICT, shots: SHOTS,
    sliceSeconds: SLICE, retries: RETRIES, server: server.label, chrome: browser.version,
    thresholds: { from: 'src/physics/gearDamage.js + src/systems/FlightWarnings.js' }, routes: [] };
  const soft = new Map();
  const started = Date.now();

  try {
    for (const [airport, group] of byAirport) {
      const target = await browser.openPage(server.url);
      const page = await Page.connect(target);
      let ready = false;
      for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
        ready = await page.evaluate('() => Boolean(window.simulator?.demoDirector && window.simulator.lobby)');
        if (!ready) await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!ready) throw new Error(`the simulator never appeared at ${server.url}`);
      await page.evaluate(INSTRUMENT);
      log(`· page opened for ${airport}`);

      for (const route of group) {
        // A decision needs one flight; a baseline wants the worst of several.
        const attempts = UPDATE_BASELINE ? RETRIES : 1;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          const routeStarted = Date.now();
          let outcome;
          try {
            const { state, meta } = await flyRoute(page, route);
            outcome = finalizeRoute(state, { baseline, strict: STRICT });
            Object.assign(outcome, { samples: meta.slices, heapMb: meta.heapMb });
            if (meta.recorded) outcome.sampleLog = meta.recorded;
          } catch (error) {
            outcome = { id: route.id, tier: route.tier, finished: false, fails: [`DRIVER ${route.id}: ${error.message}`],
              reports: [], measures: {}, warningSeconds: {}, touchdowns: [], visitedStages: [], samples: 0, simSeconds: 0 };
            try { await page.evaluate(DISARM); } catch { /* the page may already be gone */ }
          }
          const browserProblems = page.problems.splice(0);
          if (browserProblems.length) outcome.fails = [...outcome.fails, ...browserProblems.map(text => `BROWSER: ${text}`)];
          outcome.wallSeconds = Number(((Date.now() - routeStarted) / 1000).toFixed(1));
          outcome.attempt = attempt;
          outcome.route = { aircraft: route.aircraft, airport: route.airport, profile: route.profile, scenario: route.scenario };
          // A crashed route is not a reference, even when its crash is a declared
          // known issue: its soft peaks describe the accident, not the demo.
          if (!outcome.fails.length && !outcome.knownIssues?.length) soft.set(route.id, mergeSoft(soft.get(route.id), outcome));
          report.routes.push(outcome);
          const verdict = outcome.fails.length ? 'FAIL'
            : (outcome.knownIssues?.length ? 'KNOWN' : (STRICT && outcome.reports.length ? 'WARN' : 'pass'));
          log(`  ${verdict} ${route.id} · ${outcome.simSeconds.toFixed?.(0) ?? outcome.simSeconds}s sim in `
            + `${outcome.wallSeconds}s wall (${outcome.samples} slices)`
            + `${outcome.fails.length ? ` → ${outcome.fails[0]}`
              : (outcome.knownIssues?.length ? ` → ${outcome.knownIssues[0]}` : '')}`);
          // A soft peak may still be worth a second opinion; a failed run never is.
          if (outcome.fails.length || outcome.knownIssues?.length) break;
        }
      }
      page.close();
      await browser.closePage(target);
    }
  } finally {
    browser.stop();
    server.stop();
  }

  if (UPDATE_BASELINE) {
    const next = { ...baseline };
    for (const [id, entry] of soft) {
      if (report.routes.some(route => route.id === id && route.fails.length)) {
        log(`· baseline kept for ${id}: a failed run is not a reference`);
        continue;
      }
      next[id] = tidy(entry);
    }
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`);
    log(`· wrote ${path.relative(ROOT, BASELINE_FILE)} covering ${Object.keys(next).length} route(s)`);
  }

  const fails = report.routes.reduce((sum, route) => sum + route.fails.length, 0);
  const reports = report.routes.reduce((sum, route) => sum + route.reports.length, 0);
  const known = report.routes.reduce((sum, route) => sum + (route.knownIssues?.length ?? 0), 0);
  report.summary = { tier: TIER, routes: report.routes.length, fails, reports, known,
    wallSeconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'demo-sweep-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  log('');
  log('route                         tier  sim s  wall s  FAIL  REPORT  KNOWN');
  for (const route of report.routes) {
    log(`${route.id.padEnd(28)} ${(route.tier || '?').padEnd(5)}`
      + `${String(Math.round(route.simSeconds ?? 0)).padStart(5)} ${String(route.wallSeconds ?? 0).padStart(7)}`
      + ` ${String(route.fails.length).padStart(5)} ${String(route.reports.length).padStart(7)}`
      + ` ${String(route.knownIssues?.length ?? 0).padStart(6)}`
      + `  attempt ${route.attempt}`);
    for (const text of route.fails) log(`      x ${text}`);
    for (const text of route.knownIssues ?? []) log(`      k ${text}`);
    for (const text of route.reports) log(`      . ${text}`);
  }
  log('');
  log(`${report.summary.routes} route(s): ${fails} fail(s), ${reports} report(s), ${known} known issue(s) `
    + `in ${report.summary.wallSeconds}s wall`
    + ` — ${path.join(ARTIFACT_DIR, 'demo-sweep-report.json')}`);
  if (fails || (STRICT && reports)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
