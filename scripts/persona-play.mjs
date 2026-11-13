import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withBrowserSession } from './lib/browserHarness.mjs';
import { publishAnomalyIssue } from './persona-issue.mjs';

process.env.GPU_ANGLE = 'vulkan';
process.env.CHROME_PATH ||= '/home/stlim/.local/bin/chrome-headless';

const aircraft = process.env.PERSONA_AIRCRAFT ?? 'C172';
const airport = process.env.PERSONA_AIRPORT ?? 'lukla';
const demoRoute = process.env.PERSONA_DEMO_ROUTE ?? 'maneuvers';
const preset = process.env.PERSONA_PRESET ?? 'demo';
const ticks = Number(process.env.PERSONA_TICKS ?? 40);
const artifacts = process.env.PERSONA_ARTIFACTS ?? '.tmp/persona-play';
await mkdir(artifacts, { recursive: true });

const feedback = {
  persona: 'flight-persona',
  version: '1',
  timestamp: new Date().toISOString(),
  cdpUrl: null,
  mode: `${preset}-${aircraft.toLowerCase()}-${airport}`,
  anomalies: [],
  flow: [],
  flight: null,
  observations: [],
  limitations: [],
};

let report = null;

await withBrowserSession({ path: '/?telemetry=0', width: 1280, height: 720 },
  async ({ cdpPort, evaluate, send, delay, consoleMessages, exceptions }) => {
    feedback.cdpUrl = `ws://127.0.0.1:${cdpPort}`;
    await send('Page.bringToFront');

    let ready = false;
    for (let i = 0; i < 240; i++) {
      if (await evaluate('Boolean(window.simulator?.startupReady)')) { ready = true; break; }
      await delay(250);
    }
    feedback.observations.push({ note: 'simulator_ready', value: ready });

    // Configure scenario from trusted simulator state (same path as repo verify scripts).
    const configured = await evaluate(`(async () => {
      const s = window.simulator;
      if (!s) return { ok: false, reason: 'no-simulator' };
      s.demoDirector?.stop?.();
      s.setAircraft(${JSON.stringify(aircraft)});
      await s.setAirport(${JSON.stringify(airport)});
      s.gameFlow.enterLobby();
      s.lobby.preset = ${JSON.stringify(preset)};
      ${demoRoute ? `s.lobby.demoProfile = ${JSON.stringify(demoRoute)};` : ''}
      s.lobbyScreen?.refresh?.();
      const select = document.getElementById('lobby-demo-select');
      return { ok: true, selected: select?.value ?? null, offered: select ? [...select.options].map(o => o.value) : [] };
    })()`);
    feedback.observations.push({ note: 'scenario_configured', ...configured });
    feedback.flow.push({ step: 1, action: 'configure-scenario', target: `${aircraft}/${airport}/${preset}` });
    await delay(500);

    // Click the preset button (this triggers onPreset + refresh), then btn-fly.
    const startId = `lobby-preset-${preset}`;
    const startClicked = await evaluate(`(() => { const el = document.getElementById(${JSON.stringify(startId)}); if (!el) return false; el.click(); return true; })()`);
    if (startClicked) {
      feedback.flow.push({ step: feedback.flow.length + 1, action: `select-${preset}`, target: startId });
    }
    await delay(500);
    await evaluate(`document.getElementById('btn-fly')?.click()`);
    feedback.flow.push({ step: feedback.flow.length + 1, action: 'start-flight', target: 'btn-fly' });

    const allStates = [];
    for (let tick = 0; tick < ticks; tick++) {
      await delay(1000);
      const detected = await evaluate(async () => {
        const m = await import('/src/persona/flight_persona.js');
        const sim = window.simulator;
        const state = m.sample(sim);
        const anomalies = m.detectAnomalies(state, sim);
        const flight = m.summarizeFlight(sim);
        return { anomalies, flight, state };
      });
      for (const a of detected.anomalies) {
        feedback.anomalies.push({ ...a, source: 'persona-sampling', tick });
      }
      allStates.push(detected.state);
      feedback.flight = detected.flight;
    }

    // Trend detection over the collected history (cross-sample, envelope, UI-state).
    const trends = await evaluate(
      history => import('/src/persona/flight_persona.js').then(m => m.detectTrends(history)),
      allStates,
    );
    for (const a of trends) {
      feedback.anomalies.push({ ...a, source: 'persona-trend', tick: null });
    }

    for (const msg of consoleMessages ?? []) {
      const text = msg?.args?.map?.(a => a?.value ?? a?.description ?? '').join(' ') ?? '';
      if (String(msg?.type) === 'error' && String(text).length < 400) {
        feedback.anomalies.push({ code: 'CONSOLE_ERR', value: text, severity: 'P3', message: text, source: 'console' });
      }
    }
    for (const e of exceptions ?? []) {
      feedback.anomalies.push({ code: 'CONSOLE_ERR', value: String(e), severity: 'P3', message: String(e), source: 'exception' });
    }

    if (allStates.length) {
      const maxG = Math.max(...allStates.map(s => s.gForce ?? 0));
      const minAlt = Math.min(...allStates.filter(s => Number.isFinite(s.altitudeFt)).map(s => s.altitudeFt));
      const maxIAS = Math.max(...allStates.map(s => s.iasKnots ?? 0));
      feedback.observations.push({ trajectory: { maxG: maxG.toFixed(2), minAltFt: minAlt.toFixed(1), maxIAS: maxIAS.toFixed(1), samples: allStates.length } });
    }

    report = {
      ...feedback,
      consoleErrorCount: (consoleMessages ?? []).filter(m => m?.type === 'error').length,
      exceptionCount: (exceptions ?? []).length,
    };
    return report;
  });

await writeFile(path.resolve(artifacts, 'personas-feedback.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (report?.anomalies?.length) {
  console.log('\n📋 Publishing anomaly issue...');
  const result = await publishAnomalyIssue(report);
  console.log(result);
}