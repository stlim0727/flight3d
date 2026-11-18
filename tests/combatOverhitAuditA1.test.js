import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AirToAirMissileSystem } from '../src/weapons/AirToAirMissileSystem.js';
import { MissileFlightModel } from '../src/weapons/MissileFlightModel.js';
import { MissileSeeker } from '../src/weapons/MissileSeeker.js';
import { MISSILE_TYPES } from '../src/weapons/missileSpecs.js';
import { combatExperimentConfig, runCombatExperiment } from '../scripts/lib/combatExperiment.mjs';

test('A1 regression: missile hitting terrain before fuze CPA terminates as surface_collision without damaging target', () => {
  const combat = new AirToAirMissileSystem({ evasionSkill: 'hold', countermeasurePolicy: 'none' });
  // Ridge at z in [-103, -101] rises to 125 m; target sits beyond it at z = -106, y = 120 m.
  const terrainHeight = (_x, z) => (z <= -101 && z >= -103 ? 125 : 0);
  const world = {
    active: true,
    onGround: false,
    position: new THREE.Vector3(0, 120, 0),
    velocity: new THREE.Vector3(0, 0, -250),
    quaternion: new THREE.Quaternion(),
    terrainHeight,
  };
  combat.update(1 / 120, world);
  const target = combat.targets[0];
  target.position.set(0, 120, -106);
  target.prevPosition.copy(target.position);
  target.velocity.set(0, 0, 0);
  target.damage = 0;

  const spec = MISSILE_TYPES.AIM9X;
  const missile = {
    id: 901,
    stationIndex: 0,
    stationId: 'STA 1',
    typeId: 'AIM9X',
    spec,
    position: new THREE.Vector3(0, 120, -100),
    prevPosition: new THREE.Vector3(0, 120, -100),
    velocity: new THREE.Vector3(0, 0, -900),
    quaternion: new THREE.Quaternion(),
    target: null,
    targetIsPlayer: false,
    source: 'player',
    flight: new MissileFlightModel(),
    seeker: new MissileSeeker(spec),
    propellant: 0,
    age: 1,
    alive: true,
    firedAt: 0,
    launchPosition: new THREE.Vector3(0, 120, 0),
    launchVelocity: new THREE.Vector3(0, 0, -250),
    launchLocked: true,
    launchLockProgress: 1,
    closestApproaches: {},
    lastGuidance: { active: false, reason: null, losAngleDeg: null, rangeM: null },
    finalOutcome: null,
  };
  combat.missiles.push(missile);

  const events = [];
  combat._guide(missile, 1 / 120, world, events);

  assert.equal(missile.alive, false);
  assert.equal(missile.finalOutcome?.reason, 'surface_collision');
  assert.ok(missile.closestApproaches[target.id].distanceM >= 3);
  assert.equal(target.damage, 0);
  assert.equal(target.alive, true);
  assert.ok(events.some(e => e.type === 'detonation' && e.surface === true));
  assert.equal(events.some(e => e.type === 'kill' || e.type === 'damage'), false);
});

test('A1 audit: seeker memory freezes estimate and never reads hidden target maneuvers during terrain occlusion', () => {
  const spec = MISSILE_TYPES.AIM9X;
  const seeker = new MissileSeeker(spec);
  const observer = {
    position: new THREE.Vector3(0, 2000, 0),
    velocity: new THREE.Vector3(0, 0, -300),
    quaternion: new THREE.Quaternion(),
  };
  const target = {
    id: 1,
    type: 'bandit',
    alive: true,
    position: new THREE.Vector3(0, 2000, -1500),
    velocity: new THREE.Vector3(120, 0, -100),
    quaternion: new THREE.Quaternion(),
    infraredSignature: { enginePower: 1, heat: 0.9, afterburner: 0.5, omnidirectional: false },
  };
  const clearWorld = { terrainHeight: () => 0 };
  assert.equal(seeker.seed(target, observer, clearWorld), true);
  assert.equal(seeker.state, 'track');

  // Occlude line of sight via terrain ridge while target sharply reverses hidden velocity.
  const occludedWorld = { terrainHeight: (_x, z) => (z < -400 && z > -1100 ? 2500 : 0) };
  target.velocity.set(-220, 80, 150);
  target.position.set(-10, 2005, -1490);
  const dt = 1 / 120;
  seeker.update(dt, observer, [target], occludedWorld);

  assert.equal(seeker.state, 'memory');
  assert.equal(seeker.lastObservation?.lossReason, 'terrain_occlusion');
  assert.equal(seeker.estimate.velocity.x, 120);
  assert.equal(seeker.estimate.velocity.y, 0);
  assert.equal(seeker.estimate.velocity.z, -100);

  // Advance past seekerMemorySeconds (0.6s) while still occluded: estimate expires cleanly.
  for (let i = 0; i < 90; i++) {
    seeker.update(dt, observer, [target], occludedWorld);
  }
  assert.equal(seeker.hasEstimate, false);
  assert.equal(seeker.state, 'lost');
});

test('A1 audit: MissileFlightModel enforces post-burnout lateral acceleration limits without stored bypass', () => {
  const spec = MISSILE_TYPES.AIM9X;
  const flight = new MissileFlightModel();
  const missile = {
    spec,
    position: new THREE.Vector3(0, 2000, 0),
    velocity: new THREE.Vector3(0, 0, -450),
    quaternion: new THREE.Quaternion(),
  };
  const hugeDemand = new THREE.Vector3(2000, 0, 0);
  for (let i = 0; i < 60; i++) {
    flight.step(1 / 120, missile, {
      massKg: spec.massAtLaunchKg,
      thrustN: spec.maxThrustN,
      density: 1.0,
      command: hugeDemand,
      tracking: true,
    });
  }
  assert.ok(flight.deliveredLateralMps2 <= flight.availableLateralMps2 + 1e-6);

  // Drop thrust to zero and drop dynamic pressure at high altitude; delivered G must immediately obey lower limit.
  missile.velocity.set(0, 0, -180);
  flight.step(1 / 120, missile, {
    massKg: spec.dryMassKg,
    thrustN: 0,
    density: 0.3,
    command: hugeDemand,
    tracking: true,
  });
  assert.ok(flight.deliveredLateralMps2 <= flight.availableLateralMps2 + 1e-6);
});

test('A1 audit: unfavorable off-axis/long-range geometries fail while B-condition locked-IR controls stay intact', () => {
  const unfavorable = runCombatExperiment(combatExperimentConfig({
    types: 'AIM9X',
    ranges: '10000',
    aspects: '180',
    speeds: '250',
    'altitude-pairs': '1500:1500',
    defense: 'reaction-flare',
  }));
  assert.equal(unfavorable.summary[0].noLock, 1);
  assert.equal(unfavorable.summary[0].kills, 0);

  const bBaseline = runCombatExperiment(combatExperimentConfig({
    types: 'AIM9X',
    ranges: '1500,2500',
    aspects: '0',
    speeds: '108',
    'altitude-pairs': '750:1210',
    defense: 'all',
  }));
  const passive = bBaseline.summary.find(s => s.variant === 'passive');
  const flare = bBaseline.summary.find(s => s.variant === 'reaction-flare');
  assert.equal(passive.total, 2);
  assert.equal(flare.total, 2);
  assert.ok(passive.kills >= flare.kills);
});

test('A1 regression: burst-instant closest approach is recorded for secondary targets killed in the same blast', () => {
  const combat = new AirToAirMissileSystem({ banditCount: 2, evasionSkill: 'hold', countermeasurePolicy: 'none' });
  const world = {
    active: true,
    onGround: false,
    position: new THREE.Vector3(0, 2000, 0),
    velocity: new THREE.Vector3(0, 0, -250),
    quaternion: new THREE.Quaternion(),
    terrainHeight: () => 0,
  };
  combat.update(1 / 120, world);
  const [primary, secondary] = combat.targets;
  primary.position.set(0, 2000, -104);
  primary.prevPosition.copy(primary.position);
  primary.velocity.set(0, 0, 0);
  primary.damage = 0;

  secondary.position.set(3, 2000, -104);
  secondary.prevPosition.copy(secondary.position);
  secondary.velocity.set(0, 0, 0);
  secondary.damage = 0;

  const spec = MISSILE_TYPES.AIM9X;
  const missile = {
    id: 902,
    stationIndex: 0,
    stationId: 'STA 1',
    typeId: 'AIM9X',
    spec,
    position: new THREE.Vector3(0, 2000, -100),
    prevPosition: new THREE.Vector3(0, 2000, -100),
    velocity: new THREE.Vector3(0, 0, -900),
    quaternion: new THREE.Quaternion(),
    target: null,
    targetIsPlayer: false,
    source: 'player',
    flight: new MissileFlightModel(),
    seeker: new MissileSeeker(spec),
    propellant: 0,
    age: 1,
    alive: true,
    firedAt: 0,
    launchPosition: new THREE.Vector3(0, 2000, 0),
    launchVelocity: new THREE.Vector3(0, 0, -250),
    launchLocked: true,
    launchLockProgress: 1,
    closestApproaches: {},
    lastGuidance: { active: false, reason: null, losAngleDeg: null, rangeM: null },
    finalOutcome: null,
  };
  combat.missiles.push(missile);

  const events = [];
  combat._guide(missile, 1 / 120, world, events);

  assert.equal(primary.alive, false);
  assert.equal(secondary.alive, false);
  assert.ok(missile.closestApproaches[secondary.id]);
  assert.ok(missile.closestApproaches[secondary.id].distanceM <= 3.5);
});
