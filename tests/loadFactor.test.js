import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  normalLoadFactor,
  filterGForce,
  GForceFilter,
  calculateSustainedPeak,
  TouchdownGAnalyzer
} from '../src/physics/loadFactor.js';
import { constrainBodyContact } from '../src/physics/bodyContactConstraint.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';
import {
  AIRCRAFT_SPECS,
  getAircraftSpecs,
  classifyLanding,
  BOEING_737_800,
  F16_FALCON,
  CESSNA_172
} from '../src/config/aircraftConfigs.js';
import { FlightRecorder } from '../src/core/FlightRecorder.js';
import { reportText } from '../src/ui/DebriefOverlay.js';

const q = new THREE.Quaternion();
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b} (diff ${Math.abs(a - b)})`);

test('CG accelerometer gives 1g at rest, 0g in free fall, and signed manoeuvre loads', () => {
  const v = new THREE.Vector3(50, 0, 0), dt = 1 / 120;
  for (const g of [0, 1, 2.5, -1]) {
    const after = v.clone().add(new THREE.Vector3(0, (g - 1) * Atmosphere.G0 * dt, 0));
    near(normalLoadFactor(v, after, q, q, dt), g);
  }
});
test('rotating measurement axis uses the interval midpoint, not the final pose', () => {
  const v = new THREE.Vector3(), dt = 1 / 120;
  const end = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 3);
  near(normalLoadFactor(v, v, q, end, dt), Math.cos(Math.PI / 6));
});
test('includes actual normal constraint impulse in the measured delta velocity', () => {
  const v = new THREE.Vector3(0, -2, 0), before = v.clone(), omega = new THREE.Vector3();
  const p = new THREE.Vector3(0, -0.1, 0), dt = 1 / 120;
  constrainBodyContact(p, q, v, omega, 100, { x: .01, y: .01, z: .01 }, () => 0, null,
    [{ id: 'center', position: [0, 0, 0] }]);
  near(v.y, 0);
  near(normalLoadFactor(before, v, q, q, dt), 1 + 2 / (dt * Atmosphere.G0));
});
test('integrated specific force recovers the same impulse across sample rates', () => {
  for (const hz of [60, 120, 240]) {
    const dt = 1 / hz; let impulsePerMass = 0, v = new THREE.Vector3();
    for (let i = 0; i < hz; i++) {
      const next = v.clone().add(new THREE.Vector3(0, 3 * dt, 0));
      impulsePerMass += (normalLoadFactor(v, next, q, q, dt) - 1) * Atmosphere.G0 * dt;
      v = next;
    }
    near(impulsePerMass, 3);
  }
});

test('8.0 Hz EMA LPF heavily attenuates single-tick 40G impulse spike noise', () => {
  const dt = 1 / 120;
  const filter = new GForceFilter(8.0);
  // Start in 1G level flight
  filter.reset(1.0);
  assert.equal(filter.update(1.0, dt), 1.0);

  // Apply a single 1-tick 40G delta-v spike
  const spikeFiltered = filter.update(40.0, dt);
  // With 8Hz cutoff at 120Hz, alpha = (1/120) / (rc + 1/120) ≈ 0.295. Filtered output must be < 13G, never 40G.
  assert.ok(spikeFiltered < 13.0, `Spike was not attenuated: ${spikeFiltered}`);

  // When next tick returns to 1.0G, filter decays rapidly
  const nextFiltered = filter.update(1.0, dt);
  assert.ok(nextFiltered < 10.0, `Spike did not decay: ${nextFiltered}`);
});

test('8.0 Hz EMA LPF preserves constant and smooth sustained load factors', () => {
  const dt = 1 / 120;
  const filter = new GForceFilter(8.0);
  filter.reset(1.0);

  // Apply steady 2.5G pull for 1 second (120 ticks)
  let currentG = 1.0;
  for (let i = 0; i < 120; i++) {
    currentG = filter.update(2.5, dt);
  }
  near(currentG, 2.5, 1e-4);
});

test('calculateSustainedPeak rejects isolated 1-tick 40G spike over 100ms window', () => {
  const dt = 1 / 120;
  const samples = [];
  // 1 second of data around touchdown at t = 2.0s
  for (let t = 0; t <= 3.0; t += dt) {
    let g = 1.0;
    // 1-tick 40G spike at t = 2.0s
    if (Math.abs(t - 2.0) < 1e-5) g = 40.0;
    samples.push({ timeSec: t, g, dt });
  }

  // 100ms moving average across window [1.5s, 3.0s]
  const peak = calculateSustainedPeak(samples, 1.5, 3.0, 0.10);
  // In a 100ms window (12 ticks), 1 tick of 40G and 11 ticks of 1G yields average ~4.25G, far below 40G!
  assert.ok(peak < 5.0, `Unfiltered spike leaked into sustained peak: ${peak}`);
  assert.ok(peak >= 1.0, `Peak should be at least 1G: ${peak}`);
});

test('TouchdownGAnalyzer tracks 3.0s window around touchdown and resolves sustained peak', () => {
  const dt = 1 / 120;
  const analyzer = new TouchdownGAnalyzer({ leadSec: 0.5, trailSec: 2.5, durationThreshold: 0.10 });

  // Record 0.5s prior to touchdown (level 1G)
  for (let t = 0; t <= 0.5; t += dt) {
    analyzer.recordSample(t, 1.0, dt);
  }

  // Touchdown at t = 0.5s with a sustained oleo stroke of 1.4G for 150ms
  const td = analyzer.triggerTouchdown(0.5, 1.0);
  assert.equal(td.windowStart, 0.0);
  assert.equal(td.windowEnd, 3.0);

  for (let t = 0.5 + dt; t <= 3.0; t += dt) {
    // 150ms compression at 1.4G between 0.5s and 0.65s
    const g = (t >= 0.5 && t <= 0.65) ? 1.4 : 1.0;
    analyzer.recordSample(t, g, dt);
    analyzer.update(t);
  }

  const finalPeak = analyzer.evaluateTouchdown(td, 3.0);
  near(finalPeak, 1.4, 0.05);
});

test('AircraftSpecs defines structural flight limits and landing criteria for all 3 aircraft', () => {
  // 1) Boeing 737-800
  const b738 = AIRCRAFT_SPECS.B738;
  assert.equal(b738.hardLandingGThreshold, 1.55);
  assert.equal(b738.crashGThreshold, 2.10);
  assert.equal(b738.limitLoad.min, -1.0);
  assert.equal(b738.limitLoad.max, 2.5);
  assert.equal(b738.ultimateLoad.min, -1.5);
  assert.equal(b738.ultimateLoad.max, 3.75);
  assert.equal(BOEING_737_800.hardLandingGThreshold, 1.55);
  assert.equal(BOEING_737_800.crashGThreshold, 2.10);

  // 2) F-16 Falcon
  const f16 = AIRCRAFT_SPECS.F16;
  assert.equal(f16.hardLandingGThreshold, 2.20);
  assert.equal(f16.crashGThreshold, 3.50);
  assert.equal(f16.limitLoad.min, -3.0);
  assert.equal(f16.limitLoad.max, 9.0);
  assert.equal(f16.ultimateLoad.min, -4.5);
  assert.equal(f16.ultimateLoad.max, 13.5);
  assert.equal(F16_FALCON.hardLandingGThreshold, 2.20);
  assert.equal(F16_FALCON.crashGThreshold, 3.50);

  // 3) Cessna 172
  const c172 = AIRCRAFT_SPECS.C172;
  assert.equal(c172.hardLandingGThreshold, 1.70);
  assert.equal(c172.crashGThreshold, 2.50);
  assert.equal(c172.limitLoad.min, -1.52);
  assert.equal(c172.limitLoad.max, 3.8);
  assert.equal(c172.ultimateLoad.min, -2.28);
  assert.equal(c172.ultimateLoad.max, 5.7);
  assert.equal(CESSNA_172.hardLandingGThreshold, 1.70);
  assert.equal(CESSNA_172.crashGThreshold, 2.50);
});

test('classifyLanding dynamically evaluates landing ratings per aircraft', () => {
  // B738 ratings
  assert.equal(classifyLanding('B738', 1.15, 120).rating, 'butter');
  assert.equal(classifyLanding('B738', 1.40, 220).rating, 'normal');
  assert.equal(classifyLanding('B738', 1.65, 380).rating, 'firm');
  assert.equal(classifyLanding('B738', 1.95, 550).rating, 'severeHard');
  assert.equal(classifyLanding('B738', 2.25, 650).rating, 'crash');

  // F-16 ratings
  assert.equal(classifyLanding('F16', 1.40).rating, 'soft');
  assert.equal(classifyLanding('F16', 1.80).rating, 'normal');
  assert.equal(classifyLanding('F16', 2.60).rating, 'firm');
  assert.equal(classifyLanding('F16', 3.20).rating, 'severeHard');
  assert.equal(classifyLanding('F16', 3.80).rating, 'crash');

  // C172 ratings
  assert.equal(classifyLanding('C172', 1.20).rating, 'smooth');
  assert.equal(classifyLanding('C172', 1.50).rating, 'normal');
  assert.equal(classifyLanding('C172', 1.90).rating, 'firm');
  assert.equal(classifyLanding('C172', 2.30).rating, 'severeHard');
  assert.equal(classifyLanding('C172', 2.70).rating, 'crash');
});

test('Debrief and FlightRecorder clamp abnormal 40G spikes to aircraft ultimate structural limit', () => {
  const recorder = new FlightRecorder();
  recorder.start({ aircraft: 'B738', airport: 'coastal', scenario: 'approach' });

  // Airborne flight
  for (let i = 0; i < 240; i++) {
    recorder.update(1 / 120, {
      x: 0, z: 0, altitudeFt: 50, iasKnots: 140, gForce: 1.0,
      pitchDeg: 2, rollDeg: 0, headingDeg: 90, onGround: false,
      touchdownSinkRate: 0, groundSpeedKnots: 140
    });
  }

  // Sudden 40G contact spike on touchdown
  recorder.update(1 / 120, {
    x: 0, z: 0, altitudeFt: 0, iasKnots: 135, gForce: 40.0,
    pitchDeg: 0, rollDeg: 0, headingDeg: 90, onGround: true,
    touchdownSinkRate: 1.5, groundSpeedKnots: 135
  });

  const report = recorder.finish('landed');
  const b738UltimateMax = AIRCRAFT_SPECS.B738.ultimateLoad.max;

  // Touchdown contactG must never be 40G
  assert.ok(report.touchdowns.length >= 1);
  assert.ok(report.touchdowns[0].contactG <= b738UltimateMax,
    `contactG ${report.touchdowns[0].contactG} exceeded ultimate load ${b738UltimateMax}`);

  // Debrief summary report text must clamp contact G and peak G to structural envelope
  const text = reportText(report);
  assert.ok(!text.includes('40.00 G'), 'Debrief text should not contain raw 40G spike');
});
