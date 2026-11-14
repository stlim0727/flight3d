import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';
import { NEON_WIND } from '../src/config/neonWind.js';
import { NEON_RIVER, riverGroundHeight } from '../src/config/neonRiver.js';
import { WindField, setSimulationWind } from '../src/physics/WindField.js';
import { UrbanWindField } from '../src/physics/UrbanWindField.js';
import { advancePhysicsFrame, stepPhysics } from '../src/core/physicsTiming.js';

function flight(aircraftId = 'C172', preset = 'cruise') {
  const sim = createHeadlessSimulation({ aircraftId, airportId: 'neon',
    terrain: { getHeight: riverGroundHeight, getWaterLevel: () => NEON_RIVER.waterLevel } });
  sim.setPreset(preset);
  return sim;
}
const state = sim => [sim.position.toArray(), sim.quaternion.toArray(),
  sim.linearVelocity.toArray(), sim.angularVelocity.toArray()];

test('all Neon presets install the same urban field after setup, including the bridge', () => {
  for (const aircraft of ['C172', 'B738', 'F16']) {
    for (const preset of ['runway', 'approach', 'cruise', ...(aircraft === 'C172' ? ['bridge'] : [])]) {
      const sim = flight(aircraft, preset);
      assert.ok(sim.windField instanceof UrbanWindField, `${aircraft}/${preset}`);
      assert.equal(sim.windField.profile, NEON_WIND.profile);
      assert.equal(sim.windTimeSeconds, 0);
      // 4 m/s from the north: blowing toward +Z.
      const mean = sim.windField.mean();
      assert.ok(Math.abs(mean.x) < 1e-12 && mean.y === 0 && Math.abs(mean.z - 4) < 1e-12);
      assert.equal(sim.windField.region, null);
      // Outside the island, above the roofs and below street level all use the field.
      for (const point of [{ x: -6000, y: 800, z: 0 }, { x: 2300, y: -4, z: 800 }, { x: 2000, y: 2000, z: 0 }]) {
        const wind = sim.windField.sample(point, 7);
        assert.deepEqual(wind, new UrbanWindField(NEON_WIND).sample(point, 7));
        assert.ok(Math.hypot(wind.x, wind.y, wind.z) > 0);
      }
    }
  }
});

test('airborne Neon spawns keep their track and airspeed and start without sideslip', () => {
  // [authored airspeed m/s, track degrees clockwise from north] per preset (PresetSpawner).
  const authored = {
    approach: { C172: [46, 90], B738: [70, 90], F16: [70, 90] },
    cruise: { C172: [52, 110], B738: [120, 110], F16: [120, 110] },
    bridge: { C172: [NEON_RIVER.speedMs, 0] },
  };
  for (const [preset, aircraftList] of Object.entries(authored)) {
    for (const [aircraft, [airspeed, trackDeg]] of Object.entries(aircraftList)) {
      const sim = flight(aircraft, preset), label = `${aircraft}/${preset}`;
      const wind = sim.windField.meanAt(sim.position, new THREE.Vector3());
      assert.ok(wind.length() > 1, label);
      const air = sim.linearVelocity.clone().sub(wind);
      assert.ok(Math.abs(Math.hypot(air.x, air.z) - airspeed) < 1e-9, `${label} airspeed`);
      const track = (Math.atan2(sim.linearVelocity.x, -sim.linearVelocity.z) * 180 / Math.PI + 360) % 360;
      assert.ok(Math.abs(track - trackDeg) < 1e-9, `${label} track ${track}`);
      const body = air.clone().applyQuaternion(sim.quaternion.clone().invert());
      assert.ok(Math.abs(Math.asin(body.x / body.length())) < 1e-6, `${label} sideslip`);
    }
  }
});

test('the parked runway spawn is not re-aimed and holds still in the light crosswind', () => {
  for (const aircraft of ['C172', 'B738', 'F16']) {
    const sim = flight(aircraft, 'runway');
    assert.deepEqual(sim.linearVelocity.toArray(), [0, 0, 0]);
    const east = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0, 'YXZ'));
    assert.ok(sim.quaternion.angleTo(east) < 1e-6, aircraft);
    const wind = sim.windField.meanAt(sim.position);
    assert.ok(Math.abs(wind.x) < 1e-12 && wind.z > 2 && wind.z < 3, `${aircraft} crosswind ${wind.z}`);
    const start = sim.position.clone();
    for (let i = 0; i < 1200; i++) stepPhysics(sim);
    assert.equal(sim.isCrashed, false, aircraft);
    assert.ok(sim.position.distanceTo(start) < 0.5, `${aircraft} moved ${sim.position.distanceTo(start)} m`);
  }
});

test('a hands-off C172 canyon flight meets changing wind and stays upright through the slot', () => {
  const sim = flight('C172', 'approach');
  let low = Infinity, high = 0;
  for (let i = 0; i < 7200; i++) {
    stepPhysics(sim);
    const wind = Math.hypot(sim.aero.windWorld.x, sim.aero.windWorld.z);
    low = Math.min(low, wind); high = Math.max(high, wind);
    assert.equal(sim.isCrashed, false);
    assert.equal(Boolean(sim.telemetry.isStalled), false);
    assert.equal(Boolean(sim.telemetry.pilot?.isGLOC), false);
    assert.ok(Math.abs(sim.telemetry.rollDeg) < 15, `roll ${sim.telemetry.rollDeg} at x ${sim.position.x}`);
    assert.ok(sim.position.y > 100 && sim.position.y < 120, `altitude ${sim.position.y}`);
    // The slot walls stand 62 m either side of the line until x = 1680.
    if (sim.position.x < 1700) assert.ok(Math.abs(sim.position.z) < 45, `z ${sim.position.z} at x ${sim.position.x}`);
  }
  assert.ok(high - low > 1.5, `wind seen ${low}..${high} m/s`);
  assert.ok(sim.position.x > 2800);
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
  const authored = [sim.linearVelocity.toArray(), sim.quaternion.toArray()];
  sim.setPreset('cruise', false, true);
  assert.equal(sim.windField, null);
  // A mission preparation spawn is the authored still-air spawn, not re-aimed.
  assert.ok(Math.abs(sim.linearVelocity.length() - 52) < 1e-9);
  assert.notDeepEqual([sim.linearVelocity.toArray(), sim.quaternion.toArray()], authored);
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
    grouped.windField.meanAt({ x: 2500 + i, y: 110, z: 0 });
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
