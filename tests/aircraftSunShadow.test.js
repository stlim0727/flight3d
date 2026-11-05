import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SkyAtmosphere, sunShadowPlacement } from '../src/environment/SkyAtmosphere.js';
import { RENDER_QUALITY } from '../src/config/renderQuality.js';

test('sun frustum follows displayed pose and encloses the airframe across camera cuts', () => {
  const sky = new SkyAtmosphere(new THREE.Scene());
  const camera = new THREE.PerspectiveCamera();
  const position = new THREE.Vector3(12000, 900, -8000);
  const { focus, reach } = sunShadowPlacement(sky.sunPosition, position, new THREE.Vector3());
  assert.ok(reach > 30, 'The shipped golden-hour default must actually displace the box');
  let previous = 32 + reach / 2;
  for (const distance of [0, 20, 60, 60.01, 100, 200, 500, 10000, 30]) {
    camera.position.copy(position).add(new THREE.Vector3(0, 0, distance));
    sky.prepareRender(camera, position);
    const sc = sky.sunLight.shadow.camera;
    assert.ok(sc.right >= 32 + reach / 2 && sc.right <= 120 + reach / 2);
    assert.equal(sc.left, -sc.right);
    assert.equal(sc.top, sc.right);
    assert.equal(sc.bottom, -sc.right);
    if (distance === 60.01) assert.ok(Math.abs(sc.right - previous) < 0.003);
    previous = sc.right;
    assert.ok(sky.sunLight.target.position.distanceTo(focus) < 1e-9);
    assert.ok(Math.abs(sky.sunLight.position.distanceTo(focus) - 600) < 1e-9);
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
  assert.equal(previous, 32 + reach / 2, 'Returning to the aircraft restores fine detail immediately');
  const shadow = sky.sunLight.shadow;
  assert.ok(Math.abs(shadow.bias) * (shadow.camera.far - shadow.camera.near) < 0.05);
});

test('low sun keeps the projected airframe shadow inside the shadow map', () => {
  const sky = new SkyAtmosphere(new THREE.Scene());
  sky.setTimeOfDay(17.5);
  const position = new THREE.Vector3(0, 7, 0);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 12, 30);
  sky.prepareRender(camera, position);
  sky.sunLight.updateMatrixWorld(true);
  sky.sunLight.target.updateMatrixWorld(true);
  sky.sunLight.shadow.updateMatrices(sky.sunLight);
  assert.ok(sky.sunPosition.y > 0.05 && sky.sunPosition.y < 0.25, '17.5h is a low but live sun');
  // The tail top's shadow on the ground is the farthest caster footprint the map must hold.
  const tailHeight = 12.6;
  const tip = new THREE.Vector3(
    position.x - sky.sunPosition.x / sky.sunPosition.y * tailHeight,
    position.y,
    position.z - sky.sunPosition.z / sky.sunPosition.y * tailHeight);
  const projected = tip.clone().applyMatrix4(sky.sunLight.shadow.matrix);
  assert.ok(projected.x > 0 && projected.x < 1 && projected.y > 0 && projected.y < 1,
    `Low-sun tail shadow lands outside the shadow map (got ${projected.x.toFixed(2)}, ${projected.y.toFixed(2)})`);
  const aircraft = position.clone().applyMatrix4(sky.sunLight.shadow.matrix);
  assert.ok(aircraft.x > 0 && aircraft.x < 1 && aircraft.y > 0 && aircraft.y < 1,
    'The airframe itself must stay inside the widened map');
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

test('cloud layer visibility and sorting guard respects ultraLow preset', () => {
  const sky = new SkyAtmosphere(new THREE.Scene());
  assert.equal(sky.cloudLayer.visible, true);
  assert.equal(sky.cloudsGroup.visible, true);

  let sorted = 0;
  sky.cloudLayer.sortForCamera = () => { sorted++; };

  const camera = new THREE.PerspectiveCamera();
  sky.prepareRender(camera);
  assert.equal(sorted, 1, 'Clouds should be sorted when visible');

  sky.setCloudsVisible(false);
  assert.equal(sky.cloudLayer.visible, false);
  assert.equal(sky.cloudsGroup.visible, false);

  sky.prepareRender(camera);
  assert.equal(sorted, 1, 'Clouds must not be sorted when hidden in ultraLow');

  sky.setCloudsVisible(true);
  assert.equal(sky.cloudLayer.visible, true);
  assert.equal(sky.cloudsGroup.visible, true);
  sky.prepareRender(camera);
  assert.equal(sorted, 2, 'Clouds should be sorted again when re-enabled');
});
