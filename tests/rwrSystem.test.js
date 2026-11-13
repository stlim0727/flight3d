import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { RWRSystem } from '../src/systems/RWRSystem.js';

const player = {
  position: new Vector3(0, 3000, 0),
  quaternion: new Quaternion(),
};

test('search, lock and launch escalate in three distinct stages', () => {
  const rwr = new RWRSystem();
  const distant = {
    position: new Vector3(0, 3000, -15000),
    velocity: new Vector3(0, 0, -100),
    alive: true,
  };
  let state = rwr.update(1 / 60, { ...player, threats: [distant], incoming: [] });
  assert.equal(state.level, 1);
  assert.equal(state.levelName, 'search');

  const tracking = {
    position: new Vector3(0, 3000, -8000),
    velocity: new Vector3(0, 0, 100),
    alive: true,
  };
  state = rwr.update(1 / 60, { ...player, threats: [tracking], incoming: [] });
  assert.equal(state.level, 2);
  assert.equal(state.levelName, 'lock');
  assert.ok(state.contacts[0].kind === 'lock');

  const missile = {
    position: new Vector3(0, 3000, -6000),
    velocity: new Vector3(0, 0, 700),
    alive: true,
    targetIsPlayer: true,
  };
  state = rwr.update(1 / 60, { ...player, threats: [tracking], incoming: [missile] });
  assert.equal(state.level, 3);
  assert.equal(state.levelName, 'launch');
  assert.ok(state.contacts.some(contact => contact.kind === 'launch'));
});

test('a receding emitter no longer counts as tracking even inside lock range', () => {
  const rwr = new RWRSystem();
  const receding = {
    position: new Vector3(0, 3000, -8000),
    velocity: new Vector3(0, 0, -250),
    alive: true,
  };
  const state = rwr.update(1 / 60, { ...player, threats: [receding], incoming: [] });
  assert.equal(state.level, 1);
  assert.equal(state.lockWarning, false);
  assert.equal(state.contacts[0].kind, 'search');
});

test('contacts report bearing clockwise from the nose', () => {
  const rwr = new RWRSystem();
  const right = {
    position: new Vector3(9000, 3000, 0),
    velocity: new Vector3(0, 0, -100),
    alive: true,
  };
  const left = {
    position: new Vector3(-9000, 3000, 0),
    velocity: new Vector3(0, 0, -100),
    alive: true,
  };
  let state = rwr.update(1 / 60, { ...player, threats: [right], incoming: [] });
  assert.ok(Math.abs(state.contacts[0].bearingRad - Math.PI / 2) < 1e-6);

  state = rwr.update(1 / 60, { ...player, threats: [left], incoming: [] });
  assert.ok(Math.abs(state.contacts[0].bearingRad + Math.PI / 2) < 1e-6);

  const behind = {
    position: new Vector3(0, 3000, 9000),
    velocity: new Vector3(0, 0, -100),
    alive: true,
  };
  state = rwr.update(1 / 60, { ...player, threats: [behind], incoming: [] });
  assert.ok(Math.abs(Math.abs(state.contacts[0].bearingRad) - Math.PI) < 1e-6);
});

test('incoming missile bearings and elevations locate the threat, including after a heading change', () => {
  const rwr = new RWRSystem();
  for (const heading of [0, Math.PI / 2]) {
    const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading);
    for (const [offset, bearing, elevation] of [
      [new Vector3(0, 0, -1000), 0, 0],
      [new Vector3(1000, 0, 0), Math.PI / 2, 0],
      [new Vector3(-1000, 0, 0), -Math.PI / 2, 0],
      [new Vector3(0, 0, 1000), Math.PI, 0],
      [new Vector3(0, 1000, -1000), 0, Math.PI / 4],
      [new Vector3(0, -1000, -1000), 0, -Math.PI / 4],
    ]) {
      const worldOffset = offset.clone().applyQuaternion(quaternion);
      const missile = {
        alive: true,
        position: player.position.clone().add(worldOffset),
        velocity: worldOffset.clone().normalize().multiplyScalar(-700),
      };
      let state = rwr.update(1 / 60, { ...player, quaternion, incoming: [missile] });
      assert.equal(state.level, 3);
      const contact = state.contacts[0];
      const bearingError = Math.atan2(Math.sin(contact.bearingRad - bearing), Math.cos(contact.bearingRad - bearing));
      assert.ok(Math.abs(bearingError) < 1e-6, `heading ${heading}: bearing ${contact.bearingRad}, expected ${bearing}`);
      assert.ok(Math.abs(contact.elevationRad - elevation) < 1e-6);
      // Reversing course must still suppress the warning after fixing display direction.
      missile.velocity.negate();
      state = rwr.update(1 / 60, { ...player, quaternion, incoming: [missile] });
      assert.equal(state.level, 0);
      assert.equal(state.contacts.length, 0);
    }
  }
});

test('threats outside detection range and dead emitters are silent', () => {
  const rwr = new RWRSystem();
  const far = { position: new Vector3(0, 3000, -30000), velocity: new Vector3(), alive: true };
  const dead = { position: new Vector3(0, 3000, -2000), velocity: new Vector3(0, 0, 100), alive: false };
  const state = rwr.update(1 / 60, { ...player, threats: [far, dead], incoming: [] });
  assert.equal(state.level, 0);
  assert.equal(state.contacts.length, 0);
  assert.equal(state.levelName, 'none');
});
