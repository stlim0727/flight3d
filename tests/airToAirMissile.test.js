import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import {
  AirToAirMissileSystem,
  BanditTarget,
} from '../src/weapons/AirToAirMissileSystem.js';
import { F16_MISSILE_STATIONS, MISSILE_TYPES } from '../src/weapons/missileSpecs.js';

function airborneWorld(overrides = {}) {
  return {
    active: true,
    position: new Vector3(0, 3000, 0),
    velocity: new Vector3(0, 0, -250),
    quaternion: new Quaternion(),
    onGround: false,
    terrainHeight: () => 0,
    ...overrides,
  };
}

function step(system, world, seconds) {
  const dt = 1 / 120;
  const events = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    events.push(...system.update(dt, world));
  }
  return events;
}

test('six stations load in release order with the planned missile mix', () => {
  const system = new AirToAirMissileSystem();
  assert.equal(system.remaining, 6);
  assert.equal(system.totalStations, 6);
  assert.deepEqual(system.stations.map(station => station.id), ['STA 1', 'STA 9', 'STA 2', 'STA 8', 'STA 3', 'STA 7']);
  assert.deepEqual(system.stations.map(station => station.type),
    ['AIM9X', 'AIM9X', 'AIM9X', 'AIM9X', 'AIM120C', 'AIM120C']);
  assert.equal(system.stations[0], F16_MISSILE_STATIONS[0]);

  const world = airborneWorld();
  const first = system.fire(world);
  const second = system.fire(world);
  assert.equal(first.stationId, 'STA 1');
  assert.equal(second.stationId, 'STA 9');
  assert.equal(first.typeId, 'AIM9X');
  assert.equal(system.remaining, 4);
  assert.deepEqual(system.loaded.slice(0, 3), [false, false, true]);

  system.reset();
  assert.equal(system.remaining, 6);
  assert.ok(system.loaded.every(Boolean), 'reset reloads every rail');
  assert.equal(system.missiles.length, 0);
});

test('lock integrates inside the seeker cone and decays outside it', () => {
  const system = new AirToAirMissileSystem();
  const world = airborneWorld();
  const target = new BanditTarget({
    callsign: 'BANDIT 1',
    position: new Vector3(0, 3100, -4000),
    velocity: new Vector3(0, 0, 0),
  });
  system.addTarget(target);

  step(system, world, 0.2);
  assert.ok(system.lockProgress > 0 && system.lockProgress < 1, 'acquisition is continuous');
  const events = step(system, world, 0.7);
  assert.equal(system.lockProgress, 1);
  assert.equal(system.lockedTarget, target);
  assert.ok(events.some(event => event.type === 'lock'));

  target.position.set(0, 3100, 4000);
  target.prevPosition.copy(target.position);
  const decay = step(system, world, 1);
  assert.equal(system.lockProgress, 0);
  assert.equal(system.lockedTarget, null);
  assert.ok(decay.some(event => event.type === 'unlock'));

  target.position.set(5000, 3000, 0);
  target.prevPosition.copy(target.position);
  step(system, world, 0.5);
  assert.equal(system.lockProgress, 0, 'a target outside the 28° cone cannot lock');
});

test('target cycling selects the next live bandit and resets acquisition', () => {
  const system = new AirToAirMissileSystem();
  const world = airborneWorld();
  const first = new BanditTarget({ callsign: 'BANDIT 1', position: new Vector3(0, 3000, -4000) });
  const second = new BanditTarget({ callsign: 'BANDIT 2', position: new Vector3(1500, 3200, -5000) });
  system.addTarget(first);
  system.addTarget(second);
  system.selectedTargetIndex = 0;
  system.lockProgress = 0.5;

  assert.equal(system.selectNextTarget(), second);
  assert.equal(system.selectedTargetIndex, 1);
  assert.equal(system.lockProgress, 0);
  assert.equal(system.selectNextTarget(), first);
  void world;
});

test('3D TPN converges on a crossing target and the proximity fuse kills it', () => {
  const system = new AirToAirMissileSystem();
  const world = airborneWorld();
  const target = new BanditTarget({
    callsign: 'BANDIT 1',
    position: new Vector3(0, 3200, -5000),
    velocity: new Vector3(180, 0, 0),
  });
  system.addTarget(target);

  step(system, world, 0.8);
  assert.equal(system.lockedTarget, target, 'target locked before launch');
  const missile = system.fire(world);
  assert.ok(missile);
  assert.equal(missile.target, target);

  const events = step(system, world, 16);
  assert.equal(target.alive, false, 'proximity fuse destroyed the bandit');
  assert.equal(system.splashCount, 1);
  assert.ok(events.some(event => event.type === 'kill'));
  assert.ok(events.some(event => event.type === 'detonation'));
  assert.equal(system.missiles.length, 0, 'spent missile left the scene');
});

test('rocket thrust accelerates during burn, then drag decelerates the airframe', () => {
  const system = new AirToAirMissileSystem();
  const world = airborneWorld({ velocity: new Vector3(0, 0, -280) });
  const missile = system.fire(world);
  assert.ok(missile);
  const launchSpeed = missile.velocity.length();

  step(system, world, 1);
  const poweredSpeed = missile.velocity.length();
  assert.ok(poweredSpeed > launchSpeed + 80, `powered speed ${poweredSpeed} > ${launchSpeed}`);
  assert.ok(missile.propellant > 0.7, 'most propellant is still available after one second');

  step(system, world, 4);
  assert.equal(missile.propellant, 0, 'burn completed');
  const burnoutSpeed = missile.velocity.length();

  step(system, world, 6);
  const coastSpeed = missile.velocity.length();
  assert.ok(coastSpeed < burnoutSpeed, `coast speed ${coastSpeed} < burnout ${burnoutSpeed}`);
  assert.equal(missile.spec, MISSILE_TYPES.AIM9X);
});

test('ground and empty states refuse launch without mutating the loadout', () => {
  const system = new AirToAirMissileSystem();
  const ground = airborneWorld({ onGround: true });
  assert.equal(system.fire(ground), null);
  assert.equal(system.lastFireError, 'ground');
  assert.equal(system.remaining, 6);

  const world = airborneWorld();
  for (let i = 0; i < 6; i++) system.fire(world);
  assert.equal(system.remaining, 0);
  assert.equal(system.fire(world), null);
  assert.equal(system.lastFireError, 'empty');
});
