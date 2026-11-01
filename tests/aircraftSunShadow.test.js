import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';
import { RENDER_QUALITY } from '../src/config/renderQuality.js';

test('sun frustum follows displayed pose and encloses the airframe across camera cuts', () => {
  const sky = new SkyAtmosphere(new THREE.Scene());
  const camera = new THREE.PerspectiveCamera();
  const position = new THREE.Vector3(12000, 900, -8000);
  let previous = 32;
  for (const distance of [0, 20, 60, 60.01, 100, 200, 500, 10000, 30]) {
    camera.position.copy(position).add(new THREE.Vector3(0, 0, distance));
    sky.prepareRender(camera, position);
    const sc = sky.sunLight.shadow.camera;
    assert.ok(sc.right >= 32 && sc.right <= 120);
    assert.equal(sc.left, -sc.right);
    assert.equal(sc.top, sc.right);
    assert.equal(sc.bottom, -sc.right);
    if (distance === 60.01) assert.ok(Math.abs(sc.right - previous) < 0.003);
    previous = sc.right;
    assert.ok(sky.sunLight.target.position.distanceTo(position) < 1e-9);
    assert.ok(Math.abs(sky.sunLight.position.distanceTo(position) - 600) < 1e-9);
    sky.sunLight.updateMatrixWorld(true);
    sky.sunLight.target.updateMatrixWorld(true);
    sky.sunLight.shadow.updateMatrices(sky.sunLight);
    // Conservative 737 bounds, rotated through heading/pitch/bank. Check the
    // actual shadow projection rather than just checking its configured size.
    for (const angle of [0, 0.7, 1.8, 3.1]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, angle * 2, angle * 0.6));
      for (const x of [-18, 18]) for (const y of [-4, 10]) for (const z of [-21, 21]) {
        const point = new THREE.Vector3(x, y, z).applyQuaternion(q).add(position)
          .applyMatrix4(sky.sunLight.shadow.matrix);
        assert.ok(point.x > 0 && point.x < 1 && point.y > 0 && point.y < 1 && point.z > 0 && point.z < 1,
          `Airframe clipped at camera distance ${distance}`);
      }
    }
  }
  assert.equal(previous, 32, 'Returning to the aircraft restores fine detail immediately');
  const shadow = sky.sunLight.shadow;
  assert.ok(Math.abs(shadow.bias) * (shadow.camera.far - shadow.camera.near) < 0.05);
});

test('quality changes replace GPU maps only when necessary and respect texture limits', () => {
  const sky = new SkyAtmosphere(new THREE.Scene());
  const shadow = sky.sunLight.shadow;
  assert.deepEqual(Object.values(RENDER_QUALITY).map(p => p.shadowMapSize), [4096, 2048, 1024, 0]);
  for (const tier of ['performance', 'balanced', 'high', 'balanced', 'performance']) {
    let disposed = 0;
    const map = new THREE.WebGLRenderTarget(shadow.mapSize.x, shadow.mapSize.y);
    map.addEventListener('dispose', () => disposed++);
    shadow.map = map;
    sky.setShadowMapSize(RENDER_QUALITY[tier].shadowMapSize);
    assert.equal(disposed, 1);
    assert.equal(shadow.map, null);
    assert.equal(shadow.needsUpdate, true);
    assert.equal(shadow.mapSize.x, RENDER_QUALITY[tier].shadowMapSize);
    shadow.map = map;
    sky.setShadowMapSize(RENDER_QUALITY[tier].shadowMapSize);
    assert.equal(disposed, 1, 'Unchanged tier keeps the allocated map');
    assert.equal(shadow.map, map);
  }
  // ultraLow tier completely disables castShadow and frees maps
  sky.setShadowMapSize(RENDER_QUALITY.ultraLow.shadowMapSize);
  assert.equal(sky.sunLight.castShadow, false);
  assert.equal(shadow.mapSize.x, 0);
  assert.equal(shadow.map, null);
  sky.renderer = { capabilities: { maxTextureSize: 2048 } };
  sky.setShadowMapSize(RENDER_QUALITY.high.shadowMapSize);
  assert.equal(shadow.mapSize.x, 2048);
});
