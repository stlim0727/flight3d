import { decideBandit } from '../pilot/BanditPilot.js';
import { PilotPerception } from '../pilot/PilotPerception.js';
import { TerrainPerception } from '../pilot/TerrainPerception.js';
import { combatSkill, evasionDemand } from '../pilot/CombatSkills.js';
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
export const BANDIT_RESPAWN_SECONDS = 20;
export const DEFAULT_BANDIT_COUNT = 1;
const DECOY_BURST_COUNT = 3;
const DECOY_BURST_INTERVAL_S = 0.25;
const DECOY_EJECT_LATERAL_MPS = 22;
const DECOY_EJECT_VERTICAL_MPS = -12;
const EVASION_CLIMB_M = 350;
const FORWARD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

let nextTargetId = 0;
let nextMissileId = 0;

function terrainImpactFraction(prevPosition, position, terrainHeight) {
  if (!terrainHeight) return null;
  const samples = 8;
  const dx = position.x - prevPosition.x;
  const dy = position.y - prevPosition.y;
  const dz = position.z - prevPosition.z;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = prevPosition.x + dx * t;
    const y = prevPosition.y + dy * t;
    const z = prevPosition.z + dz * t;
    const ground = terrainHeight(x, z);
    if (!Number.isFinite(ground) || y <= ground + 1) {
      if (i === 0) return 0;
      let lo = (i - 1) / samples;
      let hi = t;
      for (let iter = 0; iter < 6; iter++) {
        const mid = (lo + hi) * 0.5;
        const mg = terrainHeight(prevPosition.x + dx * mid, prevPosition.z + dz * mid);
        if (!Number.isFinite(mg) || prevPosition.y + dy * mid <= mg + 1) hi = mid;
        else lo = mid;
      }
      return hi;
    }
  }
  return null;
}

/** Airborne bandit with a circular patrol. Pure state: no DOM, scene or audio. */
export class BanditTarget {
  constructor({ callsign, position, velocity = new THREE.Vector3(), orbit = null, evasion = true, rwr = true, evasionSkill = 'legacy-break', pilot = decideBandit }) {
    this.id = ++nextTargetId;
    this.type = 'bandit';
    this.pilot = pilot;
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
    this.threatResponse = new BanditThreatResponse(evasion, { rwr });
    this.chaff = new ChaffDispenser();
    this.flare = new FlareDispenser();
    this.evasionSkill = combatSkill('evasion', evasionSkill).id;
    this.flareThreatIds = new Set();
    this.chaffThreatIds = new Set();
    this.flareBursts = new Map();
    this.chaffBursts = new Map();
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
    const steps = Math.max(1, Math.ceil(dt * 120));
    const step = dt / steps;
    for (let i = 0; i < steps; i++) {
      const clearance = this.position.y - terrainHeight(this.position.x, this.position.z);
      this.threatResponse.update(step, this, missiles, terrainHeight);
      const incapacitated = this.flight.pilotPhysiology.isGLOC;
      if (incapacitated) {
        this.pendingPilotCommand = null;
        this.countermeasureRequest = null;
      }
      if (this.pilotDecisionRemaining <= 1e-9) {
        if (this.pendingPilotCommand) {
          const { controls, equipment } = this.pendingPilotCommand;
          if (this.flight.applyCommand(controls)) this.countermeasureRequest = equipment;
        }
        if (!incapacitated) this.pendingPilotCommand = this.samplePilotCommand(clearance, terrainHeight);
        this.pilotDecisionRemaining += 0.2;
        this.pilotSampleTick += 24;
      }
      this.pilotDecisionRemaining -= step;
      this.flight.step(step, this.damage, clearance, this.damageZones);
      sampleEngineInfrared(this.flight.engines, this.infraredAfterburnerLevel, this.infraredSignature);
      if (this.position.y <= terrainHeight(this.position.x, this.position.z) + 2) {
        this.alive = false;
        this.respawnTimer = BANDIT_RESPAWN_SECONDS;
        break;
      }
    }
  }

  samplePilotCommand(clearance, terrainHeight) {
    const flight = this.flight;
    const attitude = flight.euler.setFromQuaternion(flight.quaternion, 'YXZ');
    const observation = this.pilotPerception.sample({
      iasKnots: Atmosphere.msToKnots(flight.aero.ias),
      pitchDeg: THREE.MathUtils.radToDeg(attitude.x),
      rollDeg: -THREE.MathUtils.radToDeg(attitude.z),
      headingDeg: -THREE.MathUtils.radToDeg(attitude.y),
      pitchRateDegS: THREE.MathUtils.radToDeg(flight.angularVelocity.x),
      rollRateDegS: -THREE.MathUtils.radToDeg(flight.angularVelocity.z),
      altitudeFt: this.position.y / 0.3048,
      radioAltFt: clearance / 0.3048,
      vsiFpm: this.velocity.y * 60 / 0.3048,
      throttle: flight.command.throttle,
      pilot: flight.pilotPhysiology.getSnapshot(),
    }, this.pilotSampleTick);
    const orbit = this.orbit;
    const dx = this.position.x - orbit.center.x;
    const dz = this.position.z - orbit.center.z;
    const correction = Math.atan2(Math.hypot(dx, dz) - orbit.radius, Math.max(500, orbit.radius));
    const course = Math.atan2(dz, dx) + Math.sign(orbit.omega) * (Math.PI / 2 + correction);
    const response = this.threatResponse;
    const demand = evasionDemand(this.evasionSkill, {
      patrolHeading: Math.atan2(Math.cos(course), -Math.sin(course)),
      warningHeading: response.heading, weight: response.weight, integrity: 1,
      speedMps: Math.abs(orbit.radius * orbit.omega),
    });
    const altitude = observation.instruments.altitudeFt.mean;
    const radioAltitude = observation.instruments.radioAltFt;
    const desiredAltitude = (orbit.altitudeM + (this.evasionSkill === 'hold'
      ? 0 : EVASION_CLIMB_M * response.weight)) / 0.3048;
    const density = Atmosphere.getConditions(altitude * 0.3048).densityRatio;
    observation.navigation = {
      headingRad: demand.headingRad,
      altitudeFt: Math.max(desiredAltitude, radioAltitude.status === 'available'
        ? altitude + 1000 - radioAltitude.mean : desiredAltitude),
      iasKnots: Atmosphere.msToKnots(demand.speedMps * Math.sqrt(density)),
    };
    observation.terrain = this.terrainPerception.sample({
      position: this.position,
      quaternion: flight.quaternion,
      getHeight: terrainHeight,
    }, this.pilotSampleTick);
    observation.warning = response.confirmedId !== null && response.confirmedId === response.observedId
      ? { trackId: response.confirmedId, channel: response.confirmedChannel } : null;
    observation.equipment = { chaff: this.chaff.remaining, flare: this.flare.remaining };
    return this.pilot(observation);
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
    this.flareBursts.clear();
    this.chaffBursts.clear();
    const o = orbit;
    if (o) {
      const tangential = o.radius * o.omega;
      this.velocity.set(-Math.sin(o.angle) * tangential, 0, Math.cos(o.angle) * tangential);
    } else {
      this.velocity.set(0, 0, -180);
    }
    this.pilotPerception = new PilotPerception({ mission: 'bandit' });
    this.terrainPerception = new TerrainPerception({
      azimuthsDeg: [-20, 0, 20],
      elevationsDeg: [-10, 0, 10],
    });
    this.pendingPilotCommand = null;
    this.countermeasureRequest = null;
    this.pilotDecisionRemaining = 0;
    this.pilotSampleTick = 0;
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
    banditRwr = true,
    evasionSkill = 'legacy-break',
    countermeasurePolicy = 'burst',
    banditCount = DEFAULT_BANDIT_COUNT,
    banditPilot = decideBandit,
  } = {}) {
    this.stations = stations;
    this.specs = specs;
    this.fixedDt = fixedDt;
    this.rwr = rwr;
    this.banditEvasion = banditEvasion;
    this.banditRwr = banditRwr;
    this.banditCount = banditCount;
    this.banditPilot = banditPilot;
    this.evasionSkill = combatSkill('evasion', evasionSkill).id;
    this.countermeasurePolicy = combatSkill('countermeasure', countermeasurePolicy).id;
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
    this.elapsed = 0;
    this.cannon.reset();
    this.rwr.reset();
    this._events.length = 0;
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
      return this._events.splice(0);
    }

    if (dt <= 0) {
      // A frozen frame must not leave the gun's visual/audio firing flag latched.
      this.cannon.firing = false;
      return this._events.splice(0);
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
    return this._events.splice(0);
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
      lastGuidance: { active: false, reason: null, losAngleDeg: null, rangeM: null },
      _lastGuidanceLosAngleDeg: null,
      _lastGuidanceRangeM: null,
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
    for (let index = 0; index < this.banditCount; index++) {
      const target = new BanditTarget({
        callsign: `BANDIT ${index + 1}`,
        evasion: this.banditEvasion,
        pilot: this.banditPilot,
        evasionSkill: this.evasionSkill,
        rwr: this.banditRwr,
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

  _decoyEjectVelocity(target, shotIndex) {
    if (shotIndex === 0) return target.velocity;
    const vx = target.velocity.x;
    const vz = target.velocity.z;
    const horiz = Math.hypot(vx, vz);
    const side = shotIndex % 2 === 1 ? 1 : -1;
    const lx = horiz > 1e-3 ? -vz / horiz : 1;
    const lz = horiz > 1e-3 ? vx / horiz : 0;
    return new THREE.Vector3(
      vx + lx * side * DECOY_EJECT_LATERAL_MPS,
      target.velocity.y + DECOY_EJECT_VERTICAL_MPS,
      vz + lz * side * DECOY_EJECT_LATERAL_MPS,
    );
  }

  _stepDecoyBurst(dt, target, requestedTrack, burstCount, threatIds, bursts, dispenser, list, type, eventKey, events) {
    if (!bursts || !dispenser) return;
    if (!target.alive || target.flight?.pilotPhysiology.isGLOC) {
      bursts.clear();
      return;
    }
    if (requestedTrack != null && !threatIds.has(requestedTrack) && dispenser.remaining > 0) {
      threatIds.add(requestedTrack);
      bursts.set(requestedTrack, { remaining: burstCount, cooldownSec: 0, shotIndex: 0 });
    }
    for (const [track, burst] of bursts) {
      burst.cooldownSec = Math.max(0, burst.cooldownSec - dt);
      if (burst.cooldownSec > 1e-9) continue;
      const decoy = dispenser.dispense(target.position, this._decoyEjectVelocity(target, burst.shotIndex), {
        sourceId: target.id,
      });
      if (!decoy) {
        bursts.delete(track);
        continue;
      }
      burst.remaining--;
      burst.shotIndex++;
      burst.cooldownSec = DECOY_BURST_INTERVAL_S;
      if (burst.remaining === 0) bursts.delete(track);
      list.push(decoy);
      events.push({ type, [eventKey]: decoy, target, remaining: dispenser.remaining, timeSec: this.elapsed });
    }
  }

  _step(dt, world, events) {
    const burstCount = this.countermeasurePolicy === 'burst'
      ? DECOY_BURST_COUNT
      : this.countermeasurePolicy === 'single' ? 1 : 0;
    for (const target of this.targets) {
      target.update(dt, world.terrainHeight, this.missiles);
      const request = target.countermeasureRequest;
      target.countermeasureRequest = null;
      if (burstCount > 0) {
        this._stepDecoyBurst(dt, target, request?.type === 'chaff' ? request.trackId : null, burstCount, target.chaffThreatIds, target.chaffBursts, target.chaff,
          this.chaffClouds, 'chaff_dispense', 'chaff', events);
        this._stepDecoyBurst(dt, target, request?.type === 'flare' ? request.trackId : null, burstCount, target.flareThreatIds, target.flareBursts, target.flare,
          this.flares, 'flare_dispense', 'flare', events);
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
    const guided = Boolean(missile.seeker?.hasEstimate);
    // LOS angle/range are sampled in _applyGuidance, before the flight model
    // integrates this step, so the diagnostic row explains the same instant
    // the gimbal decision used.
    missile.lastGuidance = {
      active: tracking,
      reason: guidanceReason,
      losAngleDeg: guided ? missile._lastGuidanceLosAngleDeg ?? null : null,
      rangeM: guided ? missile._lastGuidanceRangeM ?? null : null,
    };

    missile.flight.step(dt, missile, {
      massKg: mass, thrustN,
      density: Atmosphere.getConditions(missile.position.y).density,
      command: this._lateral, tracking,
    });

    missile.closestApproaches ??= {};
    const recordStepClosestApproaches = (endFraction = 1, missilePos = missile.position) => {
      for (const candidate of this.targets) {
        if (!candidate.alive) continue;
        const targetPos = endFraction < 1
          ? candidate.prevPosition.clone().lerp(candidate.position, endFraction)
          : candidate.position;
        const dist = missilePos.distanceTo(targetPos);
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
    };

    // Select the earliest same-time closest-approach trigger across targets.
    let triggerTarget = null, triggerTime = Infinity;
    for (const candidate of this.targets) {
      if (!candidate.alive) continue;
      const time = fuzeClosestApproach(missile, candidate, spec.fuseRadiusM);
      if (time !== null && time < triggerTime) { triggerTarget = candidate; triggerTime = time; }
    }
    const groundEnd = world.terrainHeight ? world.terrainHeight(missile.position.x, missile.position.z) : 0;
    const groundTime = world.terrainHeight
      && (triggerTarget !== null || !Number.isFinite(groundEnd) || missile.position.y <= groundEnd + 1)
      ? terrainImpactFraction(missile.prevPosition, missile.position, world.terrainHeight)
      : (!Number.isFinite(groundEnd) || missile.position.y <= groundEnd + 1 ? 1 : null);
    if (groundTime !== null && (triggerTarget === null || groundTime <= triggerTime)) {
      missile.position.lerpVectors(missile.prevPosition, missile.position, groundTime);
      const impactGround = world.terrainHeight ? world.terrainHeight(missile.position.x, missile.position.z) : 0;
      missile.position.y = (Number.isFinite(impactGround) ? impactGround : 0) + 1;
      recordStepClosestApproaches(groundTime);
      missile.alive = false;
      missile.finalOutcome = { reason: 'surface_collision', timeSec: this.elapsed };
      events.push({
        type: 'detonation', missile, target: null,
        position: missile.position.clone(), velocity: missile.velocity.clone(), surface: true,
        timeSec: this.elapsed, reason: 'surface_collision',
      });
      return;
    }
    if (triggerTarget) {
      const burstPos = missile.prevPosition.clone().lerp(missile.position, triggerTime);
      const targetPos = triggerTarget.prevPosition.clone().lerp(triggerTarget.position, triggerTime);
      const cpaDist = burstPos.distanceTo(targetPos);
      recordStepClosestApproaches(triggerTime, burstPos);
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
    recordStepClosestApproaches(1);

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
  }

  _applyGuidance(missile, target, spec) {
    missile._lastGuidanceLosAngleDeg = null;
    missile._lastGuidanceRangeM = null;
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
    const losAngleDeg = Math.acos(THREE.MathUtils.clamp(this._dir.dot(this._rhat), -1, 1)) * (180 / Math.PI);
    missile._lastGuidanceLosAngleDeg = losAngleDeg;
    missile._lastGuidanceRangeM = range;
    if (losAngleDeg > spec.gimbalDeg) {
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
        amount, damage: target.damage,
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
      type: 'kill', target, missile, source, amount,
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
      distanceM: missile.position.distanceTo(target.prevPosition.clone().lerp(target.position, time)),
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
