import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { VulcanCannon, M61A1_VULCAN } from '../src/weapons/VulcanCannon.js';
import { AirToAirMissileSystem, BanditTarget } from '../src/weapons/AirToAirMissileSystem.js';
import { addDamage, blastDamage, combatDamageState } from '../src/physics/combatDamage.js';
import { RearmSystem, REARM_SECONDS } from '../src/systems/RearmSystem.js';

function world(overrides = {}) {
  return {
    active: true,
    position: new Vector3(0, 3000, 0),
    velocity: new Vector3(0, 0, 0),
    quaternion: new Quaternion(),
    onGround: false,
    terrainHeight: () => 0,
    ...overrides,
  };
}

function stepCannon(cannon, pose, seconds, targets = []) {
  const dt = 1 / 120;
  const events = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) events.push(...cannon.update(dt, pose, targets));
  return events;
}

function stepSystem(system, pose, seconds) {
  const dt = 1 / 120;
  const events = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) events.push(...system.update(dt, pose));
  return events;
}

test('M61A1 fires 100 rounds per second from a 510-round magazine', () => {
  const cannon = new VulcanCannon();
  const pose = world();
  assert.equal(cannon.rounds, 510);
  assert.equal(cannon.capacity, M61A1_VULCAN.capacity);

  cannon.setTrigger(true);
  stepCannon(cannon, pose, 1);
  const fired = 510 - cannon.rounds;
  assert.ok(fired >= 99 && fired <= 100, `one second fired ${fired} rounds`);
  assert.ok(cannon.bullets.length >= 99, 'tracers exist');
  assert.equal(cannon.firing, true);

  cannon.setTrigger(false);
  stepCannon(cannon, pose, 0.1);
  assert.equal(cannon.firing, false);
});

test('the gun refuses to fire on the ground or with an empty magazine', () => {
  const cannon = new VulcanCannon();
  cannon.setTrigger(true);
  stepCannon(cannon, world({ onGround: true }), 0.5);
  assert.equal(cannon.rounds, 510);
  assert.equal(cannon.bullets.length, 0);

  cannon.setTrigger(false);
  cannon.setTrigger(true);
  const events = stepCannon(cannon, world(), 5.2);
  assert.equal(cannon.rounds, 0);
  assert.equal(cannon.firing, false);
  assert.ok(events.some(event => event.type === 'gunEmpty'), 'empty magazine is announced once');

  const repeated = stepCannon(cannon, world(), 0.5);
  assert.equal(repeated.filter(event => event.type === 'gunEmpty').length, 0, 'no repeated empty spam');
});

test('bullets inherit aircraft velocity, decelerate under drag, fall and expire', () => {
  const cannon = new VulcanCannon();
  const pose = world({ velocity: new Vector3(0, 0, -250) });
  cannon.setTrigger(true);
  cannon.update(1 / 100, pose);
  cannon.setTrigger(false);
  assert.equal(cannon.bullets.length, 1);

  const bullet = cannon.bullets[0];
  const launchSpeed = bullet.velocity.length();
  const launchY = bullet.position.y;
  assert.ok(launchSpeed > 1200, 'aircraft velocity adds to the muzzle velocity');

  stepCannon(cannon, pose, 0.6);
  assert.ok(bullet.velocity.length() < launchSpeed, 'drag bleeds speed');
  assert.ok(bullet.velocity.y < -4, 'gravity accelerates the projectile down');
  assert.ok(bullet.position.y < launchY - 1, 'projectile drops');

  stepCannon(cannon, pose, 2.6);
  assert.equal(cannon.bullets.length, 0, 'unexpired rounds are bounded by projectile life');
});

test('LCOS pipper leads a crossing target and compensates ballistic drop', () => {
  const cannon = new VulcanCannon();
  const pose = world();
  const target = new BanditTarget({
    callsign: 'BANDIT 1',
    position: new Vector3(0, 3000, -500),
    velocity: new Vector3(150, 0, 0),
  });
  const aim = cannon.aimPoint(pose, target);
  assert.ok(aim);
  assert.ok(aim.point.x > 50, `pipper leads starboard: ${aim.point.x}`);
  assert.ok(aim.point.y > 3000, `pipper sits above the target for drop: ${aim.point.y}`);
  assert.ok(aim.timeOfFlight > 0.4 && aim.timeOfFlight < 0.8);

  target.position.set(0, 3000, -1500);
  target.prevPosition.copy(target.position);
  assert.equal(cannon.aimPoint(pose, target), null, 'outside gun range has no pipper');
});

test('gun hits accumulate progressive damage until the bandit fails', () => {
  const system = new AirToAirMissileSystem();
  const pose = world();
  const target = new BanditTarget({
    callsign: 'BANDIT 1',
    position: new Vector3(0, 3000, -220),
    velocity: new Vector3(0, 0, 0),
  });
  system.addTarget(target);
  system.setGunTrigger(true);

  const events = stepSystem(system, pose, 1);
  assert.equal(target.alive, false, 'sustained burst destroyed the drone');
  assert.equal(system.splashCount, 1);
  assert.ok(events.some(event => event.type === 'damage'), 'damage accumulated before failure');
  assert.ok(events.some(event => event.type === 'kill' && event.source === 'gun'));
  assert.ok(events.some(event => event.type === 'detonation'), 'gun kill hands off to the explosion view');
  assert.equal(system.cannon.rounds < 510, true);
});

test('combat damage helpers clamp monotonically and grade fragmentation', () => {
  assert.equal(addDamage(0.5, 0.2), 0.7);
  assert.equal(addDamage(0.9, 0.5), 1);
  assert.equal(addDamage(1, 0.5), 1);
  assert.equal(addDamage(0.5, -1), 0.5);
  assert.equal(combatDamageState(0), 'normal');
  assert.equal(combatDamageState(0.3), 'damaged');
  assert.equal(combatDamageState(1), 'failed');
  assert.equal(blastDamage(3), 1);
  assert.equal(blastDamage(9.5), 0.5);
  assert.equal(blastDamage(14), 0);
  assert.equal(blastDamage(20), 0);
});

function rearmInput(overrides = {}) {
  return {
    active: true,
    onGround: true,
    groundSpeedKnots: 0,
    onPavement: true,
    gearDown: true,
    gearCollapsed: false,
    bodyFailed: false,
    missilesRemaining: 4,
    missileCapacity: 6,
    gunRounds: 300,
    gunCapacity: 510,
    ...overrides,
  };
}

function stepRearm(rearmer, input, seconds) {
  const dt = 1 / 120;
  const events = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) events.push(...rearmer.update(dt, input));
  return events;
}

test('a stopped F-16 on pavement rearms over five seconds', () => {
  const rearmer = new RearmSystem();
  const input = rearmInput();
  const start = stepRearm(rearmer, input, 0.1);
  assert.ok(start.some(event => event.type === 'rearmStart'));

  stepRearm(rearmer, input, 2.4);
  assert.equal(rearmer.state, 'rearming');
  assert.ok(rearmer.progress > 0.45 && rearmer.progress < 0.55, `progress ${rearmer.progress}`);

  const complete = stepRearm(rearmer, input, REARM_SECONDS);
  assert.ok(complete.some(event => event.type === 'rearm'), 'turnaround completes once');
  assert.equal(rearmer.state, 'complete');

  const full = rearmInput({ missilesRemaining: 6, gunRounds: 510 });
  stepRearm(rearmer, full, 0.2);
  assert.equal(rearmer.state, 'idle', 'full aircraft leaves turnaround');
});

test('rearming is refused while moving, off pavement, gear-up or damaged', () => {
  const moving = new RearmSystem();
  stepRearm(moving, rearmInput({ groundSpeedKnots: 20 }), 2);
  assert.equal(moving.state, 'moving');
  assert.equal(moving.progress, 0);

  const pavement = new RearmSystem();
  const off = stepRearm(pavement, rearmInput({ onPavement: false }), 1);
  assert.ok(off.some(event => event.type === 'rearmBlocked' && event.reason === 'pavement'));
  const repeated = stepRearm(pavement, rearmInput({ onPavement: false }), 1);
  assert.equal(repeated.filter(event => event.type === 'rearmBlocked').length, 0, 'blocked notice is one-shot');

  const gear = new RearmSystem();
  assert.ok(stepRearm(gear, rearmInput({ gearCollapsed: true }), 0.2)
    .some(event => event.type === 'rearmBlocked' && event.reason === 'gear'));
  assert.ok(stepRearm(new RearmSystem(), rearmInput({ gearDown: false }), 0.2)
    .some(event => event.type === 'rearmBlocked' && event.reason === 'gear'));

  const damage = new RearmSystem();
  assert.ok(stepRearm(damage, rearmInput({ bodyFailed: true }), 0.2)
    .some(event => event.type === 'rearmBlocked' && event.reason === 'damage'));
});

test('airborne or paused states decay turnaround progress without reloading', () => {
  const rearmer = new RearmSystem();
  const input = rearmInput();
  stepRearm(rearmer, input, 2);
  assert.ok(rearmer.progress > 0);

  const airborne = stepRearm(rearmer, { ...input, onGround: false }, 0.2);
  assert.equal(rearmer.state, 'idle');
  assert.equal(rearmer.progress, 0);
  assert.equal(airborne.filter(event => event.type === 'rearm').length, 0);

  stepRearm(rearmer, input, 2);
  assert.ok(rearmer.progress > 0);
  stepRearm(rearmer, { ...input, active: false }, 1 / 120);
  assert.equal(rearmer.progress, 0, 'pause cancels the ground-service request');
});

test('a frozen frame clears the gun firing flag without consuming ammunition', () => {
  const system = new AirToAirMissileSystem();
  const pose = world();
  system.addTarget(new BanditTarget({ callsign: 'BANDIT 1', position: new Vector3(0, 3000, -800) }));
  system.setGunTrigger(true);
  stepSystem(system, pose, 0.1);
  assert.equal(system.cannon.firing, true);

  system.update(0, pose);
  assert.equal(system.cannon.firing, false, 'pause cannot leave a stale muzzle flash/audio flag');
  assert.ok(system.cannon.rounds < 510, 'rounds already fired stay spent');
});
