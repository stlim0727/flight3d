/** Locked single-shot controls, using the production situation fixture. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { simulateCombatSituation } from './lib/combatSituationMatrix.mjs';

const dir = '.cache/locked-ir';
mkdirSync(dir, { recursive: true });
const variants = [
  { id: 'patrol', threatResponseEnabled: false, flares: false },
  { id: 'evasion', threatResponseEnabled: true, flares: false },
  { id: 'evasion-flare', threatResponseEnabled: true, flares: true },
];
const rows = [];
const started = performance.now();
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
for (const shooterSpeedMps of [Math.hypot(96, 49), 250]) {
  for (const [shooterAltM, targetAltM] of [[750, 1210], [1500, 1500]]) {
    for (const rangeM of [800, 1500, 2500, 3500, 5000]) {
      for (const aspectDeg of [0, 45, 90, 135, 180]) {
        const group = [];
        for (const variant of variants) {
          const { id, ...controls } = variant;
          const r = simulateCombatSituation({ type: 'AIM9X', rangeM, aspectDeg, shooterSpeedMps,
            shooterAltM, targetAltM, targetSpeedMps: 180, targetBehavior: 'evasive_ai',
            countermeasures: false, chaff: false, ...controls, recordTrajectory: true });
          if (r.launched) assert.ok(r.launchState && Number.isFinite(r.minSeparationM));
          rows.push({ variant: id, ...r });
          group.push(r);
        }
        assert.ok(group.every(r => JSON.stringify(r.launchState) === JSON.stringify(group[0].launchState)), 'paired launch states');
      }
    }
  }
  writeFileSync(`${dir}/report.json`, JSON.stringify({ revision, dt: 1 / 120, wallSeconds: (performance.now() - started) / 1000, rows }, null, 2));
  console.log('Completed speed', shooterSpeedMps);
}
assert.equal(rows.length, 300);
const summarize = subset => ({ cases: subset.length, launched: subset.filter(r => r.launched).length,
  kills: subset.filter(r => r.terminal === 'hit').length,
  terminals: subset.reduce((a,r) => { a[r.terminal] = (a[r.terminal] || 0) + 1; return a; }, {}),
  flareReleased: subset.filter(r => r.defense?.flaresDispensed > 0).length,
  decoyEventCases: subset.filter(r => r.decoyTransfers > 0).length });
const summary = { revision, dt: 1 / 120, wallSeconds: (performance.now() - started) / 1000,
  variants: variants.map(v => ({ id: v.id, ...summarize(rows.filter(r => r.variant === v.id)) })),
  byRange: [800,1500,2500,3500,5000].flatMap(rangeM => variants.map(v => ({ rangeM, id: v.id,
    ...summarize(rows.filter(r => r.rangeM === rangeM && r.variant === v.id)) }))),
  rows: rows.map(({ trajectory, ...r }) => ({ ...r,
    sampledConfirmedFlareTrack: trajectory?.some(s => s.seekerState === 'track' && s.seekerTargetType === 'flare') ?? false,
  })) };
writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2));
const compact = { ...summary, rows: summary.rows.map(r => ({ variant: r.variant, inputs: r.inputs,
  launched: r.launched, launchState: r.launchState, terminal: r.terminal, minSeparationM: r.minSeparationM,
  damageInflicted: r.damageInflicted, controlLimitedSec: r.controlLimitedSec,
  flaresDispensed: r.defense?.flaresDispensed ?? 0,
  sampledConfirmedFlareTrack: r.sampledConfirmedFlareTrack,
  rawDecoyTransferEvents: r.decoyTransfers, guidanceLossReasons: r.guidanceLossReasons,
  seekerLossReasons: r.seekerLossReasons })) };
writeFileSync(`${dir}/evidence.json`, JSON.stringify(compact, null, 2));
console.log(JSON.stringify(summary.variants, null, 2));
console.log(`Saved ${dir}; ${summary.wallSeconds.toFixed(2)} seconds`);
