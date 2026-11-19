import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Euler } from 'three';
import { createHeadlessSimulation } from '../src/core/HeadlessSimulation.js';
import { guidePlayer, experiment } from '../scripts/probe-cruise-combat.mjs';

test('pursuit routes elevator and rudder through real player input rather than overwritten aero commands', () => {
  const pilot = createHeadlessSimulation({ aircraftId: 'F16' });
  pilot.setPreset('cruise'); pilot.integratePhysics(1 / 120);
  pilot.euler = new Euler(); pilot.forward = new Vector3(); pilot.result = pilot._aeroResult;
  pilot.aero.beta = 0.1;
  const original = pilot.quaternion.clone();
  const { elevator, rudder } = pilot.aero;
  guidePlayer(pilot, { position: pilot.position.clone().add(new Vector3(3000, 500, -3000)) }, 180);
  assert.equal(pilot.aero.elevator, elevator);
  assert.equal(pilot.aero.rudder, rudder);
  assert.notEqual(pilot.controls.virtualRudder, 0);
  assert.notEqual(pilot.controls.virtualElevator, 0);
  assert.deepEqual(pilot.quaternion, original, 'guidance must not directly change the pose');
  pilot.integratePhysics(1 / 120);
  assert.notEqual(pilot.controls.elevator, 0);
  assert.notEqual(pilot.controls.rudder, 0);
  assert.ok(pilot.position.toArray().every(Number.isFinite));
});

test('an acquisition window with no launch retains an explicit withheld outcome', () => {
  const row = experiment('locked', true, 108, { maxSeconds: 0.1 });
  assert.equal(row.shots.length, 0);
  assert.equal(row.launchState, null);
  assert.equal(row.terminal, 'withheld-no-lock-or-range');
  assert.equal(row.kills, 0);
});

test('real Cruise countermeasure controls share the exact locked launch and record terminal flight', () => {
  const enabled = experiment('close-locked', true, Math.hypot(96, 49), { launchDeadlineSeconds: 90, maxSeconds: 160 });
  const disabled = experiment('close-locked', false, Math.hypot(96, 49), { launchDeadlineSeconds: 90, maxSeconds: 160 });
  assert.deepEqual(enabled.launchState, disabled.launchState);
  for (const row of [enabled, disabled]) {
    assert.equal(row.shots.length, 1);
    assert.equal(row.shots[0].locked, true);
    assert.equal(row.shots[0].alive, false);
    assert.ok(row.launchState.rangeM <= 2500);
    assert.ok(row.missileSamples.length > 1);
    assert.equal(row.missileSamples.at(-1).alive, false);
    assert.equal(row.transitions[0].phase, 'track:bandit:active');
  }
  assert.ok(enabled.events.flare_dispense > 0);
  assert.equal(disabled.events.flare_dispense, undefined);
});
