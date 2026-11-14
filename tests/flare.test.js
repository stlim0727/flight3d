import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { FlareDispenser, FLARE_MODEL } from '../src/weapons/Flare.js';
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
  ir.update(0.05, o, [t, f], world); assert.equal(ir.state, 'memory');
  ir.update(0.1, o, [t, f], world); assert.equal(ir.target, f);
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
