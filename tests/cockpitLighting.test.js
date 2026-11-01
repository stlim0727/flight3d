import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { excludeFromDeckShadow, cockpitCasterState } from '../src/aircraft/CockpitLighting.js';
import { CockpitOcclusion } from '../src/aircraft/CockpitOcclusion.js';

it('excludes exterior skin from the deck depth pass and restores it for the main sun', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.geometry.setDrawRange(3, 12);
  excludeFromDeckShadow(mesh);
  const args = [null, mesh, new THREE.Camera(), new THREE.Camera(), mesh.geometry];
  args[3].userData.cockpitSun = true;
  mesh.onBeforeShadow(...args);
  assert.equal(mesh.geometry.drawRange.count, 0);
  mesh.onAfterShadow(...args);
  assert.deepEqual(mesh.geometry.drawRange, { start: 3, count: 12 });
  args[3].userData.cockpitSun = false;
  mesh.onBeforeShadow(...args);
  assert.equal(mesh.geometry.drawRange.count, 12);
  mesh.onAfterShadow(...args);
  assert.deepEqual(mesh.geometry.drawRange, { start: 3, count: 12 });
});

it('tracks loaded geometry, yoke visibility, yoke motion and engine controls as casters', () => {
  const cockpit = { gltfYokes: [new THREE.Group()], gltfEngineControls: {
    throttles: [new THREE.Group()], pedals: [new THREE.Group()],
  }, gltfAirframeControls: {gear:new THREE.Group(), flaps:new THREE.Group(),
    spoilers:new THREE.Group(), trimWheels:[new THREE.Group(),new THREE.Group()]},
  yokesVisible: true, gltfCockpitLoaded: false };
  let before = cockpitCasterState(cockpit);
  for (const change of [() => { cockpit.gltfCockpitLoaded = true; },
    () => { cockpit.gltfYokes[0].rotation.z = 0.2; },
    () => { cockpit.yokesVisible = false; },
    () => { cockpit.gltfEngineControls.throttles[0].rotation.x = 0.3; },
    () => { cockpit.gltfEngineControls.pedals[0].position.z = 0.02; },
    () => { cockpit.gltfAirframeControls.gear.position.y += .07; },
    () => { cockpit.gltfAirframeControls.flaps.rotation.x = -.6; },
    () => { cockpit.gltfAirframeControls.spoilers.rotation.x = -.6; },
    () => { cockpit.gltfAirframeControls.trimWheels[0].rotation.x = 1; },
    () => { cockpit.gltfAirframeControls.trimWheels[1].rotation.x = 1; }]) {
    change();
    const after = cockpitCasterState(cockpit);
    assert.notEqual(before, after);
    before = after;
  }
});

it('AO excludes glass and preserves renderer/camera state even if compositing fails', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.08, 45000);
  const group = new THREE.Group();
  const opaque = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const display = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial({ transparent: true }));
  group.add(opaque, display, glass);
  scene.add(group);
  const ao = new CockpitOcclusion(scene, camera, { gltfCockpitGroup: group, gltfCockpitLoaded: true });
  const renderer = { shadowMap: { autoUpdate: true, needsUpdate: true }, autoClear: true,
    getDrawingBufferSize: v => v.set(100, 100), getRenderTarget: () => null,
    setRenderTarget() {}, render() { throw new Error('display render failed'); } };
  ao.render(renderer, 'performance');
  assert.equal(ao.pass, null, 'Performance mode allocates no AO targets');
  ao.init();
  assert.equal(opaque.layers.mask, 3);
  assert.equal(display.layers.mask, 5);
  assert.equal(glass.layers.mask, 1);
  ao.pass.render = () => {};
  assert.throws(() => ao.render(renderer, 'balanced'), /display render failed/);
  assert.equal(camera.layers.mask, 1);
  assert.equal(renderer.autoClear, true);
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.equal(renderer.shadowMap.needsUpdate, true);
  assert.equal(scene.overrideMaterial, null);
  ao.dispose();
});

it('AO linearizes nearby contacts with its own range on initialization and camera changes', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.08, 45000);
  const ao = new CockpitOcclusion(new THREE.Scene(), camera, {
    gltfCockpitGroup: new THREE.Group(), gltfCockpitLoaded: true,
  });
  ao.init();
  const renderer = { shadowMap: { autoUpdate: true, needsUpdate: false }, autoClear: true,
    getDrawingBufferSize: v => v.set(1280, 720), getRenderTarget: () => null,
    setRenderTarget() {}, render() {} };
  const checkContact = () => {
    const uniforms = ao.pass.ssaoMaterial.uniforms;
    const near = uniforms.cameraNear.value, far = uniforms.cameraFar.value;
    assert.equal(near, camera.near);
    assert.equal(far, 8, 'SSAO must not retain the exterior 45 km depth range');
    assert.equal(ao.pass.depthRenderMaterial.uniforms.cameraNear.value, near);
    assert.equal(ao.pass.depthRenderMaterial.uniforms.cameraFar.value, far);
    // Project two surfaces 10 cm apart, then linearize with the SSAO shader's
    // perspectiveDepthToViewZ / viewZToOrthographicDepth equations.
    const linearDepth = distance => {
      const ndc = new THREE.Vector3(0, 0, -distance).applyMatrix4(ao.aoCamera.projectionMatrix);
      const depth = ndc.z * 0.5 + 0.5;
      const viewZ = near * far / ((far - near) * depth - far);
      return (viewZ + near) / (near - far);
    };
    const delta = linearDepth(1.1) - linearDepth(1);
    assert.ok(Math.abs(delta - 0.1 / (8 - camera.near)) < 1e-10);
    assert.ok(delta > ao.pass.minDistance && delta < ao.pass.maxDistance,
      'Nearby surfaces must remain inside the metre-based occlusion interval');
    assert.ok(Math.abs(ao.pass.minDistance - 0.003 / (8 - camera.near)) < 1e-12);
    assert.ok(Math.abs(ao.pass.maxDistance - 0.45 / (8 - camera.near)) < 1e-12);
  };
  checkContact();
  ao.pass.render = () => { checkContact(); };
  for (const [quality, near, aspect] of [['balanced', 0.08, 16 / 9], ['high', 0.16, 9 / 16],
    ['balanced', 0.05, 16 / 9]]) {
    camera.near = near;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    ao.render(renderer, quality);
    assert.equal(camera.far, 45000, 'AO must leave the exterior camera range unchanged');
  }
  let aoPassCalled = 0;
  ao.pass.render = () => { aoPassCalled++; };
  ao.render(renderer, 'performance');
  ao.render(renderer, 'ultraLow');
  assert.equal(aoPassCalled, 0, 'performance and ultraLow must skip AO rendering pass');
  ao.dispose();
});

it('warmup preserves independent photo deck visibility and skips performance until quality changes', () => {
  const group = new THREE.Group();
  const deck = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  deck.add(mesh);
  group.add(deck);
  group.visible = false;
  const camera = new THREE.PerspectiveCamera();
  camera.layers.set(3);
  const ao = new CockpitOcclusion(new THREE.Scene(), camera, {
    group, gltfCockpitGroup: deck, gltfCockpitLoaded: true,
  });
  const previous = {};
  let target = previous, beautyDraws = 0, aoDraws = 0;
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: value => { target = value; },
    render() {
      beautyDraws++;
      assert.equal(group.visible, true);
      assert.equal(deck.visible, true);
      assert.equal(mesh.frustumCulled, false);
    },
  };
  // Isolate warmup orchestration from WebGL; render() itself is covered above.
  ao.render = () => { aoDraws++; ao.pass = {}; };
  for (let i = 0; i < 3; i++) {
    ao.warm(renderer, 'performance');
    ao.warm(renderer, 'ultraLow');
  }
  assert.equal(beautyDraws, 0);
  assert.equal(aoDraws, 0);
  assert.equal(ao.pass, null);
  ao.warm(renderer, 'balanced');
  assert.equal(beautyDraws, 1);
  assert.equal(aoDraws, 2);
  assert.equal(group.visible, false);
  assert.equal(deck.visible, true);
  assert.equal(mesh.frustumCulled, true);
  assert.equal(camera.layers.mask, 8);
  assert.equal(target, previous);
  group.visible = true; // Photo look-away / switching to the 3D cockpit.
  assert.equal(deck.visible, true, 'The loaded deck remains available after warmup');
  ao.warm(renderer, 'high');
  assert.equal(beautyDraws, 1, 'An initialized pass is not warmed repeatedly');

  ao.pass = null;
  deck.visible = false;
  renderer.render = () => { throw new Error('warm draw failed'); };
  assert.throws(() => ao.warm(renderer, 'balanced'), /warm draw failed/);
  assert.equal(group.visible, true);
  assert.equal(deck.visible, false);
  assert.equal(mesh.frustumCulled, true);
  assert.equal(camera.layers.mask, 8);
  assert.equal(target, previous);
});
