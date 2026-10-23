import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LandingGear } from '../src/physics/LandingGear.js';
import { GEAR_DAMAGE_LIMITS, updateGearDamage } from '../src/physics/gearDamage.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';

const demand = overrides => ({ sinkRate: 0, firstContact: false, normalLoad: 600000,
  lateralLoad: 0, longitudinalLoad: 0, overtravel: 0, locked: true, ...overrides });
const leg = () => ({ damage: 0, damageState: 'normal' });
function sample(gear, { y = 3.5, velocity = [0, -1, -60], rotation = [0, 0, 0], dt = 1 / 120,
  height = () => 0, normal = () => new THREE.Vector3(0, 1, 0), omega = [0, 0, 0] } = {}) {
  const mesh = new THREE.Object3D();
  mesh.position.y = y;
  mesh.rotation.set(...rotation);
  mesh.updateMatrixWorld(true);
  return gear.update(dt, mesh, new THREE.Vector3(...velocity), new THREE.Vector3(...omega), height, normal);
}

describe('Independent gear damage and body support', () => {
  it('keeps normal landing, parked suspension and full braking below failure loads', () => {
    for (const brakes of [0, 1]) {
      const gear = new LandingGear();
      gear.setBrakes(brakes);
      for (let i = 0; i < 1200; i++) sample(gear, { velocity: [0, 0, -60] });
      assert.ok(gear.contacts.every(c => c.damage === 0));
    }
  });
  it('reacts to the tire force the surface can supply rather than to slip speed', () => {
    const gear = new LandingGear();
    // 60 m/s of lateral motion at taxi weight: the scrub force is capped at
    // mu * strut load, so a sideways slide alone cannot overload the leg.
    for (let i = 0; i < 600; i++) sample(gear, { y: 3.5, velocity: [60, 0, -30] });
    assert.equal(gear.contacts[0].damageState, 'normal');
  });
  it('distinguishes threshold, damaged and collapsed vertical impacts', () => {
    for (const [speed, state] of [[3.8, 'normal'], [4, 'damaged'], [10, 'collapsed']]) {
      const c = leg();
      updateGearDamage(c, demand({ firstContact: true, sinkRate: speed }), 1 / 120, GEAR_DAMAGE_LIMITS.main);
      assert.equal(c.damageState, state);
    }
  });
  it('accumulates combined vertical/lateral/braking overload rather than failing on one spike', () => {
    const c = leg();
    const d = demand({ normalLoad: 1500000, lateralLoad: 750000, longitudinalLoad: 1000000 });
    updateGearDamage(c, d, 1 / 120, GEAR_DAMAGE_LIMITS.main);
    assert.equal(c.damageState, 'normal');
    for (let i = 0; i < 360; i++) updateGearDamage(c, d, 1 / 120, GEAR_DAMAGE_LIMITS.main);
    assert.equal(c.damageState, 'damaged');
    for (let i = 0; i < 360; i++) updateGearDamage(c, d, 1 / 120, GEAR_DAMAGE_LIMITS.main);
    assert.equal(c.damageState, 'collapsed');
  });
  it('produces the same sustained damage at 60, 120 and 240 Hz', () => {
    const values = [60, 120, 240].map(hz => {
      const c = leg();
      for (let i = 0; i < hz; i++) updateGearDamage(c, demand({ lateralLoad: 1100000 }), 1 / hz, GEAR_DAMAGE_LIMITS.main);
      return c.damage;
    });
    assert.ok(Math.max(...values) - Math.min(...values) < 1e-10);
  });
  it('accumulates lateral overload and suspension bottom-out independently', () => {
    for (const overrides of [{ lateralLoad: 1800000 }, { sinkRate: 4, overtravel: 0.6 }]) {
      const c = leg();
      for (let i = 0; i < 600; i++) updateGearDamage(c, demand(overrides), 1 / 120, GEAR_DAMAGE_LIMITS.main);
      assert.equal(c.damageState, 'collapsed');
    }
  });
  it('does not repeat impact damage while a loaded leg remains on the ground', () => {
    const c = leg();
    updateGearDamage(c, demand({ sinkRate: 6, firstContact: true }), 1 / 120, GEAR_DAMAGE_LIMITS.main);
    const initial = c.damage;
    for (let i = 0; i < 120; i++) updateGearDamage(c, demand({ sinkRate: 6 }), 1 / 120, GEAR_DAMAGE_LIMITS.main);
    assert.equal(c.damage, initial);
  });
  it('does not generate scraping drag or impact damage before body contact', () => {
    const gear = new LandingGear();
    gear.gearState = gear.targetGearState = 0;
    const result = sample(gear, { y: 10, velocity: [0, -20, -60] });
    assert.equal(result.bodyContacts.length, 0);
    assert.equal(result.forces.length(), 0);
    assert.equal(result.catastrophicImpact, false);
    assert.equal(result.structuralDamage, 0);
  });
  it('retains damage across bounce and increases it on the next impact', () => {
    const gear = new LandingGear();
    sample(gear, { velocity: [0, -6, -60] });
    const first = gear.contacts[1].damage;
    assert.equal(gear.contacts[1].damageState, 'damaged');
    sample(gear, { y: 10 });
    assert.equal(gear.contacts[1].damage, first);
    sample(gear, { velocity: [0, -8, -60] });
    assert.equal(gear.contacts[1].damageState, 'collapsed');
  });
  it('collapses the nose first in a nose-down impact', () => {
    const gear = new LandingGear();
    const result = sample(gear, { y: 4, rotation: [-0.08, 0, 0], velocity: [0, -8, -60] });
    assert.equal(result.gearDamage.nose, 'collapsed');
    assert.equal(result.gearDamage.mainLeft, 'normal');
    assert.equal(result.gearDamage.mainRight, 'normal');
    assert.equal(result.weightOnWheels, 0);
  });
  it('collapses only the low-side main on a banked impact, mirrored left/right', () => {
    for (const sign of [-1, 1]) {
      const gear = new LandingGear();
      const result = sample(gear, { y: 3.9, rotation: [0, 0, sign * 0.1], velocity: [0, -11, -60] });
      assert.equal(result.gearDamage[sign > 0 ? 'mainLeft' : 'mainRight'], 'collapsed');
      assert.equal(result.gearDamage[sign > 0 ? 'mainRight' : 'mainLeft'], 'normal');
    }
  });
  it('accounts for angular contact speed and terrain-normal approach speed', () => {
    const rotating = new LandingGear();
    sample(rotating, { y: 3.5, velocity: [0, 0, -60], omega: [-1, 0, 0] });
    assert.equal(rotating.contacts[0].damageState, 'collapsed');
    const inclined = new LandingGear();
    sample(inclined, { velocity: [0, 0, -60], normal: () => new THREE.Vector3(0, 1, 0.2).normalize() });
    assert.equal(inclined.contacts[1].damageState, 'collapsed');
  });
  it('loses support under sustained load with an unlocked or retracting gear', () => {
    const gear = new LandingGear();
    gear.gearState = 0.8;
    gear.targetGearState = 1;
    for (let i = 0; i < 480; i++) sample(gear, { y: 2.8, velocity: [0, 0, -30] });
    assert.equal(gear.contacts[1].damageState, 'collapsed');
    gear.gearState = gear.targetGearState = 1;
    sample(gear);
    assert.equal(gear.contacts[1].damageState, 'collapsed');
  });
  it('keeps body support active with gear up and after all deployed legs fail', () => {
    for (const deployed of [0, 1]) {
      const gear = new LandingGear();
      gear.gearState = gear.targetGearState = deployed;
      if (deployed) gear.contacts.forEach(c => { c.damage = 1; c.damageState = 'collapsed'; });
      const result = sample(gear, { y: 2.8, velocity: [0, -1, -50] });
      assert.ok(result.bodyContacts.some(c => c.id === 'engineL'));
      assert.ok(result.bodyContacts.some(c => c.id === 'engineR'));
      assert.ok(result.forces.y > 0);
      assert.ok(result.forces.z > 0);
      assert.equal(result.weightOnWheels, 0);
      assert.equal(result.catastrophicImpact, false);
      assert.equal(result.touchdown, false);
    }
  });
  it('emits transition events once, resets all damage and contact history', () => {
    const gear = new LandingGear();
    assert.ok(sample(gear, { velocity: [0, -11, -60] }).damageEvents.length);
    assert.equal(sample(gear).damageEvents.length, 0);
    gear.resetDamage();
    assert.ok(gear.contacts.every(c => c.damage === 0 && !c.isGrounded));
    assert.equal(gear.structuralDamage, 0);
    assert.equal(gear.bodyGrounded.size, 0);
    assert.ok(sample(gear, { velocity: [0, -11, -60] }).damageEvents.length);
  });
  it('permits controlled runway scraping but retains catastrophic, obstacle and off-runway crashes', () => {
    const terrain = { getHeight: () => 12 };
    const airport = { isOnRunway: (x, z) => Math.abs(x) < 50 && Math.abs(z) < 1500,
      controlTowerData: { x: 100, y: 12, z: 0, radius: 10, height: 50 } };
    const detector = new CollisionDetector(terrain, airport);
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3(0, -1, -60);
    const safe = { catastrophicImpact: false, bodyContacts: [] };
    assert.equal(detector.checkCollision(new THREE.Vector3(0, 14.8, 0), q, v, 0, 0, 0, safe), null);
    assert.ok(detector.checkCollision(new THREE.Vector3(0, 14.8, 0), q, v, 0, 0, 0,
      { ...safe, catastrophicImpact: true }));
    assert.equal(detector.checkCollision(new THREE.Vector3(100, 30, 0), q, v, 1, 0, 0, safe).type, 'TOWER');
    assert.equal(detector.checkCollision(new THREE.Vector3(200, 12, 0), q, v, 0, 0, 0, safe).type, 'TERRAIN');
  });
});
