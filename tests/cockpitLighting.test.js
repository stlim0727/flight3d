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
  }, yokesVisible: true, gltfCockpitLoaded: false };
  let before = cockpitCasterState(cockpit);
  for (const change of [() => { cockpit.gltfCockpitLoaded = true; },
    () => { cockpit.gltfYokes[0].rotation.z = 0.2; },
    () => { cockpit.yokesVisible = false; },
    () => { cockpit.gltfEngineControls.throttles[0].rotation.x = 0.3; },
    () => { cockpit.gltfEngineControls.pedals[0].position.z = 0.02; }]) {
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
