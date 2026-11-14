import * as THREE from 'three';
import { ChaffDispenser } from './Chaff.js';
import { FlareDispenser } from './Flare.js';
import { BanditThreatResponse } from './BanditThreatResponse.js';
import { fuzeClosestApproach } from './MissileFuze.js';
import { MissileSeeker, seekerCanObserve } from './MissileSeeker.js';
import { sampleEngineInfrared } from './InfraredSignal.js';
import { MissileFlightModel } from './MissileFlightModel.js';
import { BanditFlightModel } from './BanditFlightModel.js';
import { Atmosphere } from '../physics/Atmosphere.js';
import { RWRSystem } from '../systems/RWRSystem.js';
import {
  addDamage,
  applyBlastZoneDamage,
  applyZoneDamage,
  blastDamage,
  classifyHitZone,
  combatDamageState,
  createDamageZones,
  toBodyOffset,
} from '../physics/combatDamage.js';
import { VulcanCannon } from './VulcanCannon.js';
import { F16_MISSILE_STATIONS, MISSILE_TYPES } from './missileSpecs.js';

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
  constructor({ callsign, position, velocity = new THREE.Vector3(), orbit = null, evasion = true }) {
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
    this.damageZones = createDamageZones();
    this.lastHitZone = null;
    this.damageZones = createDamageZones();
    this.lastHitZone = null;
    this.hostile = true;
    this.radar = true;
    // Kinematic test targets are explicit hot omnidirectional emitters. Live
    // patrol aircraft publish measured engine state and use their actual attitude.
    this.infraredSignature = { enginePower: 1, heat: 1, afterburner: 0, omnidirectional: true };
    this.infraredAfterburnerLevel = 0;
    this.threatResponse = new BanditThreatResponse(evasion);
    this.chaff = new ChaffDispenser();
    this.flare = new FlareDispenser();
    this.flareThreatIds = new Set();
    this.chaffThreatIds = new Set();
    this.flight = null;
    this.quaternion = null;
    if (orbit) this.respawn(position, orbit);
  }

  update(dt, terrainHeight = () => 0, missiles = []) {
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
    const patrolHeading = Math.atan2(Math.cos(course), -Math.sin(course));
    // Threat state and pilot commands advance through the same physical steps.
    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < steps; i++) {
      this.threatResponse.update(dt / steps, this, missiles, terrainHeight);
      const response = this.threatResponse;
      const avionicsIntegrity = Math.max(0.25, 1 - 0.6 * (this.damageZones?.nose ?? 0));
      const headingError = Math.atan2(Math.sin(response.heading - patrolHeading),
        Math.cos(response.heading - patrolHeading));
      const heading = patrolHeading + headingError * response.weight * avionicsIntegrity;
      const lookahead = Math.max(500, this.velocity.length() * 8);
      const ground = Math.max(terrainHeight(this.position.x, this.position.z),
        terrainHeight(this.position.x + Math.sin(heading) * lookahead,
          this.position.z - Math.cos(heading) * lookahead));
      const altitude = Math.max(o.altitudeM, ground + 420);
      const commandedSpeed = speed + (Math.max(speed, 250) - speed) * response.weight * avionicsIntegrity;
      this.flight.guide(heading, altitude, commandedSpeed);
      this.flight.step(dt / steps, this.damage,
        this.position.y - terrainHeight(this.position.x, this.position.z), this.damageZones);
      sampleEngineInfrared(this.flight.engines, this.infraredAfterburnerLevel, this.infraredSignature);
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
    this.damageZones = createDamageZones();
    this.lastHitZone = null;
    this.damageZones = createDamageZones();
    this.lastHitZone = null;
    this.threatResponse.reset();
    this.chaff.reset();
    this.flare.reset();
    this.flareThreatIds.clear();
    this.chaffThreatIds.clear();
    const o = orbit;
    if (o) {
      const tangential = o.radius * o.omega;
      this.velocity.set(-Math.sin(o.angle) * tangential, 0, Math.cos(o.angle) * tangential);
    } else {
      this.velocity.set(0, 0, -180);
    }
    this.flight = o ? new BanditFlightModel(this.position, this.velocity) : null;
    this.quaternion = this.flight?.quaternion ?? null;
    this.infraredAfterburnerLevel = 0;
    if (this.flight) sampleEngineInfrared(this.flight.engines, 0, this.infraredSignature);
    else Object.assign(this.infraredSignature, { enginePower: 1, heat: 1, afterburner: 0, omnidirectional: true });
  }
}

/**
 * F-16 air-to-air combat: six rail stations, seeker lock progression, projected
 * PN requests, pressure-limited missile dynamics and a proximity fuse.
 * The system advances at a fixed 120 Hz irrespective of render rate.
 */
export class AirToAirMissileSystem {
  constructor({
    stations = F16_MISSILE_STATIONS,
    specs = MISSILE_TYPES,
    fixedDt = 1 / 120,
    rwr = new RWRSystem(),
    banditEvasion = true,
  } = {}) {
    this.stations = stations;
    this.specs = specs;
    this.fixedDt = fixedDt;
    this.rwr = rwr;
    this.banditEvasion = banditEvasion;
    this.cannon = new VulcanCannon();
    this.loaded = stations.map(() => true);
    this.missiles = [];
    this.chaffClouds = [];
    this.flares = [];
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
    this._los = new THREE.Vector3();
    this._rel = new THREE.Vector3();
    this._omega = new THREE.Vector3();
    this._rhat = new THREE.Vector3();
    this._lateral = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._r0 = new THREE.Vector3();
    this._launchPos = new THREE.Vector3();
  }

  reset() {
    this.loaded.fill(true);
    this.missiles.length = 0;
    this.chaffClouds.length = 0;
    this.flares.length = 0;
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

  getInFlightMissiles() {
    return this.missiles.filter(m => m.alive);
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
      this.chaffClouds.length = 0;
      this.flares.length = 0;
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
    const launchLocked = Boolean(this.lockedTarget?.alive && this.lockProgress >= 1);
    const selected = this.selectedTarget();
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
      flight: new MissileFlightModel(),
      seeker: new MissileSeeker(spec),
      propellant: 1,
      age: 0,
      alive: true,
      firedAt: this.elapsed,
      launchPosition: this._launchPos.clone(),
      launchVelocity: velocity.clone(),
      launchLocked,
      launchLockProgress: this.lockProgress,
      launchTargetId: target?.id ?? (selected?.id ?? null),
      launchTargetCallsign: target?.callsign ?? (selected?.callsign ?? null),
      closestApproaches: {},
      lastGuidance: { active: false, reason: null },
      finalOutcome: null,
    };
    if (target) missile.seeker.seed(target, missile, world);
    missile.target = missile.seeker.target;
    this.loaded[stationIndex] = false;
    this.missiles.push(missile);
    this._events.push({
      type: 'launch',
      missile,
      timeSec: this.elapsed,
      locked: launchLocked,
      lockProgress: this.lockProgress,
      target: missile.target,
    });
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
        evasion: this.banditEvasion,
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
      target.update(dt, world.terrainHeight, this.missiles);
      const threatId = target.threatResponse.confirmedId;
      if (target.alive && threatId !== null && !target.chaffThreatIds.has(threatId)) {
        const cloud = target.chaff.dispense(target.position, target.velocity, { sourceId: target.id });
        if (cloud) {
          target.chaffThreatIds.add(threatId);
          this.chaffClouds.push(cloud);
          events.push({
            type: 'chaff_dispense',
            chaff: cloud,
            target,
            remaining: target.chaff.remaining,
            timeSec: this.elapsed,
          });
        }
      }
      if (target.alive && threatId !== null && !target.flareThreatIds.has(threatId)) {
        const flare = target.flare.dispense(target.position, target.velocity, { sourceId: target.id });
        if (flare) {
          target.flareThreatIds.add(threatId);
          this.flares.push(flare);
          events.push({
            type: 'flare_dispense',
            flare,
            target,
            remaining: target.flare.remaining,
            timeSec: this.elapsed,
          });
        }
      }
      if (!target.alive) {
        target.respawnTimer -= dt;
        if (target.respawnTimer <= 0) this._placeBandit(target, world, this.targets.indexOf(target));
      }
    }

    for (const flare of this.flares) {
      flare.update(dt);
      if (!flare.alive) {
        events.push({ type: 'flare_expire', flareId: flare.id, sourceId: flare.sourceId, timeSec: this.elapsed });
      }
    }
    this.flares = this.flares.filter(flare => flare.alive);
    for (const cloud of this.chaffClouds) {
      cloud.update(dt);
      if (!cloud.alive) {
        events.push({ type: 'chaff_expire', chaffId: cloud.id, sourceId: cloud.sourceId, timeSec: this.elapsed });
      }
    }
    this.chaffClouds = this.chaffClouds.filter(cloud => cloud.alive);
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
    const inCone = this.selectedTargetIndex >= 0
      && seekerCanObserve(spec, world, target, world, spec.seekerFovDeg);

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
    const mass = spec.dryMassKg + spec.propellantMassKg * missile.propellant;
    let thrustN = 0;
    if (missile.propellant > 0) {
      missile.propellant = Math.max(0, missile.propellant - dt / spec.burnSeconds);
      const taper = THREE.MathUtils.clamp(missile.propellant / 0.06, 0, 1);
      thrustN = spec.maxThrustN * taper;
    }

    missile.seeker.update(dt, missile, missile.spec.seekerType === 'ACTIVE_RADAR'
      ? [...this.targets, ...this.chaffClouds] : missile.spec.seekerType === 'IR'
        ? [...this.targets, ...this.flares] : this.targets, world);
    missile.target = missile.seeker.target;

    if (missile.seeker?.seekerEvents?.length) {
      for (const seekerEvent of missile.seeker.seekerEvents) {
        events.push({
          ...seekerEvent,
          missile,
          timeSec: this.elapsed,
        });
      }
      missile.seeker.seekerEvents.length = 0;
    }

    this._lateral.set(0, 0, 0);
    const tracking = missile.seeker?.hasEstimate
      ? this._applyGuidance(missile, missile.seeker.estimate, spec) : false;
    const guidanceReason = tracking ? null : (missile.seeker?.hasEstimate ? missile._lastGuidanceCutoffReason : 'no_estimate');
    missile.lastGuidance = { active: tracking, reason: guidanceReason };

    missile.flight.step(dt, missile, {
      massKg: mass, thrustN,
      density: Atmosphere.getConditions(missile.position.y).density,
      command: this._lateral, tracking,
    });

    // Track minimum separation distance to each airborne target
    missile.closestApproaches ??= {};
    for (const candidate of this.targets) {
      if (!candidate.alive) continue;
      const dist = missile.position.distanceTo(candidate.position);
      const prev = missile.closestApproaches[candidate.id];
      if (!prev || dist < prev.distanceM) {
        missile.closestApproaches[candidate.id] = {
          distanceM: dist,
          timeSec: this.elapsed,
          method: 'step_sampling',
          targetCallsign: candidate.callsign,
          targetId: candidate.id,
        };
      }
    }

    // Select the earliest same-time closest-approach trigger across targets.
    let triggerTarget = null, triggerTime = Infinity;
    for (const candidate of this.targets) {
      if (!candidate.alive) continue;
      const time = fuzeClosestApproach(missile, candidate, spec.fuseRadiusM);
      if (time !== null && time < triggerTime) { triggerTarget = candidate; triggerTime = time; }
    }
    if (triggerTarget) {
      const burstPos = missile.prevPosition.clone().lerp(missile.position, triggerTime);
      const targetPos = triggerTarget.prevPosition.clone().lerp(triggerTarget.position, triggerTime);
      const cpaDist = burstPos.distanceTo(targetPos);
      missile.closestApproaches[triggerTarget.id] = {
        distanceM: cpaDist,
        timeSec: this.elapsed,
        method: 'continuous_fuze',
        targetCallsign: triggerTarget.callsign,
        targetId: triggerTarget.id,
      };
      missile.finalOutcome = {
        reason: 'fuze_burst',
        timeSec: this.elapsed,
        targetId: triggerTarget.id,
        distanceM: cpaDist,
      };
      this._detonate(missile, triggerTarget, events, triggerTime);
      return;
    }

    if (missile.age >= spec.maxLifeSeconds) {
      missile.alive = false;
      missile.finalOutcome = { reason: 'life_expiry', timeSec: this.elapsed };
      events.push({
        type: 'expire',
        missile,
        position: missile.position.clone(),
        timeSec: this.elapsed,
        reason: 'life_expiry',
      });
      return;
    }

    const ground = world.terrainHeight ? world.terrainHeight(missile.position.x, missile.position.z) : 0;
    if (missile.position.y <= ground + 1) {
      missile.position.y = ground + 1;
      missile.alive = false;
      missile.finalOutcome = { reason: 'surface_collision', timeSec: this.elapsed };
      events.push({
        type: 'detonation', missile, target: null,
        position: missile.position.clone(), velocity: missile.velocity.clone(), surface: true,
        timeSec: this.elapsed, reason: 'surface_collision',
      });
    }
  }

  _applyGuidance(missile, target, spec) {
    this._los.copy(target.position).sub(missile.position);
    const rangeSq = this._los.lengthSq();
    if (rangeSq < 1) {
      missile._lastGuidanceCutoffReason = 'range_too_close';
      return false;
    }
    const range = Math.sqrt(rangeSq);
    const speed = missile.velocity.length();
    if (speed < 1e-3) {
      missile._lastGuidanceCutoffReason = 'low_speed';
      return false;
    }

    // Seeker gimbal limit: the body must keep the line of sight inside its
    // field of regard. Invalid tracking stops new commands; the actuator unloads.
    this._dir.copy(missile.velocity).divideScalar(speed);
    this._rhat.copy(this._los).divideScalar(range);
    if (Math.acos(THREE.MathUtils.clamp(this._dir.dot(this._rhat), -1, 1)) >
        THREE.MathUtils.degToRad(spec.gimbalDeg)) {
      missile._lastGuidanceCutoffReason = 'gimbal_limit';
      return false;
    }

    this._rel.copy(target.velocity).sub(missile.velocity);
    const closing = -this._los.dot(this._rel) / range;
    if (closing <= 0) {
      missile._lastGuidanceCutoffReason = 'negative_closure';
      return false;
    }

    // LOS-normal PN request. The flight model projects onto the velocity-normal
    // plane, applies actuator lag/authority and charges the delivered maneuver drag.
    this._omega.crossVectors(this._los, this._rel).divideScalar(rangeSq);
    this._lateral.crossVectors(this._omega, this._rhat).multiplyScalar(spec.navigationConstant * closing);
    missile._lastGuidanceCutoffReason = null;
    return true;
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
    detonationEmitted = false, targetPosition = target.position,
  } = {}) {
    if (!target?.alive || amount <= 0) return;
    const localOffset = toBodyOffset(position, targetPosition, target.quaternion, target.velocity);
    const hitZone = classifyHitZone(localOffset);
    if (target.damageZones) {
      if (source === 'missile') {
        applyBlastZoneDamage(target.damageZones, localOffset, amount);
      } else {
        applyZoneDamage(target.damageZones, hitZone, amount * 1.35);
      }
      target.lastHitZone = hitZone;
    }
    target.damage = addDamage(target.damage, amount);
    target.damageState = combatDamageState(target.damage);
    if (target.damage < 1) {
      events.push({
        type: 'damage', target, source, missile,
        damage: target.damage,
        hitZone,
        damageZones: target.damageZones ? { ...target.damageZones } : null,
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
      hitZone,
      damageZones: target.damageZones ? { ...target.damageZones } : null,
      position: targetPosition.clone(), velocity: target.velocity.clone(),
    });
    if (this.lockedTarget === target) {
      this.lockedTarget = null;
      this.lockProgress = 0;
    }
    const nextIndex = this.targets.findIndex(candidate => candidate.alive);
    this.selectedTargetIndex = nextIndex;
  }

  _detonate(missile, target, events, time) {
    missile.position.lerpVectors(missile.prevPosition, missile.position, time);
    missile.alive = false;
    events.push({
      type: 'detonation', missile, target, surface: false,
      position: missile.position.clone(), velocity: missile.velocity.clone(),
    });
    // Every affected target is evaluated at the same interpolated instant.
    for (const candidate of this.targets) {
      if (!candidate.alive) continue;
      const position = candidate.prevPosition.clone().lerp(candidate.position, time);
      const distance = position.distanceTo(missile.position);
      const amount = blastDamage(distance, {
        lethalRadiusM: missile.spec.lethalRadiusM,
        fragmentRadiusM: missile.spec.fragmentRadiusM,
      });
      this._damageTarget(candidate, amount, events, {
        source: 'missile', missile, position: missile.position,
        targetPosition: position, velocity: candidate.velocity, detonationEmitted: true,
      });
    }
  }
}
