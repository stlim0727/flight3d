import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { radarSignalQuality } from '../src/weapons/RadarSignal.js';
import { MissileSeeker } from '../src/weapons/MissileSeeker.js';
import { MISSILE_TYPES } from '../src/weapons/missileSpecs.js';

const observer = { position: new Vector3(0, 3000, 0), quaternion: new Quaternion() };
const target = () => ({ alive: true, position: new Vector3(0, 3000, -5000), velocity: new Vector3(), radarCrossSectionM2: 1 });
const world = { terrainHeight: () => 0 };

test('radar return varies continuously with range and reflection and rejects invalid inputs', () => {
  const t = target(), q = (range) => radarSignalQuality(observer, t, range, world);
  assert.ok(q(4000) > q(5000) && q(5000) > q(6000));
  const initial = q(5000); t.radarCrossSectionM2 = 0.2;
  assert.ok(q(5000) < initial); t.radarCrossSectionM2 = NaN;
  assert.equal(q(5000), 0); assert.equal(q(0), 0);
});

test('ground background degrades look-down return continuously', () => {
  const t = target(), d = {};
  t.position.y = 500; const distance = observer.position.distanceTo(t.position);
  const low = radarSignalQuality(observer, t, distance, world, d);
  assert.ok(d.clutter > 0);
  const clear = radarSignalQuality(observer, t, distance, null);
  assert.ok(low < clear);
  t.position.y = 2500;
  const d2 = {}; radarSignalQuality(observer, t, observer.position.distanceTo(t.position), world, d2);
  assert.ok(d2.clutter < d.clutter);
});

test('weak reflection causes memory, loss and confirmed reacquisition', () => {
  const t = target(), seeker = new MissileSeeker(MISSILE_TYPES.AIM120C);
  assert.ok(seeker.seed(t, observer, world));
  t.radarCrossSectionM2 = 0;
  seeker.update(0.1, observer, [t], world); assert.equal(seeker.state, 'memory');
  seeker.update(2, observer, [t], world); assert.equal(seeker.state, 'lost');
  t.radarCrossSectionM2 = 1;
  seeker.update(0.1, observer, [t], world); assert.equal(seeker.state, 'acquire');
  seeker.update(0.2, observer, [t], world); assert.equal(seeker.state, 'track');
});
