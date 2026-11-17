import * as THREE from 'three';
import { MissileCombatView, MissileSmokeTrail } from '../weapons/MissileCombatView.js';
import { presentCombatEvent, syncCombatAudio } from '../weapons/combatPresentation.js';
import { Flare, FLARE_MODEL } from '../weapons/Flare.js';
import { ChaffCloud, CHAFF_MODEL } from '../weapons/Chaff.js';
import { F16_MISSILE_STATIONS, MISSILE_TYPES } from '../weapons/missileSpecs.js';
import { createDamageZones, combatDamageState } from '../physics/combatDamage.js';
import { findSpan } from './TrackSampler.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, alpha) {
  return a + (b - a) * alpha;
}

function slerp(out, a, b, alpha) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  dot = Math.min(1, dot * sign);
  const theta = Math.acos(dot);
  if (theta < 1e-6) {
    for (let index = 0; index < 4; index++) out[index] = a[index] + ((b[index] * sign) - a[index]) * alpha;
  } else {
    const sinTheta = Math.sin(theta);
    const wa = Math.sin((1 - alpha) * theta) / sinTheta;
    const wb = Math.sin(alpha * theta) / sinTheta * sign;
    for (let index = 0; index < 4; index++) out[index] = wa * a[index] + wb * b[index];
  }
  const length = Math.hypot(...out) || 1;
  for (let index = 0; index < 4; index++) out[index] /= length;
  return out;
}

function shortestAngle(a, b, alpha) {
  const delta = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + delta * alpha;
}

function catmullRom(p0, p1, p2, p3, t) {
  const d = p2 - p1;
  if (Math.abs(d) < 1e-4) return p1;
  let m1 = 0.5 * (p2 - p0);
  let m2 = 0.5 * (p3 - p1);
  if (d * m1 <= 0) m1 = 0;
  if (d * m2 <= 0) m2 = 0;
  const s1 = m1 / d;
  const s2 = m2 / d;
  const sumSq = s1 * s1 + s2 * s2;
  if (sumSq > 9) {
    const tau = 3 / Math.sqrt(sumSq);
    m1 = tau * s1 * d;
    m2 = tau * s2 * d;
  }
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * p1 + h10 * m1 + h01 * p2 + h11 * m2;
}

/**
 * Replays the optional combat section of a track. It never re-simulates
 * guidance: sampled target and missile poses are interpolated, and detonation
 * markers stage explosions exactly once per playback pass.
 */
export class CombatReplayPlayback {
  constructor(sim) {
    this.sim = sim;
    this.track = null;
    this.active = false;
    this.timeSec = 0;
    this.state = { targets: [], missiles: [], flares: [], chaffClouds: [], rails: 0x3f };
    this.view = new MissileCombatView(sim.scene, this.state, {
      terrainHeight: (x, z) => sim.currentTerrain?.getHeight(x, z) ?? 0,
    });
    this.targets = [];
    this.groups = new Map();
    this.missiles = new Map();
    this.decoys = new Map();
    this.events = [];
    this.staged = new Set();
    this._banditHint = 0;
    // Launch presentation waits one playback tick. The new missile appears in
    // the same tick, and the DIRECTOR camera only cuts to its launch shot later
    // in that frame, so an immediate launch sound would be scored against the
    // previous orbit camera kilometres away and arrive attenuated to silence.
    this.pendingLaunches = [];
  }

  load(combat) {
    this.stop();
    if (!combat || !Array.isArray(combat.targets)) return false;
    this.track = combat;
    this.targets = combat.targets.map((target, index) => ({
      // Event IDs use the compact byte namespace even before codec export.
      id: (target.id ?? index) & 255,
      callsign: target.callsign || `TARGET ${index + 1}`,
      alive: true,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(0, 0, -1),
    }));
    this.state.targets = this.targets;
    this.lethalMissileIds = new Set();
    this.hitMissileIds = new Set();
    for (const event of combat.events || []) {
      const mid = event.missileId ?? event.missile?.id;
      if (mid != null) {
        if (event.kind === 'kill') {
          this.lethalMissileIds.add(mid & 255);
        } else if (event.kind === 'damage' || (event.kind === 'detonation' && !event.surface)) {
          this.hitMissileIds.add(mid & 255);
        }
      }
    }
    this.groups = new Map();
    for (const sample of combat.missileSamples || []) {
      let group = this.groups.get(sample.id);
      if (!group) {
        group = { typeId: sample.typeId, samples: [], removeAt: Infinity, hint: 0 };
        this.groups.set(sample.id, group);
      }
      group.samples.push(sample);
      group.typeId = sample.typeId;
    }
    for (const event of combat.events || []) {
      if (event.kind !== 'detonation' && event.kind !== 'expire') continue;
      const group = this.groups.get(event.missileId);
      if (group) group.removeAt = Math.min(group.removeAt, event.timeSec);
    }
    for (const group of this.groups.values()) group.samples.sort((a, b) => a.timeSec - b.timeSec);
    this.events = [...(combat.events || [])].sort((a, b) => a.timeSec - b.timeSec);
    this.active = true;
    this.timeSec = 0;
    this._banditHint = 0;
    this.decoys.clear();
    this.staged.clear();
    this.pendingLaunches.length = 0;
    return true;
  }

  /** Pose-only seek: rebuild the visible set and suppress explosions already in the past. */
  seek(timeSec) {
    if (!this.active) return;
    this.timeSec = timeSec;
    this._banditHint = 0;
    for (const group of this.groups.values()) group.hint = 0;
    this.staged = new Set(this.events.filter(event => event.timeSec <= timeSec + 1e-9));
    this.pendingLaunches.length = 0;
    this.decoys.clear();
    this.view.clear();
    this._updateState(timeSec);
    this.view.sync(0);

    // Reconstruct lingering smoke trails for recently detonated missiles within 26s
    for (const group of this.groups.values()) {
      if (!group.samples?.length) continue;
      const launchTime = group.samples[0].timeSec;
      const removeTime = Number.isFinite(group.removeAt) ? group.removeAt : group.samples.at(-1).timeSec;
      if (timeSec >= removeTime && timeSec <= removeTime + 26.0 && timeSec >= launchTime) {
        const trail = new MissileSmokeTrail(this.sim.scene);
        trail.prepopulateFromSamples(group.samples, timeSec);
        if (trail.count > 0) {
          this.view.trails.push(trail);
        } else {
          trail.dispose();
        }
      }
    }

    syncCombatAudio(this.state, { audio: this.sim.audio, camera: this.sim.camera, paused: true });
  }

  update(dt, timeSec) {
    if (!this.active) return;
    if (timeSec < this.timeSec - 1e-9) {
      this.staged.clear();
      this.decoys.clear();
      this.view.clear();
      this._banditHint = 0;
      for (const group of this.groups.values()) group.hint = 0;
    }
    this.timeSec = timeSec;
    this._updateState(timeSec);
    this.view.sync(dt);
    syncCombatAudio(this.state, { audio: this.sim.audio, camera: this.sim.camera, paused: dt <= 0 });
    if (this.pendingLaunches.length) {
      const deferred = this.pendingLaunches.splice(0);
      for (const event of deferred) this._present(event);
    }
    for (const event of this.events) {
      if (event.timeSec > timeSec + 1e-9) break;
      if (this.staged.has(event)) continue;
      this.staged.add(event);
      if (event.kind === 'launch') this.pendingLaunches.push(event);
      else this._present(event);
    }
  }

  _present(event) {
    presentCombatEvent(event, {
      view: this.view,
      explosionSystem: this.sim.explosionSystem,
      audio: this.sim.audio,
      camera: this.sim.camera,
    });
  }

  stop() {
    this.view.clear();
    syncCombatAudio(null, { audio: this.sim.audio, paused: true });
    this.track = null;
    this.active = false;
    this.timeSec = 0;
    this.targets.length = 0;
    this.state.targets.length = 0;
    this.state.missiles.length = 0;
    this.state.flares.length = 0;
    this.state.chaffClouds.length = 0;
    this.state.rails = 0x3f;
    this.groups.clear();
    this.missiles.clear();
    this.decoys.clear();
    this.lethalMissileIds?.clear?.();
    this.hitMissileIds?.clear?.();
    this.events.length = 0;
    this.staged.clear();
    this.pendingLaunches.length = 0;
  }

  /** HUD state for playback: recorded rail count, nearest live bandit and bursts. */
  getHudState(aircraftPosition) {
    if (!this.active) return null;
    const rails = this.state.rails ?? 0x3f;
    let remaining = 0;
    let firstType = null;
    for (let index = 0; index < F16_MISSILE_STATIONS.length; index++) {
      if (!(rails & (1 << index))) continue;
      remaining++;
      firstType ??= F16_MISSILE_STATIONS[index].type;
    }
    let target = null;
    let rangeM = 0;
    for (const candidate of this.targets) {
      if (!candidate.alive) continue;
      const range = candidate.position.distanceTo(aircraftPosition);
      if (!target || range < rangeM) {
        target = candidate;
        rangeM = range;
      }
    }
    return {
      remaining,
      total: F16_MISSILE_STATIONS.length,
      splash: this.events.filter(event => (this.track.killEventsRecorded === false
        ? event.kind === 'detonation' && !event.surface : event.kind === 'kill')
        && event.timeSec <= this.timeSec + 1e-9).length,
      lockProgress: 0,
      locked: false,
      lockedTarget: null,
      selectedTarget: target,
      nextMissileType: firstType ? MISSILE_TYPES[firstType] : null,
      rangeM,
      closureMps: null,
      infraRed: true,
      rwr: { level: 0, levelName: 'none', contacts: [] },
      missilesInFlight: this.state.missiles.length,
    };
  }

  _updateState(timeSec) {
    this._updateTargets(timeSec);
    this._updateDecoys(timeSec);
    this.state.missiles.length = 0;
    // Objects are reused across seeks so a consumer (the director) can hold a
    // missile reference and see it die when playback crosses its detonation.
    for (const missile of this.missiles.values()) missile.alive = false;
    for (const [id, group] of this.groups) {
      const samples = group.samples;
      if (!samples.length || timeSec + 1e-9 < samples[0].timeSec) continue;
      if (Number.isFinite(group.removeAt) && timeSec + 1e-9 >= group.removeAt) continue;
      const clamped = Math.min(samples.at(-1).timeSec, timeSec);
      const index = findSpan(samples, clamped, group.hint);
      group.hint = index;
      const a = samples[index];
      const b = samples[index + 1] ?? a;
      const alpha = b.timeSec > a.timeSec
        ? clamp((clamped - a.timeSec) / (b.timeSec - a.timeSec), 0, 1)
        : 0;
      const p0 = index > 0 ? samples[index - 1] : { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z };
      const p1 = a;
      const p2 = b;
      const p3 = (index + 2 < samples.length) ? samples[index + 2] : { x: 2 * b.x - a.x, y: 2 * b.y - a.y, z: 2 * b.z - a.z };

      let missile = this.missiles.get(id);
      if (!missile) {
        missile = {
          id, typeId: group.typeId, alive: true, age: 0,
          position: new THREE.Vector3(), velocity: new THREE.Vector3(),
          quaternion: new THREE.Quaternion(), propellant: 0,
        };
        this.missiles.set(id, missile);
      }
      missile.typeId = group.typeId;
      missile.alive = true;
      missile.historySamples = samples;
      missile.timeSec = timeSec;
      missile.age = Math.max(0, clamped - samples[0].timeSec);
      missile.lethal = Boolean(this.lethalMissileIds?.has?.(id & 255));
      missile.hit = Boolean(this.hitMissileIds?.has?.(id & 255));
      missile.position.set(
        catmullRom(p0.x, p1.x, p2.x, p3.x, alpha),
        catmullRom(p0.y, p1.y, p2.y, p3.y, alpha),
        catmullRom(p0.z, p1.z, p2.z, p3.z, alpha),
      );
      const quat = slerp([0, 0, 0, 1], a.quat, b.quat, alpha);
      missile.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
      missile.propellant = a.powered ? 1 : 0;
      // Recorded samples carry pose only; the pose delta restores the flight
      // direction the director needs for its follow cam.
      const previous = index > 0 ? samples[index - 1] : a;
      const from = b.timeSec > a.timeSec ? a : previous;
      const to = b.timeSec > a.timeSec ? b : a;
      const span = to.timeSec - from.timeSec;
      if (span > 1e-6) {
        missile.velocity.set(
          (to.x - from.x) / span,
          (to.y - from.y) / span,
          (to.z - from.z) / span,
        );
      } else {
        missile.velocity.set(0, 0, -1).applyQuaternion(missile.quaternion).multiplyScalar(600);
      }
      const lastSampleTime = samples.at(-1).timeSec;
      if (timeSec > lastSampleTime) {
        const maxExtrapolateS = Number.isFinite(group.removeAt)
          ? Math.min(0.2, Math.max(0, group.removeAt - lastSampleTime))
          : 0.1;
        const extraDt = Math.min(maxExtrapolateS, timeSec - lastSampleTime);
        if (extraDt > 0) {
          missile.position.addScaledVector(missile.velocity, extraDt);
        }
      }
      this.state.missiles.push(missile);
    }
  }

  _updateDecoys(timeSec) {
    this.state.flares.length = 0;
    this.state.chaffClouds.length = 0;
    for (const event of this.events) {
      if (event.timeSec > timeSec + 1e-9) break;
      if (event.kind !== 'decoy_dispense') continue;
      const isChaff = event.decoyType === 'chaff';
      const model = isChaff ? CHAFF_MODEL : FLARE_MODEL;
      const age = timeSec - event.timeSec;
      if (age >= model.lifetimeS) {
        this.decoys.delete(event);
        continue;
      }
      let decoy = this.decoys.get(event);
      if (!decoy) {
        const pos = new THREE.Vector3(event.x, event.y, event.z);
        const vel = new THREE.Vector3(event.vx, event.vy, event.vz);
        decoy = isChaff ? new ChaffCloud(pos, vel) : new Flare(pos, vel);
        this.decoys.set(event, decoy);
      }
      // Evaluate the continuous drag/settling trajectory directly from age so
      // normal playback and seek() produce identical positions at any framerate.
      const tau = model.dragTimeS;
      const expTerm = 1 - Math.exp(-age / tau);
      const terminalY = isChaff ? -CHAFF_MODEL.settlingMps : -FLARE_MODEL.gravityMps2 * tau;
      decoy.age = age;
      decoy.alive = true;
      decoy.position.set(
        event.x + event.vx * tau * expTerm,
        event.y + terminalY * age + (event.vy - terminalY) * tau * expTerm,
        event.z + event.vz * tau * expTerm,
      );
      if (isChaff) {
        decoy.radarCrossSectionM2 = CHAFF_MODEL.peakRcsM2 * (1 - Math.exp(-age / CHAFF_MODEL.buildTimeS))
          * Math.exp(-age / CHAFF_MODEL.decayTimeS);
        this.state.chaffClouds.push(decoy);
      } else {
        decoy.infraredEmission = FLARE_MODEL.peakEmission * (1 - Math.exp(-age / FLARE_MODEL.riseTimeS))
          * Math.exp(-age / FLARE_MODEL.decayTimeS);
        this.state.flares.push(decoy);
      }
    }
  }

  _updateTargets(timeSec) {
    const samples = this.track?.banditSamples || [];
    if (!samples.length) return;
    if (timeSec + 1e-9 < samples[0].timeSec) {
      for (const target of this.targets) target.alive = false;
      return;
    }
    const clamped = clamp(timeSec, samples[0].timeSec, samples.at(-1).timeSec);
    const index = samples.length > 1 ? findSpan(samples, clamped, this._banditHint) : 0;
    this._banditHint = index;
    const a = samples[index];
    const b = samples[index + 1] ?? a;
    const alpha = b.timeSec > a.timeSec ? clamp((clamped - a.timeSec) / (b.timeSec - a.timeSec), 0, 1) : 0;
    this.state.rails = alpha < 0.5 ? (a.rails ?? 0x3f) : (b.rails ?? 0x3f);
    for (let slot = 0; slot < this.targets.length; slot++) {
      const target = this.targets[slot];
      const from = a.targets?.[slot];
      const to = b.targets?.[slot] ?? from;
      if (!from) {
        target.alive = false;
        continue;
      }
      // Bandit samples arrive at 2 Hz, so switching the whole pose at the
      // midpoint reads as hopping. Two live samples describe one continuous
      // orbit, so blend them. A death or respawn between samples is a
      // teleport, not a flight path, and keeps snapping at the midpoint.
      const continuous = from.alive && to.alive;
      const blend = continuous ? alpha : alpha < 0.5 ? 0 : 1;
      const pose = blend < 0.5 ? from : to;
      target.alive = Boolean(pose.alive);
      // Damage is a discrete hit history, never interpolated ahead of a hit.
      // Continuous flight uses the preceding snapshot; a respawn switches
      // damage together with the pose so the new airframe cannot inherit fire.
      const respawned = !from.alive && to.alive && blend === 1;
      const damageSample = respawned || clamped >= b.timeSec ? b : a;
      const damagePose = damageSample.targets?.[slot];
      target.damage = Math.max(0, damagePose?.damage ?? 0);
      target.damageZones = { ...createDamageZones(), ...damagePose?.damageZones };
      if (this.track.version >= 8) {
        for (const event of this.events) {
          if (event.timeSec > timeSec + 1e-9) break;
          if (event.timeSec < damageSample.timeSec || event.targetId !== target.id || !event.damageZones) continue;
          target.damage = event.damage;
          target.damageZones = { ...event.damageZones };
        }
      }
      target.damageState = combatDamageState(target.damage);
      target.position.set(
        continuous ? lerp(from.x, to.x, blend) : pose.x,
        continuous ? lerp(from.y, to.y, blend) : pose.y,
        continuous ? lerp(from.z, to.z, blend) : pose.z,
      );
      const heading = continuous ? shortestAngle(from.headingRad, to.headingRad, alpha) : pose.headingRad;
      target.velocity.set(Math.sin(heading), 0, -Math.cos(heading));
      if (from.quaternion && to.quaternion) {
        target.quaternion ??= new THREE.Quaternion();
        target.quaternion.fromArray(slerp([], from.quaternion, to.quaternion, blend));
      } else target.quaternion = null;
    }
  }
}
