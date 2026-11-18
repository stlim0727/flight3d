import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightWarnings, terrainConflictSeconds } from '../src/systems/FlightWarnings.js';
import { b738MaximumSpeedKnots } from '../src/aircraft/PFDCanvas.js';
const normal = { onGround: false, radioAltFt: 3000, altitudeFt: 3000, vsiFpm: 0,
  iasKnots: 230, mach: 0.4, gearState: 1, flapDegree: 30, rollDeg: 0 };
const ids = alerts => alerts.map(a => a.id);
test('normal approach, flare, touchdown and ground remain quiet', () => {
  const w = new FlightWarnings();
  for (let ra = 500; ra >= 0; ra -= 2) {
    assert.deepEqual(w.update(0.2, { ...normal, radioAltFt: ra, altitudeFt: ra, vsiFpm: -600 }), []);
  }
  assert.deepEqual(w.update(0.1, { ...normal, onGround: true, isStalled: true }), []);
});
test('sink rate escalates, recovery holds briefly then clears; reset clears state', () => {
  const w = new FlightWarnings();
  assert.ok(ids(w.update(0.1, { ...normal, radioAltFt: 500, vsiFpm: -1800 })).includes('sink-rate'));
  assert.equal(w.update(0.1, { ...normal, radioAltFt: 500, vsiFpm: -4000 })[0].id, 'pull-up');
  assert.ok(w.update(0.1, normal).length);
  for (let i = 0; i < 10; i++) w.update(0.1, normal);
  assert.deepEqual(w.result, []);
  w.update(0.1, { ...normal, isStalled: true }); w.reset();
  assert.deepEqual(w.update(0, normal), []);
});
test('terrain closure warns during level flight toward rising ground, invalid sensors do not warn', () => {
  const w = new FlightWarnings();
  for (let i = 0; i < 20; i++) w.update(0.1, { ...normal, gearState: 0, radioAltFt: 800 - i * 30 });
  assert.equal(w.result[0].id, 'pull-up');
  w.reset();
  assert.deepEqual(w.update(0.1, { ...normal, radioAltFt: NaN, vsiFpm: NaN }), []);
  assert.equal(w.update(0.1, normal, 6)[0].id, 'pull-up');
});
test('gear and flap warnings inhibited during climb; rearm after approach recovery', () => {
  const w = new FlightWarnings();
  assert.ok(ids(w.update(0.1, { ...normal, gearState: 0, radioAltFt: 300, vsiFpm: -500 })).includes('gear'));
  w.reset();
  assert.deepEqual(w.update(0.1, { ...normal, gearState: 0, radioAltFt: 300, vsiFpm: 500 }), []);
  assert.ok(ids(w.update(0.1, { ...normal, flapDegree: 0, radioAltFt: 150, vsiFpm: -500 })).includes('flaps'));
});
test('departure altitude loss and touchdown reset work across a sequence', () => {
  const w = new FlightWarnings();
  w.update(0.1, { ...normal, onGround: true, radioAltFt: 0, altitudeFt: 0 });
  w.update(0.1, { ...normal, radioAltFt: 100, altitudeFt: 100, vsiFpm: 800 });
  w.update(0.1, { ...normal, radioAltFt: 150, altitudeFt: 150, vsiFpm: 800 });
  assert.ok(ids(w.update(0.1, { ...normal, radioAltFt: 110, altitudeFt: 110, vsiFpm: -500 })).includes('dont-sink'));
  assert.deepEqual(w.update(0.1, { ...normal, onGround: true, radioAltFt: 0 }), []);
});
test('aircraft profiles preserve light-aircraft horn and separate fighter limits', () => {
  const cessna = new FlightWarnings('C172');
  assert.deepEqual(cessna.update(0.1, { ...normal, iasKnots: 100, radioAltFt: 100, vsiFpm: -5000 }, 4), []);
  assert.ok(ids(cessna.update(0.1, { ...normal, iasKnots: 170 })).includes('overspeed'));
  const fighter = new FlightWarnings('F16');
  assert.deepEqual(fighter.update(0.1, { ...normal, iasKnots: 500, mach: 0.9, rollDeg: 60 }), []);
  assert.equal(fighter.update(0.1, normal, 4)[0].voice, 'Pull up, pull up');
});
test('priority, overspeed hysteresis, engine failure and takeoff configuration', () => {
  const w = new FlightWarnings();
  let a = w.update(0.1, { ...normal, iasKnots: 350, isStalled: true, engine1: { failed: true }, rollDeg: 60 });
  assert.deepEqual(ids(a), ['stall', 'overspeed', 'engine', 'bank']);
  a = w.update(0.1, { ...normal, iasKnots: 338 });
  assert.ok(ids(a).includes('overspeed'));
  for (let i = 0; i < 10; i++) a = w.update(0.1, normal);
  assert.deepEqual(a, []);
  assert.equal(w.update(0.1, { ...normal, onGround: true, throttle: 1, flapDegree: 0 })[0].id, 'takeoff-config');
});
test('B738 overspeed recovery and altitude-dependent speed tape', () => {
  const w = new FlightWarnings('B738');
  const overspeed = sample => ids(w.update(0.1, { ...normal, ...sample })).includes('overspeed');
  assert.equal(b738MaximumSpeedKnots(500), 340);
  assert.equal(overspeed({ altitudeFt: 500, iasKnots: 230 }), false);
  assert.equal(overspeed({ altitudeFt: 500, iasKnots: 341 }), true);
  assert.equal(overspeed({ altitudeFt: 500, iasKnots: 230 }), false);

  const altitudeFt = 35000;
  assert.equal(Math.round(b738MaximumSpeedKnots(altitudeFt)), 263);
  assert.equal(overspeed({ altitudeFt, iasKnots: 262, mach: 0.819 }), false);
  assert.equal(overspeed({ altitudeFt, iasKnots: 264, mach: 0.823 }), true);
  assert.equal(overspeed({ altitudeFt, iasKnots: 259, mach: 0.808 }), false);
});

test('prediction sees rising terrain but allows a configured runway approach', () => {
  const p = { x: 0, y: 100, z: 0 }, v = { x: 50, y: -5, z: 0 };
  assert.equal(terrainConflictSeconds(p, v, { getHeight: () => 0 }, true), Infinity);
  assert.ok(terrainConflictSeconds(p, v, { getHeight: x => x * 0.3 }, true) < 8);
  assert.equal(terrainConflictSeconds(p, { x: 0, y: 0, z: 0 }, { getHeight: () => 0 }, false), Infinity);
});

test('real engine model ignores absent engines but detects installed engine failures', async () => {
  const { EngineModel } = await import('../src/physics/EngineModel.js');
  const { AIRCRAFT_REGISTRY } = await import('../src/config/aircraftConfigs.js');
  for (const config of Object.values(AIRCRAFT_REGISTRY)) {
    const engines = new EngineModel(config), warnings = new FlightWarnings(config);
    const sensed = () => ({ ...normal, iasKnots: 100, ...engines.update(0.1, 1000, 50, 0.9) });
    assert.ok(!ids(warnings.update(0.1, sensed())).includes('engine'), config.id);
    engines.setEngineFailure(0, true);
    assert.ok(ids(warnings.update(0.1, sensed())).includes('engine'), `${config.id} engine 1`);
    engines.setEngineFailure(0, false); warnings.reset();
    if (config.propulsion.numEngines > 1) {
      engines.setEngineFailure(1, true);
      assert.ok(ids(warnings.update(0.1, sensed())).includes('engine'), `${config.id} engine 2`);
    }
  }
});

test('low circuit transitions from takeoff to normal configured approach before 1500ft', () => {
  const w = new FlightWarnings();
  w.update(0.25, { ...normal, onGround:true, radioAltFt:0, altitudeFt:0 });
  for (let height = 5; height <= 1000; height += 5)
    w.update(0.25, { ...normal, radioAltFt:height, altitudeFt:height, vsiFpm:1200 });
  for (let height = 997.5; height >= 150; height -= 2.5) {
    const alerts = w.update(0.25, { ...normal, radioAltFt:height, altitudeFt:height, vsiFpm:-600 });
    assert.ok(!ids(alerts).includes('dont-sink'), `normal approach at ${height}ft`);
  }
  assert.equal(w.departure, false);
});

test('low circuit level-off rearms gear and flap warnings; reset permits another takeoff warning', () => {
  const w = new FlightWarnings();
  const state = { ...normal, gearState:0, flapDegree:0 };
  w.update(0.25, { ...state, onGround:true, radioAltFt:0, altitudeFt:0 });
  for (let height = 5; height <= 600; height += 5)
    w.update(0.25, { ...state, radioAltFt:height, altitudeFt:height, vsiFpm:1200 });
  for (let i = 0; i < 24; i++) w.update(0.25, { ...state, radioAltFt:600, altitudeFt:600 });
  for (let height = 597.5; height >= 150; height -= 2.5)
    w.update(0.25, { ...state, radioAltFt:height, altitudeFt:height, vsiFpm:-600 });
  assert.ok(ids(w.result).includes('gear'));
  for (let i = 0; i < 5; i++)
    w.update(0.25, { ...state, radioAltFt:150, altitudeFt:150, vsiFpm:-600, gearState:1 });
  assert.ok(ids(w.result).includes('flaps'));
  w.reset();
  w.update(0.25, { ...normal, onGround:true, radioAltFt:0, altitudeFt:0 });
  w.update(0.25, { ...normal, radioAltFt:150, altitudeFt:150, vsiFpm:800 });
  assert.ok(ids(w.update(0.25, { ...normal, radioAltFt:110, altitudeFt:110, vsiFpm:-500 })).includes('dont-sink'));
});


test('warning arbitration follows the stall sensor rather than retained separation', () => {
  const w = new FlightWarnings();
  assert.deepEqual(w.update(0.1, { ...normal, isStalled:true, isStallWarning:false }), []);
  assert.equal(w.update(0.1, { ...normal, isStalled:false, isStallWarning:true })[0].id, 'stall');
  for (let i = 0; i < 10; i++) w.update(0.1, { ...normal, isStalled:true, isStallWarning:false });
  assert.deepEqual(w.result, []);
});
