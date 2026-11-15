import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateCombatSituation } from '../scripts/lib/combatSituationMatrix.mjs';

test('sub-sample memory and target reacquisition reach the shared analyzer', () => {
  const options = { type: 'AIM9X', rangeM: 2500, aspectDeg: 0,
    shooterAltM: 1500, targetAltM: 1500, targetSpeedMps: 180,
    targetBehavior: 'evasive_ai', flares: true, chaff: false,
    flareObservationCutoffSeconds: 0.2, recordTrajectory: true };
  const plain = simulateCombatSituation(options);
  const recorded = simulateCombatSituation({ ...options, recordDiagnostics: true });
  for (const key of ['terminal', 'terminalSeconds', 'minSeparationM', 'defense', 'trajectory']) {
    assert.deepEqual(recorded[key], plain[key]);
  }
  assert.equal(plain.diagnostics, null);
  const diagnostic = recorded.diagnostics;
  const events = diagnostic.track.combat.events;
  const transfer = events.find(e => e.kind === 'decoy_transfer');
  const memory = events.find(e => e.kind === 'seeker_state' && e.state === 'memory');
  const reacquired = events.find(e => e.kind === 'seeker_target' && e.targetType === 'bandit' && e.timeSec > transfer.timeSec);
  assert.ok(transfer.timeSec < memory.timeSec && memory.timeSec < reacquired.timeSec);
  assert.ok(reacquired.timeSec - memory.timeSec < 0.2);
  assert.ok(!recorded.trajectory.some(s => s.seekerState === 'memory'), '5 Hz missed the short memory interval');
  assert.ok(diagnostic.analysis.missiles[0].seekerTimeline.some(e => e.state === 'memory'));
  assert.ok(diagnostic.analysis.missiles[0].seekerTimeline.some(e => e.eventKind === 'seeker_target' && e.prevTargetId === transfer.decoyId && e.targetId === 1));
  assert.equal(transfer.sourceId, 1);
  assert.equal(diagnostic.analysis.summary.countermeasures.flaresDispensed, recorded.defense.flaresDispensed);
  assert.ok(events.some(e => e.kind === 'warning_state' && e.confirmed));
  assert.ok(events.some(e => e.kind === 'diagnostic_intervention'));
  assert.ok(events.every((e, i) => i === 0 || events[i - 1].timeSec <= e.timeSec));
});

test('launch, continuous CPA, blast damage and kill are correlated without live object references', () => {
  const options = { rangeM: 1500, targetBehavior: 'straight', recordDiagnostics: true };
  const first = simulateCombatSituation(options);
  const second = simulateCombatSituation(options);
  assert.deepEqual(first.diagnostics, second.diagnostics, 'Fixture-local IDs are reproducible across global ID increments');
  const serialized = JSON.parse(JSON.stringify(first.diagnostics));
  const missile = serialized.analysis.missiles[0];
  assert.equal(missile.termination.outcome, 'kill');
  assert.equal(missile.termination.damageApplied, 100);
  assert.equal(missile.closestApproach.method, 'continuous_fuze');
  assert.ok(Math.abs(missile.closestApproach.minSeparationM - first.minSeparationM) < 0.01);
  const launch = serialized.track.combat.events.find(e => e.kind === 'launch');
  assert.equal(launch.timeSec, 0);
  assert.notDeepEqual(launch.position, missile.termination.position);
  assert.ok(serialized.track.combat.diagnosticSamples.some(d => d.dragN > 0 && d.mach > 0 && d.qBarPa > 0));
});

test('sampled CPA, guidance cutoff and motor burnout do not imply energy exhaustion', () => {
  const run = simulateCombatSituation({ rangeM: 2500, targetBehavior: 'evasive_ai',
    countermeasures: true, recordDiagnostics: true });
  assert.equal(run.terminal, 'miss-expired');
  const events = run.diagnostics.track.combat.events;
  assert.ok(events.some(e => e.kind === 'propulsion_state' && e.powered === false));
  assert.ok(events.some(e => e.kind === 'guidance_state' && e.active === false && e.reason));
  const analyzed = run.diagnostics.analysis.missiles[0];
  assert.equal(analyzed.termination.outcome, 'expired');
  assert.equal(analyzed.closestApproach.method, 'step_sampling');
  assert.doesNotMatch(analyzed.causalSummary, /energy.*exhausted/);
});

test('timeout is unresolved and no-lock never manufactures a missile engagement', () => {
  const run = simulateCombatSituation({ rangeM: 1500, targetBehavior: 'straight',
    maxSimTimeSec: 0.1, recordDiagnostics: true });
  assert.equal(run.terminal, 'timeout');
  assert.equal(run.diagnostics.analysis.summary.outcomes.unresolved_sortie_ended, 1);
  assert.equal(run.diagnostics.track.combat.events.filter(e => e.kind === 'unresolved_end').length, 1);
  assert.ok(Math.abs(run.diagnostics.track.combat.diagnosticSamples.at(-1).timeSec - 0.1) < 1e-9);
  const noLock = simulateCombatSituation({ rangeM: 10000, recordDiagnostics: true });
  assert.equal(noLock.launched, false);
  assert.equal(noLock.diagnostics, null);
  assert.equal(noLock.inputs.recordDiagnostics, true);
});

test('non-lethal fuze explosion remains survival with measured partial damage', () => {
  const run = simulateCombatSituation({ rangeM: 1500, aspectDeg: 180,
    shooterAltM: 1500, targetAltM: 1500, targetBehavior: 'evasive_ai',
    countermeasures: true, recordDiagnostics: true });
  assert.equal(run.terminal, 'detonation-non-lethal');
  const analysis = run.diagnostics.analysis;
  assert.equal(analysis.summary.missileKills, 0);
  const result = analysis.missiles[0];
  assert.equal(result.termination.outcome, 'survived_fuze_blast');
  assert.ok(result.termination.damageApplied > 0 && result.termination.damageApplied < 100);
  assert.ok(Math.abs(result.termination.damageApplied / 100 - run.damageInflicted) < 0.001);
  assert.ok(Math.abs(result.termination.distanceM - run.minSeparationM) < 0.01);
  assert.equal(result.closestApproach.method, 'continuous_fuze');
});

test('continuous LOS fields do not duplicate guidance_state events', () => {
  const run = simulateCombatSituation({ rangeM: 2500, targetBehavior: 'straight',
    recordDiagnostics: true });
  const guidance = run.diagnostics.track.combat.events.filter(e => e.kind === 'guidance_state');
  assert.ok(guidance.length >= 2, 'expected launch and tracking transitions');
  assert.ok(guidance.length < 20, `guidance_state log grew to ${guidance.length} events`);
  for (let i = 1; i < guidance.length; i++) {
    assert.notDeepEqual([guidance[i - 1].active, guidance[i - 1].reason],
      [guidance[i].active, guidance[i].reason],
      'consecutive guidance_state events must differ in active/reason');
  }
});

test('manual flare and sensor cutoff intervention inputs are preserved', () => {
  const run = simulateCombatSituation({ rangeM: 2500, targetBehavior: 'evasive_ai',
    threatResponseEnabled: false, flares: true, manualFlareAtSeconds: 0.65,
    recordDiagnostics: true, recordDetail: true });
  assert.equal(run.inputs.recordDetail, true);
  assert.equal(run.inputs.manualFlareAtSeconds, 0.65);
  const event = run.diagnostics.track.combat.events.find(e => e.kind === 'decoy_dispense');
  assert.equal(event.intervention, true);
  assert.equal(event.sourceId, 1);
  assert.equal(run.diagnostics.analysis.summary.countermeasures.flaresDispensed, 1);
});

test('surface impact is not classified as a proximity burst', () => {
  const run = simulateCombatSituation({ type: 'AIM120C', rangeM: 400, aspectDeg: 90,
    targetBehavior: 'straight', recordDiagnostics: true });
  assert.equal(run.terminal, 'miss-ground');
  const result = run.diagnostics.analysis.missiles[0].termination;
  assert.equal(result.outcome, 'ground_impact');
  assert.equal(result.fuzeTriggered, false);
  assert.equal(result.distanceM, null);
});
