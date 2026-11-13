import test from 'node:test';
import assert from 'node:assert/strict';
import { ANOMALY_CODES, detectAnomalies, sample } from '../src/persona/flight_persona.js';
import { NEON_RIVER, riverGroundHeight } from '../src/config/neonRiver.js';

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
