import * as THREE from 'three';
import { BanditAircraftView } from './BanditAircraftView.js';
import { createMissileMesh } from './missileGeometry.js';
import { ZONE_LOCAL_CENTERS } from '../physics/combatDamage.js';

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const scratchDirection = new THREE.Vector3();
const scratchOffset = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchEmitPos = new THREE.Vector3();
const scratchVelocity = new THREE.Vector3();

// A destroyed bandit keeps flying as a burning wreck instead of blinking out.
// Its launch velocity is the airframe's measured frame-to-frame motion, so the
// fall continues the last visible trajectory; these are presentation values.
const WRECK_GRAVITY_MPS2 = 9.81;
const WRECK_DRAG_TIME_S = 8;
const WRECK_SPIN_RAD_PER_S = 2.6;
const WRECK_MAX_AGE_S = 20;
const WRECK_GROUND_CLEARANCE_M = 2;
let smokeTexture = null;
let flareTexture = null;

function mostDamagedZone(damageZones) {
  if (!damageZones) return null;
  let bestZone = null;
  let bestValue = 0;
  for (const [zone, value] of Object.entries(damageZones)) {
    if (value > bestValue && ZONE_LOCAL_CENTERS[zone]) {
      bestValue = value;
      bestZone = zone;
    }
  }
  return bestZone;
}

function zoneEmitWorldPosition(target, zone, out) {
  const local = zone ? ZONE_LOCAL_CENTERS[zone] : null;
  if (!local) return out.copy(target.position);
  scratchOffset.set(local.x, local.y, local.z);
  if (target.quaternion) {
    scratchOffset.applyQuaternion(target.quaternion);
  } else if (target.velocity?.lengthSq() > 1) {
    scratchDirection.copy(target.velocity).normalize();
    scratchQuat.setFromUnitVectors(FORWARD, scratchDirection);
    scratchOffset.applyQuaternion(scratchQuat);
  }
  return out.copy(target.position).add(scratchOffset);
}

/** Soft circular puff: PointsMaterial without a map renders hard squares. */
function smokeMap() {
  if (smokeTexture || typeof document === 'undefined') return smokeTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.45, 'rgba(236,236,236,0.45)');
  gradient.addColorStop(1, 'rgba(220,220,220,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  smokeTexture = new THREE.CanvasTexture(canvas);
  smokeTexture.needsUpdate = true;
  return smokeTexture;
}

/** Warm additive glow sprite map for ejected IR flares. */
function flareMap() {
  if (flareTexture || typeof document === 'undefined') return flareTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,245,1)');
  gradient.addColorStop(0.25, 'rgba(255,195,90,0.92)');
  gradient.addColorStop(0.6, 'rgba(255,110,20,0.38)');
  gradient.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  flareTexture = new THREE.CanvasTexture(canvas);
  flareTexture.needsUpdate = true;
  return flareTexture;
}

function createChaffCloudPoints() {
  const count = 14;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const radius = 0.6 + (i % 3) * 0.45;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = ((i % 5) - 2) * 0.25;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xd8e0ea,
    map: smokeMap(),
    size: 2.8,
    transparent: true,
    opacity: 0.65,
    alphaTest: 0.02,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'ChaffCloud';
  return points;
}

/** Materials are shared; only the per-model geometry is owned by a view. */
function disposeGeometry(object) {
  object.traverse(node => {
    if (node.isMesh) node.geometry?.dispose();
  });
}

/** Bounded white smoke trail behind a boosted missile. */
class SmokeTrail {
  constructor(scene, { max = 96, size = 4.2, color = 0xf2f2f2, opacity = 0.5 } = {}) {
    this.max = max;
    this.opacity = opacity;
    this.positions = new Float32Array(this.max * 3);
    this.geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(this.positions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', attribute);
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.PointsMaterial({
      color,
      map: smokeMap(),
      size,
      transparent: true,
      opacity,
      alphaTest: 0.02,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'MissileSmokeTrail';
    scene.add(this.points);
    this.scene = scene;
    this.count = 0;
    this.emitTimer = 0;
    this.fade = 0;
    this.done = false;
  }

  emit(position) {
    if (this.count >= this.max) {
      this.positions.copyWithin(0, 3);
      this.count = this.max - 1;
    }
    const offset = this.count * 3;
    this.positions[offset] = position.x;
    this.positions[offset + 1] = position.y;
    this.positions[offset + 2] = position.z;
    this.count++;
    this.geometry.setDrawRange(0, this.count);
    this.geometry.attributes.position.needsUpdate = true;
  }

  update(dt, position, emitting) {
    if (emitting) {
      this.emitTimer -= dt;
      if (this.emitTimer <= 0) {
        this.emit(position);
        this.emitTimer = 0.028;
      }
    } else {
      this.fade += dt;
      this.material.opacity = Math.max(0, this.opacity * (1 - this.fade / 2.2));
      if (this.fade > 2.2) this.done = true;
    }
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Scene-side mirror of the pure combat state: bandit airframes, released
 * missiles, smoke trails and explosion handoff. No gameplay state lives here.
 */
export class MissileCombatView {
  /**
   * @param {object} [options]
   * @param {(x:number, z:number)=>number} [options.terrainHeight] ground under the
   *   wreck; a wreck ends on impact, and without it the wreck ends at sea level.
   */
  constructor(scene, system, { terrainHeight = null } = {}) {
    this.scene = scene;
    this.system = system;
    this.terrainHeight = terrainHeight;
    this.targetViews = new Map();
    this.missileViews = new Map();
    this.flareViews = new Map();
    this.chaffViews = new Map();
    this.trails = [];
  }

  sync(dt) {
    const liveTargets = new Set();
    for (const target of this.system.targets) {
      liveTargets.add(target.id);
      let view = this.targetViews.get(target.id);
      if (!view) {
        const aircraft = new BanditAircraftView(target.callsign);
        const mesh = aircraft.mesh;
        this.scene.add(mesh);
        view = { mesh, aircraft, trail: null, fireTrail: null,
          lastPosition: null, velocity: new THREE.Vector3(), wreck: null };
        this.targetViews.set(target.id, view);
      }
      if (!target.alive) {
        this._syncWreck(view, target, dt);
        continue;
      }
      // A respawn (or a replay seek back before the kill) restores the airframe.
      view.wreck = null;
      view.mesh.visible = true;
      view.aircraft.update(dt, target.flight);
      view.mesh.position.copy(target.position);
      if (target.quaternion) {
        view.mesh.quaternion.copy(target.quaternion);
      } else if (target.velocity.lengthSq() > 1) {
        scratchDirection.copy(target.velocity).normalize();
        view.mesh.quaternion.setFromUnitVectors(FORWARD, scratchDirection);
      }
      // A damaged drone bleeds dark smoke (and fire on heavy/engine damage)
      // from its most damaged zone until it is destroyed.
      if (target.damage > 0.12) {
        const zone = mostDamagedZone(target.damageZones);
        const emitPos = zoneEmitWorldPosition(target, zone, scratchEmitPos);
        if (!view.trail) {
          view.trail = new SmokeTrail(this.scene, {
            max: 72, size: 3.0 + target.damage * 1.4, color: 0x3f3f3f, opacity: 0.48,
          });
        }
        view.trail.update(dt, emitPos, true);
        const onFire = target.damage > 0.55 || (target.damageZones?.engine ?? 0) > 0.45 || (target.damageZones?.fuselage ?? 0) > 0.55;
        if (onFire) {
          if (!view.fireTrail) {
            view.fireTrail = new SmokeTrail(this.scene, {
              max: 48, size: 2.4, color: 0xff7722, opacity: 0.78, life: 0.65,
            });
          }
          view.fireTrail.update(dt, emitPos, true);
        } else if (view.fireTrail) {
          view.fireTrail.update(dt, null, false);
        }
      } else {
        if (view.trail) {
          view.trail.update(dt, null, false);
          if (view.trail.done) { view.trail.dispose(); view.trail = null; }
        }
        if (view.fireTrail) {
          view.fireTrail.update(dt, null, false);
          if (view.fireTrail.done) { view.fireTrail.dispose(); view.fireTrail = null; }
        }
      }
      this._observeMotion(view, target, dt);
    }
    for (const [id, view] of this.targetViews) {
      if (liveTargets.has(id)) continue;
      this.scene.remove(view.mesh);
      view.aircraft.dispose();
      view.trail?.dispose();
      view.fireTrail?.dispose();
      this.targetViews.delete(id);
    }

    const liveMissiles = new Set();
    for (const missile of this.system.missiles) {
      if (!missile.alive) continue;
      liveMissiles.add(missile.id);
      let view = this.missileViews.get(missile.id);
      if (!view) {
        const mesh = createMissileMesh(missile.typeId);
        this.scene.add(mesh);
        const trail = new SmokeTrail(this.scene);
        this.trails.push(trail);
        view = { mesh, trail };
        this.missileViews.set(missile.id, view);
      }
      view.mesh.position.copy(missile.position);
      view.mesh.quaternion.copy(missile.quaternion);
      view.trail.update(dt, missile.position, missile.propellant > 0);
    }
    for (const [id, view] of this.missileViews) {
      if (liveMissiles.has(id)) continue;
      this.scene.remove(view.mesh);
      disposeGeometry(view.mesh);
      this.missileViews.delete(id);
    }

    this._syncFlares(dt);
    this._syncChaff(dt);

    for (let index = this.trails.length - 1; index >= 0; index--) {
      const trail = this.trails[index];
      if (!this.trailsBeingEmitted(trail)) trail.update(dt, null, false);
      if (trail.done) {
        trail.dispose();
        this.trails.splice(index, 1);
      }
    }
  }

  /** Frame-to-frame airframe motion: the wreck inherits the last visible velocity. */
  _observeMotion(view, target, dt) {
    if (!view.lastPosition) {
      view.lastPosition = target.position.clone();
      return;
    }
    if (dt > 1e-4) {
      scratchVelocity.subVectors(target.position, view.lastPosition).divideScalar(dt);
      const speed = scratchVelocity.length();
      // Replay seeks and respawns teleport; only flap-free flight speed is motion.
      if (speed > 1 && speed < 1200) view.velocity.copy(scratchVelocity);
    }
    view.lastPosition.copy(target.position);
  }

  /**
   * A killed bandit keeps its airframe: it tumbles, drags, falls and burns until
   * it hits the ground, so a kill reads as a downing instead of a deletion. Only
   * a target observed alive can become a wreck; a seek that lands after the kill
   * has no motion history and stays hidden.
   */
  _syncWreck(view, target, dt) {
    if (!view.wreck) {
      if (!view.lastPosition || view.velocity.lengthSq() < 1) {
        this._fadeWreckTrails(view, dt, true);
        return;
      }
      const heading = view.velocity.clone().normalize();
      const axis = new THREE.Vector3().crossVectors(UP, heading);
      if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0); else axis.normalize();
      view.wreck = { age: 0, velocity: view.velocity.clone(), axis };
      view.mesh.position.copy(target.position);
      view.lastPosition = null;
    }
    view.mesh.visible = true;
    if (dt <= 0) return;
    const wreck = view.wreck;
    wreck.age += dt;
    wreck.velocity.y -= WRECK_GRAVITY_MPS2 * dt;
    wreck.velocity.multiplyScalar(Math.exp(-dt / WRECK_DRAG_TIME_S));
    view.mesh.position.addScaledVector(wreck.velocity, dt);
    scratchQuat.setFromAxisAngle(wreck.axis, WRECK_SPIN_RAD_PER_S * dt);
    view.mesh.quaternion.multiply(scratchQuat);
    if (!view.fireTrail) {
      view.fireTrail = new SmokeTrail(this.scene, { max: 64, size: 4.2, color: 0xff7722, opacity: 0.85 });
    }
    view.fireTrail.update(dt, view.mesh.position, true);
    if (!view.trail) {
      view.trail = new SmokeTrail(this.scene, { max: 96, size: 7, color: 0x242424, opacity: 0.62 });
    }
    view.trail.update(dt, view.mesh.position, true);
    const ground = this.terrainHeight?.(view.mesh.position.x, view.mesh.position.z) ?? 0;
    if (view.mesh.position.y <= ground + WRECK_GROUND_CLEARANCE_M || wreck.age >= WRECK_MAX_AGE_S) {
      view.wreck = null;
      view.lastPosition = null;
      this._fadeWreckTrails(view, dt, true);
    }
  }

  /** Fade a wreck's smoke after impact, or the damage trail of a dead target. */
  _fadeWreckTrails(view, dt, hide) {
    if (hide) view.mesh.visible = false;
    for (const key of ['trail', 'fireTrail']) {
      const trail = view[key];
      if (!trail) continue;
      trail.update(dt, null, false);
      if (!trail.done) continue;
      trail.dispose();
      view[key] = null;
    }
  }

  _syncFlares(dt) {
    const liveFlares = new Set();
    for (const flare of this.system.flares || []) {
      if (!flare.alive) continue;
      liveFlares.add(flare.id);
      let view = this.flareViews.get(flare.id);
      if (!view) {
        const material = new THREE.SpriteMaterial({
          map: flareMap(),
          color: 0xffd27d,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.name = 'CountermeasureFlare';
        this.scene.add(sprite);
        const trail = new SmokeTrail(this.scene, {
          max: 40, size: 3.5, color: 0xffe8c2, opacity: 0.55,
        });
        this.trails.push(trail);
        view = { sprite, trail };
        this.flareViews.set(flare.id, view);
      }
      const glow = Math.max(0.25, Math.min(1.2, (flare.infraredEmission ?? 4) / 5));
      const scale = 12 + glow * 10;
      view.sprite.position.copy(flare.position);
      view.sprite.scale.set(scale, scale, 1);
      view.sprite.material.opacity = Math.min(1, 0.55 + glow * 0.45);
      view.trail.update(dt, flare.position, true);
    }
    for (const [id, view] of this.flareViews) {
      if (liveFlares.has(id)) continue;
      this.scene.remove(view.sprite);
      view.sprite.material.dispose();
      this.flareViews.delete(id);
    }
  }

  _syncChaff(dt) {
    const liveChaff = new Set();
    for (const cloud of this.system.chaffClouds || []) {
      if (!cloud.alive) continue;
      liveChaff.add(cloud.id);
      let view = this.chaffViews.get(cloud.id);
      if (!view) {
        const points = createChaffCloudPoints();
        this.scene.add(points);
        view = { points };
        this.chaffViews.set(cloud.id, view);
      }
      const age = cloud.age ?? 0;
      const spread = 1.6 + Math.min(5.0, age * 0.65);
      const fade = Math.max(0, 1 - age / 12);
      view.points.position.copy(cloud.position);
      view.points.scale.setScalar(spread);
      view.points.material.opacity = 0.78 * fade;
    }
    for (const [id, view] of this.chaffViews) {
      if (liveChaff.has(id)) continue;
      this.scene.remove(view.points);
      view.points.geometry.dispose();
      view.points.material.dispose();
      this.chaffViews.delete(id);
    }
  }

  trailsBeingEmitted(trail) {
    // Trails still owned by a live missile or flare are already advanced in sync().
    for (const view of this.missileViews.values()) {
      if (view.trail === trail) return true;
    }
    for (const view of this.flareViews.values()) {
      if (view.trail === trail) return true;
    }
    return false;
  }

  spawnExplosion(explosionSystem, event) {
    if (!explosionSystem || !event?.position) return;
    const velocity = event.velocity || new THREE.Vector3();
    const isKill = Boolean(event.target);
    explosionSystem.spawnExplosion({
      point: event.position,
      type: 'AIR',
      name: 'MISSILE DETONATION',
      speedKnots: velocity.length() * 1.94384,
    }, velocity, {
      exaggerated: isKill,
      intensity: isKill ? 1.5 : 1.1,
    });
  }

  clear() {
    for (const view of this.targetViews.values()) {
      this.scene.remove(view.mesh);
      view.aircraft.dispose();
      view.trail?.dispose();
      view.fireTrail?.dispose();
    }
    for (const view of this.missileViews.values()) {
      this.scene.remove(view.mesh);
      disposeGeometry(view.mesh);
    }
    for (const view of this.flareViews.values()) {
      this.scene.remove(view.sprite);
      view.sprite.material.dispose();
    }
    for (const view of this.chaffViews.values()) {
      this.scene.remove(view.points);
      view.points.geometry.dispose();
      view.points.material.dispose();
    }
    for (const trail of this.trails) trail.dispose();
    this.targetViews.clear();
    this.missileViews.clear();
    this.flareViews.clear();
    this.chaffViews.clear();
    this.trails.length = 0;
  }
}
