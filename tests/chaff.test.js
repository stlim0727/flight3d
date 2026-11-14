import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { ChaffDispenser, CHAFF_MODEL } from '../src/weapons/Chaff.js';
import { MissileSeeker } from '../src/weapons/MissileSeeker.js';
import { MISSILE_TYPES } from '../src/weapons/missileSpecs.js';

const observer = { position: new Vector3(0, 3000, 0), quaternion: new Quaternion() };
const target = () => ({ alive: true, position: new Vector3(0, 3000, -5000), velocity: new Vector3(), radarCrossSectionM2: 1,
  infraredSignature: { enginePower: 1, heat: 1, afterburner: 0, omnidirectional: true } });
const world = { terrainHeight: () => 0 };

test('finite dispenser, independent cloud state, growth, decay and reset', () => {
  const dispenser = new ChaffDispenser(1), p = new Vector3(0, 3000, -5000), v = new Vector3(100, 0, 0);
  const cloud = dispenser.dispense(p, v);
  assert.equal(dispenser.dispense(p, v), null);
  p.x = 900; v.x = 0; cloud.update(0.5);
  assert.ok(cloud.position.x > 0 && cloud.position.x < 900);
  const peak = cloud.radarCrossSectionM2; cloud.update(5);
  assert.ok(cloud.radarCrossSectionM2 < peak);
  cloud.update(CHAFF_MODEL.lifetimeS); assert.equal(cloud.alive, false);
  dispenser.reset(); assert.equal(dispenser.remaining, 1);
});

test('nearby strong chaff competes after confirmation; IR ignores it and radar reacquires', () => {
  const t = target(), dispenser = new ChaffDispenser(), cloud = dispenser.dispense(t.position, t.velocity);
  cloud.update(0.5);
  const radar = new MissileSeeker(MISSILE_TYPES.AIM120C), ir = new MissileSeeker(MISSILE_TYPES.AIM9X);
  assert.ok(radar.seed(t, observer, world)); assert.ok(ir.seed(t, observer, world));
  radar.update(0.1, observer, [t, cloud], world); assert.equal(radar.state, 'memory');
  radar.update(0.2, observer, [t, cloud], world); assert.equal(radar.target, cloud);
  ir.update(0.5, observer, [t, cloud], world); assert.equal(ir.target, t);
  cloud.update(CHAFF_MODEL.lifetimeS);
  radar.update(0.1, observer, [t, cloud], world);
  radar.update(0.2, observer, [t, cloud], world); assert.equal(radar.target, t);
});

test('a distant angular or range-separated cloud does not displace a track', () => {
  for (const offset of [new Vector3(2000, 0, 0), new Vector3(0, 0, -2000)]) {
    const t = target(), d = new ChaffDispenser(), c = d.dispense(t.position.clone().add(offset), t.velocity);
    c.update(0.5); const seeker = new MissileSeeker(MISSILE_TYPES.AIM120C);
    seeker.seed(t, observer, world); seeker.update(0.5, observer, [t, c], world);
    assert.equal(seeker.target, t);
  }
});

test('combat advances one cloud per confirmed threat, clears it on reset, and replenishes on respawn', async () => {
  const { AirToAirMissileSystem, BanditTarget } = await import('../src/weapons/AirToAirMissileSystem.js');
  const system = new AirToAirMissileSystem();
  const bandit = new BanditTarget({ callsign: 'TEST', position: new Vector3(0, 3000, -5000) });
  bandit.update = () => { bandit.threatResponse.confirmedId = 7; };
  system.addTarget(bandit);
  const activeWorld = { ...world, active: true, onGround: false, position: observer.position,
    quaternion: observer.quaternion, velocity: new Vector3() };
  system.update(1 / 60, activeWorld);
  assert.equal(bandit.chaff.remaining, CHAFF_MODEL.capacity - 1);
  assert.equal(system.chaffClouds.length, 1);
  system.update(1 / 60, activeWorld);
  assert.equal(system.chaffClouds.length, 1);
  assert.ok(system.chaffClouds[0].age > 0);
  bandit.respawn(new Vector3(0, 3000, -5000), null);
  assert.equal(bandit.chaff.remaining, CHAFF_MODEL.capacity);
  system.reset(); assert.equal(system.chaffClouds.length, 0);
});
