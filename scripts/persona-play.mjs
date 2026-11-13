// Flight persona runner: fly one lobby configuration, sample the simulator, and report.
// Defaults reproduce the Neon Metropolis bridge flight from issue #690; override with
// PERSONA_AIRCRAFT, PERSONA_AIRPORT, PERSONA_SCENARIO, PERSONA_DEMO_ROUTE and
// PERSONA_TICKS. Set PERSONA_PUBLISH=1 to publish anomalies as GitHub issues.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { detectGpuAngle, withBrowserSession } from './lib/browserHarness.mjs';
import { SPAWN_SCENARIOS } from '../src/config/scenarioRegistry.js';
import { detectAnomalies, sample, summarizeFlight } from '../src/persona/flight_persona.js';
import { publishAnomalyIssue } from './persona-issue.mjs';

const config = {
  aircraft: process.env.PERSONA_AIRCRAFT ?? 'C172',
  airport: process.env.PERSONA_AIRPORT ?? 'neon',
  scenario: process.env.PERSONA_SCENARIO ?? 'bridge',
  ticks: Number(process.env.PERSONA_TICKS ?? 40),
  intervalMs: Number(process.env.PERSONA_INTERVAL_MS ?? 1000),
  publish: process.env.PERSONA_PUBLISH === '1',
};
const scenario = SPAWN_SCENARIOS[config.scenario];
if (!scenario) throw new Error(`Unknown scenario: ${config.scenario}`);
if (!scenario.airports.includes(config.airport)) {
  throw new Error(`${config.scenario} is not available at ${config.airport}`);
}
// A scenario that requires one aircraft overrides the requested one in the lobby.
const aircraft = scenario.aircraft ?? config.aircraft;
// Repo policy: WebGL runs use hardware acceleration. detectGpuAngle() reports
// swiftshader when the render node is missing, and Chrome can also fail over after
// launch, so refuse to sample (or publish) this reduced-confidence evidence unless
// the task was explicitly approved for software rendering.
const gpuAngle = detectGpuAngle();
const allowSoftwareGpu = process.env.PERSONA_ALLOW_SOFTWARE_GPU === '1';
if (gpuAngle !== 'vulkan' && !allowSoftwareGpu) {
  throw new Error(`Hardware GPU required: detectGpuAngle() returned "${gpuAngle}". `
    + 'Set PERSONA_ALLOW_SOFTWARE_GPU=1 only with explicit approval for software rendering.');
}
const artifacts = '.tmp/persona-play';
await mkdir(artifacts, { recursive: true });

const feedback = {
  persona: 'flight-persona',
  version: '1',
  timestamp: new Date().toISOString(),
  cdpUrl: null,
  mode: config.scenario,
  anomalies: [],
  flow: [],
  flight: {
    aircraft, airport: config.airport, scenario: config.scenario,
    durationSec: null, peakG: null, peakIas: null, peakAltitudeFt: null,
    glocIncidents: 0, touchdowns: [], crash: null, endReason: null,
    demoRoute: null,
  },
  observations: [],
  limitations: [],
};
if (gpuAngle !== 'vulkan') {
  feedback.limitations.push(`Software rasterizer "${gpuAngle}" approved via PERSONA_ALLOW_SOFTWARE_GPU=1; physics evidence is weaker than on a hardware GPU.`);
}

const click = async (evaluate, id, step, delay) => {
  const present = await evaluate(`Boolean(document.getElementById(${JSON.stringify(id)}))`);
  if (!present) return false;
  await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  feedback.flow.push({ step: feedback.flow.length + 1, ...step });
  await delay(500);
  return true;
};

let report = null;
await withBrowserSession({ path: '/?telemetry=0', width: 1280, height: 720 },
  async ({ cdpPort, evaluate, send, delay, consoleMessages, exceptions }) => {
    feedback.cdpUrl = `ws://127.0.0.1:${cdpPort}`;
    await send('Page.bringToFront');

    let ready = false;
    for (let i = 0; i < 240 && !ready; i++) {
      ready = Boolean(await evaluate('Boolean(window.simulator?.startupReady)'));
      if (!ready) await delay(250);
    }
    feedback.observations.push({ note: 'simulator_ready', value: ready });
    if (!ready) throw new Error('Simulator did not become ready');
    const renderer = await evaluate(`(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    })()`);
    feedback.observations.push({ note: 'webgl_renderer', value: renderer });
    if (!renderer || /swiftshader|llvmpipe|software/i.test(renderer)) {
      if (!allowSoftwareGpu) {
        throw new Error(`WebGL fell back to software rendering (${renderer ?? 'unknown renderer'}); hardware GPU evidence is required.`);
      }
      feedback.limitations.push(`WebGL renderer is software or unknown (${renderer ?? 'unknown'}); physics evidence is weaker than on a hardware GPU.`);
    }

    await click(evaluate, 'lobby-tab-scenario', { action: 'open-scenario-tab', target: 'lobby-tab-scenario' }, delay);
    const required = [
      [`lobby-airport-${config.airport}`, { action: 'select-airport', value: config.airport }],
      [`lobby-aircraft-${aircraft.toLowerCase()}`, { action: 'select-aircraft', value: aircraft }],
      [scenario.lobbyButtonId, { action: 'select-scenario', value: config.scenario }],
    ];
    for (const [id, step] of required) {
      if (!await click(evaluate, id, step, delay)) throw new Error(`Missing lobby control: ${id}`);
    }
    if (config.scenario === 'demo') {
      const requested = process.env.PERSONA_DEMO_ROUTE ?? null;
      const choice = await evaluate((route) => {
        const select = document.getElementById('lobby-demo-select');
        if (!select) return { ok: false, reason: 'demo route selector missing' };
        const options = [...select.options].map(option => option.value);
        const value = route ?? (options.includes('canyon-slalom') ? 'canyon-slalom' : options[0] ?? null);
        if (!value) return { ok: false, reason: 'no demo routes available for this configuration', options };
        if (!options.includes(value)) return { ok: false, reason: `demo route "${value}" is not available`, options };
        select.value = value;
        select.dispatchEvent(new Event('change'));
        return { ok: true, requested: value, options };
      }, requested);
      if (!choice.ok) {
        throw new Error(`${choice.reason}; available: [${(choice.options ?? []).join(', ')}]`);
      }
      await delay(500);
      const selected = await evaluate(`document.getElementById('lobby-demo-select')?.value ?? null`);
      if (selected !== choice.requested) {
        throw new Error(`Demo route "${choice.requested}" resolved to "${selected}" instead`);
      }
      feedback.flow.push({ step: feedback.flow.length + 1, action: 'select-demo-route', value: selected });
      feedback.flight.demoRoute = selected;
    }

    const started = await click(evaluate, 'btn-fly', { action: 'start-flight', target: 'btn-fly' }, delay);
    if (!started) throw new Error('Missing lobby control: btn-fly');
    // fly() may await a scene rebuild for an airport/aircraft swap, and a failed start
    // returns to the lobby. Wait for the start hold to clear, the flow to enter FLIGHT,
    // and the recorder to carry the requested aircraft and airport before sampling.
    const expected = { aircraft, airport: config.airport };
    let launch = null;
    const launchDeadline = Date.now() + 120000;
    while (Date.now() < launchDeadline) {
      launch = await evaluate((target) => {
        const sim = window.simulator;
        if (!sim) return { ok: false, reason: 'simulator unavailable' };
        const state = {
          startingFlight: Boolean(sim.startingFlight),
          flow: sim.gameFlow?.state ?? null,
          recording: Boolean(sim.flightRecorder?.active),
          aircraft: sim.currentAircraftId ?? null,
          airport: sim.activeAirport ?? null,
        };
        state.ok = !state.startingFlight && state.flow === 'flight' && state.recording
          && state.aircraft === target.aircraft && state.airport === target.airport;
        return state;
      }, expected);
      if (launch?.ok) break;
      await delay(250);
    }
    if (!launch?.ok) {
      throw new Error(`Flight did not start for ${aircraft} @ ${config.airport}: ${JSON.stringify(launch)}`);
    }
    feedback.observations.push({
      note: 'flight_started', value: true, aircraft: launch.aircraft, airport: launch.airport,
    });

    const allStates = [];
    let state = null;
    for (let tick = 0; tick < config.ticks; tick++) {
      await delay(config.intervalMs);
      const detected = await evaluate(async () => {
        const m = await import('/src/persona/flight_persona.js');
        const sim = window.simulator;
        const state = m.sample(sim);
        return { anomalies: m.detectAnomalies(state, sim), flight: m.summarizeFlight(sim), state };
      });
      for (const anomaly of detected.anomalies) {
        feedback.anomalies.push({ ...anomaly, source: 'persona-sampling', tick });
      }
      const flight = detected.flight;
      if (flight) {
        for (const key of Object.keys(feedback.flight)) {
          if (flight[key] !== null && flight[key] !== undefined) feedback.flight[key] = flight[key];
        }
      }
      state = detected.state;
      allStates.push(state);
    }

    for (const message of consoleMessages ?? []) {
      const text = message?.args?.map?.(arg => arg?.value ?? arg?.description ?? '').join(' ') ?? '';
      if (String(message?.type) === 'error') {
        // A handled error logged with console.error may be the only evidence: keep it,
        // clipped, instead of dropping it because a stack made the text long.
        const value = text.length > 400 ? `${text.slice(0, 400)}…` : text;
        feedback.anomalies.push({ code: 'CONSOLE_ERR', value, severity: 'P3', message: value, source: 'console' });
      }
    }
    for (const exception of exceptions ?? []) {
      feedback.anomalies.push({ code: 'CONSOLE_ERR', value: String(exception), severity: 'P3', message: String(exception), source: 'exception' });
    }

    const values = key => allStates.map(s => s[key]).filter(Number.isFinite);
    const maxOf = key => (values(key).length ? Math.max(...values(key)) : null);
    const minOf = key => (values(key).length ? Math.min(...values(key)) : null);
    feedback.flight.durationSec ??= allStates.length * config.intervalMs / 1000;
    // The recorder samples at 5 Hz and holds the true peaks; these persona samples are
    // sparse, so only fill a peak the recorder/debrief did not report.
    feedback.flight.peakG ??= maxOf('gForce');
    feedback.flight.peakIas ??= maxOf('iasKnots');
    feedback.flight.peakAltitudeFt ??= maxOf('altitudeFt');
    feedback.observations.push({ trajectory: {
      maxG: feedback.flight.peakG, maxIAS: feedback.flight.peakIas,
      minAltFt: minOf('altitudeFt'), minClearanceFt: minOf('radioAltFt'),
      samples: allStates.length,
    } });
    if (state?.outcome && !feedback.flight.crash) feedback.flight.crash = state.outcome;

    report = {
      ...feedback,
      settings: {
        aircraft, airport: config.airport, scenario: config.scenario,
        demoRoute: feedback.flight.demoRoute, ticks: config.ticks, intervalMs: config.intervalMs,
      },
      consoleErrorCount: (consoleMessages ?? []).filter(m => m?.type === 'error').length,
      exceptionCount: (exceptions ?? []).length,
    };
    return report;
  });

await writeFile(path.resolve(artifacts, 'personas-feedback.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (report?.anomalies?.length) {
  if (!config.publish) {
    console.log('\nAnomalies found. Set PERSONA_PUBLISH=1 to file them as GitHub issues.');
  } else {
    console.log('\nPublishing anomaly issue...');
    console.log(await publishAnomalyIssue(report));
  }
}
