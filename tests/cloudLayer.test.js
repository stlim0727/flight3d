import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CloudLayer, createCloudDensity, CLOUD_DENSITY_SIZE, CLOUD_VARIANTS } from '../src/environment/CloudLayer.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';

test('shared 3D density is reproducible, varied and bounded in memory', () => {
  const a = createCloudDensity();
  const b = createCloudDensity();
  assert.deepEqual(a.image.data, b.image.data);
  assert.equal(a.image.width, CLOUD_DENSITY_SIZE);
  assert.equal(a.image.height, CLOUD_DENSITY_SIZE);
  assert.equal(a.image.depth, (CLOUD_DENSITY_SIZE + 2) * CLOUD_VARIANTS);
  assert.ok(a.image.data.byteLength < 512 * 1024);
  assert.ok(new Set(a.image.data).size > 150);
  const size = CLOUD_DENSITY_SIZE;
  const stride = size + 2;
  const shapes = [];
  for (let variant = 0; variant < CLOUD_VARIANTS; variant++) {
    const start = variant * stride * size * size;
    const end = start + stride * size * size;
    shapes.push(Buffer.from(a.image.data.slice(start, end)).toString('base64'));
    // Gutters and outer faces must be empty: no rectangular outline or atlas bleed.
    for (let z = 0; z < stride; z++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (z <= 1 || z >= stride - 2 || x === 0 || y === 0 || x === size - 1 || y === size - 1) {
            assert.equal(a.image.data[start + (z * size + y) * size + x], 0);
          }
        }
      }
    }
  }
  assert.equal(new Set(shapes).size, CLOUD_VARIANTS);
  a.dispose(); b.dispose();
});

test('each cloud can sort independently alongside transparent effects', () => {
  const layer = new CloudLayer();
  assert.ok(layer.count > 40 && layer.count <= 64);
  assert.equal(layer.children.length, layer.count);
  const effect = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
  for (const cloud of layer.clouds) {
    assert.ok(cloud.isMesh);
    assert.ok(Math.abs(cloud.position.x) >= 4000 || Math.abs(cloud.position.z) >= 2500);
    assert.ok(cloud.position.y >= 2800 && cloud.position.y <= 3600);
    assert.equal(cloud.renderOrder, effect.renderOrder);
    assert.equal(layer.renderOrder, effect.renderOrder);
    assert.equal(cloud.material.transparent, true);
    assert.equal(cloud.material.depthWrite, false);
    assert.equal(cloud.geometry, layer.geometry);
    assert.equal(cloud.material.uniforms.densityTexture.value, layer.densityTexture);
  }
  assert.deepEqual(new Set(layer.clouds.map(cloud => cloud.material.uniforms.cloudVariant.value)),
    new Set([0, 1, 2, 3]));
  let disposed = 0;
  layer.densityTexture.addEventListener('dispose', () => disposed++);
  layer.dispose();
  assert.equal(disposed, 1);
  effect.material.dispose();
});

test('cloud lighting follows day, sunset, night and repeated airport changes', () => {
  const sky = new SkyAtmosphere(new THREE.Scene());
  const brightness = hour => {
    sky.setTimeOfDay(hour);
    const u = sky.cloudLayer.material.uniforms;
    return u.sunColor.value.r + u.ambientColor.value.r;
  };
  const noon = brightness(12);
  sky.setTimeOfDay(18);
  const sunset = sky.cloudLayer.material.uniforms.sunColor.value;
  assert.ok(sunset.r > sunset.b * 2);
  assert.ok(brightness(0) < noon * 0.1);
  for (const airport of ['lukla', 'coastal', 'lukla', 'coastal']) {
    sky.setAirport(airport);
    assert.equal(sky.cloudsGroup.position.y, airport === 'lukla' ? 3400 : 0);
    assert.equal(sky.cloudsGroup.children.length, 1);
  }
  sky.cloudLayer.dispose();
});
