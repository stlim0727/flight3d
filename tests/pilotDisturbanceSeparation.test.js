import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPilotMissionSimulation } from './helpers/pilotMissionFlight.js';
import { SimulatorMissionAdapter } from '../src/arena/SimulatorMissionAdapter.js';
import { PilotPerception } from '../src/pilot/PilotPerception.js';

const TICKS = 1200;
const DECISION_TICKS = 24;
// The SAME recorded command history is replayed in all four runs. Observations
// are deliberately collected but never used to choose controls in this test.
const commands = Array.from({ length: TICKS / DECISION_TICKS }, (_, decision) => ({
  elevator: 0, aileron: 0, rudder: 0, brakes: 0,
  throttle: Math.min(1, (decision + 1) / 5),
}));

async function replayGroundRoll(environmentProfile, sensorNoise) {
  const sim = createPilotMissionSimulation();
  const adapter = new SimulatorMissionAdapter(sim);
  const { manifest, initialSnapshot } = await adapter.prepare({
    missionId: 'takeoff-basic-v1', environmentProfile, seed: 42,
  });
  const perception = new PilotPerception({
    sensorSeed: 'independent-sensor-stream', noise: sensorNoise, mission: 'takeoff',
    physicsHz: 120,
    runway: { headingDeg: manifest.runwayHeadingDeg, elevationM: manifest.runwayThreshold.y },
  });
  let snapshot = initialSnapshot;
  const observations = [], truth = [], applied = [];
  adapter.acquire();
  try {
    for (let tick = 0; tick < TICKS; tick++) {
      if (tick % DECISION_TICKS === 0) {
        observations.push(perception.sample(snapshot, tick));
        adapter.apply(commands[tick / DECISION_TICKS]);
      }
      adapter.step();
      snapshot = adapter.snapshot(tick + 1);
      perception.updateContact(snapshot.weightOnWheels, tick + 1);
      assert.equal(snapshot.crashed, false, `Unexpected crash during ${environmentProfile} ground roll`);
      assert.equal(snapshot.weightOnWheels, true, 'Test must remain a ground roll, not a pilot calibration');
      truth.push({
        tick: tick + 1,
        position: sim.position.toArray(), velocity: sim.linearVelocity.toArray(),
        quaternion: sim.quaternion.toArray(), angularVelocity: sim.angularVelocity.toArray(),
        fuelKg: sim.engines.fuelKg,
        snapshot,
      });
      applied.push(['elevator', 'aileron', 'rudder', 'throttle', 'brakes'].map(key => sim.controls[key]));
    }
    return { truth, observations, applied };
  } finally {
    adapter.release();
  }
}

test('production ground-roll replay separates physical wind from sensor noise (2 x 2)', async t => {
  // Keep preparation and integration serial; no browser, renderer or wall clock.
  const calmExact = await replayGroundRoll('calm-debug-v1', false);
  const calmNoisy = await replayGroundRoll('calm-debug-v1', true);
  const windExact = await replayGroundRoll('mild-disturbance-v1', false);
  const windNoisy = await replayGroundRoll('mild-disturbance-v1', true);

  // Perception must not write noise back into physics, even through controls,
  // fuel, gear contact state, pose, or attitude over 1,200 production substeps.
  assert.deepEqual(calmNoisy.truth, calmExact.truth);
  assert.deepEqual(windNoisy.truth, windExact.truth);
  assert.deepEqual(calmNoisy.applied, calmExact.applied);
  assert.deepEqual(windNoisy.applied, windExact.applied);
  assert.deepEqual(windExact.applied, calmExact.applied);
  assert.notDeepEqual(calmNoisy.observations, calmExact.observations);
  assert.notDeepEqual(windNoisy.observations, windExact.observations);
  for (const run of [calmNoisy, windNoisy]) {
    assert.ok(run.observations.some(o => o.instruments.pitchDeg.std > 0));
  }
  for (const run of [calmExact, windExact]) {
    assert.ok(run.observations.every(o => o.instruments.pitchDeg.std === 0));
  }

  // Wind must change actual trajectory with IDENTICAL applied command history.
  // Do not require an excursion: ground tire friction legitimately resists it.
  const calmEnd = calmExact.truth.at(-1), windEnd = windExact.truth.at(-1);
  const displacementM = Math.hypot(...windEnd.position.map((value, axis) => value - calmEnd.position[axis]));
  t.diagnostic(`10 s identical-input ground roll: wind changes final position by ${displacementM.toFixed(6)} m; sensor noise changes truth by exactly 0`);
  assert.ok(displacementM > 1e-4, `Wind did not move the actual trajectory (${displacementM} m)`);
  assert.notDeepEqual(windEnd.angularVelocity, calmEnd.angularVelocity);
  assert.ok(calmEnd.snapshot.groundSpeedKnots > 10, 'History must actually accelerate the aircraft');
  assert.ok(windEnd.snapshot.groundSpeedKnots > 10);
});
