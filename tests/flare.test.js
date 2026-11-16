import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { FlareDispenser, FLARE_MODEL } from '../src/weapons/Flare.js';
import { CHAFF_MODEL } from '../src/weapons/Chaff.js';
import { infraredSignalQuality } from '../src/weapons/InfraredSignal.js';
import { MissileSeeker, seekerCanObserve } from '../src/weapons/MissileSeeker.js';
import { MISSILE_TYPES } from '../src/weapons/missileSpecs.js';
import { AirToAirMissileSystem, BanditTarget } from '../src/weapons/AirToAirMissileSystem.js';
const o = { position: new Vector3(0, 3000, 0), quaternion: new Quaternion() };
const target = () => ({ alive: true, position: new Vector3(0, 3000, -4000), velocity: new Vector3(),
  infraredSignature: { enginePower: 1, heat: 1, afterburner: 0, omnidirectional: true } });
const world = { terrainHeight: () => 0 };

test('finite inventory and flare emission rise, decay, motion and expiry', () => {
  const d = new FlareDispenser(1), t = target(), f = d.dispense(t.position, new Vector3(100, 0, 0));
  assert.equal(d.dispense(t.position, t.velocity), null);
  f.update(0.5); const emission = f.infraredEmission;
  assert.ok(emission > 0 && f.position.x > 0 && f.position.y < 3000);
  const diagnostics = {}; infraredSignalQuality(o, f, 2000, diagnostics); const received = diagnostics.received;
  infraredSignalQuality(o, f, 4000, diagnostics); assert.ok(Math.abs(received / diagnostics.received - 4) < 1e-10);
  f.update(3); assert.ok(f.infraredEmission < emission);
  f.infraredEmission = NaN; assert.equal(infraredSignalQuality(o, f, 4000, diagnostics), 0); assert.equal(diagnostics.received, 0);
  f.update(FLARE_MODEL.lifetimeS); assert.equal(f.alive, false); d.reset(); assert.equal(d.remaining, 1);
});

test('IR diverts after confirmation and reacquires after flare fades; radar ignores flare', () => {
  const t = target(), f = new FlareDispenser().dispense(t.position, t.velocity); f.update(0.5);
  const ir = new MissileSeeker(MISSILE_TYPES.AIM9X), radar = new MissileSeeker(MISSILE_TYPES.AIM120C);
  assert.ok(ir.seed(t, o, world)); assert.ok(radar.seed(t, o, world));
  assert.equal(seekerCanObserve(MISSILE_TYPES.AIM120C, o, f, world), false);
  ir.update(0.05, o, [t, f], world); assert.equal(ir.state, 'track');
  assert.equal(ir.target, t); assert.equal(ir.seekerEvents.filter(e => e.type === 'decoy_transfer').length, 0);
  ir.update(0.1, o, [t, f], world); assert.equal(ir.target, f);
  assert.equal(ir.seekerEvents.filter(e => e.type === 'decoy_transfer').length, 1);
  radar.update(1, o, [t, f], world); assert.equal(radar.target, t);
  f.update(FLARE_MODEL.lifetimeS); ir.update(0.05, o, [t, f], world);
  ir.update(0.1, o, [t, f], world); assert.equal(ir.target, t);
});

test('far off-axis, occluded and weak flares do not divert the seeker', () => {
  for (const mode of ['angle', 'terrain', 'weak']) {
    const t = target(), f = new FlareDispenser().dispense(t.position, t.velocity); f.update(0.5);
    if (mode === 'angle') f.position.x = 1500;
    if (mode === 'weak') f.infraredEmission = 0.01;
    const w = mode === 'terrain' ? { terrainHeight: (x, z) => x > 100 && z < -1000 && z > -3000 ? 4000 : 0 } : world;
    if (mode === 'terrain') f.position.x = 400;
    const seeker = new MissileSeeker(MISSILE_TYPES.AIM9X); seeker.seed(t, o, w);
    seeker.update(1, o, [t, f], w); assert.equal(seeker.target, t, mode);
  }
});

test('IR association keeps a continuous track when a brighter return has different angular motion', () => {
  const t = target(); t.position.z = -1500; t.velocity.x = 180;
  const f = new FlareDispenser().dispense(t.position, new Vector3()); f.update(0.5);
  const seeker = new MissileSeeker(MISSILE_TYPES.AIM9X); seeker.seed(t, o, world);
  for (let i = 0; i < 60; i++) {
    t.position.addScaledVector(t.velocity, 1 / 120);
    seeker.update(1 / 120, o, [t, f], world);
    assert.equal(seeker.target, t); assert.equal(seeker.state, 'track');
  }
  assert.equal(seeker.seekerEvents.filter(e => e.type === 'decoy_transfer').length, 0);
});

test('matching-motion flare can still capture; confirmation emits once and reset clears association', () => {
  const t = target(); t.velocity.x = 120;
  const f = new FlareDispenser().dispense(t.position, t.velocity);
  f.infraredEmission = 6;
  const seeker = new MissileSeeker(MISSILE_TYPES.AIM9X); seeker.seed(t, o, world);
  for (let i = 0; i < 120; i++) {
    t.position.addScaledVector(t.velocity, 1 / 120);
    f.position.addScaledVector(f.velocity, 1 / 120);
    seeker.update(1 / 120, o, [t, f], world);
    if (i < 17) assert.equal(seeker.target, t);
  }
  assert.equal(seeker.target, f);
  assert.equal(seeker.seekerEvents.filter(e => e.type === 'decoy_transfer').length, 1);
  f.alive = false;
  for (let i = 0; i < 18; i++) seeker.update(1 / 120, o, [t, f], world);
  assert.equal(seeker.target, t);
  seeker.reset(); assert.equal(seeker.hasEstimate, false); assert.equal(seeker.seekerEvents.length, 0);
});

test('candidate confirmation continues measuring a moving visible incumbent', () => {
  const t = target(), f = new FlareDispenser().dispense(t.position, t.velocity); f.infraredEmission = 6;
  const seeker = new MissileSeeker(MISSILE_TYPES.AIM9X); seeker.seed(t, o, world);
  seeker.update(0.05, o, [t, f], world);
  t.position.x += 2;
  seeker.update(0.05, o, [t, f], world);
  assert.equal(seeker.state, 'track'); assert.equal(seeker.target, t);
  assert.equal(seeker.estimate.position.x, 2); assert.equal(seeker.observationAgeSeconds, 0);
  f.alive = false; seeker.update(0.05, o, [t, f], world);
  assert.equal(seeker.pendingTarget, null); assert.equal(seeker.confirmationSeconds, 0);
  assert.equal(seeker.seekerEvents.filter(e => e.type === 'decoy_transfer').length, 0);
});

test('IR association follows angular evidence rather than privileging aircraft identity', () => {
  const t = target(); t.position.z = -1500;
  const f = new FlareDispenser().dispense(t.position, t.velocity); f.infraredEmission = 6;
  f.velocity.x = 180; f.infraredEmission = 0.5;
  const seeker = new MissileSeeker(MISSILE_TYPES.AIM9X); seeker.seed(f, o, world);
  // A weaker flare already owns the confirmed motion track. A brighter
  // aircraft with different angular motion does not get a type exemption.
  for (let i = 0; i < 60; i++) {
    f.position.addScaledVector(f.velocity, 1 / 120);
    seeker.update(1 / 120, o, [t, f], world);
  }
  assert.equal(seeker.target, f);
});

test('IR association does not read motion from a terrain-hidden return', () => {
  const t = target(), f = new FlareDispenser().dispense(t.position.clone().add(new Vector3(400, 0, 0)), t.velocity);
  f.infraredEmission = 6;
  Object.defineProperty(f, 'velocity', { get() { throw new Error('hidden velocity read'); } });
  const w = { terrainHeight: (x, z) => x > 100 && z < -1000 && z > -3000 ? 4000 : 0 };
  const seeker = new MissileSeeker(MISSILE_TYPES.AIM9X); seeker.seed(t, o, w);
  seeker.update(1, o, [t, f], w); assert.equal(seeker.target, t);
});

test('Bandit dispenses once for A-B-A and respawn and combat reset clear state', () => {
  const system = new AirToAirMissileSystem(), b = new BanditTarget({ callsign: 'TEST', position: target().position });
  let id = 1; b.update = () => { b.threatResponse.confirmedId = id; }; system.addTarget(b);
  const w = { ...world, ...o, velocity: new Vector3(), active: true, onGround: false };
  system.update(1 / 60, w); id = 2; system.update(1 / 60, w); id = 1; system.update(1 / 60, w);
  assert.equal(b.flare.remaining, FLARE_MODEL.capacity - 2); assert.equal(system.flares.length, 2);
  b.respawn(target().position, null); system.update(1 / 60, w);
  assert.equal(b.flare.remaining, FLARE_MODEL.capacity - 1);
  system.reset(); assert.equal(system.flares.length, 0);
});

test('Bandit dispenses a fanned 3-flare and 3-chaff burst over 0.5s for a sustained threat', () => {
  const system = new AirToAirMissileSystem(), b = new BanditTarget({ callsign: 'BURST', position: target().position });
  b.velocity.set(0, 0, -180);
  b.update = () => { b.threatResponse.confirmedId = 42; };
  system.addTarget(b);
  const w = { ...world, ...o, velocity: new Vector3(), active: true, onGround: false };
  for (let i = 0; i < 40; i++) system.update(1 / 60, w);
  assert.equal(system.flares.length, 3);
  assert.equal(system.chaffClouds.length, 3);
  assert.equal(b.flare.remaining, FLARE_MODEL.capacity - 3);
  assert.equal(b.chaff.remaining, CHAFF_MODEL.capacity - 3);
  assert.ok(system.flares[1].velocity.x > 0 && system.flares[2].velocity.x < 0, 'burst fans laterally');
  assert.ok(system.flares[1].velocity.y < 0, 'burst ejects downward');
});
