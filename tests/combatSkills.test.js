import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { combatSkill, createAttackSkill, evasionDemand } from '../src/pilot/CombatSkills.js';
import { AirToAirMissileSystem } from '../src/weapons/AirToAirMissileSystem.js';
import { combatExperimentConfig, runCombatExperiment } from '../scripts/lib/combatExperiment.mjs';

test('skill selection is explicit, versioned and rejects misspellings and ignored arguments', () => {
  const config = combatExperimentConfig({ scenario: 'coastal', 'attack-skill': 'hold',
    'evasion-skill': 'hold', 'countermeasure-policy': 'none' });
  assert.deepEqual(config.skills.attack, { id: 'hold', version: '1.0.0' });
  for (const values of [{ scenario: 'coastal', 'attack-skill': 'typo' },
    { scenario: 'coastal', seconds: '301' }, { scenario: 'coastal', ranges: '1000' },
    { 'evasion-skill': 'hold' }]) assert.throws(() => combatExperimentConfig(values));
  assert.throws(() => combatSkill('countermeasure', 'typo'));
});

test('attack consumes snapshots, gates fire by contact/lock/range, and supports abort/reset', () => {
  const observation = { own: { x: 0, y: 1500, z: 0, headingRad: 0 },
    contact: { x: 100, y: 1600, z: -2000, rangeM: 2002 }, locked: true, speedMps: 250 };
  const pursuit = createAttackSkill('pursuit'), close = createAttackSkill('close-pursuit');
  assert.equal(pursuit.update(observation).fire, true);
  assert.equal(close.update(observation).fire, false);
  assert.equal(pursuit.update({ ...observation, locked: false }).fire, false);
  assert.equal(pursuit.update({ ...observation, contact: null }).fire, false);
  pursuit.abort(); assert.equal(pursuit.update(observation), null);
  pursuit.reset(); assert.equal(pursuit.update(observation).fire, true);
  assert.equal(createAttackSkill('hold').update(observation).fire, false);
});

test('legacy evasion preserves guidance math; hold ignores warning without disabling perception', () => {
  const observation = { patrolHeading: 0.4, warningHeading: -2.8, weight: 0.7, integrity: 0.8, speedMps: 180 };
  const error = Math.atan2(Math.sin(-3.2), Math.cos(-3.2));
  assert.deepEqual(evasionDemand('legacy-break', observation), {
    headingRad: 0.4 + error * 0.7 * 0.8, speedMps: 180 + 70 * 0.7 * 0.8 });
  assert.deepEqual(evasionDemand('hold', observation), { headingRad: 0.4, speedMps: 180 });
});

test('countermeasure choice is independent of warning detection and resets per sortie', () => {
  for (const countermeasurePolicy of ['none', 'single']) {
    const combat = new AirToAirMissileSystem({ evasionSkill: 'hold', countermeasurePolicy });
    const world = { active: true, onGround: false, position: new Vector3(0, 3000, 0),
      velocity: new Vector3(0, 0, -250), quaternion: new Quaternion(), terrainHeight: () => 0 };
    combat.update(1 / 120, world);
    const target = combat.targets[0];
    const missile = combat.fire(world);
    missile.position.copy(target.position).add(new Vector3(0, 0, 3000));
    missile.velocity.set(0, 0, -300);
    const events = [];
    for (let tick = 0; tick < 240; tick++) events.push(...combat.update(1 / 120, world));
    assert.notEqual(target.threatResponse.confirmedId, null);
    assert.equal(events.filter(e => e.type === 'flare_dispense').length, countermeasurePolicy === 'single' ? 1 : 0);
    combat.reset(); combat.update(1 / 120, world);
    assert.equal(combat.targets[0].evasionSkill, 'hold');
    assert.equal(combat.targets[0].flareThreatIds.size, 0);
  }
});

test('renderless coastal play preserves initial conditions across policy changes and records bounded results', () => {
  const make = values => runCombatExperiment(combatExperimentConfig({ scenario: 'coastal', seconds: '2', diagnostics: true, ...values })).results[0];
  const a = make({}), b = make({ 'attack-skill': 'hold', 'evasion-skill': 'hold', 'countermeasure-policy': 'none' });
  assert.deepEqual(a.initialState, b.initialState);
  assert.equal(a.elapsedSeconds, 2);
  assert.equal(a.samples.length, 2);
  assert.equal(b.skills.countermeasure.id, 'none');
  assert.equal(b.shots.length, 0);
});
