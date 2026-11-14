import * as THREE from 'three';
import { BanditAircraftView } from './BanditAircraftView.js';
import { createMissileMesh } from './missileGeometry.js';
import { ZONE_LOCAL_CENTERS } from '../physics/combatDamage.js';

const FORWARD = new THREE.Vector3(0, 0, -1);
const scratchDirection = new THREE.Vector3();
const scratchOffset = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchEmitPos = new THREE.Vector3();
let smokeTexture = null;

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
  constructor(scene, system) {
    this.scene = scene;
    this.system = system;
    this.targetViews = new Map();
    this.missileViews = new Map();
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
        view = { mesh, aircraft, trail: null, fireTrail: null };
        this.targetViews.set(target.id, view);
      }
      view.mesh.visible = target.alive;
      if (!target.alive) {
        if (view.trail) {
          view.trail.update(dt, null, false);
          if (view.trail.done) {
            view.trail.dispose();
            view.trail = null;
          }
        }
        if (view.fireTrail) {
          view.fireTrail.update(dt, null, false);
          if (view.fireTrail.done) {
            view.fireTrail.dispose();
            view.fireTrail = null;
          }
        }
        continue;
      }
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

    for (let index = this.trails.length - 1; index >= 0; index--) {
      const trail = this.trails[index];
      if (!this.trailsBeingEmitted(trail)) trail.update(dt, null, false);
      if (trail.done) {
        trail.dispose();
        this.trails.splice(index, 1);
      }
    }
  }

  trailsBeingEmitted(trail) {
    // Trails still owned by a live missile are already advanced in the loop above.
    for (const view of this.missileViews.values()) {
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
    for (const trail of this.trails) trail.dispose();
    this.targetViews.clear();
    this.missileViews.clear();
    this.trails.length = 0;
  }
}
