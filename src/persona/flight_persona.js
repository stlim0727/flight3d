/**
 * Flight Persona - Free-Play Agent with Anomaly Detection
 *
 * This module is meant to be imported by the browser session (browser harness).
 * It does not submit anything; it returns raw observations and anomalies that
 * the skill/consumer formats into the $flight-persona JSON report.
 */

export const ANOMALY_CODES = Object.freeze({
  NON_FINITE: 'NON_FINITE',
  EXTREME_G: 'EXTREME_G',
  GLOC: 'GLOC',
  NEG_ALT: 'NEG_ALT',
  TERRAIN_CLIP: 'TERRAIN_CLIP',
  BREAKUP: 'BREAKUP',
  STALL: 'STALL',
  UI_MISSING: 'UI_MISSING',
  CONSOLE_ERR: 'CONSOLE_ERR',
});

export const SEVERITY = Object.freeze({
  NON_FINITE: 'P1',
  BREAKUP: 'P1',
  GLOC: 'P1',
  TERRAIN_CLIP: 'P1',
  EXTREME_G: 'P2',
  NEG_ALT: 'P2',
  STALL: 'P2',
  UI_MISSING: 'P2',
  CONSOLE_ERR: 'P3',
});

const COMPANION_FIELDS = ['altitudeFt', 'iasKnots', 'gForce', 'pitchDeg', 'rollDeg', 'headingDeg', 'groundSpeedKnots', 'vsiFpm', 'radioAltFt', 'tasKnots', 'trackDeg', 'mach', 'flapDegree', 'spoilers'];

export function sample(sim) {
  // The telemetry object is on the simulator root; fields match the flight recorder's FIELDS.
  const s = sim?.telemetry ?? {};
  const sampled = {};
  for (const key of COMPANION_FIELDS) {
    const v = s?.[key];
    sampled[key] = Number.isFinite(v) ? v : Number.NaN;
  }
  sampled.wow = Boolean(s?.onGround);
  sampled.gloc = Boolean(s?.pilot?.isGLOC);
  sampled.isStalled = Boolean(s?.isStallWarning ?? s?.isPreStall ?? s?.isStalled);
  sampled.outcome = s?.scenarioOutcome?.outcome ?? s?.outcome ?? null;
  return sampled;
}

export function detectAnomalies(state, sim) {
  const anomalies = [];
  const push = (code, value, message) => anomalies.push({
    code,
    value,
    message,
    severity: SEVERITY[code] ?? 'P2',
  });

  for (const key of COMPANION_FIELDS) {
    const v = state[key];
    if (Number.isNaN(v)) push(ANOMALY_CODES.NON_FINITE, null, `Field "${key}" is NaN`);
    else if (!Number.isFinite(v)) push(ANOMALY_CODES.NON_FINITE, null, `Field "${key}" is Infinity`);
  }

  if (Number.isFinite(state.gForce) && state.gForce > 8) {
    push(ANOMALY_CODES.EXTREME_G, state.gForce, `gForce ${state.gForce.toFixed(2)} > 8`);
  }

  if (state.gloc) push(ANOMALY_CODES.GLOC, true, 'Pilot G-LOC detected');

  if (Number.isFinite(state.altitudeFt) && state.altitudeFt < -200) {
    push(ANOMALY_CODES.NEG_ALT, state.altitudeFt, `alt ${state.altitudeFt.toFixed(0)} ft below the sea-level reference`);
  }

  // altitudeFt is height above mean sea level, not above the ground. Neon canal flights
  // are legitimately below sea level (the water sits at -14 m), so clearance must come
  // from radioAltFt, the height above terrain (#690).
  if (Number.isFinite(state.radioAltFt) && !state.wow && state.radioAltFt < 1) {
    const msl = Number.isFinite(state.altitudeFt) ? ` at ${state.altitudeFt.toFixed(1)} ft MSL` : '';
    push(ANOMALY_CODES.TERRAIN_CLIP, state.radioAltFt,
      `airborne ${state.radioAltFt.toFixed(1)} ft above terrain${msl} — possible terrain mesh clipping`);
  }

  // AircraftBreakup has no `active` flag: spawn() fills the debris list and
  // PhysicsIntegrator.triggerCrash() marks `isCrashed` before spawning it.
  const debris = Array.isArray(sim?.aircraftBreakup?.pieces) ? sim.aircraftBreakup.pieces.length : 0;
  if (sim?.isCrashed === true || debris > 0) {
    const kind = sim?.crashResult?.type ?? sim?.crashResult?.name ?? null;
    const detail = [debris > 0 ? `${debris} debris pieces` : null, kind].filter(Boolean).join(', ');
    push(ANOMALY_CODES.BREAKUP, true,
      `aircraft breakup flagged by simulator${detail ? ` (${detail})` : ''}`);
  }

  // undefined (no document or no banner element) is not a visible banner.
  const stallBanner = typeof document !== 'undefined'
    && document.getElementById('hud-stall')?.offsetParent != null;
  if (sim?.hud?.stallWarning === true || sim?.hud?.stall === true
      || stallBanner || state.isStalled) {
    push(ANOMALY_CODES.STALL, true, 'Stall warning banner is visible');
  }

  return anomalies;
}

export function createAnomalyEvaluator({ sampleIntervalMs = 500, onAnomaly } = {}) {
  const seen = new Set();
  let interval = null;

  return {
    start(sim) {
      if (interval) return;
      interval = setInterval(() => {
        const state = sample(sim);
        const found = detectAnomalies(state, sim);
        for (const anomaly of found) {
          const key = `${anomaly.code}:${anomaly.value ?? anomaly.message}`;
          if (!seen.has(key)) {
            seen.add(key);
            console.log('[Persona-Anomaly]', anomaly);
            onAnomaly?.(anomaly, state);
          }
        }
      }, sampleIntervalMs);
    },
    stop() {
      clearInterval(interval);
      interval = null;
    },
    get seen() { return [...seen]; },
  };
}

export function summarizeFlight(sim) {
  const report = sim?.debriefReport ?? null;
  const recorder = sim?.flightRecorder ?? null;
  const latest = recorder?.latest ?? null;
  // An active sortie has no debriefReport yet, but FlightRecorder already counts
  // G-LOC entries and touchdowns. Fall back to those counters so sampling that
  // ends mid-flight does not erase events that have already been recorded.
  const liveTouchdowns = Array.isArray(recorder?.touchdowns)
    ? recorder.touchdowns.map(({ _tdRecord, ...touchdown }) => touchdown)
    : [];
  const peaks = report?.peaks ?? recorder?.peaks ?? null;
  return {
    aircraft: report?.metadata?.aircraft ?? sim?.lobby?.aircraft ?? null,
    airport: report?.metadata?.airport ?? sim?.lobby?.airport ?? null,
    scenario: report?.metadata?.scenario ?? sim?.lobby?.preset ?? null,
    durationSec: Number.isFinite(report?.durationSec) ? report.durationSec
      : Number.isFinite(recorder?.elapsed) ? recorder.elapsed
      : Number.isFinite(latest?.timeSec) ? latest.timeSec
      : null,
    peakG: Number.isFinite(peaks?.gForce?.gForce) ? peaks.gForce.gForce : null,
    peakIas: Number.isFinite(peaks?.iasKnots?.iasKnots) ? peaks.iasKnots.iasKnots : null,
    peakAltitudeFt: Number.isFinite(peaks?.altitudeFt?.altitudeFt) ? peaks.altitudeFt.altitudeFt : null,
    glocIncidents: Number.isFinite(report?.glocIncidents) ? report.glocIncidents
      : Number.isFinite(recorder?.glocIncidents) ? recorder.glocIncidents
      : 0,
    touchdowns: Array.isArray(report?.touchdowns) ? report.touchdowns : liveTouchdowns,
    // A normal stop ('landed', 'manual') is not a crash and must not be read as one.
    endReason: report?.reason ?? null,
    crash: report
      ? (report.reason === 'crash' ? (report.crash ?? true) : null)
      : sim?.crashResult ?? null,
  };
}
