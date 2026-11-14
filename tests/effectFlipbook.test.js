import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEffectAtlas, flipbookFrame } from '../src/effects/EffectFlipbook.js';
import { TireSmokeSystem } from '../src/effects/TireSmokeSystem.js';
import { ExplosionSystem } from '../src/effects/ExplosionSystem.js';

test('atlas frames change, have transparent gutters, and fit a fixed memory budget', () => {
  for (const kind of ['fire', 'smoke', 'water', 'tire']) {
    const texture = createEffectAtlas(kind);
    const { data, width } = texture.image;
    assert.equal(data.byteLength, 256 * 256 * 4);
    assert.equal(texture.generateMipmaps, false);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      if (x % 64 === 0 || x % 64 === 63 || y % 64 === 0 || y % 64 === 63) {
        assert.equal(data[(y * width + x) * 4 + 3], 0);
      }
    }
    assert.notDeepEqual(data.slice(32 * width * 4, (32 * width + 64) * 4), data.slice((32 * width + 64) * 4, (32 * width + 128) * 4));
    texture.dispose();
  }
});

test('playback clamps at death rather than looping and supports variable speed', () => {
  assert.deepEqual([-1, 0, 0.5, 1, 2].map(t => flipbookFrame(t, 1)), [0, 0, 8, 15, 15]);
  assert.equal(flipbookFrame(0.5, 1, 0.5), 4);
  assert.equal(flipbookFrame(0, 0), 15);
});

test('touchdown / update / clear preserves dynamics, shares maps, and stays bounded', () => {
  const system = new TireSmokeSystem(new THREE.Scene());
  const contact = { id: 'left', worldPos: new THREE.Vector3(), groundSpeed: 70, sinkRate: 2 };
  const velocity = new THREE.Vector3(70, 0, 0);
  for (let cycle = 0; cycle < 5; cycle++) {
    for (let i = 0; i < 30; i++) system.spawnTouchdownSmoke([contact], velocity);
    assert.equal(system.particles.length, 200);
    assert.equal(system.activeSpinUpEmitters.length, 16);
    const particle = system.particles[0];
    const start = particle.sprite.position.clone();
    assert.ok(system.particles.every(p => p.sprite.material.map === system.smokeTexture));
    system.update(0.3);
    assert.ok(particle.sprite.material.userData.flipbook.frame.value > 0);
    assert.ok(particle.sprite.position.x < start.x);
    system.clear();
    assert.equal(system.group.children.length, 0);
    assert.equal(system.activeSpinUpEmitters.length, 0);
  }
  let disposed = 0;
  system.smokeTexture.addEventListener('dispose', () => disposed++);
  system.dispose();
  assert.equal(disposed, 1);
  assert.equal(system.scene.children.length, 0);
});

test('impacts separate water from solid materials, settle, expire and reset within budgets', () => {
  const original = ExplosionSystem.prototype.createSparkTexture;
  ExplosionSystem.prototype.createSparkTexture = () => new THREE.Texture();
  let system;
  try { system = new ExplosionSystem(new THREE.Scene()); }
  finally { ExplosionSystem.prototype.createSparkTexture = original; }
  for (const type of ['TERRAIN', 'WATER', 'BUILDING']) {
    for (let i = 0; i < 8; i++) system.spawnExplosion(
      { type, point: new THREE.Vector3(0, -1, 0) }, new THREE.Vector3(75, -20, 0));
    if (type === 'WATER') {
      assert.equal(system.fireballs.length, 0);
      assert.equal(system.smokePuffs.length, 0);
      assert.equal(system.debrisParticles.length, 0);
      assert.equal(system.shockwaves.length, 4);
      assert.ok(system.lightPool.every(item => !item.light.visible));
      assert.equal(system.waterPlumes.length, 90);
      assert.equal(system.persistentWreckage, null);
      assert.ok(system.waterPlumes.every(p => p.sprite.position.y > 0));
      const spray = system.waterPlumes[0], vy = spray.vel.y;
      system.update(0.1);
      assert.ok(spray.vel.y < vy);
      for (let i = 0; i < 35; i++) {
        system.update(0.1);
        assert.ok(system.waterPlumes.every(p => p.sprite.position.y >= p.surfaceY));
      }
    } else {
      assert.ok(system.fireballs.length <= 60);
      assert.equal(system.smokePuffs.length, 120);
      assert.equal(system.debrisParticles.length, 70);
      assert.equal(system.shockwaves.length, 0); // No floating ring at building impact height.
      assert.ok(system.smokePuffs.every(p => p.sprite.material.map === system.dustTexture));
    }
    for (let i = 0; i < 360; i++) system.update(0.1);
    for (const particles of [system.smokePuffs, system.waterPlumes, system.fireballs, system.debrisParticles, system.shockwaves]) {
      assert.equal(particles.length, 0);
    }
    system.clear();
    assert.equal(system.group.children.length, 4);
    assert.ok(system.lightPool.every(item => !item.light.visible));
  }
  system.spawnExplosion({ type: 'TERRAIN', speedKnots: 20 });
  const slowCount = system.smokePuffs.length;
  assert.equal(system.fireballs.length, 0);
  assert.ok(system.lightPool.every(item => !item.light.visible));
  system.clear();
  const point = new THREE.Vector3(5, -2, 8), velocity = new THREE.Vector3(100, -20, 0);
  system.spawnExplosion({ type: 'BUILDING', point }, velocity);
  assert.ok(system.smokePuffs.length > slowCount);
  assert.ok(system.fireballs.length > 0);
  assert.deepEqual(point.toArray(), [5, -2, 8]);
  assert.deepEqual(velocity.toArray(), [100, -20, 0]);
  system.dispose();
  assert.equal(system.scene.children.length, 0);
});

test('persistent wreckage maintains smoke and water foam for 30 seconds across clear({ preservePersistent: true })', () => {
  const original = ExplosionSystem.prototype.createSparkTexture;
  ExplosionSystem.prototype.createSparkTexture = () => new THREE.Texture();
  let system;
  try {
    system = new ExplosionSystem(new THREE.Scene());
    // 1. Terrain impact initiates 30s smoke
    system.spawnExplosion({ type: 'TERRAIN', point: new THREE.Vector3(10, 0, 10), speedKnots: 80 });
    assert.equal(system.persistentWreckages.length, 1);
    assert.equal(system.persistentWreckages[0].duration, 30);

    // 2. Water impact initiates 30s water foam
    system.spawnExplosion({ type: 'WATER', point: new THREE.Vector3(50, 0, 50), speedKnots: 80 });
    assert.equal(system.persistentWaterWreckages.length, 1);
    assert.equal(system.persistentWaterWreckages[0].duration, 30);

    // 3. Clear with preservePersistent: true (like respawn)
    system.clear({ preservePersistent: true });
    assert.equal(system.persistentWreckages.length, 1, 'Smoke wreckage preserved');
    assert.equal(system.persistentWaterWreckages.length, 1, 'Water wreckage preserved');

    // 4. Update for 25 seconds: smoke and foam should continue emitting
    for (let i = 0; i < 250; i++) system.update(0.1);
    assert.ok(system.smokePuffs.length > 0, 'Smoke should still be billowing at 25s');
    assert.ok(system.waterPlumes.length > 0, 'Water foam should still be bubbling at 25s');

    // 5. Update past 30 seconds (up to 36s): wreckages expire and particles fade to 0
    for (let i = 0; i < 110; i++) system.update(0.1);
    assert.equal(system.persistentWreckages.length, 0, 'Ground wreckage expired after 30s');
    assert.equal(system.persistentWaterWreckages.length, 0, 'Water wreckage expired after 30s');
    assert.equal(system.smokePuffs.length, 0, 'Smoke puffs completely dissipated');
    assert.equal(system.waterPlumes.length, 0, 'Water plumes completely dissipated');

    system.dispose();
  } finally {
    ExplosionSystem.prototype.createSparkTexture = original;
  }
});

test('exaggerated air explosions spawn comet-like flame tails within budgets and clear cleanly', () => {
  const original = ExplosionSystem.prototype.createSparkTexture;
  ExplosionSystem.prototype.createSparkTexture = () => new THREE.Texture();
  let system;
  try {
    system = new ExplosionSystem(new THREE.Scene());
    // Water must never emit comet debris
    system.spawnExplosion({ type: 'WATER', point: new THREE.Vector3(0, 0, 0) }, new THREE.Vector3(100, -30, 0), { exaggerated: true });
    assert.equal(system.cometDebris.length, 0);
    assert.equal(system.cometTailParticles.length, 0);
    system.clear();

    // Exaggerated AIR detonation spawns 3D shockwave + comet debris that shed flame & smoke tails
    system.spawnExplosion({ type: 'AIR', point: new THREE.Vector3(0, 1000, 0) }, new THREE.Vector3(0, 0, -220), { exaggerated: true, intensity: 1.5 });
    assert.ok(system.cometDebris.length > 0 && system.cometDebris.length <= 28);
    assert.equal(system.shockwaves.length, 1);

    // Step forward so comets shed flame and soot tails
    for (let i = 0; i < 6; i++) system.update(0.05);
    assert.ok(system.cometTailParticles.length > 0 && system.cometTailParticles.length <= 240);
    assert.ok(system.cometTailParticles.some(p => !p.isSmoke), 'comet emits flame tail particles');
    assert.ok(system.cometTailParticles.some(p => p.isSmoke), 'comet emits soot tail particles');

    // Clear removes all comet debris & tails
    system.clear();
    assert.equal(system.cometDebris.length, 0);
    assert.equal(system.cometTailParticles.length, 0);
    assert.equal(system.group.children.length, 4);
    system.dispose();
  } finally {
    ExplosionSystem.prototype.createSparkTexture = original;
  }
});
