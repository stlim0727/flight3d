import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';
import { NEON_WIND } from '../src/config/neonWind.js';
import { NEON_RIVER, riverGroundHeight } from '../src/config/neonRiver.js';
import { WindField, setSimulationWind } from '../src/physics/WindField.js';
import { advancePhysicsFrame, stepPhysics } from '../src/core/physicsTiming.js';

function flight(aircraftId = 'C172', preset = 'cruise') {
  const sim = createHeadlessSimulation({ aircraftId, airportId: 'neon',
    terrain: { getHeight: riverGroundHeight, getWaterLevel: () => NEON_RIVER.waterLevel } });
  sim.setPreset(preset);
  return sim;
}
const state = sim => [sim.position.toArray(), sim.quaternion.toArray(),
  sim.linearVelocity.toArray(), sim.angularVelocity.toArray()];

test('all Neon presets install the same world field after setup, including the bridge', () => {
  for (const aircraft of ['C172', 'B738', 'F16']) {
    for (const preset of ['runway', 'approach', 'cruise', ...(aircraft === 'C172' ? ['bridge'] : [])]) {
      const sim = flight(aircraft, preset);
      assert.equal(sim.windField.profile, NEON_WIND.profile, `${aircraft}/${preset}`);
      assert.equal(sim.windTimeSeconds, 0);
      assert.deepEqual(sim.windField.mean(), { x: 0, y: 0, z: 0 });
      assert.equal(sim.windField.region, null);
      // Outside the island, above the roofs and below street level all use the field.
      for (const point of [{ x: -6000, y: 800, z: 0 }, { x: 2300, y: -4, z: 800 }, { x: 2000, y: 2000, z: 0 }]) {
        const wind = sim.windField.sample(point, 7);
        assert.deepEqual(wind, new WindField(NEON_WIND).sample(point, 7));
        assert.ok(Math.hypot(wind.x, wind.y, wind.z) > 0);
      }
    }
  }
});

test('Neon restart repeats motion and leaving the region clears all three wind samples', () => {
  const sim = flight();
  const initial = state(sim);
  for (let i = 0; i < 120; i++) stepPhysics(sim);
  const after = state(sim);
  sim.setPreset('cruise');
  assert.deepEqual(state(sim), initial);
  assert.equal(sim.windTimeSeconds, 0);
  for (let i = 0; i < 120; i++) stepPhysics(sim);
  assert.deepEqual(state(sim), after);
  sim.setPreset('bridge');
  stepPhysics(sim);
  assert.ok(sim.aero.windWorld.length() > 0);
  sim.activeAirport = 'coastal';
  sim.setPreset('runway');
  assert.equal(sim.windField, null);
  assert.equal(sim.windTimeSeconds, 0);
  for (const sample of ['windWorld', 'windLeftWorld', 'windRightWorld']) {
    assert.deepEqual(sim.aero[sample].toArray(), [0, 0, 0]);
  }
  sim.activeAirport = 'neon';
  sim.setPreset('cruise');
  assert.deepEqual(state(sim), initial);
  assert.equal(sim.windField.seed, NEON_WIND.seed);
});

test('explicit mission wind wins; normal presets restore the default; room respawns stay calm', () => {
  const sim = flight();
  sim.setPreset('cruise', false, true);
  assert.equal(sim.windField, null);
  const explicit = new WindField({ profile: 'calm-debug-v1', seed: 'mission' });
  setSimulationWind(sim, explicit);
  stepPhysics(sim);
  assert.equal(sim.windField, explicit);
  assert.deepEqual(sim.aero.windWorld.toArray(), [0, 0, 0]);
  sim.setPreset('cruise');
  assert.equal(sim.windField.seed, NEON_WIND.seed);
  sim.multiplayer = { active: true, respawn() {} };
  for (const preset of ['runway', 'cruise', 'cruise']) {
    sim.setPreset(preset);
    assert.equal(sim.windField, null);
    assert.deepEqual(sim.aero.windWorld.toArray(), [0, 0, 0]);
  }
});

test('Neon samples use physics time, independent of frame grouping and diagnostic queries', () => {
  const reference = flight(), grouped = flight();
  for (let i = 0; i < 240; i++) stepPhysics(reference);
  for (let i = 0; i < 60; i++) {
    grouped.windField.sample({ x: i, y: 0, z: 100 }, 800);
    advancePhysicsFrame(grouped, 4 * grouped.physicsDt);
  }
  assert.deepEqual(state(grouped), state(reference));
  assert.equal(grouped.windTimeSeconds, reference.windTimeSeconds);
});

test('60 s Neon cruise uses unchanged production aerodynamics and stays controllable', () => {
  for (const aircraft of ['C172', 'B738', 'F16']) {
    const windy = flight(aircraft), calm = flight(aircraft);
    setSimulationWind(calm);
    stepPhysics(windy); stepPhysics(calm);
    assert.notDeepEqual(windy._aeroResult.forceWorld, calm._aeroResult.forceWorld);
    assert.notDeepEqual(windy._aeroResult.momentBody, calm._aeroResult.momentBody);
    assert.notDeepEqual(windy.aero.windLeftWorld, windy.aero.windRightWorld);
    for (let i = 1; i < 7200; i++) {
      stepPhysics(windy);
      assert.equal(windy.isCrashed, false, aircraft);
      assert.equal(Boolean(windy.telemetry.isStalled), false, aircraft);
      assert.equal(Boolean(windy.telemetry.pilot?.isGLOC), false, aircraft);
    }
    assert.equal(windy.engines.failed.some(Boolean), false);
    assert.equal(windy.autopilot.master, false);
    windy.controls.setVirtualInput('aileron', 0.2);
    for (let i = 0; i < 12; i++) stepPhysics(windy);
    assert.ok(windy.controls.aileron > 0, `${aircraft}: manual control remains available`);
  }
});
