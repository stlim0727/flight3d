import * as THREE from 'three';
import { createEffectAtlas, createFlipbookMaterial, updateFlipbook } from './EffectFlipbook.js';

/**
 * Cinematic High-Fidelity Explosion & Crash Effects System
 * Generates multi-stage explosions featuring:
 * 1. Expanding incandescent fireball core & point light flash
 * 2. Billowing buoyant black smoke plumes rising into the sky
 * 3. High-velocity ballistic burning metal shrapnel and spark debris
 * 4. Ground/water shockwave expansion ring
 * 5. Massive water geyser & white foam plumes upon ocean impact
 * 6. Persistent fuselage fire & smoke at crash wreckage
 */
export class ExplosionSystem {
  constructor(scene, terrain = null) {
    this.scene = scene;
    this.terrain = terrain;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Active particle systems
    this.fireballs = [];
    this.smokePuffs = [];
    this.debrisParticles = [];
    this.waterPlumes = [];
    this.shockwaves = [];
    this.persistentWreckage = null;

    // Point lights for dynamic illumination
    this.lightPool = [];
    this.initLightPool();

    // Procedural Particle Textures
    this.fireTexture = createEffectAtlas('fire');
    this.smokeTexture = createEffectAtlas('smoke');
    this.waterTexture = createEffectAtlas('water');
    this.sparkTexture = this.createSparkTexture();
  }

  createSparkTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0.0, 'rgba(255, 255, 200, 1.0)');
    grad.addColorStop(0.4, 'rgba(255, 160, 40, 0.9)');
    grad.addColorStop(1.0, 'rgba(255, 50, 0, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  initLightPool() {
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xff8822, 0.0, 140, 1.5);
      light.visible = false;
      this.group.add(light);
      this.lightPool.push({ light, life: 0, maxLife: 1.0 });
    }
  }

  getAvailableLight() {
    for (const item of this.lightPool) {
      if (!item.light.visible) return item;
    }
    return this.lightPool[0];
  }

  /**
   * Spawns an explosion at the given collision result
   */
  spawnExplosion(crashResult) {
    const pos = crashResult.point || new THREE.Vector3();
    const isWater = crashResult.type === 'WATER';

    // 1. Incandescent Flash Light
    const flash = this.getAvailableLight();
    flash.light.position.copy(pos);
    flash.light.position.y += 3.0;
    flash.light.color.set(isWater ? 0x99ccff : 0xffaa33);
    flash.light.intensity = isWater ? 20.0 : 40.0;
    flash.light.distance = 180;
    flash.light.visible = true;
    flash.life = 0.0;
    flash.maxLife = 1.4;

    // 2. Shockwave Ring on Ground or Water
    this.spawnShockwave(pos, isWater);

    // 3. Fireball Core
    const fireballCount = isWater ? 25 : 60;
    this.spawnFireballCore(pos, fireballCount, isWater);

    // 4. Rising Smoke Plume
    const smokeCount = isWater ? 40 : 85;
    this.spawnSmokePlume(pos, smokeCount, isWater);

    // 5. High-Velocity Sparks & Shrapnel
    this.spawnShrapnel(pos, isWater ? 30 : 70, isWater);

    // 6. Water Plumes (If crashing into ocean)
    if (isWater) {
      this.spawnWaterGeyser(pos, 90);
    }

    // 7. Attach persistent wreckage fire to impact site
    this.persistentWreckage = {
      pos: pos.clone(),
      isWater,
      timer: 0,
      smokeInterval: 0.12,
      duration: 25.0 // lasts 25 seconds
    };
  }

  spawnShockwave(pos, isWater) {
    if (this.shockwaves.length >= 4) return;
    const geo = new THREE.RingGeometry(1.0, 2.5, 32);
    geo.rotateX(-Math.PI * 0.5);

    const mat = new THREE.MeshBasicMaterial({
      color: isWater ? 0xd0f0fd : 0xffddaa,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.position.y += 0.25;

    this.group.add(mesh);
    this.shockwaves.push({
      mesh,
      scale: 1.0,
      maxScale: isWater ? 75.0 : 55.0,
      opacity: 0.85,
      life: 0.0,
      maxLife: 1.0
    });
  }

  spawnFireballCore(pos, count, isWater) {
    for (let i = 0; i < count && this.fireballs.length < 60; i++) {
      const spriteMat = createFlipbookMaterial(isWater ? this.waterTexture : this.fireTexture, {
        transparent: true,
        opacity: 0.95,
        blending: isWater ? THREE.NormalBlending : THREE.AdditiveBlending,
        depthWrite: false
      });

      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.copy(pos);

      // Random spherical velocity
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI * 0.65; // Bias upwards
      const speed = 12.0 + Math.random() * 32.0;

      const vel = new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi) * speed,
        Math.cos(theta) * speed * 1.2 + 4.0,
        Math.sin(theta) * Math.sin(phi) * speed
      );

      const baseScale = 4.5 + Math.random() * 6.5;
      sprite.scale.set(baseScale, baseScale, 1.0);

      this.group.add(sprite);
      this.fireballs.push({
        sprite,
        vel,
        scale: baseScale,
        growth: 12.0 + Math.random() * 16.0,
        life: 0.0,
        maxLife: 0.9 + Math.random() * 0.7,
        isWater
      });
    }
  }

  spawnSmokePlume(pos, count, isWater) {
    for (let i = 0; i < count && this.smokePuffs.length < 120; i++) {
      const spriteMat = createFlipbookMaterial(this.smokeTexture, {
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });

      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.copy(pos).add(new THREE.Vector3(
        (Math.random() - 0.5) * 8.0,
        Math.random() * 3.0,
        (Math.random() - 0.5) * 8.0
      ));

      // Buoyant rising velocity
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 6.0,
        4.5 + Math.random() * 9.5,
        (Math.random() - 0.5) * 6.0
      );

      const baseScale = 6.0 + Math.random() * 8.0;
      sprite.scale.set(baseScale, baseScale, 1.0);

      this.group.add(sprite);
      this.smokePuffs.push({
        sprite,
        vel,
        scale: baseScale,
        growth: 4.5 + Math.random() * 6.0,
        life: 0.0,
        maxLife: 5.5 + Math.random() * 4.5
      });
    }
  }

  spawnShrapnel(pos, count, isWater) {
    for (let i = 0; i < count && this.debrisParticles.length < 70; i++) {
      const spriteMat = new THREE.SpriteMaterial({
        map: this.sparkTexture,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.copy(pos);

      // Explosive outward cone
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI * 0.45;
      const speed = 25.0 + Math.random() * 55.0;

      const vel = new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi) * speed,
        Math.cos(theta) * speed * 1.4,
        Math.sin(theta) * Math.sin(phi) * speed
      );

      const baseScale = 0.8 + Math.random() * 1.4;
      sprite.scale.set(baseScale, baseScale, 1.0);

      this.group.add(sprite);
      this.debrisParticles.push({
        sprite,
        vel,
        scale: baseScale,
        life: 0.0,
        maxLife: 2.5 + Math.random() * 2.0
      });
    }
  }

  spawnWaterGeyser(pos, count) {
    for (let i = 0; i < count && this.waterPlumes.length < 90; i++) {
      const spriteMat = createFlipbookMaterial(this.waterTexture, {
        transparent: true,
        opacity: 0.9,
        blending: THREE.NormalBlending,
        depthWrite: false
      });

      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.copy(pos).add(new THREE.Vector3(
        (Math.random() - 0.5) * 12.0,
        0.5,
        (Math.random() - 0.5) * 12.0
      ));

      // Upward geyser fountain
      const angle = Math.random() * Math.PI * 2;
      const radialSpeed = 2.0 + Math.random() * 12.0;
      const upSpeed = 20.0 + Math.random() * 40.0;

      const vel = new THREE.Vector3(
        Math.cos(angle) * radialSpeed,
        upSpeed,
        Math.sin(angle) * radialSpeed
      );

      const baseScale = 3.5 + Math.random() * 6.0;
      sprite.scale.set(baseScale, baseScale, 1.0);

      this.group.add(sprite);
      this.waterPlumes.push({
        sprite,
        vel,
        scale: baseScale,
        growth: 6.0 + Math.random() * 8.0,
        life: 0.0,
        maxLife: 2.2 + Math.random() * 1.5
      });
    }
  }

  update(dt) {
    // 1. Update point lights
    for (const item of this.lightPool) {
      if (item.light.visible) {
        item.life += dt;
        const progress = item.life / item.maxLife;
        if (progress >= 1.0) {
          item.light.visible = false;
        } else {
          // Rapid decay
          item.light.intensity *= Math.max(0.0, 1.0 - dt * 3.2);
        }
      }
    }

    // 2. Update shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life += dt;
      const t = s.life / s.maxLife;
      if (t >= 1.0) {
        this.group.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this.shockwaves.splice(i, 1);
      } else {
        const curScale = 1.0 + (s.maxScale - 1.0) * Math.sin(t * Math.PI * 0.5);
        s.mesh.scale.set(curScale, curScale, curScale);
        s.mesh.material.opacity = s.opacity * (1.0 - t * t);
      }
    }

    // 3. Update fireballs
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.life += dt;
      updateFlipbook(f);
      const t = f.life / f.maxLife;
      if (t >= 1.0) {
        this.group.remove(f.sprite);
        f.sprite.material.dispose();
        this.fireballs.splice(i, 1);
      } else {
        f.sprite.position.addScaledVector(f.vel, dt);
        f.vel.multiplyScalar(Math.max(0.0, 1.0 - dt * 1.8)); // Air drag
        f.scale += f.growth * dt;
        f.sprite.scale.set(f.scale, f.scale, 1.0);
        f.sprite.material.opacity = Math.max(0.0, (1.0 - t) * 0.95);
      }
    }

    // 4. Update smoke puffs
    for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
      const s = this.smokePuffs[i];
      s.life += dt;
      updateFlipbook(s);
      const t = s.life / s.maxLife;
      if (t >= 1.0) {
        this.group.remove(s.sprite);
        s.sprite.material.dispose();
        this.smokePuffs.splice(i, 1);
      } else {
        s.sprite.position.addScaledVector(s.vel, dt);
        s.vel.x += dt * 0.8; // Atmospheric wind drift
        s.vel.y = Math.max(1.5, s.vel.y - dt * 0.5); // Rising buoyancy
        s.scale += s.growth * dt;
        s.sprite.scale.set(s.scale, s.scale, 1.0);
        s.sprite.material.opacity = Math.max(0.0, (1.0 - t * 0.9) * 0.75);
      }
    }

    // 5. Update debris & shrapnel with ballistic gravity
    for (let i = this.debrisParticles.length - 1; i >= 0; i--) {
      const d = this.debrisParticles[i];
      d.life += dt;
      const t = d.life / d.maxLife;
      if (t >= 1.0) {
        this.group.remove(d.sprite);
        d.sprite.material.dispose();
        this.debrisParticles.splice(i, 1);
      } else {
        // Gravity
        d.vel.y -= 9.8 * dt;
        d.sprite.position.addScaledVector(d.vel, dt);

        // Ground bounce collision
        const groundY = this.terrain ? this.terrain.getHeight(d.sprite.position.x, d.sprite.position.z) : 0.0;
        if (d.sprite.position.y < groundY + 0.2) {
          d.sprite.position.y = groundY + 0.2;
          d.vel.y = -d.vel.y * 0.35; // Bounce
          d.vel.x *= 0.65;
          d.vel.z *= 0.65;
        }

        d.sprite.material.opacity = Math.max(0.0, 1.0 - t);
      }
    }

    // 6. Update water plumes
    for (let i = this.waterPlumes.length - 1; i >= 0; i--) {
      const w = this.waterPlumes[i];
      w.life += dt;
      updateFlipbook(w);
      const t = w.life / w.maxLife;
      if (t >= 1.0) {
        this.group.remove(w.sprite);
        w.sprite.material.dispose();
        this.waterPlumes.splice(i, 1);
      } else {
        w.vel.y -= 12.0 * dt; // Gravity
        w.sprite.position.addScaledVector(w.vel, dt);
        w.scale += w.growth * dt;
        w.sprite.scale.set(w.scale, w.scale, 1.0);
        w.sprite.material.opacity = Math.max(0.0, (1.0 - t) * 0.9);
      }
    }

    // 7. Persistent wreckage smoke emission
    if (this.persistentWreckage) {
      this.persistentWreckage.timer += dt;
      if (this.persistentWreckage.timer < this.persistentWreckage.duration) {
        this.persistentWreckage.smokeInterval -= dt;
        if (this.persistentWreckage.smokeInterval <= 0) {
          this.persistentWreckage.smokeInterval = 0.25;
          this.spawnWreckageSmoke(this.persistentWreckage.pos);
        }
      }
    }
  }

  spawnWreckageSmoke(pos) {
    if (this.smokePuffs.length >= 120) return; // Particle budget cap
    const spriteMat = createFlipbookMaterial(this.smokeTexture, {
      transparent: true,
      opacity: 0.75,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.copy(pos).add(new THREE.Vector3(
      (Math.random() - 0.5) * 3.5,
      1.5,
      (Math.random() - 0.5) * 3.5
    ));

    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 2.0 + 1.2, // Wind drift
      3.0 + Math.random() * 4.0,
      (Math.random() - 0.5) * 2.0
    );

    const baseScale = 4.0 + Math.random() * 4.0;
    sprite.scale.set(baseScale, baseScale, 1.0);

    this.group.add(sprite);
    this.smokePuffs.push({
      sprite,
      vel,
      scale: baseScale,
      growth: 3.5,
      life: 0.0,
      maxLife: 4.5
    });
  }

  /**
   * Resets and clears all explosion particles and wreckage
   */
  dispose() {
    this.clear();
    for (const texture of [this.fireTexture, this.smokeTexture, this.waterTexture, this.sparkTexture]) texture.dispose();
    this.scene.remove(this.group);
  }

  clear() {
    for (const f of this.fireballs) {
      this.group.remove(f.sprite);
      f.sprite.material.dispose();
    }
    this.fireballs = [];

    for (const s of this.smokePuffs) {
      this.group.remove(s.sprite);
      s.sprite.material.dispose();
    }
    this.smokePuffs = [];

    for (const d of this.debrisParticles) {
      this.group.remove(d.sprite);
      d.sprite.material.dispose();
    }
    this.debrisParticles = [];

    for (const w of this.waterPlumes) {
      this.group.remove(w.sprite);
      w.sprite.material.dispose();
    }
    this.waterPlumes = [];

    for (const sw of this.shockwaves) {
      this.group.remove(sw.mesh);
      sw.mesh.geometry.dispose();
      sw.mesh.material.dispose();
    }
    this.shockwaves = [];

    for (const item of this.lightPool) {
      item.light.visible = false;
    }

    this.persistentWreckage = null;
  }
}
