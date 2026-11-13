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
  HIGH_G: 'HIGH_G',
  ENVELOPE: 'ENVELOPE',
  OVERSPEED_FLAPS: 'OVERSPEED_FLAPS',
  STEEP_DIVE: 'STEEP_DIVE',
  FALSE_STALL: 'FALSE_STALL',
  RAPID_DESCENT: 'RAPID_DESCENT',
  SUSTAINED_HIGH_G: 'SUSTAINED_HIGH_G',
});

export const SEVERITY = Object.freeze({
  NON_FINITE: 'P1',
  BREAKUP: 'P1',
  GLOC: 'P1',
  TERRAIN_CLIP: 'P1',
  ENVELOPE: 'P1',
  OVERSPEED_FLAPS: 'P1',
  EXTREME_G: 'P2',
  HIGH_G: 'P2',
  NEG_ALT: 'P2',
  STALL: 'P2',
  UI_MISSING: 'P2',
  STEEP_DIVE: 'P2',
  FALSE_STALL: 'P2',
  RAPID_DESCENT: 'P2',
  SUSTAINED_HIGH_G: 'P2',
  CONSOLE_ERR: 'P3',
});

const COMPANION_FIELDS = ['altitudeFt', 'iasKnots', 'gForce', 'pitchDeg', 'rollDeg', 'headingDeg', 'groundSpeedKnots', 'vsiFpm', 'radioAltFt', 'tasKnots', 'trackDeg', 'mach', 'flapDegree', 'spoilers'];

export function sample(sim) {
  // The telemetery object is on the simulator root; fields match the flight recorder's FIELDS.
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
    push(ANOMALY_CODES.NEG_ALT, state.altitudeFt, `alt ${state.altitudeFt.toFixed(0)} ft below terrain reference`);
  }

  // Use radar altitude (height above terrain) instead of MSL altitude so elevated terrain such as Lukla/valley is handled.
  if (Number.isFinite(state.radioAltFt) && !state.wow && state.radioAltFt < 5) {
    push(ANOMALY_CODES.TERRAIN_CLIP, state.radioAltFt,
      `airborne at ${state.radioAltFt.toFixed(1)} ft above terrain — possible terrain mesh clipping`);
  }

  if ((sim?.aircraftBreakup?.pieces?.length ?? 0) > 0) {
    push(ANOMALY_CODES.BREAKUP, true, 'aircraft breakup flagged by simulator');
  }

  const stallBannerVisible = typeof document !== 'undefined'
    ? document.getElementById('hud-stall')?.offsetParent !== null
    : false;
  if (sim?.hud?.stallWarning === true || sim?.hud?.stall === true
      || stallBannerVisible
      || state.isStalled) {
    push(ANOMALY_CODES.STALL, true, 'Stall warning banner is visible');
  }
  if (Number.isFinite(state.gForce) && state.gForce > 6 && !state.wow) {
    push(ANOMALY_CODES.HIGH_G, state.gForce, `gForce ${state.gForce.toFixed(2)} > 6`);
  }

  if (Number.isFinite(state.gForce) && state.gForce > 6
      && Number.isFinite(state.altitudeFt) && state.altitudeFt < 500 && !state.wow) {
    push(ANOMALY_CODES.ENVELOPE, state.gForce,
      `high G ${state.gForce.toFixed(1)}g at ${state.altitudeFt.toFixed(0)} ft — outside safe envelope`);
  }

  if (Number.isFinite(state.iasKnots) && Number.isFinite(state.flapDegree)
      && state.flapDegree > 10 && state.iasKnots > 200) {
    push(ANOMALY_CODES.OVERSPEED_FLAPS, state.iasKnots,
      `IAS ${state.iasKnots.toFixed(0)} kt with flaps ${state.flapDegree.toFixed(0)}°`);
  }

  if (Number.isFinite(state.pitchDeg) && Number.isFinite(state.vsiFpm)
      && state.pitchDeg < -30 && state.vsiFpm < -4000 && !state.wow) {
    push(ANOMALY_CODES.STEEP_DIVE, state.vsiFpm,
      `pitch ${state.pitchDeg.toFixed(0)}° with VSI ${state.vsiFpm.toFixed(0)} fpm`);
  }

  if ((sim?.hud?.stallWarning === true || state.isStalled)
      && Number.isFinite(state.gForce) && Math.abs(state.gForce) < 1.5
      && Number.isFinite(state.iasKnots) && state.iasKnots > 180 && !state.wow) {
    push(ANOMALY_CODES.FALSE_STALL, state.iasKnots,
      `stall warning at ${state.iasKnots.toFixed(0)} kt with |g| ${state.gForce.toFixed(1)} — UI/state mismatch`);
  }

   return anomalies;
 }

export function detectTrends(history, { windowSec = 10 } = {}) {
  const anomalies = [];
  if (!Array.isArray(history) || history.length < 2) return anomalies;
  const push = (code, value, message) => anomalies.push({
    code,
    value,
    message,
    severity: SEVERITY[code] ?? 'P2',
  });

  const airborne = history.filter(s => s && !s.wow);
  if (!airborne.length) return anomalies;

  const windowSize = Math.max(2, Math.min(windowSec, history.length - 1));
  for (let i = windowSize; i < history.length; i++) {
    const a = history[i - windowSize];
    const b = history[i];
    if (!a || !b || b.wow) continue;
    if (!Number.isFinite(a.altitudeFt) || !Number.isFinite(b.altitudeFt)) continue;
    const drop = a.altitudeFt - b.altitudeFt;
    if (drop > 3000) {
      push(ANOMALY_CODES.RAPID_DESCENT, drop,
        `altitude dropped ${drop.toFixed(0)} ft over ~${windowSize} s`);
      break;
    }
  }

  const highG = airborne.filter(s => Number.isFinite(s.gForce) && s.gForce > 6).length;
  if (highG >= 3) {
    push(ANOMALY_CODES.SUSTAINED_HIGH_G, highG,
      `gForce > 6 on ${highG} airborne samples`);
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
  const latest = sim?.flightRecorder?.latest ?? null;
  return {
    aircraft: report?.metadata?.aircraft ?? sim?.lobby?.aircraft ?? null,
    airport: report?.metadata?.airport ?? sim?.lobby?.airport ?? null,
    scenario: report?.metadata?.scenario ?? sim?.lobby?.preset ?? null,
    durationSec: Number.isFinite(report?.durationSec) ? report.durationSec
      : Number.isFinite(latest?.timeSec) ? latest.timeSec
      : null,
    peakG: Number.isFinite(report?.peaks?.gForce?.gForce) ? report.peaks.gForce.gForce : null,
    peakIas: Number.isFinite(report?.peaks?.iasKnots?.iasKnots) ? report.peaks.iasKnots.iasKnots : null,
    peakAltitudeFt: Number.isFinite(report?.peaks?.altitudeFt?.altitudeFt) ? report.peaks.altitudeFt.altitudeFt : null,
    glocIncidents: Number.isFinite(report?.glocIncidents) ? report.glocIncidents : 0,
    touchdowns: Array.isArray(report?.touchdowns) ? report.touchdowns : [],
    crash: report?.reason === 'crash' ? (report?.crash ?? true) : report?.reason ?? null,
  };
}
