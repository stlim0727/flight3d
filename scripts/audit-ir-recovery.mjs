/** Paired 2.5 km AIM-9X recovery controls on the locked-shot fixture.
 *
 * Diagnostic interventions are test-only: a manual flare without evasion and
 * hiding a flare after an age. They do not describe production gameplay.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { simulateCombatSituation } from './lib/combatSituationMatrix.mjs';

const dir = '.cache/ir-recovery';
mkdirSync(dir, { recursive: true });
const dt = 1 / 120;
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const started = performance.now();
const common = {
  type: 'AIM9X', rangeM: 2500, targetSpeedMps: 180, targetBehavior: 'evasive_ai',
  countermeasures: false, chaff: false, recordDetail: true, maxSimTimeSec: 20,
};

/** Reduce a 120 Hz run to recovery, geometry and terminal-guidance evidence. */
function metrics(result) {
  const detail = result.detail || [];
  let lastFlare = -1;
  let reacq = -1;
  for (let i = 0; i < detail.length; i++) {
    const sample = detail[i];
    if (sample.seekerTargetType === 'flare' && sample.seekerState === 'track') lastFlare = i;
    if (lastFlare >= 0 && reacq < 0 && i > lastFlare
      && sample.seekerTargetType === 'bandit' && sample.seekerState === 'track') reacq = i;
  }
  let closest = null;
  for (const sample of detail) if (!closest || sample.rangeM < closest.rangeM) closest = sample;
  let saturatedSeconds = 0;
  let maxRequested = 0;
  for (let i = reacq >= 0 ? reacq : detail.length; i < detail.length; i++) {
    const sample = detail[i];
    if (sample.seekerTargetType !== 'bandit') continue;
    if (sample.requestedLateralMps2 > sample.availableLateralMps2 + 1e-4) saturatedSeconds += dt;
    maxRequested = Math.max(maxRequested, sample.requestedLateralMps2);
  }
  return {
    terminal: result.terminal,
    launchKey: result.launchState ? JSON.stringify(result.launchState) : null,
    minSeparationM: result.minSeparationM,
    decoyTransfers: result.decoyTransfers,
    flareDispenseSeconds: result.defense?.firstConfirmedThreatSeconds ?? null,
    flareTrackSeconds: lastFlare >= 0
      ? Number((detail[lastFlare].seconds - (result.defense?.firstConfirmedThreatSeconds ?? 0)).toFixed(2)) : 0,
    reacquired: reacq >= 0,
    reacquiredSeconds: reacq >= 0 ? Number(detail[reacq].seconds.toFixed(2)) : null,
    reacquiredRangeM: reacq >= 0 ? Math.round(detail[reacq].rangeM) : null,
    reacquiredLosDeg: reacq >= 0 ? Number(detail[reacq].losAngleDeg.toFixed(1)) : null,
    closestSeconds: closest ? Number(closest.seconds.toFixed(2)) : null,
    closestRangeM: closest ? Number(closest.rangeM.toFixed(1)) : null,
    closestLosDeg: closest ? Number(closest.losAngleDeg.toFixed(1)) : null,
    closestSpeedMps: closest ? Number(closest.missileSpeedMps.toFixed(0)) : null,
    closestPropellant: closest ? Number(closest.propellant.toFixed(2)) : null,
    closestAvailableMps2: closest ? Math.round(closest.availableLateralMps2) : null,
    saturatedSeconds: Number(saturatedSeconds.toFixed(2)),
    maxRequestedMps2: Math.round(maxRequested),
    seekerLossReasons: result.seekerLossReasons,
    guidanceLossReasons: result.guidanceLossReasons,
  };
}

const rows = [];
for (const shooterSpeedMps of [Math.hypot(96, 49), 250]) {
  for (const [shooterAltM, targetAltM] of [[750, 1210], [1500, 1500]]) {
    for (const aspectDeg of [0, 45, 90, 135, 180]) {
      const geometry = { ...common, shooterSpeedMps, shooterAltM, targetAltM, aspectDeg };
      const flareAt = simulateCombatSituation({ ...geometry, flares: true, threatResponseEnabled: true });
      assert.ok(flareAt.launched && flareAt.launchState, 'paired controls require a locked launch');
      assert.ok(Number.isFinite(flareAt.defense.firstConfirmedThreatSeconds),
        'flare control requires an observed flare dispense time');
      const control = metrics(flareAt);
      const launchKey = control.launchKey;
      delete control.launchKey;
      const result = {
        aspectDeg, shooterSpeedMps, shooterAltM, targetAltM,
        launchState: flareAt.launchState,
        control,
        evasionOnly: metrics(simulateCombatSituation({
          ...geometry, flares: false, threatResponseEnabled: true,
        })),
        flareOnly: metrics(simulateCombatSituation({
          ...geometry, flares: true, threatResponseEnabled: false,
          manualFlareAtSeconds: flareAt.defense.firstConfirmedThreatSeconds,
        })),
      };
      for (const age of [0.2, 2, 4]) {
        result[`cutoff${age}s`] = metrics(simulateCombatSituation({
          ...geometry, flares: true, threatResponseEnabled: true,
          flareObservationCutoffSeconds: age,
        }));
      }
      for (const key of ['evasionOnly', 'flareOnly', 'cutoff0.2s', 'cutoff2s', 'cutoff4s']) {
        assert.equal(result[key].launchKey, launchKey, `${key} shares the launch state`);
        assert.notEqual(result[key].terminal, 'no-lock', `${key} launched`);
        assert.notEqual(result[key].terminal, 'fire-failed', `${key} launched`);
        delete result[key].launchKey;
      }
      rows.push(result);
    }
  }
}

function summarize(subset) {
  const values = subset.map(row => row.terminal);
  const timed = subset.filter(row => row.reacquired);
  const reacquired = timed.filter(row => row.reacquiredRangeM < 800).length;
  return {
    cases: subset.length,
    kills: values.filter(value => value === 'hit').length,
    terminals: values.reduce((counts, value) => {
      counts[value] = (counts[value] || 0) + 1;
      return counts;
    }, {}),
    reacquired: timed.length,
    reacquiredInside800M: reacquired,
    meanFlareTrackSeconds: Number((subset.reduce((sum, row) => sum + row.flareTrackSeconds, 0)
      / Math.max(1, subset.filter(row => row.flareTrackSeconds > 0).length)).toFixed(2)),
    saturatedAtReacquisition: subset.filter(row => row.saturatedSeconds > 0).length,
    propellantExhaustedAtClosest: subset.filter(row => row.closestPropellant === 0).length,
  };
}

const variantKeys = ['evasionOnly', 'flareOnly', 'control', 'cutoff0.2s', 'cutoff2s', 'cutoff4s'];
const summary = {
  revision, dt, wallSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
  geometries: rows.length,
  variants: Object.fromEntries(variantKeys.map(key => [key, summarize(rows.map(row => row[key]))])),
  rows: rows.map(({ launchState, ...row }) => ({ ...row, launchRangeM: launchState.rangeM })),
};

// One representative failure at launch-range level, plus the same geometry with
// the flare hidden after the transfer is confirmed.
function timeline(settings) {
  const run = simulateCombatSituation({ ...common, shooterSpeedMps: 250,
    shooterAltM: 1500, targetAltM: 1500, aspectDeg: 0, flares: true,
    threatResponseEnabled: true, ...settings });
  const samples = [];
  let previous = null;
  for (const sample of run.detail) {
    const key = [sample.seekerState, sample.seekerTargetType, sample.guidanceReason,
      sample.observationLossReason].join('|');
    const stateChange = key !== previous;
    if (stateChange || sample.seconds === run.detail.at(-1)?.seconds
      || Math.abs(sample.seconds * 10 - Math.round(sample.seconds * 10)) < 1e-9) {
      samples.push({
        seconds: Number(sample.seconds.toFixed(3)),
        state: key,
        rangeM: Number(sample.rangeM.toFixed(1)),
        losAngleDeg: Number(sample.losAngleDeg.toFixed(1)),
        missileSpeedMps: Number(sample.missileSpeedMps.toFixed(0)),
        propellant: Number(sample.propellant.toFixed(2)),
        requestedLateralMps2: Math.round(sample.requestedLateralMps2),
        availableLateralMps2: Math.round(sample.availableLateralMps2),
      });
    }
    previous = key;
  }
  return { settings, terminal: run.terminal, minSeparationM: run.minSeparationM,
    decoyTransfers: run.decoyTransfers, decoyTransferSeconds: run.decoyTransferSeconds, samples };
}
summary.representative = {
  control: timeline({}),
  cutoffTransfer: timeline({ flareObservationCutoffSeconds: 0.2 }),
};

writeFileSync(`${dir}/report.json`, JSON.stringify(summary, null, 2));
writeFileSync(`${dir}/summary.json`, JSON.stringify({
  ...summary,
  rows: summary.rows.map(({ control, evasionOnly, flareOnly, ...row }) => ({
    ...row, control: control.terminal, evasionOnly: evasionOnly.terminal, flareOnly: flareOnly.terminal,
  })),
}, null, 2));
console.log(JSON.stringify(summary.variants, null, 2));
console.log(`Saved ${dir}; ${summary.wallSeconds} seconds`);
