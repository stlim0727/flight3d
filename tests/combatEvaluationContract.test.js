import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Vector3 } from 'three';
import { runCoastalCombatPlay } from '../scripts/lib/coastalCombatPlay.mjs';
import { ReplayStore, createMemoryIndexedDB } from '../src/replay/ReplayStore.js';
import { combatExperimentConfig, runCombatExperiment } from '../scripts/lib/combatExperiment.mjs';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  };
}

test('coastal diagnostics invariance preserves summary and outcome fields across diagnostics toggle', () => {
  const ordinary = runCombatExperiment(combatExperimentConfig({
    scenario: 'coastal', seconds: '5', 'attack-skill': 'pursuit',
  }));
  const traced = runCombatExperiment(combatExperimentConfig({
    scenario: 'coastal', seconds: '5', 'attack-skill': 'pursuit', diagnostics: true,
  }));

  assert.deepEqual(ordinary.summary, traced.summary);
  const { samples: _s0, diagnostics: d0, ...base0 } = ordinary.results[0];
  const { samples: _s1, diagnostics: d1, ...base1 } = traced.results[0];
  assert.equal(d0, null);
  assert.notEqual(d1, null);
  assert.deepEqual(base0, base1);
  assert.ok(traced.summary[0].caseIds.includes(traced.results[0].caseId));
});

test('coastal diagnostics produces an importable flight3d.sortie.v1 replay and consistent metrics', async () => {
  const traced = runCombatExperiment(combatExperimentConfig({
    scenario: 'coastal', seconds: '5', 'attack-skill': 'pursuit', diagnostics: true,
  }));
  const result = traced.results[0];
  assert.equal(result.caseId, 'coastal-0');
  assert.equal(result.diagnostics.caseId, result.caseId);
  assert.equal(result.diagnostics.sortie.kind, 'flight3d.sortie.v1');

  const store = new ReplayStore(createMemoryStorage(), { indexedDB: createMemoryIndexedDB() });
  const imported = await store.importJson(JSON.stringify(result.diagnostics.sortie));
  assert.equal(imported.error, null);
  assert.ok(imported.entry);

  const loaded = await store.get(imported.entry.id);
  assert.ok(loaded);
  assert.equal(loaded.track.metadata.scenario, 'cruise');
  assert.ok(loaded.track.samples.length >= 2);
  assert.ok(Math.abs(loaded.track.durationSec - result.elapsedSeconds) < 0.05);

  const { shotBreakdown, metrics, targetLifecycles } = result;
  assert.equal(metrics.selfDamage.gearDamagedParts, 0);
  assert.equal(metrics.selfDamage.bodyDamagedParts, 0);
  assert.equal(shotBreakdown.lockedLaunches + shotBreakdown.unlockedLaunches, result.shots.length);
  assert.equal(
    shotBreakdown.kills + shotBreakdown.survivedFuzeBlasts + shotBreakdown.groundImpacts
      + shotBreakdown.expiredMisses + shotBreakdown.unresolved,
    result.shots.length,
  );
  assert.equal(metrics.survived, !result.crashed);
  assert.equal(metrics.uniqueOpponentsTotal, 1);
  assert.ok(targetLifecycles.length >= 1);
  assert.ok(Number.isFinite(metrics.energyAndAltitude.specificEnergyDeltaM));
  assert.ok(Number.isFinite(metrics.controlLoss.controlLossTotalSeconds));
});

test('coastal CLI exports a sortie that round-trips through ReplayStore', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flight-coastal-t2-'));
  const output = join(dir, 'coastal-t2.json');
  try {
    const cli = spawnSync(
      process.execPath,
      [
        'scripts/run-combat-experiment.mjs',
        '--scenario', 'coastal',
        '--seconds', '5',
        '--attack-skill', 'pursuit',
        '--evasion-skill', 'legacy-break',
        '--countermeasure-policy', 'single',
        '--diagnostics',
        '--output', output,
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(cli.status, 0, cli.stderr);
    const printed = JSON.parse(cli.stdout);
    assert.ok(printed.sortiePath);

    const sortiePayload = readFileSync(printed.sortiePath, 'utf8');
    const sortie = JSON.parse(sortiePayload);
    assert.equal(sortie.kind, 'flight3d.sortie.v1');

    const store = new ReplayStore(createMemoryStorage(), { indexedDB: createMemoryIndexedDB() });
    const imported = await store.importJson(sortiePayload);
    assert.equal(imported.error, null);
    assert.ok(imported.entry);

    const loaded = await store.get(imported.entry.id);
    assert.equal(loaded.track.metadata.scenario, 'cruise');
    for (const ev of loaded.track.combat.events) {
      assert.ok(ev.timeSec <= loaded.track.durationSec + 1e-6);
    }

    const report = JSON.parse(readFileSync(output, 'utf8'));
    const result = report.results[0];
    assert.equal(
      result.shotBreakdown.kills + result.shotBreakdown.survivedFuzeBlasts
        + result.shotBreakdown.groundImpacts + result.shotBreakdown.expiredMisses
        + result.shotBreakdown.unresolved,
      result.shots.length,
    );
    assert.ok(result.uniqueOpponentsKilled <= result.kills);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a controlled coastal encounter links recorded shots to engagement analysis', () => {
  const config = combatExperimentConfig({
    scenario: 'coastal', seconds: '20', 'attack-skill': 'close-pursuit', diagnostics: true,
  });
  const { results: [result] } = runCoastalCombatPlay(config, undefined, {
    setupEncounter({ combat, world }) {
      const target = combat.targets[0];
      const forward = new Vector3(0, 0, -1).applyQuaternion(world.quaternion);
      const position = world.position.clone().addScaledVector(forward, 1500);
      target.respawn(position, null);
      target.velocity.copy(world.velocity);
      target.quaternion = world.quaternion.clone();
    },
  });
  assert.equal(result.shots.length, 1);
  const analyzed = new Set(result.diagnostics.analysis.missiles.map(m => m.missileId));
  for (const shot of result.shots) {
    assert.ok(analyzed.has(result.diagnostics.trackMissileIds[shot.missileId]));
  }
});
