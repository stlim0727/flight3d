import * as THREE from 'three';
import { createEffectAtlas, createFlipbookMaterial, updateFlipbook } from './EffectFlipbook.js';

/**
 * Realistic Aviation Tire Touchdown Smoke & Friction System
 * 
 * Simulates high-energy tire spin-up rubber smoke when airliner tires impact
 * the runway at 130-150 knots, producing expanding, billowing white-grey
 * smoke plumes that trail rearward with the slipstream and wind.
 */
export class TireSmokeSystem {
  constructor(scene, terrain = null) {
    this.scene = scene;
    this.terrain = terrain;

    this.group = new THREE.Group();
    this.group.name = 'TireSmokeSystem';
    this.scene.add(this.group);

    this.particles = [];
    this.activeSpinUpEmitters = [];

    // Realistic soft feathered smoke texture
    this.smokeTexture = createEffectAtlas('tire');

    // Reusable vectors for performance
    this._tempVec = new THREE.Vector3();
  }

  /**
   * Spawns touchdown tire smoke for contacting landing gear bogies
   * @param {Array<{id: string, worldPos: THREE.Vector3, groundSpeed: number, sinkRate: number}>} contacts 
   * @param {THREE.Vector3} linearVelocity 
   */
  spawnTouchdownSmoke(contacts, linearVelocity) {
    if (!contacts || contacts.length === 0) return;

    // Only main landing gear bogies produce high-energy touchdown spin-up rubber smoke (nose gear never smokes)
    const validContacts = contacts.filter(c => c.id !== 'nose');
    if (validContacts.length === 0) return;

    for (const c of validContacts) {
      const pos = c.worldPos;
      const groundSpeed = c.groundSpeed || 70.0;
      if (groundSpeed < 20.0) continue; // Minimum speed threshold for tire spin-up rubber smoke

      const sinkRate = Math.max(0.5, c.sinkRate || 1.5);

      // Authentic, crisp touchdown puff: 8 to 14 particles per main bogie (instantaneous burst)
      const count = Math.min(14, Math.max(8, Math.round(sinkRate * 4 + (groundSpeed / 35.0) * 4)));

      this.emitSmokeBurst(pos, linearVelocity, groundSpeed, count);

      // Brief spin-up trailing scrub (~0.12s)
      if (this.activeSpinUpEmitters.length >= 16) continue;
      this.activeSpinUpEmitters.push({
        worldPos: pos.clone(),
        linearVelocity: linearVelocity.clone(),
        groundSpeed,
        duration: 0.12,
        elapsed: 0.0,
        interval: 0.04,
        timer: 0.0
      });
    }
  }

  /**
   * Emits a burst of smoke particles at a specific contact patch
   */
  emitSmokeBurst(origin, linearVelocity, groundSpeed, count) {
    // Determine horizontal movement direction
    const velNorm = this._tempVec.set(linearVelocity.x, 0, linearVelocity.z);
    if (velNorm.lengthSq() > 0.001) {
      velNorm.normalize();
    } else {
      velNorm.set(1, 0, 0);
    }

    const groundY = this.terrain ? this.terrain.getHeight(origin.x, origin.z) : origin.y;

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= 200) break; // Particle budget cap

      const spriteMat = createFlipbookMaterial(this.smokeTexture, {
        transparent: true,
        opacity: 0.60 + Math.random() * 0.15,
        depthWrite: false
      });

      const sprite = new THREE.Sprite(spriteMat);

      // Spawn at contact point with lateral tire spread
      const lateralSpread = (Math.random() - 0.5) * 1.2;
      const longitudinalSpread = (Math.random() - 0.5) * 0.8;
      const latVec = new THREE.Vector3(-velNorm.z, 0, velNorm.x);

      sprite.position.copy(origin).addScaledVector(latVec, lateralSpread).addScaledVector(velNorm, longitudinalSpread);
      sprite.position.y = groundY + 0.25 + Math.random() * 0.35;

      // Realistic tire smoke dynamics:
      // High-speed backward throw from runway friction into slipstream
      const slipstreamFactor = 0.25 + Math.random() * 0.35;
      const vel = new THREE.Vector3(
        -velNorm.x * groundSpeed * slipstreamFactor + (Math.random() - 0.5) * 3.0,
        1.0 + Math.random() * 2.5, // Upward buoyant billow
        -velNorm.z * groundSpeed * slipstreamFactor + (Math.random() - 0.5) * 3.0
      );

      const baseScale = 0.9 + Math.random() * 0.5;
      sprite.scale.set(baseScale, baseScale, 1.0);

      this.group.add(sprite);
      this.particles.push({
        sprite,
        vel,
        scale: baseScale,
        growth: 2.2 + Math.random() * 2.0,
        life: 0.0,
        maxLife: 1.1 + Math.random() * 0.3,
        baseOpacity: 0.65
      });
    }
  }

  /**
   * Spawns lighter smoke puffs for heavy anti-skid wheel braking on runway
   */
  spawnBrakingSmoke(contacts, linearVelocity, brakeIntensity) {
    if (!contacts || brakeIntensity < 0.6) return;
    const groundSpeed = Math.hypot(linearVelocity.x, linearVelocity.z);
    if (groundSpeed < 5.0) return; // Parked wheels cannot produce braking smoke.
    if (Math.random() > 0.4) return; // Stagger braking emission

    for (const c of contacts) {
      if (c.id === 'nose' || !c.isGrounded) continue; // Only loaded main wheels can brake.
      this.emitSmokeBurst(c.worldPos, linearVelocity, groundSpeed, 3);
    }
  }

  update(dt) {
    // 1. Process active spin-up emitters
    for (let i = this.activeSpinUpEmitters.length - 1; i >= 0; i--) {
      const em = this.activeSpinUpEmitters[i];
      em.elapsed += dt;
      em.timer += dt;

      if (em.elapsed >= em.duration) {
        this.activeSpinUpEmitters.splice(i, 1);
      } else if (em.timer >= em.interval) {
        em.timer = 0;
        this.emitSmokeBurst(em.worldPos, em.linearVelocity, em.groundSpeed * (1.0 - em.elapsed / em.duration), 3);
      }
    }

    // 2. Update active smoke particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      updateFlipbook(p);
      const t = p.life / p.maxLife;

      if (t >= 1.0) {
        this.group.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
      } else {
        // Drag deceleration
        p.vel.x *= Math.max(0.0, 1.0 - dt * 1.8);
        p.vel.z *= Math.max(0.0, 1.0 - dt * 1.8);
        // Buoyancy lift decreases over time
        p.vel.y = Math.max(0.4, p.vel.y - dt * 0.8);

        p.sprite.position.addScaledVector(p.vel, dt);

        // Keep smoke rolling above ground
        const groundY = this.terrain ? this.terrain.getHeight(p.sprite.position.x, p.sprite.position.z) : 0.0;
        if (p.sprite.position.y < groundY + 0.2) {
          p.sprite.position.y = groundY + 0.2;
          p.vel.y = Math.abs(p.vel.y) * 0.3; // Gentle surface deflection
        }

        // Expansion: smoke billows outward
        p.scale += p.growth * dt;
        p.sprite.scale.set(p.scale, p.scale, 1.0);

        // Smooth non-linear opacity fade
        p.sprite.material.opacity = p.baseOpacity * Math.max(0.0, (1.0 - t * t));
      }
    }
  }

  dispose() {
    this.clear();
    for (const texture of [this.smokeTexture]) texture.dispose();
    this.scene.remove(this.group);
  }

  clear() {
    for (const p of this.particles) {
      this.group.remove(p.sprite);
      p.sprite.material.dispose();
    }
    this.particles = [];
    this.activeSpinUpEmitters = [];
  }
}
