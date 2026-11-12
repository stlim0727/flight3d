import * as THREE from 'three';
import { Atmosphere } from '../physics/Atmosphere.js';

const GRAVITY = 9.80665;
const FORWARD = new THREE.Vector3(0, 0, -1);
const MIN_CLOSURE = 200;

// Game-calibrated M61A1 values. The projectile is a 20 mm HEI round; drag,
// life and hit radius are tuning values, not certification data.
const VULCAN = {
  capacity: 510,
  roundsPerSecond: 100,
  muzzleVelocityMps: 1050,
  projectileMassKg: 0.102,
  projectileDiameterM: 0.020,
  dragCoefficient: 0.30,
  lifeSeconds: 3.0,
  hitRadiusM: 3.4,
  damagePerHit: 0.2,
  gunRangeM: 1200,
  // F-16 M61A1 port: left side of the forward fuselage, above the wing root.
  // Aircraft frame (+X starboard, +Y up, -Z nose).
  muzzleOffset: [-0.34, 0.62, -4.25],
};
VULCAN.crossSectionM2 = Math.PI * (VULCAN.projectileDiameterM / 2) ** 2;
export const M61A1_VULCAN = Object.freeze(VULCAN);

/**
 * M61A1 Vulcan 20 mm cannon. Pure state: fixed-step projectile ballistics,
 * ammunition, target hit tests and the lead-computing aim point used by the
 * HUD. The system owns the trigger; this class owns only the gun.
 */
export class VulcanCannon {
  constructor(spec = M61A1_VULCAN) {
    this.spec = spec;
    this.rounds = spec.capacity;
    this.bullets = [];
    this.trigger = false;
    this.firing = false;
    this.muzzlePosition = new THREE.Vector3();
    this.muzzleDirection = new THREE.Vector3(0, 0, -1);
    this._pool = [];
    this._fireAccumulator = 0;
    this._emptyNotified = false;
    this._aimPoint = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._r0 = new THREE.Vector3();
    this._rv = new THREE.Vector3();
    this._closest = new THREE.Vector3();
    this._los = new THREE.Vector3();
    this._predicted = new THREE.Vector3();
    this._zero = new THREE.Vector3();
    this._relative = new THREE.Vector3();
  }

  get capacity() {
    return this.spec.capacity;
  }

  get ammoRatio() {
    return this.spec.capacity ? this.rounds / this.spec.capacity : 0;
  }

  reset() {
    this.rounds = this.spec.capacity;
    for (const bullet of this.bullets) this._pool.push(bullet);
    this.bullets.length = 0;
    this.trigger = false;
    this.firing = false;
    this._fireAccumulator = 0;
    this._emptyNotified = false;
  }

  /** Ground-crew resupply keeps any rounds already in flight. */
  reload() {
    this.rounds = this.spec.capacity;
    this._emptyNotified = false;
  }

  clearBullets() {
    for (const bullet of this.bullets) this._pool.push(bullet);
    this.bullets.length = 0;
    this.firing = false;
    this._fireAccumulator = 0;
  }

  setTrigger(pressed) {
    const next = Boolean(pressed);
    if (this.trigger && !next) this._fireAccumulator = 0;
    if (!next) this._emptyNotified = false;
    this.trigger = next;
  }

  /**
   * @param {number} dt fixed step
   * @param {{position:THREE.Vector3, velocity:THREE.Vector3, quaternion:THREE.Quaternion,
   *   active:boolean, onGround:boolean, terrainHeight?:Function}} world
   * @param {Array<object>} targets live bandits
   */
  update(dt, world, targets = []) {
    const events = [];
    const active = Boolean(world?.active);
    const canFire = Boolean(this.trigger && active && !world?.onGround);
    this.firing = canFire && this.rounds > 0;

    if (!active) {
      this.firing = false;
      this._fireAccumulator = 0;
      return events;
    }

    if (canFire) {
      const interval = 1 / this.spec.roundsPerSecond;
      this._fireAccumulator += dt;
      while (this._fireAccumulator >= interval && this.rounds > 0) {
        this._spawnBullet(world);
        this.rounds--;
        this._fireAccumulator -= interval;
      }
      if (this.rounds === 0) {
        this._fireAccumulator = 0;
        this.firing = false;
      }
      if (this.rounds === 0 && !this._emptyNotified) {
        this._emptyNotified = true;
        events.push({ type: 'gunEmpty' });
      }
    } else {
      this._fireAccumulator = 0;
      if (this.trigger && active && !world?.onGround && this.rounds === 0 && !this._emptyNotified) {
        this._emptyNotified = true;
        events.push({ type: 'gunEmpty' });
      }
    }

    const terrainHeight = world?.terrainHeight;
    for (const bullet of this.bullets) {
      if (!bullet.alive) continue;
      bullet.prevPosition.copy(bullet.position);
      bullet.age += dt;

      const speed = bullet.velocity.length();
      if (speed > 1e-3) {
        const density = Atmosphere.getConditions(bullet.position.y).density;
        const dragAccel = 0.5 * density * speed * speed
          * this.spec.dragCoefficient * this.spec.crossSectionM2 / this.spec.projectileMassKg;
        bullet.velocity.addScaledVector(bullet.velocity, -dragAccel * dt / speed);
      }
      bullet.velocity.y -= GRAVITY * dt;
      bullet.position.addScaledVector(bullet.velocity, dt);

      for (const target of targets) {
        if (!target?.alive) continue;
        if (this._segmentDistance(bullet, target.position) <= this.spec.hitRadiusM) {
          bullet.alive = false;
          events.push({
            type: 'bulletHit',
            target,
            damage: this.spec.damagePerHit,
            position: bullet.position.clone(),
            distanceM: this._closest.distanceTo(target.position),
          });
          break;
        }
      }
      if (!bullet.alive) continue;

      if (bullet.age >= this.spec.lifeSeconds) {
        bullet.alive = false;
        continue;
      }
      const ground = terrainHeight ? terrainHeight(bullet.position.x, bullet.position.z) : 0;
      if (bullet.position.y <= ground + 0.2) bullet.alive = false;
    }

    for (let index = this.bullets.length - 1; index >= 0; index--) {
      if (this.bullets[index].alive) continue;
      this._pool.push(this.bullets[index]);
      this.bullets.splice(index, 1);
    }
    return events;
  }

  _spawnBullet(world) {
    const bullet = this._pool.pop() ?? {
      position: new THREE.Vector3(),
      prevPosition: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      age: 0,
      alive: true,
    };
    this._forward.copy(FORWARD).applyQuaternion(world.quaternion);
    this._muzzle.set(...this.spec.muzzleOffset).applyQuaternion(world.quaternion).add(world.position);
    bullet.position.copy(this._muzzle);
    bullet.prevPosition.copy(this._muzzle);
    bullet.velocity.copy(world.velocity ?? this._zero.set(0, 0, 0));
    bullet.velocity.addScaledVector(this._forward, this.spec.muzzleVelocityMps);
    bullet.age = 0;
    bullet.alive = true;
    this.bullets.push(bullet);
    this.muzzlePosition.copy(this._muzzle);
    this.muzzleDirection.copy(this._forward);
  }

  /** Closest distance from a moving segment to a sphere centre. */
  _segmentDistance(bullet, centre) {
    this._r0.copy(centre).sub(bullet.prevPosition);
    this._rv.copy(bullet.position).sub(bullet.prevPosition);
    const lengthSq = this._rv.lengthSq();
    const t = lengthSq > 1e-9
      ? THREE.MathUtils.clamp(this._r0.dot(this._rv) / lengthSq, 0, 1)
      : 0;
    this._closest.copy(this._rv).multiplyScalar(t).add(bullet.prevPosition);
    return this._closest.distanceTo(centre);
  }

  /**
   * Lead-computing optical sight: advance the target by the projectile's
   * estimated flight time and subtract the ballistic drop. Returns null when
   * the target is outside the useful gun range.
   */
  aimPoint(world, target) {
    if (!target?.alive || !world?.position) return null;
    this._forward.copy(FORWARD).applyQuaternion(world.quaternion);
    this._muzzle.set(...this.spec.muzzleOffset).applyQuaternion(world.quaternion).add(world.position);
    this._los.copy(target.position).sub(this._muzzle);
    const rangeM = this._los.length();
    if (rangeM < 1 || rangeM > this.spec.gunRangeM) return null;

    // Average projectile speed is below the muzzle value because drag bleeds
    // speed over the flight; 0.9 is the calibration for this 20 mm round.
    const targetVelocity = target.velocity ?? this._zero.set(0, 0, 0);
    let timeOfFlight = rangeM / (this.spec.muzzleVelocityMps * 0.9);
    const ownAlong = (world.velocity ?? this._zero.set(0, 0, 0)).dot(this._los) / rangeM;
    if (ownAlong > 0) timeOfFlight = rangeM / (this.spec.muzzleVelocityMps * 0.9 + ownAlong);
    for (let iteration = 0; iteration < 3; iteration++) {
      this._predicted.copy(target.position).addScaledVector(targetVelocity, timeOfFlight);
      this._los.copy(this._predicted).sub(this._muzzle);
      const predictedRange = this._los.length();
      if (predictedRange < 1) break;
      this._relative.copy(world.velocity ?? this._zero.set(0, 0, 0))
        .addScaledVector(this._forward, this.spec.muzzleVelocityMps)
        .sub(targetVelocity);
      const closure = this._relative.dot(this._los) / predictedRange;
      timeOfFlight = predictedRange / Math.max(MIN_CLOSURE, closure);
    }

    // The pipper must sit above the predicted target by the ballistic drop:
    // the projectile falls while it travels, so the gun points high.
    this._aimPoint.copy(target.position).addScaledVector(targetVelocity, timeOfFlight);
    this._aimPoint.y += 0.5 * GRAVITY * timeOfFlight * timeOfFlight;
    return { point: this._aimPoint, rangeM, timeOfFlight, inRange: true };
  }
}
