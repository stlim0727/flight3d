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

test('land / water crashes retain flash, shockwave, wind, gravity, reset and budgets', () => {
  // The unchanged spark canvas is unrelated to atlas generation or particle dynamics.
  const original = ExplosionSystem.prototype.createSparkTexture;
  ExplosionSystem.prototype.createSparkTexture = () => new THREE.Texture();
  let system;
  try { system = new ExplosionSystem(new THREE.Scene()); }
  finally { ExplosionSystem.prototype.createSparkTexture = original; }
  for (const type of ['GROUND', 'WATER', 'GROUND']) {
    for (let i = 0; i < 8; i++) system.spawnExplosion({ type, point: new THREE.Vector3() });
    assert.equal(system.fireballs.length, 60);
    assert.equal(system.smokePuffs.length, 120);
    assert.equal(system.debrisParticles.length, 70);
    assert.equal(system.shockwaves.length, 4);
    assert.ok(system.lightPool.some(item => item.light.visible));
    if (type === 'WATER') {
      assert.equal(system.waterPlumes.length, 90);
      assert.equal(system.waterPlumes[0].sprite.material.blending, THREE.NormalBlending);
    }
    const smoke = system.smokePuffs[0], wind = smoke.vel.x;
    system.update(0.8);
    assert.ok(smoke.vel.x > wind);
    assert.ok(smoke.sprite.material.userData.flipbook.frame.value > 0);
    for (let i = 0; i < 360; i++) system.update(0.1);
    assert.equal(system.smokePuffs.length, 0);
    system.clear();
    assert.equal(system.group.children.length, 4);
    assert.ok(system.lightPool.every(item => !item.light.visible));
    assert.equal(system.persistentWreckage, null);
  }
  system.dispose();
  assert.equal(system.scene.children.length, 0);
});
