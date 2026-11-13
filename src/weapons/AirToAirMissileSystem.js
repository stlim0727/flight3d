import * as THREE from 'three';
import { BanditFlightModel } from './BanditFlightModel.js';
import { Atmosphere } from '../physics/Atmosphere.js';
import { RWRSystem } from '../systems/RWRSystem.js';
import { addDamage, blastDamage, combatDamageState } from '../physics/combatDamage.js';
import { VulcanCannon } from './VulcanCannon.js';
import { F16_MISSILE_STATIONS, MISSILE_TYPES } from './missileSpecs.js';

const GRAVITY = 9.80665;
const LOCK_SECONDS = 0.75;
const UNLOCK_SECONDS = 0.9;
const BANDIT_RESPAWN_SECONDS = 8;
const FORWARD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

let nextTargetId = 0;
let nextMissileId = 0;

/** Airborne bandit with a circular patrol. Pure state: no DOM, scene or audio. */
export class BanditTarget {
  constructor({ callsign, position, velocity = new THREE.Vector3(), orbit = null }) {
    this.id = ++nextTargetId;
    this.type = 'bandit';
    this.callsign = callsign;
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.prevPosition = position.clone();
    this.orbit = orbit;
    this.alive = true;
    this.respawnTimer = 0;
    this.damage = 0;
    this.damageState = 'normal';
    this.hostile = true;
    this.radar = true;
    this.flight = null;
    this.quaternion = null;
    if (orbit) this.respawn(position, orbit);
  }

  update(dt, terrainHeight = () => 0) {
    this.prevPosition.copy(this.position);
    if (!this.alive) return;
    if (!this.flight) {
      // Explicit ballistic fixtures used by weapon callers have no patrol AI.
      this.position.addScaledVector(this.velocity, dt);
      return;
    }
    const o = this.orbit;
    const dx = this.position.x - o.center.x;
    const dz = this.position.z - o.center.z;
    const radial = Math.atan2(dz, dx);
    const direction = Math.sign(o.omega) || 1;
    const correction = Math.atan2(Math.hypot(dx, dz) - o.radius, Math.max(300, o.radius * 0.5));
    const course = radial + direction * (Math.PI / 2 + correction);
    const speed = Math.abs(o.radius * o.omega);
    const lookahead = Math.max(500, this.velocity.length() * 8);
    const ground = Math.max(terrainHeight(this.position.x, this.position.z),
      terrainHeight(this.position.x + Math.cos(course) * lookahead,
        this.position.z + Math.sin(course) * lookahead));
    const altitude = Math.max(o.altitudeM, ground + 420);
    // Fixed substeps also make direct callers independent of render cadence.
    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < steps; i++) {
      this.flight.guide(Math.atan2(Math.cos(course), -Math.sin(course)), altitude, speed);
      this.flight.step(dt / steps, this.damage,
        this.position.y - terrainHeight(this.position.x, this.position.z));
      if (this.position.y <= terrainHeight(this.position.x, this.position.z) + 2) {
        this.alive = false;
        this.respawnTimer = BANDIT_RESPAWN_SECONDS;
        break;
      }
    }
  }

  respawn(position, orbit) {
    this.position.copy(position);
    this.prevPosition.copy(position);
    this.orbit = orbit;
    this.alive = true;
    this.respawnTimer = 0;
    this.damage = 0;
    this.damageState = 'normal';
    const o = orbit;
    if (o) {
      const tangential = o.radius * o.omega;
      this.velocity.set(-Math.sin(o.angle) * tangential, 0, Math.cos(o.angle) * tangential);
    } else {
      this.velocity.set(0, 0, -180);
    }
    this.flight = o ? new BanditFlightModel(this.position, this.velocity) : null;
    this.quaternion = this.flight?.quaternion ?? null;
  }
}

/**
 * F-16 air-to-air combat: six rail stations, seeker lock progression, 3D true
 * proportional navigation, continuous rocket mass/thrust and a proximity fuse.
 * The system advances at a fixed 120 Hz irrespective of render rate.
 */
export class AirToAirMissileSystem {
  constructor({
    stations = F16_MISSILE_STATIONS,
    specs = MISSILE_TYPES,
    fixedDt = 1 / 120,
    rwr = new RWRSystem(),
  } = {}) {
    this.stations = stations;
    this.specs = specs;
    this.fixedDt = fixedDt;
    this.rwr = rwr;
    this.cannon = new VulcanCannon();
    this.loaded = stations.map(() => true);
    this.missiles = [];
    this.targets = [];
    this.selectedTargetIndex = -1;
    this.lockProgress = 0;
    this.lockedTarget = null;
    this.splashCount = 0;
    this.lastFireError = null;
    this.accumulator = 0;
    this.elapsed = 0;
    this.world = null;

    this._events = [];
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._accel = new THREE.Vector3();
    this._los = new THREE.Vector3();
    this._rel = new THREE.Vector3();
    this._omega = new THREE.Vector3();
    this._rhat = new THREE.Vector3();
    this._lateral = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._r0 = new THREE.Vector3();
    this._r1 = new THREE.Vector3();
    this._rv = new THREE.Vector3();
    this._closest = new THREE.Vector3();
    this._launchPos = new THREE.Vector3();
  }

  reset() {
    this.loaded.fill(true);
    this.missiles.length = 0;
    this.targets.length = 0;
    this.selectedTargetIndex = -1;
    this.lockProgress = 0;
    this.lockedTarget = null;
    this.splashCount = 0;
    this.lastFireError = null;
    this.accumulator = 0;
    this.cannon.reset();
    this.rwr.reset();
  }

  /** Ground-crew turnaround: full rails and a full gun magazine, no new sortie. */
  rearm() {
    this.loaded.fill(true);
    this.cannon.reload();
  }

  setGunTrigger(pressed) {
    this.cannon.setTrigger(pressed);
  }

  get remaining() {
    return this.loaded.reduce((count, loaded) => count + (loaded ? 1 : 0), 0);
  }

  get totalStations() {
    return this.stations.length;
  }

  nextMissileType() {
    const index = this.loaded.findIndex(Boolean);
    return index < 0 ? null : this.specs[this.stations[index].type];
  }

  selectedTarget() {
    const target = this.targets[this.selectedTargetIndex];
    return target?.alive ? target : null;
  }

  selectNextTarget() {
    if (!this.targets.length) return null;
    const start = Math.max(0, this.selectedTargetIndex);
    for (let offset = 1; offset <= this.targets.length; offset++) {
      const index = (start + offset) % this.targets.length;
      const target = this.targets[index];
      if (!target.alive) continue;
      this.selectedTargetIndex = index;
      this.lockProgress = 0;
      this.lockedTarget = null;
      return target;
    }
    return null;
  }

  /** Select by target object or id; used by tests and remote-target integration. */
  selectTarget(targetOrId) {
    const id = typeof targetOrId === 'object' ? targetOrId?.id : targetOrId;
    const index = this.targets.findIndex(target => target.id === id);
    if (index < 0) return null;
    this.selectedTargetIndex = index;
    this.lockProgress = 0;
    this.lockedTarget = null;
    return this.targets[index];
  }

  /** Direct target injection for tests or remote aircraft. */
  addTarget(target) {
    this.targets.push(target);
    if (this.selectedTargetIndex < 0 || !this.selectedTarget()?.alive) this.selectedTargetIndex = this.targets.length - 1;
    return target;
  }

  clearTargets() {
    this.targets.length = 0;
    this.selectedTargetIndex = -1;
    this.lockProgress = 0;
    this.lockedTarget = null;
  }

  /**
   * @param {number} dt render delta
   * @param {{active:boolean, position:THREE.Vector3, velocity:THREE.Vector3,
   *   quaternion:THREE.Quaternion, onGround:boolean, terrainHeight?:Function}} world
   * @returns {Array<object>} events for audio, HUD and effects
   */
  update(dt, world) {
    this._events.length = 0;
    this.world = world;
    this.elapsed += dt;
    if (!world?.active) {
      if (this.targets.length || this.missiles.length) {
        this.missiles.length = 0;
        this.clearTargets();
      }
      this.cannon.clearBullets();
      this.cannon.setTrigger(false);
      this.rwr.reset();
      this.accumulator = 0;
      return this._events;
    }

    if (dt <= 0) {
      // A frozen frame must not leave the gun's visual/audio firing flag latched.
      this.cannon.firing = false;
      return this._events;
    }

    this._ensureTargets(world);
    this.accumulator += dt;
    while (this.accumulator >= this.fixedDt) {
      this._step(this.fixedDt, world, this._events);
      this.accumulator -= this.fixedDt;
    }
    this.rwr.update(dt, {
      position: world.position,
      quaternion: world.quaternion,
      threats: this.targets.filter(target => target.alive),
      incoming: this.missiles.filter(missile => missile.targetIsPlayer && missile.alive),
    });
    return this._events;
  }

  fire(world = this.world) {
    this.lastFireError = null;
    if (!world?.active) {
      this.lastFireError = 'inactive';
      return null;
    }
    if (world.onGround) {
      this.lastFireError = 'ground';
      return null;
    }
    const stationIndex = this.loaded.findIndex(Boolean);
    if (stationIndex < 0) {
      this.lastFireError = 'empty';
      return null;
    }
    const station = this.stations[stationIndex];
    const spec = this.specs[station.type];
    this._forward.copy(FORWARD).applyQuaternion(world.quaternion);
    this._up.copy(UP).applyQuaternion(world.quaternion);
    this._launchPos.set(...station.position).applyQuaternion(world.quaternion).add(world.position);
    const velocity = world.velocity.clone()
      .addScaledVector(this._forward, 22)
      .addScaledVector(this._up, -3);
    const target = this.lockedTarget?.alive ? this.lockedTarget : null;
    const quaternion = new THREE.Quaternion().setFromUnitVectors(FORWARD, this._dir.copy(velocity).normalize());
    const missile = {
      id: ++nextMissileId,
      stationIndex,
      stationId: station.id,
      typeId: station.type,
      spec,
      position: this._launchPos.clone(),
      prevPosition: this._launchPos.clone(),
      velocity,
      quaternion,
      target,
      targetIsPlayer: false,
      source: 'player',
      propellant: 1,
      age: 0,
      alive: true,
    };
    this.loaded[stationIndex] = false;
    this.missiles.push(missile);
    return missile;
  }

  getHudState() {
    const target = this.selectedTarget();
    const nextType = this.nextMissileType();
    let rangeM = 0;
    let closureMps = 0;
    if (target && this.world?.position) {
      this._r0.copy(target.position).sub(this.world.position);
      rangeM = this._r0.length();
      if (rangeM > 1e-3) {
        this._rel.copy(target.velocity).sub(this.world.velocity);
        closureMps = -this._r0.dot(this._rel) / rangeM;
      }
    }
    return {
      remaining: this.remaining,
      total: this.totalStations,
      splash: this.splashCount,
      lockProgress: this.lockProgress,
      locked: Boolean(this.lockedTarget?.alive && this.lockProgress >= 1),
      lockedTarget: this.lockedTarget?.alive ? this.lockedTarget : null,
      selectedTarget: target,
      nextMissileType: nextType,
      rangeM,
      closureMps,
      infraRed: nextType ? nextType.fox === 2 : true,
      rwr: this.rwr.state(),
      missilesInFlight: this.missiles.length,
      gun: {
        rounds: this.cannon.rounds,
        capacity: this.cannon.capacity,
        firing: this.cannon.firing,
        bullets: this.cannon.bullets.length,
        aim: target ? this.cannon.aimPoint(this.world, target) : null,
      },
    };
  }

  _ensureTargets(world) {
    if (this.targets.length) return;
    for (let index = 0; index < 2; index++) {
      const target = new BanditTarget({
        callsign: `BANDIT ${index + 1}`,
        position: new THREE.Vector3(),
      });
      this._placeBandit(target, world, index);
      this.targets.push(target);
    }
    this.selectedTargetIndex = 0;
  }

  _placeBandit(target, world, index) {
    this._forward.copy(FORWARD).applyQuaternion(world.quaternion);
    this._right.copy(RIGHT).applyQuaternion(world.quaternion);
    this._up.copy(UP).applyQuaternion(world.quaternion);
    const side = index % 2 === 0 ? -1 : 1;
    const ahead = 5200 + index * 900;
    const lateral = side * 1600;
    const position = this._launchPos.copy(world.position)
      .addScaledVector(this._forward, ahead)
      .addScaledVector(this._right, lateral)
      .addScaledVector(this._up, 460 + index * 130);
    const ground = world.terrainHeight ? world.terrainHeight(position.x, position.z) : 0;
    position.y = Math.max(position.y, ground + 420);

    const radius = 780 + index * 160;
    const center = position.clone().addScaledVector(this._right, side * radius);
    const angle = Math.atan2(position.z - center.z, position.x - center.x);
    const speed = 180 + index * 15;
    target.respawn(position, {
      center,
      radius,
      angle,
      omega: side * speed / radius,
      altitudeM: position.y,
    });
  }

  _step(dt, world, events) {
    for (const target of this.targets) {
      target.update(dt, world.terrainHeight);
      if (!target.alive) {
        target.respawnTimer -= dt;
        if (target.respawnTimer <= 0) this._placeBandit(target, world, this.targets.indexOf(target));
      }
    }

    this._updateGun(dt, world, events);
    this._updateLock(dt, world, events);

    for (const missile of this.missiles) {
      if (!missile.alive) continue;
      this._guide(missile, dt, world, events);
    }
    for (let index = this.missiles.length - 1; index >= 0; index--) {
      if (!this.missiles[index].alive) this.missiles.splice(index, 1);
    }
  }

  _updateLock(dt, world, events) {
    const target = this.selectedTarget();
    if (!target) {
      if (this.lockedTarget) {
        this.lockedTarget = null;
        events.push({ type: 'unlock' });
      }
      this.lockProgress = 0;
      return;
    }
    const spec = this.nextMissileType() || this.specs.AIM9X;
    this._los.copy(target.position).sub(world.position);
    const range = this._los.length();
    this._forward.copy(FORWARD).applyQuaternion(world.quaternion);
    const cosine = range > 1e-3 ? this._los.dot(this._forward) / range : -1;
    const angleDeg = Math.acos(THREE.MathUtils.clamp(cosine, -1, 1)) * 180 / Math.PI;
    const inCone = angleDeg <= spec.seekerFovDeg && range <= spec.seekerRangeM && this.selectedTargetIndex >= 0;

    const wasLocked = this.lockProgress >= 1;
    this.lockProgress = THREE.MathUtils.clamp(
      this.lockProgress + (inCone ? dt / LOCK_SECONDS : -dt / UNLOCK_SECONDS),
      0,
      1,
    );
    const isLocked = this.lockProgress >= 1;
    if (isLocked && !wasLocked) {
      this.lockedTarget = target;
      events.push({ type: 'lock', target });
    } else if (!isLocked && wasLocked) {
      this.lockedTarget = null;
      events.push({ type: 'unlock', target });
    } else if (isLocked) {
      this.lockedTarget = target;
    }
  }

  _guide(missile, dt, world, events) {
    const spec = missile.spec;
    missile.prevPosition.copy(missile.position);
    missile.age += dt;
    const speed = missile.velocity.length();
    const mass = spec.dryMassKg + spec.propellantMassKg * missile.propellant;
    this._accel.set(0, -GRAVITY, 0);

    if (missile.propellant > 0) {
      missile.propellant = Math.max(0, missile.propellant - dt / spec.burnSeconds);
      const taper = THREE.MathUtils.clamp(missile.propellant / 0.06, 0, 1);
      if (speed > 1e-3) this._dir.copy(missile.velocity).divideScalar(speed);
      else this._dir.copy(FORWARD).applyQuaternion(missile.quaternion);
      this._accel.addScaledVector(this._dir, spec.maxThrustN * taper / mass);
    }

    if (speed > 1e-3) {
      const density = Atmosphere.getConditions(missile.position.y).density;
      const dragAccel = 0.5 * density * speed * speed * spec.dragCoefficient * spec.crossSectionM2 / mass;
      this._accel.addScaledVector(missile.velocity, -dragAccel / speed);
    }

    if (!missile.target?.alive) this._acquireTarget(missile);
    const target = missile.target;
    if (target?.alive) this._applyGuidance(missile, target, spec, dt);

    missile.velocity.addScaledVector(this._accel, dt);
    missile.position.addScaledVector(missile.velocity, dt);
    if (missile.velocity.lengthSq() > 1e-6) {
      this._dir.copy(missile.velocity).normalize();
      missile.quaternion.setFromUnitVectors(FORWARD, this._dir);
    }

    if (target?.alive) {
      const distance = this._closestApproach(missile, target);
      if (distance <= spec.fuseRadiusM) {
        this._detonate(missile, target, events, distance);
        return;
      }
    }

    if (missile.age >= spec.maxLifeSeconds) {
      missile.alive = false;
      events.push({ type: 'expire', missile, position: missile.position.clone() });
      return;
    }

    const ground = world.terrainHeight ? world.terrainHeight(missile.position.x, missile.position.z) : 0;
    if (missile.position.y <= ground + 1) {
      missile.position.y = ground + 1;
      missile.alive = false;
      events.push({
        type: 'detonation', missile, target: null,
        position: missile.position.clone(), velocity: missile.velocity.clone(), surface: true,
      });
    }
  }

  /** Maddog: an unlocked launch can still acquire a target inside the seeker
   * gimbal once the missile has separated from the rail. */
  _acquireTarget(missile) {
    const speed = missile.velocity.length();
    if (speed < 1e-3) return;
    this._dir.copy(missile.velocity).divideScalar(speed);
    let best = null;
    let bestRange = Infinity;
    for (const candidate of this.targets) {
      if (!candidate.alive) continue;
      this._los.copy(candidate.position).sub(missile.position);
      const range = this._los.length();
      if (range < 1 || range > missile.spec.seekerRangeM || range >= bestRange) continue;
      this._rhat.copy(this._los).divideScalar(range);
      if (this._dir.dot(this._rhat) < Math.cos(THREE.MathUtils.degToRad(missile.spec.gimbalDeg))) continue;
      best = candidate;
      bestRange = range;
    }
    missile.target = best;
  }

  _applyGuidance(missile, target, spec, dt) {
    void dt;
    this._los.copy(target.position).sub(missile.position);
    const rangeSq = this._los.lengthSq();
    if (rangeSq < 1) return;
    const range = Math.sqrt(rangeSq);
    const speed = missile.velocity.length();
    if (speed < 1e-3) return;

    // Seeker gimbal limit: the body must keep the line of sight inside its
    // field of regard. Loss of lock leaves the missile ballistic.
    this._dir.copy(missile.velocity).divideScalar(speed);
    this._rhat.copy(this._los).divideScalar(range);
    if (Math.acos(THREE.MathUtils.clamp(this._dir.dot(this._rhat), -1, 1)) >
        THREE.MathUtils.degToRad(spec.gimbalDeg)) return;

    this._rel.copy(target.velocity).sub(missile.velocity);
    const closing = -this._los.dot(this._rel) / range;
    if (closing <= 0) return;

    // True proportional navigation: a = N' * Vc * (Omega_LOS x r_hat).
    this._omega.crossVectors(this._los, this._rel).divideScalar(rangeSq);
    this._lateral.crossVectors(this._omega, this._rhat).multiplyScalar(spec.navigationConstant * closing);
    const maxAccel = spec.maxLateralG * GRAVITY;
    if (this._lateral.lengthSq() > maxAccel * maxAccel) this._lateral.setLength(maxAccel);
    this._accel.add(this._lateral);
  }

  _closestApproach(missile, target) {
    this._r0.copy(target.prevPosition).sub(missile.prevPosition);
    this._r1.copy(target.position).sub(missile.position);
    this._rv.copy(this._r1).sub(this._r0);
    const lengthSq = this._rv.lengthSq();
    const t = lengthSq > 1e-9
      ? THREE.MathUtils.clamp(-this._r0.dot(this._rv) / lengthSq, 0, 1)
      : 0;
    this._closest.copy(this._rv).multiplyScalar(t).add(this._r0);
    return this._closest.length();
  }

  _updateGun(dt, world, events) {
    const gunEvents = this.cannon.update(dt, world, this.targets);
    for (const event of gunEvents) {
      if (event.type !== 'bulletHit') {
        events.push(event);
        continue;
      }
      this._damageTarget(event.target, event.damage, events, {
        source: 'gun',
        position: event.position,
        velocity: event.target.velocity,
      });
    }
  }

  /**
   * One monotonic damage integration for guns and warhead fragments. A target
   * survives until cumulative damage reaches full failure; the kill path emits
   * the same respawn, splash and lock-reset contract as a direct hit.
   */
  _damageTarget(target, amount, events, {
    source = 'gun', missile = null, position = target.position, velocity = target.velocity,
    detonationEmitted = false,
  } = {}) {
    if (!target?.alive || amount <= 0) return;
    target.damage = addDamage(target.damage, amount);
    target.damageState = combatDamageState(target.damage);
    if (target.damage < 1) {
      events.push({
        type: 'damage', target, source, missile,
        damage: target.damage,
        position: position.clone(),
      });
      return;
    }

    target.alive = false;
    target.respawnTimer = BANDIT_RESPAWN_SECONDS;
    this.splashCount++;
    if (!detonationEmitted) {
      events.push({
        type: 'detonation', missile, target, surface: false,
        position: target.position.clone(), velocity: target.velocity.clone(),
      });
    }
    events.push({
      type: 'kill', target, missile, source,
      position: target.position.clone(), velocity: target.velocity.clone(),
    });
    if (this.lockedTarget === target) {
      this.lockedTarget = null;
      this.lockProgress = 0;
    }
    const nextIndex = this.targets.findIndex(candidate => candidate.alive);
    this.selectedTargetIndex = nextIndex;
  }

  _detonate(missile, target, events, distanceM) {
    missile.alive = false;
    events.push({
      type: 'detonation', missile, target, surface: false,
      position: missile.position.clone(), velocity: missile.velocity.clone(),
    });
    if (!target?.alive) return;
    // The fuse radius is the warhead's lethal radius for a light drone. The
    // fragmentation model in combatDamage.js applies graded damage to larger
    // airframes once hostile fragments can reach the player.
    this._damageTarget(target, blastDamage(distanceM, {
      lethalRadiusM: missile.spec.fuseRadiusM,
      fragmentRadiusM: missile.spec.fuseRadiusM,
    }), events, {
      source: 'missile', missile,
      position: target.position,
      velocity: target.velocity,
      detonationEmitted: true,
    });
  }
}
