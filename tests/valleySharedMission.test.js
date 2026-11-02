import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MissionRunner } from '../src/arena/MissionRunner.js';
import { SlalomMissionAdapter } from '../src/arena/SlalomMissionAdapter.js';
import { SlalomMission } from '../src/arena/SlalomMission.js';
import { ValleyScoreboard, valleyAttempt } from '../src/arena/ValleyScoreboard.js';
import { PilotPerception } from '../src/pilot/PilotPerception.js';
import { PilotHost } from '../src/pilot/PilotHost.js';
import { validatePlainData } from '../src/pilot/PilotProtocol.js';
import { valleySlalomPilotSource } from '../src/pilot/examples/valleySlalom.js';
import { createSlalomSimulation } from './helpers/slalomFlight.js';
import { PilotThreadWorker } from './helpers/pilotThreadWorker.js';
import { valleyNavigationText } from '../src/ui/valleyNavigationView.js';

test('isolated Worker completes F16 valley on production physics with bounded observations and 24 tick delay', async () => {
  const sim = createSlalomSimulation(1);
  const runner = new MissionRunner(new SlalomMissionAdapter(sim), {
    hostFactory: () => new PilotHost({ workerFactory: () => new PilotThreadWorker(),
      startupTimeoutMs: 5000, tickTimeoutMs: 1000 }), yieldFrame: async () => {},
  });
  const record = await runner.start(valleySlalomPilotSource, { missionId: 'valley-slalom-v1', seed: 1 });
  assert.equal(record.status, 'succeeded', `${record.reason}: ${record.detail}`);
  assert.equal(record.result.metrics.completedGates, 6);
  assert.ok(record.commands.length > 100);
  assert.deepEqual([...new Set(record.observations.map(o => o.observation.navigation.currentGateIndex))], [1, 2, 3, 4, 5, 6]);
  assert.ok(record.commands.every(c => c.applyTick === c.sampleTick + 24));
  assert.ok(record.observations.every(o => validatePlainData(o.observation).ok));
  assert.equal(sim.controls.virtualElevator, null);
  assert.equal(sim.controls.inputBlocked, false);
  assert.equal(sim.controls.aircraftControlsDisabled, false);
  assert.equal(sim.windField, null);
});

test('human inputs own the same production steps; holds freeze ticks, abort releases, restart resets navigation', async () => {
  const sim = createSlalomSimulation(3);
  let held = false, holdCount = 0;
  const adapter = new SlalomMissionAdapter(sim);
  const runner = new MissionRunner(adapter, {
    hostFactory: () => { throw new Error('Human must not start a Worker'); },
    canAdvance: () => !held,
    yieldFrame: async () => {
      if (held) {
        assert.equal(runner.record.tick, 24);
        assert.ok(Math.abs(sim.windTimeSeconds - 24 / 120) < 1e-10);
        if (++holdCount === 3) held = false;
      }
    },
    paceTick: async tick => {
      assert.equal(sim.controls.aircraftControlsDisabled, false);
      assert.equal(sim.controls.inputBlocked, false);
      assert.equal(sim.controls.virtualElevator, null);
      if (tick === 25 && !holdCount) held = true;
      if (tick === 49) runner.stop('preset-changed');
    },
  });
  for (let i = 0; i < 2; i++) {
    holdCount = 0;
    const record = await runner.start('ignored', { pilotKind: 'human', missionId: 'valley-slalom-v1', seed: 3 });
    assert.equal(record.status, 'aborted', record.detail);
    assert.equal(record.reason, 'preset-changed');
    assert.equal(record.tick, 48);
    assert.equal(record.source, null); assert.equal(record.sourceHash, null);
    assert.equal(record.commands.length, 0);
    assert.equal(record.observations[0].sampleTick, 0);
    assert.equal(record.observations[0].observation.navigation.currentGateIndex, 1);
    assert.equal(holdCount, 3);
    assert.equal(sim.controls.aircraftControlsDisabled, false);
    assert.equal(sim.windField, null);
    assert.equal(valleyAttempt(record).metrics.altitudeCostM, null);
  }
});

test('human and AI navigation share exact seeded measurements, gate transition and final destination', async () => {
  const sim = createSlalomSimulation(4), adapter = new SlalomMissionAdapter(sim);
  const { manifest } = await adapter.prepare({ seed: 4 });
  const evaluator = new SlalomMission(manifest);
  const human = new PilotPerception({ sensorSeed: 4 }), ai = new PilotPerception({ sensorSeed: 4 });
  for (const [tick, index] of [[0, 1], [24, 2], [48, 6]]) {
    evaluator.gate = index;
    const snapshot = adapter.snapshot(tick);
    const a = adapter.observe(human, snapshot, tick, evaluator).navigation;
    const b = adapter.observe(ai, snapshot, tick, evaluator).navigation;
    assert.deepEqual(a, b);
    assert.equal(a.currentGateIndex, index);
    assert.equal(a.finishRangeM.sampleTick, tick);
    assert.match(valleyNavigationText(a), new RegExp(`경유지 ${index}/6`));
    assert.match(valleyNavigationText(a), /최종 도착:/);
    if (index === 6) assert.ok(Math.abs(a.goalRangeM.mean - a.finishRangeM.mean) < 300);
  }
  await adapter.prepare({ seed: 4 });
  const initial = adapter.observe(new PilotPerception({ sensorSeed: 4 }), adapter.snapshot(0), 0, new SlalomMission(manifest));
  assert.equal(initial.navigation.currentGateIndex, 1);
  adapter.release();
});

test('local scoreboard preserves failed and aborted attempts with null scores and separates comparison conditions', async () => {
  const sim = createSlalomSimulation(1), adapter = new SlalomMissionAdapter(sim);
  const { manifest } = await adapter.prepare({ seed: 1 });
  const record = { manifest, pilotKind: 'human', status: 'succeeded', reason: 'completed', tick: 6000,
    sensorSeed: 1, noiseEnabled: true, sourceHash: null,
    result: { metrics: { completedGates: 6, altitudeCostM: 42, minAglM: 30, medianAglM: 60, maxAglM: 120 } } };
  const data = new Map();
  const board = new ValleyScoreboard({ getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) });
  const human = board.add(record);
  const ai = board.add({ ...record, pilotKind: 'ai', sourceHash: 'abc' });
  assert.equal(human.comparisonKey, ai.comparisonKey);
  assert.equal(ai.sourceHash, 'abc');
  for (const status of ['failed', 'aborted']) assert.equal(board.add({ ...record, status }).metrics.altitudeCostM, null);
  assert.notEqual(board.add({ ...record, sensorSeed: 2 }).comparisonKey, human.comparisonKey);
  assert.notEqual(board.add({ ...record, manifest: { ...manifest, navigationProfile: 'other' } }).comparisonKey, human.comparisonKey);
  assert.equal(board.read().length, 6);
  const restored = new ValleyScoreboard(board.storage);
  assert.equal(restored.read()[0].metrics.altitudeCostM, 42);
  const broken = new ValleyScoreboard({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.ok(broken.add(record)); assert.equal(broken.error, 'blocked');
  adapter.release();
});
