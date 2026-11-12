import * as THREE from 'three';
import { MissileCombatView } from '../weapons/MissileCombatView.js';
import { F16_MISSILE_STATIONS, MISSILE_TYPES } from '../weapons/missileSpecs.js';
import { findSpan } from './TrackSampler.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
    this.state = { targets: [], missiles: [], rails: 0x3f };
    this.view = new MissileCombatView(sim.scene, this.state);
    this.targets = [];
    this.groups = new Map();
    this.missiles = new Map();
    this.events = [];
    this.staged = new Set();
    this._banditHint = 0;
  }

  load(combat) {
    this.stop();
    if (!combat || !Array.isArray(combat.targets)) return false;
    this.track = combat;
    this.targets = combat.targets.map((target, index) => ({
      id: index,
      callsign: target.callsign || `TARGET ${index + 1}`,
      alive: true,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(0, 0, -1),
    }));
    this.state.targets = this.targets;
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
    this.staged.clear();
    return true;
  }

  /** Pose-only seek: rebuild the visible set and suppress explosions already in the past. */
  seek(timeSec) {
    if (!this.active) return;
    this.timeSec = timeSec;
    this._banditHint = 0;
    for (const group of this.groups.values()) group.hint = 0;
    this.staged = new Set(this.events.filter(event => event.timeSec <= timeSec + 1e-9));
    this.view.clear();
    this._updateState(timeSec);
    this.view.sync(0);
  }

  update(dt, timeSec) {
    if (!this.active) return;
    if (timeSec < this.timeSec - 1e-9) {
      this.staged.clear();
      this.view.clear();
      this._banditHint = 0;
      for (const group of this.groups.values()) group.hint = 0;
    }
    this.timeSec = timeSec;
    this._updateState(timeSec);
    this.view.sync(dt);
    for (const event of this.events) {
      if (event.timeSec > timeSec + 1e-9) break;
      if (this.staged.has(event)) continue;
      this.staged.add(event);
      if (event.kind === 'detonation') {
        this.view.spawnExplosion(this.sim.explosionSystem, {
          position: new THREE.Vector3(event.x, event.y, event.z),
          velocity: new THREE.Vector3(event.vx, event.vy, event.vz),
        });
      }
    }
  }

  stop() {
    this.view.clear();
    this.track = null;
    this.active = false;
    this.timeSec = 0;
    this.targets.length = 0;
    this.state.targets.length = 0;
    this.state.missiles.length = 0;
    this.state.rails = 0x3f;
    this.groups.clear();
    this.missiles.clear();
    this.events.length = 0;
    this.staged.clear();
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
      splash: this.events.filter(event => event.kind === 'detonation' && !event.surface
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
    this.state.missiles.length = 0;
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
      let missile = this.missiles.get(id);
      if (!missile) {
        missile = {
          id, typeId: group.typeId, alive: true,
          position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
          propellant: 0,
        };
        this.missiles.set(id, missile);
      }
      missile.typeId = group.typeId;
      missile.alive = true;
      missile.position.set(
        a.x + (b.x - a.x) * alpha,
        a.y + (b.y - a.y) * alpha,
        a.z + (b.z - a.z) * alpha,
      );
      const quat = slerp([0, 0, 0, 1], a.quat, b.quat, alpha);
      missile.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
      missile.propellant = a.powered ? 1 : 0;
      this.state.missiles.push(missile);
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
      const blend = from.alive && to.alive ? alpha : alpha < 0.5 ? 0 : 1;
      const pose = blend < 0.5 ? from : to;
      target.alive = Boolean(pose.alive);
      target.position.set(pose.x, pose.y, pose.z);
      const heading = from.alive && to.alive ? shortestAngle(from.headingRad, to.headingRad, alpha) : pose.headingRad;
      target.velocity.set(Math.sin(heading), 0, -Math.cos(heading));
    }
  }
}
