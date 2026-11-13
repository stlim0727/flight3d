import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Euler } from 'three';
import { BanditTarget } from '../src/weapons/AirToAirMissileSystem.js';
import { BanditFlightModel } from '../src/weapons/BanditFlightModel.js';
import { F16_FALCON } from '../src/config/aircraftConfigs.js';

function patrol(speed = 180, radius = 780, altitude = 3460) {
  return new BanditTarget({ callsign: 'TEST', position: new Vector3(radius, altitude, 0),
    orbit: { center: new Vector3(), radius, angle: 0, altitudeM: altitude, omega: speed / radius } });
}

test('F16 patrol holds a physical bank and stable altitude for three minutes', () => {
  for (const [speed, radius] of [[180, 780], [195, 940]]) {
    const target = patrol(speed, radius);
    const fuel = target.flight.engines.fuelKg;
    let maxLoad = 0, maxAlpha = 0, maxRate = 0;
    for (let i = 0; i < 180 * 120; i++) {
      target.update(1 / 120);
      maxLoad = Math.max(maxLoad, target.flight.aero.gForce);
      maxAlpha = Math.max(maxAlpha, target.flight.aero.alpha * 180 / Math.PI);
      maxRate = Math.max(maxRate, target.flight.angularVelocity.length());
      assert.ok(target.alive);
      assert.ok(Math.abs(target.position.y - 3460) < 60, 'patrol retains altitude without position correction');
    }
    assert.ok(maxLoad > 2 && maxLoad < 9, `normal load ${maxLoad}`);
    assert.ok(maxAlpha < 15, `alpha ${maxAlpha}`);
    assert.ok(maxRate < 1, 'finite angular response');
    const bank = new Euler().setFromQuaternion(target.quaternion, 'YXZ').z;
    assert.ok(Math.abs(bank) > 0.6, 'turning airframe banks');
    assert.ok(Math.abs(target.velocity.length() - speed) < 15);
    assert.ok(target.flight.engines.fuelKg < fuel, 'engine consumes fuel');
    assert.equal(target.flight.aero.wingArea, F16_FALCON.aerodynamics.wingAreaM2);
    assert.equal(target.flight.engines.maxStaticThrustPerEngine, F16_FALCON.propulsion.maxStaticThrustPerEngineN);
  }
});

test('damage changes forces without teleporting or instantly removing speed', () => {
  const target = patrol();
  for (let i = 0; i < 2400; i++) target.update(1 / 120);
  const position = target.position.clone(), velocity = target.velocity.clone();
  target.damage = 0.7;
  target.update(1 / 120);
  assert.ok(target.position.distanceTo(position) < 3);
  assert.ok(target.velocity.distanceTo(velocity) < 1);
  assert.ok(target.flight.aero.CD0 > F16_FALCON.aerodynamics.cd0Clean);
  const damaged = target.flight.engines.contactDamage[0];
  assert.equal(damaged, 0.7);
  target.respawn(new Vector3(780, 3460, 0), { ...target.orbit, angle: 0 });
  assert.equal(target.damage, 0);
  assert.equal(target.flight.engines.contactDamage[0], 0);
  assert.equal(target.flight.angularVelocity.length(), 0);
  assert.equal(target.quaternion, target.flight.quaternion);
});

test('unpowered aircraft loses mechanical energy instead of preserving scripted speed', () => {
  const f = new BanditFlightModel(new Vector3(0, 3000, 0), new Vector3(0, 0, -200));
  const energy = () => 0.5 * f.linearVelocity.lengthSq() + 9.80665 * f.position.y;
  const before = energy();
  f.engines.failed[0] = true;
  f.engines.n1.fill(0);
  for (let i = 0; i < 1200; i++) { f.guide(0, 3000, 200); f.step(1 / 120); }
  assert.ok(energy() < before - 100, 'drag dissipates specific energy');
});

test('low airspeed reduces commanded bank and cannot produce the high-speed turn', () => {
  const slow = patrol(90), fast = patrol(220);
  for (let i = 0; i < 600; i++) { slow.update(1 / 120); fast.update(1 / 120); }
  const bank = t => Math.abs(new Euler().setFromQuaternion(t.quaternion, 'YXZ').z);
  assert.ok(bank(slow) < bank(fast) * 0.7);
});

test('terrain collision kills the target and respawn restores a fresh F16', () => {
  const target = patrol();
  target.update(1 / 120, () => 4000);
  assert.equal(target.alive, false);
  assert.equal(target.respawnTimer, 8);
  const position = target.position.clone();
  target.update(1);
  assert.deepEqual(target.position, position);
});
