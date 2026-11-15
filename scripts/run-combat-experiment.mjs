#!/usr/bin/env node
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { combatExperimentConfig, runCombatExperiment } from './lib/combatExperiment.mjs';

if (!isMainThread) {
  const report = runCombatExperiment(workerData, completed => parentPort.postMessage({ completed }));
  parentPort.postMessage({ report });
}

export function runBoundedCombat(config, onProgress = () => {}) {
  return new Promise((resolveRun, rejectRun) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: config });
    let settled = false;
    const finish = (error, report) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().then(() => error ? rejectRun(error) : resolveRun(report), rejectRun);
    };
    const timer = setTimeout(() => finish(new Error('Combat experiment timed out; results are incomplete')),
      config.timeoutSeconds * 1000);
    worker.on('message', message => {
      if (message.report) finish(null, message.report);
      else if (Number.isInteger(message.completed)) onProgress(message.completed);
    });
    worker.on('error', error => finish(error));
    worker.on('exit', code => { if (!settled) finish(new Error(`Worker exited without a report (${code})`)); });
  });
}

function save(path, report) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n');
  renameSync(temporary, path);
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    scenario: { type: 'string' }, defense: { type: 'string' }, types: { type: 'string' },
    ranges: { type: 'string' }, aspects: { type: 'string' }, speeds: { type: 'string' },
    'altitude-pairs': { type: 'string' }, timeout: { type: 'string' },
    diagnostics: { type: 'boolean' }, output: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('npm run combat:experiment -- [--scenario locked-ir|defense|single] [--defense all|passive|reaction-only|reaction-flare|reaction-chaff|reaction-both]\n' +
      '  [--types AIM9X,AIM120C] [--ranges 1500,2500] [--aspects 0,90] [--speeds 108,250]\n' +
      '  [--altitude-pairs 750:1210,1500:1500] [--diagnostics] [--timeout 60] [--output path.json]');
    return;
  }
  const output = resolve(values.output ?? `.cache/combat-experiment/${values.scenario ?? 'locked-ir'}.json`);
  const summaryPath = output.replace(/\.json$/i, '') + '.summary.json';
  if (output === summaryPath) throw new Error('Report and summary paths must differ');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
  const metadata = { revision: null, dirty: null,
    nodeVersion: process.version, timestepSeconds: 1 / 120, terrain: 'flat-zero', renderer: 'none',
    launchPolicy: 'confirmed-lock-single', fixture: 'evasive_ai', randomSeed: null };
  const started = performance.now();
  let completedCases = 0;
  let config = null, compactConfig = null, expectedCases = null;
  const running = { status: 'running', metadata, requested: values, config, expectedCases };
  save(output, running);
  save(summaryPath, { ...running, config: compactConfig });
  try {
    config = combatExperimentConfig(values);
    expectedCases = config.geometries.length * config.variants.length;
    compactConfig = { scenario: config.scenario, geometryCount: config.geometries.length,
      variants: config.variants.map(v => v.id), recordTrajectory: config.recordTrajectory,
      targetSpeedMps: config.targetSpeedMps, timeoutSeconds: config.timeoutSeconds };
    metadata.revision = git(['rev-parse', 'HEAD']);
    metadata.dirty = Boolean(git(['status', '--porcelain']));
    const report = await runBoundedCombat(config, completed => { completedCases = completed; });
    const complete = { status: 'complete', metadata: { ...metadata, durationSeconds: (performance.now() - started) / 1000 },
      config, expectedCases, completedCases: report.results.length, ...report };
    save(output, complete);
    const { results, ...summary } = complete;
    save(summaryPath, { ...summary, config: compactConfig });
    console.log(JSON.stringify({ status: complete.status, completedCases: complete.completedCases,
      durationSeconds: complete.metadata.durationSeconds,
      cohorts: report.summary.map(s => ({ variant: s.variant, type: s.type, cases: s.total,
        launches: s.launched, kills: s.kills, noLock: s.noLock, unresolved: s.unresolved })),
      output, summaryPath }));
  } catch (error) {
    const failed = { status: 'incomplete', metadata, requested: values, config, expectedCases, completedCases, error: error.message };
    save(output, failed);
    save(summaryPath, { ...failed, config: compactConfig });
    throw error;
  }
}

if (isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
