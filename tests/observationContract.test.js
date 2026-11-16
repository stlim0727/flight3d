import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OBSERVATION_MODES,
  assertObservationBoundary,
  createContactObservation,
  createPilotObservation,
  createWarningObservations,
  resolveContactObservation,
} from '../src/pilot/ObservationContract.js';
import { createAttackSkill } from '../src/pilot/CombatSkills.js';
import { combatExperimentConfig, runCombatExperiment } from '../scripts/lib/combatExperiment.mjs';

test('observation-limited pilots reject truth-diagnostic mode and hidden raw truth fields', () => {
  const pursuit = createAttackSkill('pursuit');
  const own = { x: 0, y: 1500, z: 0, headingRad: 0 };
  const contact = createContactObservation({ x: 0, y: 1500, z: -2000, rangeM: 2000, observedAt: 1.0 });

  assert.throws(() => pursuit.update({
    mode: OBSERVATION_MODES.TRUTH_DIAGNOSTIC,
    time: 1.0,
    own,
    contact,
    locked: false,
    speedMps: 250,
  }), /truth-diagnostic/);

  for (const key of ['targets', 'missiles', 'simulator', 'scorer', 'propellant', 'futurePath']) {
    assert.throws(() => pursuit.update({
      mode: OBSERVATION_MODES.LIMITED,
      time: 1.0,
      own,
      contact,
      locked: false,
      speedMps: 250,
      [key]: {},
    }), new RegExp(key));
  }

  for (const key of ['velocity', 'propellant', 'futurePath', 'alive', 'flareStock']) {
    assert.throws(() => pursuit.update({
      mode: OBSERVATION_MODES.LIMITED,
      time: 1.0,
      own,
      contact: { ...contact, [key]: 1 },
      locked: false,
      speedMps: 250,
    }), new RegExp(key));
  }
});

test('contact observation handles delay, expiration, loss and reacquisition cleanly', () => {
  const pursuit = createAttackSkill('pursuit');
  const own = { x: 0, y: 2000, z: 0, headingRad: 0 };

  const c1 = createContactObservation({ x: 0, y: 2000, z: -2000, rangeM: 2000, observedAt: 1.0, ttlSeconds: 0.45, quality: 0.9 });
  const c2 = createContactObservation({ x: 40, y: 2000, z: -2000, rangeM: 2000, observedAt: 1.2, ttlSeconds: 0.45, quality: 0.9 });

  pursuit.update(createPilotObservation({ time: 1.0, own, contact: c1, locked: true, speedMps: 250 }));
  const leadCmd = pursuit.update(createPilotObservation({ time: 1.2, own, contact: c2, locked: true, speedMps: 250 }));
  assert.ok(leadCmd.headingRad > Math.atan2(40, 2000));
  assert.equal(leadCmd.fire, true);

  // Expired contact (time > expiresAt) is treated as lost and suppresses fire
  assert.equal(resolveContactObservation(c2, 2.0), null);
  const expiredCmd = pursuit.update(createPilotObservation({ time: 2.0, own, contact: c2, locked: true, speedMps: 250 }));
  assert.equal(expiredCmd.fire, false);
  assert.equal(expiredCmd.headingRad, own.headingRad);

  // Explicit lost contact also resolves to null
  const lost = createContactObservation({ x: 40, y: 2000, z: -2000, rangeM: 2000, observedAt: 2.2, status: 'lost' });
  assert.equal(resolveContactObservation(lost, 2.2), null);

  // Reacquisition after loss resets prior velocity history (no stale spike)
  const reacquired = createContactObservation({ x: 0, y: 2000, z: -2000, rangeM: 2000, observedAt: 3.0, ttlSeconds: 0.45 });
  const reacquiredCmd = pursuit.update(createPilotObservation({ time: 3.0, own, contact: reacquired, locked: false, speedMps: 250 }));
  assert.equal(Math.abs(reacquiredCmd.headingRad) < 1e-9, true);
});

test('IR launches emit optical warnings only and never disguise as radar warnings', () => {
  const aircraft = { position: { x: 0, y: 2000, z: 0 }, velocity: { x: 0, y: 0, z: -200 } };
  const irMissile = {
    id: 11,
    alive: true,
    propellant: 8,
    position: { x: 0, y: 2000, z: -2000 },
    velocity: { x: 0, y: 0, z: 300 },
    spec: { seekerType: 'IR', gimbalDeg: 65 },
  };
  const radarMissile = {
    id: 12,
    alive: true,
    propellant: 0,
    position: { x: 1000, y: 2000, z: -5000 },
    velocity: { x: -60, y: 0, z: 300 },
    spec: { seekerType: 'ACTIVE_RADAR', gimbalDeg: 65 },
  };

  const warnings = createWarningObservations({ now: 5.0, aircraft, missiles: [irMissile, radarMissile] });
  assert.equal(warnings.length, 2);
  assert.equal(warnings[0].channel, 'optical');
  assert.equal(warnings[1].channel, 'radar');
  for (const w of warnings) {
    assert.equal(w.propellant, undefined);
    assert.equal(w.futurePath, undefined);
    assert.equal(w.missile, undefined);
  }

  assert.throws(() => assertObservationBoundary({
    mode: OBSERVATION_MODES.LIMITED,
    own: { x: 0, y: 2000, z: 0, headingRad: 0 },
    contact: null,
    warnings: [{ channel: 'radar', sourceSeekerType: 'IR', bearingRad: 0, observedAt: 1, expiresAt: 2, quality: 1 }],
  }), /IR launch/);
});

test('coastal play records observation-limited mode in results and summary', () => {
  const out = runCombatExperiment(combatExperimentConfig({ scenario: 'coastal', seconds: '2' }));
  assert.equal(out.results[0].observationMode, OBSERVATION_MODES.LIMITED);
  assert.equal(out.summary[0].observationMode, OBSERVATION_MODES.LIMITED);
});

test('future contacts are rejected and plain contact/warning entries are copied and frozen', () => {
  const mutableContact = { x: 10, y: 2000, z: -2000, rangeM: 2000, observedAt: 5.0, expiresAt: 5.5, quality: 1, status: 'active' };
  const mutableWarning = { id: 'w1', channel: 'optical', bearingRad: 0.1, observedAt: 5.0, expiresAt: 5.5, quality: 0.9, status: 'active' };
  const snapshot = createPilotObservation({
    time: 4.0,
    own: { x: 0, y: 2000, z: 0, headingRad: 0 },
    contact: mutableContact,
    warnings: [mutableWarning],
  });
  assert.equal(Object.isFrozen(snapshot.contact), true);
  assert.equal(Object.isFrozen(snapshot.warnings[0]), true);
  mutableContact.x = 9999;
  mutableWarning.bearingRad = 2.5;
  assert.equal(snapshot.contact.x, 10);
  assert.equal(snapshot.warnings[0].bearingRad, 0.1);
  assert.equal(resolveContactObservation(snapshot.contact, 4.0), null);
  assert.equal(resolveContactObservation(snapshot.contact, 5.2), snapshot.contact);
});
