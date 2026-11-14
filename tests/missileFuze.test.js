import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { fuzeClosestApproach } from '../src/weapons/MissileFuze.js';
import { AirToAirMissileSystem, BanditTarget } from '../src/weapons/AirToAirMissileSystem.js';
import { blastDamage } from '../src/physics/combatDamage.js';
import { MISSILE_TYPES } from '../src/weapons/missileSpecs.js';
const p = (x, y = 0, z = 0) => new Vector3(x, y, z);
const segment = (from, to) => ({ prevPosition: from, position: to });

test('CPA requires a real minimum within the step and handles boundaries', () => {
  const target = segment(p(0), p(0));
  assert.equal(fuzeClosestApproach(segment(p(-20, 10), p(20, 10)), target, 14), 0.5);
  assert.equal(fuzeClosestApproach(segment(p(-20), p(-10)), target, 14), null, 'entry waits while approaching');
  assert.equal(fuzeClosestApproach(segment(p(-10), p(0)), target, 14), 1);
  assert.equal(fuzeClosestApproach(segment(p(3), p(4)), target, 14), 0, 'inside and separating');
  assert.equal(fuzeClosestApproach(segment(p(3), p(3)), target, 14), 0, 'inside and stationary');
  assert.equal(fuzeClosestApproach(segment(p(20), p(21)), target, 14), null);
  assert.equal(fuzeClosestApproach(segment(p(-20, 15), p(20, 15)), target, 14), null);
  assert.equal(fuzeClosestApproach(segment(p(NaN), p(1)), target, 14), null);
});

test('fragment damage varies with distance independent of fuze radius', () => {
  assert.equal(blastDamage(5), 1); assert.ok(blastDamage(10) > 0 && blastDamage(10) < 1);
  assert.equal(blastDamage(14), 0); assert.equal(blastDamage(15), 0);
  assert.equal(fuzeClosestApproach(segment(p(-20, 10), p(20, 10)), segment(p(0), p(0)), 8), null);
});

test('one explosion applies simultaneous distance and body offsets to all affected targets', () => {
  const system = new AirToAirMissileSystem();
  const a = new BanditTarget({ callsign: 'A', position: p(10, 10) });
  const b = new BanditTarget({ callsign: 'B', position: p(10, 4) });
  const c = new BanditTarget({ callsign: 'C', position: p(10, 40) });
  for (const target of [a, b, c]) { target.prevPosition.set(-10, target.position.y, 0); system.addTarget(target); }
  const missile = { prevPosition: p(-20), position: p(20), velocity: p(40), alive: true, spec: MISSILE_TYPES.AIM9X };
  const events = [];
  system._detonate(missile, a, events, 0.5);
  assert.deepEqual(missile.position.toArray(), [0, 0, 0]);
  assert.equal(events.filter(e => e.type === 'detonation').length, 1);
  assert.deepEqual(events[0].position.toArray(), [0, 0, 0]);
  assert.ok(Math.abs(a.damage - blastDamage(10)) < 1e-12); assert.equal(a.alive, true);
  assert.equal(b.alive, false); assert.equal(system.splashCount, 1);
  assert.equal(c.damage, 0); assert.equal(events.filter(e => e.type === 'kill').length, 1);
  assert.deepEqual(events.find(e => e.type === 'kill').position.toArray(), [0, 4, 0]);
  assert.equal(a.lastHitZone, 'fuselage', 'local offset uses target at the same instant');
});

test('earliest CPA across targets controls the actual detonation step', () => {
  const system = new AirToAirMissileSystem();
  const later = new BanditTarget({ callsign: 'LATER', position: p(10, 8) });
  const earlier = new BanditTarget({ callsign: 'EARLIER', position: p(-10, 8) });
  system.addTarget(later); system.addTarget(earlier);
  const spec = { ...MISSILE_TYPES.AIM9X, maxLifeSeconds: 100 };
  const missile = { position: p(-20), prevPosition: p(-20), velocity: p(40), age: 0, propellant: 0, alive: true,
    spec, seeker: { target: null, hasEstimate: false, update() {} }, flight: { step(dt, state) { state.position.set(20, 0, 0); } } };
  const events = []; system._guide(missile, 1, { terrainHeight: () => -100 }, events);
  assert.equal(missile.alive, false); assert.equal(events[0].target, earlier);
  assert.deepEqual(events[0].position.toArray(), [-10, 0, 0]);
  assert.ok(earlier.damage > 0); assert.equal(later.damage, 0);
  assert.equal(events.filter(e => e.type === 'detonation').length, 1);
});
