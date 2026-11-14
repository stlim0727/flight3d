import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { MissileSeeker, seekerCanObserve } from '../src/weapons/MissileSeeker.js';
import { MISSILE_TYPES } from '../src/weapons/missileSpecs.js';
import { AirToAirMissileSystem, BanditTarget } from '../src/weapons/AirToAirMissileSystem.js';
import { compareSeekerTerrainEngagements } from '../scripts/lib/missileSeekerScenario.mjs';

const dt = 1 / 120;
const own = () => ({ position: new Vector3(0, 3000, 0), quaternion: new Quaternion() });
const contact = (id = 1) => ({ id, alive: true, position: new Vector3(0, 3000, -4000), velocity: new Vector3(80, 0, 0) });
const flat = { terrainHeight: () => 0 };
const ridge = { terrainHeight: (x, z) => z < -1500 && z > -2500 ? 4000 : 0 };
function step(s, o, targets, seconds, world = flat) {
  for (let i = 0; i < Math.round(seconds / dt); i++) s.update(dt, o, targets, world);
}

test('terrain, view, range, invalid geometry and typed quality gate observations', () => {
  const spec = MISSILE_TYPES.AIM9X, o = own(), t = contact();
  assert.ok(seekerCanObserve(spec, o, t, flat));
  assert.equal(new MissileSeeker(spec).seed(t, o, ridge), false);
  assert.equal(seekerCanObserve(spec, o, t, { terrainHeight: () => NaN }), false);
  t.position.z = -9000;
  assert.equal(seekerCanObserve(spec, o, t, flat), false);
  t.position.z = 4000;
  assert.equal(seekerCanObserve(spec, o, t, flat), false);
  o.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  const ir = { ...flat, seekerSignalQuality: ({ type }) => type === 'IR' ? 1 : 0 };
  assert.ok(seekerCanObserve(spec, o, t, ir));
  assert.equal(seekerCanObserve(MISSILE_TYPES.AIM120C, o, t, ir), false);
  o.quaternion.x = NaN;
  assert.equal(seekerCanObserve(spec, o, t, flat), false);
});

test('confirmation cannot pool interrupted glimpses or different target tracks', () => {
  const s = new MissileSeeker(MISSILE_TYPES.AIM9X), o = own(), a = contact(), b = contact(2);
  step(s, o, [a], 0.1); step(s, o, [], 0.1); step(s, o, [a], 0.1); step(s, o, [b], 0.1);
  assert.equal(s.hasEstimate, false);
  step(s, o, [b], 0.05);
  assert.equal(s.target, b);
  a.position.z = -1000;
  step(s, o, [a, b], 0.2);
  assert.equal(s.target, b, 'nearer contacts cannot steal a visible established track');
});

test('hidden velocity is never sampled and memory predicts only the last observation', () => {
  for (const spec of Object.values(MISSILE_TYPES)) {
    const s = new MissileSeeker(spec), o = own(), t = contact();
    s.seed(t, o, flat);
    t.position.x = 1000;
    Object.defineProperty(t, 'velocity', { get() { throw new Error('Hidden velocity read'); } });
    step(s, o, [t], 0.25, ridge);
    assert.equal(s.state, 'memory');
    assert.ok(Math.abs(s.estimate.position.x - 20) < 1e-10);
    assert.deepEqual(s.estimate.velocity.toArray(), [80, 0, 0]);
    step(s, o, [t], spec.seekerMemorySeconds + 0.1, ridge);
    assert.equal(s.state, 'lost');
    assert.equal(s.hasEstimate, false);
    assert.equal(s.target, null);
  }
});

test('both types reacquire changed truth only after a new confirmation interval', () => {
  for (const spec of Object.values(MISSILE_TYPES)) {
    const s = new MissileSeeker(spec), o = own(), t = contact();
    s.seed(t, o, flat);
    step(s, o, [t], spec.seekerMemorySeconds + 0.1, ridge);
    t.position.x = 500; t.velocity.x = -180;
    s.update(dt, o, [t], flat);
    assert.equal(s.hasEstimate, false);
    step(s, o, [t], spec.seekerAcquireSeconds);
    assert.equal(s.state, 'track');
    assert.equal(s.estimate.position.x, 500);
    assert.equal(s.estimate.velocity.x, -180);
  }
});

test('range/gimbal loss, pause and reset preserve independent state', () => {
  const s = new MissileSeeker(MISSILE_TYPES.AIM9X), other = new MissileSeeker(MISSILE_TYPES.AIM9X), o = own(), t = contact();
  s.seed(t, o, flat); t.position.z = -9000;
  step(s, o, [t], 0.2);
  const age = s.observationAgeSeconds, p = s.estimate.position.clone();
  s.update(0, o, [t], flat);
  assert.equal(s.observationAgeSeconds, age); assert.deepEqual(s.estimate.position, p);
  t.position.z = 4000; step(s, o, [t], 0.6);
  assert.equal(s.state, 'lost'); assert.equal(other.state, 'search');
  s.reset(); assert.equal(s.state, 'search'); assert.equal(s.hasEstimate, false);
});

test('rail lock and stale handoff reject occlusion, then an exposed launch can acquire', () => {
  const world = { ...own(), ...ridge, active: true, onGround: false, velocity: new Vector3(0, 0, -250) };
  const combat = new AirToAirMissileSystem(), t = new BanditTarget({ callsign: 'TEST', position: new Vector3(0, 3000, -4000) });
  combat.addTarget(t);
  for (let i = 0; i < 120; i++) combat.update(dt, world);
  assert.equal(combat.lockProgress, 0);
  combat.lockedTarget = t;
  const m = combat.fire(world); assert.equal(m.target, null);
  world.terrainHeight = () => 0;
  for (let i = 0; i < 12; i++) combat.update(dt, world);
  assert.equal(m.seeker.hasEstimate, false);
  for (let i = 0; i < 12; i++) combat.update(dt, world);
  assert.equal(m.seeker.state, 'track');
  combat.reset(); assert.equal(combat.fire(world).seeker.state, 'search');
});

test('different hidden maneuvers produce identical missile trajectories and memory expiry unloads guidance', () => {
  const make = () => {
    const world = { ...own(), ...flat, active: true, onGround: false, velocity: new Vector3(0, 0, -250) };
    const combat = new AirToAirMissileSystem();
    const t = new BanditTarget({ callsign: 'TEST', position: new Vector3(0, 3000, -6000), velocity: new Vector3(40, 0, 0) });
    combat.addTarget(t); combat.lockedTarget = t;
    const m = combat.fire(world); world.seekerSignalQuality = () => 0;
    return { world, combat, t, m };
  };
  const a = make(), b = make(); b.t.position.x = 1000; b.t.velocity.set(-500, 100, 0);
  for (let i = 0; i < 100; i++) {
    a.combat.update(dt, a.world); b.combat.update(dt, b.world);
    assert.ok(a.m.velocity.distanceTo(b.m.velocity) < 1e-10);
  }
  assert.equal(a.m.seeker.state, 'lost'); assert.equal(a.m.flight.requestedLateralMps2, 0);
});

test('sensor denial does not grant physical immunity to a ballistic impact', () => {
  const world = { ...own(), ...flat, active: true, onGround: false, velocity: new Vector3(0, 0, -250), seekerSignalQuality: () => 0 };
  const combat = new AirToAirMissileSystem(), t = new BanditTarget({ callsign: 'CLOSE', position: new Vector3(0, 3000, -300) });
  combat.addTarget(t); const m = combat.fire(world);
  for (let i = 0; i < 240 && m.alive; i++) combat.update(dt, world);
  assert.equal(m.seeker.everTracked, false); assert.equal(t.alive, false); assert.equal(combat.splashCount, 1);
});

test('exposed, briefly masked and persistently masked combat produce distinct state histories', () => {
  for (const result of compareSeekerTerrainEngagements()) {
    assert.equal(result.terminal, result.masking === 'permanent' ? 'miss-terrain' : 'hit');
    assert.deepEqual(result.phases, result.masking === 'open' ? ['track']
      : result.masking === 'brief' ? ['track', 'memory', 'track'] : ['track', 'memory', 'lost']);
  }
});
