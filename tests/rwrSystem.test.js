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

test('threats outside detection range and dead emitters are silent', () => {
  const rwr = new RWRSystem();
  const far = { position: new Vector3(0, 3000, -30000), velocity: new Vector3(), alive: true };
  const dead = { position: new Vector3(0, 3000, -2000), velocity: new Vector3(0, 0, 100), alive: false };
  const state = rwr.update(1 / 60, { ...player, threats: [far, dead], incoming: [] });
  assert.equal(state.level, 0);
  assert.equal(state.contacts.length, 0);
  assert.equal(state.levelName, 'none');
});
