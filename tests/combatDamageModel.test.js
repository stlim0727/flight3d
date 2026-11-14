import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyBlastZoneDamage,
  applyZoneDamage,
  classifyHitZone,
  computeAeroDamageEffects,
  createDamageZones,
  toBodyOffset,
} from '../src/physics/combatDamage.js';
import { Aerodynamics, createAeroResult } from '../src/physics/Aerodynamics.js';
import { F16_FALCON } from '../src/config/aircraftConfigs.js';
import { BanditFlightModel } from '../src/weapons/BanditFlightModel.js';
import { AirToAirMissileSystem, BanditTarget } from '../src/weapons/AirToAirMissileSystem.js';

test('zone classification and body-frame offset map hits to nose, wings, tail, engine, and fuselage', () => {
  const targetPos = new THREE.Vector3(100, 1000, 200);
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  // Target faces -X in world space when rotated +90 deg around Y.
  // A hit at +3m in world -Z is on the target's left wing (body -X = -3).
  const leftWingWorld = new THREE.Vector3(100, 1000, 203);
  const localLeft = toBodyOffset(leftWingWorld, targetPos, quat);
  assert.equal(classifyHitZone(localLeft), 'wingL');

  assert.equal(classifyHitZone(new THREE.Vector3(3.2, 0, 0.4)), 'wingR');
  assert.equal(classifyHitZone(new THREE.Vector3(0, 0, -4.0)), 'nose');
  assert.equal(classifyHitZone(new THREE.Vector3(0, 0.1, 4.2)), 'engine');
  assert.equal(classifyHitZone(new THREE.Vector3(0, 1.2, 4.5)), 'tail');
  assert.equal(classifyHitZone(new THREE.Vector3(0.4, 0, 0.2)), 'fuselage');
});

test('zone damage accumulates monotonically and blast distribution weights nearby zones higher', () => {
  const zones = createDamageZones();
  applyZoneDamage(zones, 'wingL', 0.4);
  assert.equal(zones.wingL, 0.4);
  assert.ok(zones.fuselage > 0 && zones.fuselage < 0.4);

  const blastZones = createDamageZones();
  applyBlastZoneDamage(blastZones, new THREE.Vector3(-3.0, 0, 0.5), 0.8);
  assert.ok(blastZones.wingL > blastZones.wingR);
  assert.ok(blastZones.wingL <= 1);
  assert.ok(blastZones.fuselage > 0);
});

test('computeAeroDamageEffects is neutral when undamaged and induces asymmetric roll/drag/authority loss when damaged', () => {
  const clean = computeAeroDamageEffects(createDamageZones());
  assert.equal(clean.liftScale, 1);
  assert.equal(clean.parasiticDragDelta, 0);
  assert.equal(clean.rollAsymmetry, 0);
  assert.equal(clean.elevatorAuthority, 1);
  assert.equal(clean.avionicsScale, 1);

  const aeroClean = new Aerodynamics(F16_FALCON);
  const aeroDamaged = new Aerodynamics(F16_FALCON);
  const mesh = { quaternion: new THREE.Quaternion() };
  const vel = new THREE.Vector3(0, -10, -220);
  const ang = new THREE.Vector3();
  const resClean = aeroClean.computeAero(1 / 120, mesh, vel, ang, 1000, 1000, 30000, 0, createAeroResult());

  aeroDamaged.damageZones = { nose: 0.2, fuselage: 0.3, wingL: 0.8, wingR: 0, tail: 0.5, engine: 0.4 };
  const resDmg = aeroDamaged.computeAero(1 / 120, mesh, vel, ang, 1000, 1000, 30000, 0, createAeroResult());

  assert.ok(aeroDamaged.drag > aeroClean.drag, 'damaged airframe produces higher drag');
  assert.ok(aeroDamaged.lift < aeroClean.lift, 'wing damage reduces lift');
  assert.ok(resDmg.momentBody.z > resClean.momentBody.z, 'left wing damage induces left-wing-down (+Z) roll moment');
});

test('BanditTarget and BanditFlightModel track zone damage and reset cleanly on respawn', () => {
  const system = new AirToAirMissileSystem();
  const bandit = system.addTarget(new BanditTarget({
    callsign: 'VIPER-1',
    position: new THREE.Vector3(0, 1500, -1200),
    orbit: { center: new THREE.Vector3(0, 1500, 0), radius: 1200, altitudeM: 1500, omega: 0.15, angle: 0 },
  }));

  const events = [];
  // Strike left wing with gun fire
  const wingHitPos = new THREE.Vector3(-3.2, 0, 0.5).applyQuaternion(bandit.quaternion).add(bandit.position);
  system._damageTarget(bandit, 0.35, events, { source: 'gun', position: wingHitPos });
  assert.equal(bandit.lastHitZone, 'wingL');
  assert.ok(bandit.damageZones.wingL > 0.35);
  assert.equal(events[0].hitZone, 'wingL');

  // Step flight model with zone damage
  const posBefore = bandit.position.clone();
  bandit.update(0.1, () => 0, []);
  assert.ok(Number.isFinite(bandit.position.x) && bandit.position.distanceTo(posBefore) > 1);

  // Respawn clears zone damage
  bandit.respawn(new THREE.Vector3(0, 1500, -1200), bandit.orbit);
  assert.equal(bandit.damage, 0);
  assert.equal(bandit.lastHitZone, null);
  assert.deepEqual(bandit.damageZones, createDamageZones());

  // Direct BanditFlightModel engine damage check
  const fm = new BanditFlightModel(new THREE.Vector3(0, 1500, 0), new THREE.Vector3(0, 0, -220));
  fm.step(1 / 60, 0.2, 1500, { nose: 0, fuselage: 0, wingL: 0, wingR: 0, tail: 0, engine: 0.9 });
  assert.equal(fm.engines.contactDamage[0], 0.9);
});
