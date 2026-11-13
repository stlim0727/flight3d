import test from 'node:test';
import assert from 'node:assert/strict';
import { ANOMALY_CODES, detectAnomalies, sample, summarizeFlight } from '../src/persona/flight_persona.js';
import { NEON_RIVER, riverGroundHeight } from '../src/config/neonRiver.js';
import { buildSignature, formatIssue } from '../scripts/persona-issue.mjs';

const feet = meters => meters / 0.3048;

// A complete airborne sample, so only the field under test can raise an anomaly.
function state(overrides = {}) {
  return {
    altitudeFt: 1000, iasKnots: 80, gForce: 1, pitchDeg: 0, rollDeg: 0, headingDeg: 0,
    groundSpeedKnots: 80, vsiFpm: 0, radioAltFt: 1000, tasKnots: 80, trackDeg: 0,
    mach: 0.1, flapDegree: 0, spoilers: 0, wow: false, gloc: false, isStalled: false,
    outcome: null, ...overrides,
  };
}

const terrainClips = s => detectAnomalies(s, {}).filter(a => a.code === ANOMALY_CODES.TERRAIN_CLIP);

test('the Neon bridge spawn below sea level is not terrain clipping (#690)', () => {
  const [x, y, z] = NEON_RIVER.spawn;
  const s = state({ altitudeFt: feet(y), radioAltFt: feet(y - riverGroundHeight(x, z)) });
  // The canal flight starts at -13 ft MSL but 33 ft above the water: negative MSL is expected.
  assert.ok(s.altitudeFt < -10);
  assert.ok(s.radioAltFt > 30);
  assert.deepEqual(terrainClips(s), []);
});

test('terrain clipping is judged above the ground, not above sea level', () => {
  const clipped = state({ altitudeFt: 1200, radioAltFt: 0 });
  const [anomaly] = terrainClips(clipped);
  assert.ok(anomaly);
  assert.equal(anomaly.severity, 'P1');
  assert.match(anomaly.message, /1200\.0 ft MSL/);
  // Negative MSL with real clearance stays clear, and wheels on the ground are not a clip.
  assert.deepEqual(terrainClips(state({ altitudeFt: -13.1, radioAltFt: 32.8 })), []);
  assert.deepEqual(terrainClips(state({ altitudeFt: 0, radioAltFt: 0, wow: true })), []);
});

test('no stall flag and no DOM banner means no stall anomaly outside the browser', () => {
  assert.deepEqual(detectAnomalies(state(), {}).filter(a => a.code === ANOMALY_CODES.STALL), []);
});

test('sample reads clearance and weight-on-wheels from the simulator telemetry', () => {
  const s = sample({ telemetry: { onGround: false, altitudeFt: -13.1, radioAltFt: 32.8 } });
  assert.equal(s.altitudeFt, -13.1);
  assert.equal(s.radioAltFt, 32.8);
  assert.equal(s.wow, false);
});

test('breakup detection reads the debris list and crash state the simulator exposes', () => {
  const breakups = sim => detectAnomalies(state(), sim).filter(a => a.code === ANOMALY_CODES.BREAKUP);
  assert.deepEqual(breakups({}), []);
  assert.deepEqual(breakups({ aircraftBreakup: { pieces: [] } }), []);
  // triggerCrash() marks the sortie before AircraftBreakup.spawn() fills `pieces`.
  assert.equal(breakups({ isCrashed: true })[0]?.severity, 'P1');
  const [debris] = breakups({
    isCrashed: true,
    aircraftBreakup: { pieces: [{}, {}] },
    crashResult: { type: 'TERRAIN' },
  });
  assert.match(debris.message, /2 debris pieces, TERRAIN/);
});

test('summarizeFlight preserves incidents recorded before a debrief exists', () => {
  const recorder = {
    elapsed: 12.5,
    latest: { timeSec: 12.4 },
    peaks: { gForce: { gForce: 4.2 }, iasKnots: { iasKnots: 210 }, altitudeFt: { altitudeFt: 5000 } },
    glocIncidents: 1,
    touchdowns: [{ timeSec: 9, sinkRateFpm: 180, contactG: 1.3, _tdRecord: { finalized: false } }],
  };
  const live = summarizeFlight({
    flightRecorder: recorder,
    lobby: { aircraft: 'F16', airport: 'lukla', preset: 'demo' },
    crashResult: { type: 'TERRAIN' },
  });
  assert.equal(live.durationSec, 12.5);
  assert.equal(live.glocIncidents, 1);
  assert.equal(live.peakG, 4.2);
  assert.deepEqual(live.touchdowns, [{ timeSec: 9, sinkRateFpm: 180, contactG: 1.3 }]);
  assert.deepEqual(live.crash, { type: 'TERRAIN' });

  // A finished debrief is authoritative once the sortie stops.
  const finished = summarizeFlight({
    debriefReport: {
      metadata: { aircraft: 'C172' }, durationSec: 30, peaks: {}, touchdowns: [],
      glocIncidents: 2, reason: 'manual',
    },
    flightRecorder: recorder,
  });
  assert.equal(finished.aircraft, 'C172');
  assert.equal(finished.durationSec, 30);
  assert.equal(finished.glocIncidents, 2);
  // A normal stop is reported as an end reason, never as a crash.
  assert.equal(finished.endReason, 'manual');
  assert.equal(finished.crash, null);
});


test('published issues keep the flown demo route, sampling settings and flow', () => {
  const report = {
    timestamp: '2026-11-13T00:00:00Z',
    anomalies: [{ code: 'STALL', severity: 'P2', message: 'stall warning' }],
    flight: { aircraft: 'F16', airport: 'lukla', scenario: 'demo', demoRoute: 'canyon-chase', durationSec: 12 },
    flow: [{ step: 1, action: 'select-demo-route', value: 'canyon-chase' }],
    settings: {
      aircraft: 'F16', airport: 'lukla', scenario: 'demo', demoRoute: 'canyon-chase',
      ticks: 40, intervalMs: 1000,
    },
    observations: [], limitations: [],
  };
  const body = formatIssue(report, { commit: 'abc1234', repo: 'o/r' });
  assert.match(body, /Demo route: `canyon-chase`/);
  assert.match(body, /PERSONA_AIRCRAFT=F16 PERSONA_AIRPORT=lukla PERSONA_SCENARIO=demo PERSONA_DEMO_ROUTE=canyon-chase PERSONA_TICKS=40 PERSONA_INTERVAL_MS=1000 node scripts\/persona-play\.mjs/);
  assert.match(body, /select-demo-route → `canyon-chase`/);
  // Different choreography in the same aircraft/airport must not share an issue signature.
  const other = { ...report, settings: { ...report.settings, demoRoute: 'low-pass' } };
  assert.notEqual(buildSignature(report), buildSignature(other));
});
