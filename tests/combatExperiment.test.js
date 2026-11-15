import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { combatExperimentConfig, runCombatExperiment } from '../scripts/lib/combatExperiment.mjs';
import { runBoundedCombat } from '../scripts/run-combat-experiment.mjs';

test('default grids preserve locked-IR and existing defense case counts', () => {
  const ir = combatExperimentConfig(), defense = combatExperimentConfig({ scenario: 'defense' });
  assert.equal(ir.geometries.length * ir.variants.length, 300);
  assert.equal(defense.geometries.length * defense.variants.length, 240);
  assert.equal(ir.recordTrajectory, false);
  assert.equal(combatExperimentConfig({ scenario: 'single' }).geometries.length, 1);
});

test('invalid selections and ambiguous single-shot requests fail before simulation', () => {
  for (const values of [{ scenario: 'unknown' }, { ranges: '' }, { ranges: 'NaN' },
    { types: 'other' }, { aspects: '181' }, { speeds: '0' }, { defense: 'other' },
    { 'altitude-pairs': '750:' }, { 'altitude-pairs': '750:2000', ranges: '800' },
    { timeout: '0' }, { timeout: 'Infinity' }, { scenario: 'single', ranges: '800,1500' },
    { scenario: 'single', defense: 'all' }]) assert.throws(() => combatExperimentConfig(values));
});

test('no-lock controls retain denominators and paired launch state, and diagnostics do not change outcomes', () => {
  const values = { ranges: '1500,10000', aspects: '0', speeds: '250', 'altitude-pairs': '1500:1500' };
  const ordinary = runCombatExperiment(combatExperimentConfig(values));
  const traced = runCombatExperiment(combatExperimentConfig({ ...values, diagnostics: true }));
  assert.deepEqual(ordinary.summary, traced.summary);
  assert.equal(ordinary.results.length, 6);
  for (const row of ordinary.summary) { assert.equal(row.total, 2); assert.equal(row.launched, 1); assert.equal(row.noLock, 1); }
  assert.ok(ordinary.results.every(r => r.trajectory === null));
  assert.ok(traced.results.filter(r => r.launched).every(r => r.trajectory.length > 1));
  assert.throws(() => runCombatExperiment({ geometries: [], variants: [] }), /Empty experiment/);
});

test('worker deadline terminates synchronous physics and CLI replaces stale success with incomplete', async () => {
  const config = combatExperimentConfig({ timeout: '0.000001' });
  await assert.rejects(runBoundedCombat(config), /timed out/);
  const dir = mkdtempSync(join(tmpdir(), 'flight-combat-experiment-'));
  const output = join(dir, 'report.json'), summary = join(dir, 'report.summary.json');
  try {
    writeFileSync(summary, '{"status":"complete"}');
    const result = spawnSync(process.execPath, ['scripts/run-combat-experiment.mjs', '--timeout', '0.000001', '--output', output],
      { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /timed out/);
    assert.equal(JSON.parse(readFileSync(output)).status, 'incomplete');
    assert.equal(JSON.parse(readFileSync(summary)).status, 'incomplete');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('successful CLI emits compact cohorts and preserves detailed diagnostics only in artifacts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flight-combat-success-'));
  const output = join(dir, 'report.json');
  try {
    const result = spawnSync(process.execPath, ['scripts/run-combat-experiment.mjs', '--scenario', 'single',
      '--diagnostics', '--output', output], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const consoleReport = JSON.parse(result.stdout);
    assert.equal(consoleReport.status, 'complete');
    assert.equal(consoleReport.completedCases, 1);
    assert.equal(consoleReport.cohorts.length, 1);
    assert.equal(consoleReport.results, undefined);
    const summary = JSON.parse(readFileSync(consoleReport.summaryPath));
    assert.equal(summary.config.geometries, undefined);
    assert.equal(summary.config.geometryCount, 1);
    const detailed = JSON.parse(readFileSync(output));
    assert.equal(detailed.results.length, 1);
    assert.ok(detailed.results[0].trajectory.length > 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('metadata executor failures cannot leave an older success summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flight-combat-metadata-'));
  const output = join(dir, 'report.json'), summary = join(dir, 'report.summary.json');
  try {
    writeFileSync(summary, '{"status":"complete"}');
    const result = spawnSync(process.execPath, ['scripts/run-combat-experiment.mjs', '--output', output],
      { encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: dir } });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(readFileSync(output)).status, 'incomplete');
    assert.equal(JSON.parse(readFileSync(summary)).status, 'incomplete');
    assert.equal(JSON.parse(readFileSync(summary)).metadata.revision, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('invalid experiment inputs replace both successful artifacts before rejecting the rerun', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flight-combat-invalid-rerun-'));
  const output = join(dir, 'report.json'), summary = join(dir, 'report.summary.json');
  const run = args => spawnSync(process.execPath, ['scripts/run-combat-experiment.mjs',
    '--scenario', 'single', '--output', output, ...args], { encoding: 'utf8', timeout: 10000 });
  try {
    for (const invalid of [['--ranges', '0'], ['--defense', 'unknown']]) {
      assert.equal(run([]).status, 0);
      assert.equal(JSON.parse(readFileSync(summary)).status, 'complete');
      const failed = run(invalid);
      assert.equal(failed.status, 1);
      for (const path of [output, summary]) {
        const report = JSON.parse(readFileSync(path));
        assert.equal(report.status, 'incomplete');
        assert.equal(report.completedCases, 0);
        assert.equal(report.config, null);
        assert.match(report.error, /Invalid ranges|Unknown defense/);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
