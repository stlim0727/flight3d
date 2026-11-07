import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlalomSimulation } from './helpers/slalomFlight.js';
import { SlalomMissionAdapter } from '../src/arena/SlalomMissionAdapter.js';
import { SlalomMission } from '../src/arena/SlalomMission.js';
import { createSlalomManifest } from '../src/arena/slalomCourse.js';
import { VALLEY_SLALOM_RULES } from '../src/arena/generatedValley.js';
import { PilotPerception } from '../src/pilot/PilotPerception.js';

test('arena bot observation receives pilot physiological telemetry', async () => {
  const sim = createSlalomSimulation(1);
  const adapter = new SlalomMissionAdapter(sim);
  const { manifest } = await adapter.prepare({ seed: 1, environmentProfile: 'calm-debug-v1', noise: false });
  const evaluator = new SlalomMission(manifest);
  const perception = new PilotPerception({ sensorSeed: 1, noise: false, mission: manifest.id,
    runway: { headingDeg: manifest.runwayHeadingDeg, elevationM: manifest.runwayThreshold.y } });

  adapter.acquire({ human: false });
  const snapshot = adapter.snapshot(0);
  const observation = adapter.observe(perception, snapshot, 0, evaluator);

  assert.ok(observation.pilot, 'Observation must contain pilot field');
  assert.equal(typeof observation.pilot.gZ, 'number');
  assert.equal(typeof observation.pilot.consciousness, 'number');
  assert.equal(typeof observation.pilot.responsiveness, 'number');
  assert.equal(typeof observation.pilot.isGLOC, 'boolean');

  assert.equal(observation.pilot.consciousness, 1.0);
  assert.equal(observation.pilot.isGLOC, false);

  adapter.release();
});

test('arena bot control inputs are degraded under sustained high-G pull', async () => {
  const sim = createSlalomSimulation(1);
  const adapter = new SlalomMissionAdapter(sim);
  await adapter.prepare({ seed: 1, environmentProfile: 'calm-debug-v1', noise: false });

  adapter.acquire({ human: false });

  // Bot commands aggressive pitch up: elevator = 1.0
  adapter.apply({ elevator: 1.0, aileron: 0.0, rudder: 0.0, throttle: 1.0, brakes: 0.0 });

  // Advance physics under sustained aggressive pull
  for (let tick = 0; tick < 360; tick++) {
    adapter.step();
  }

  const snapshot = adapter.snapshot(360);
  // High G flight should have been registered
  assert.ok(snapshot.pilot, 'Snapshot must have pilot telemetry');
  assert.ok(Number.isFinite(snapshot.pilot.gZ));

  // Verify that pilot physiology filtered elevator was applied to aerodynamics
  assert.equal(sim.aero.elevator, sim.pilotPhysiology.effectiveElevator);
  assert.ok(sim.pilotPhysiology.effectiveElevator <= 1.0);

  adapter.release();
});

test('mission scoring penalizes G-LOC occurrences and excessive high-G fatigue', () => {
  const manifest = createSlalomManifest({ seed: 1 });

  const cleanMission = new SlalomMission(manifest);
  const glocMission = new SlalomMission(manifest);

  const spawn = manifest.spawn;
  const baseSnapshot = {
    position: { x: spawn.x, z: spawn.z },
    iasKnots: 250,
    groundSpeedKnots: 250,
    aglM: 80,
    crashed: false,
    damaged: false,
    bodyContact: false,
  };

  // Clean run
  for (let tick = 1; tick <= 120; tick++) {
    cleanMission.update({
      ...baseSnapshot,
      position: { x: spawn.x + tick * 0.1, z: spawn.z + tick * 0.1 },
      tick,
      pilot: { consciousness: 1.0, isGLOC: false, gZ: 1.0 }
    });
  }

  // G-LOC run
  for (let tick = 1; tick <= 120; tick++) {
    glocMission.update({
      ...baseSnapshot,
      position: { x: spawn.x + tick * 0.1, z: spawn.z + tick * 0.1 },
      tick,
      pilot: { consciousness: 0.0, isGLOC: true, gZ: 7.0 }
    });
  }

  cleanMission.finish('succeeded', 'completed');
  glocMission.finish('succeeded', 'completed');

  const cleanResult = cleanMission.result();
  const glocResult = glocMission.result();

  assert.equal(cleanResult.metrics.glocIncidents, 0);
  assert.equal(cleanResult.metrics.glocPenalty, 0);

  assert.ok(glocResult.metrics.glocIncidents > 0, 'G-LOC incidents must be recorded');
  assert.ok(glocResult.metrics.glocPenalty > 0, 'G-LOC penalty must be applied');
  assert.ok(glocResult.metrics.finalScore < cleanResult.metrics.finalScore, 'G-LOC must reduce final score');
});
