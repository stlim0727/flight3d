import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createScreenSky } from '../src/environment/ScreenSky.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';

// Mirrors the rewritten vertex shader: NDC corner -> world-space view ray.
function shaderRay(camera, ndcX, ndcY) {
  const p = camera.projectionMatrix.elements;
  const viewRay = new THREE.Vector3((ndcX + p[8]) / p[0], (ndcY + p[9]) / p[5], -1);
  return viewRay.applyMatrix3(new THREE.Matrix3().setFromMatrix4(camera.matrixWorld));
}

test('sky is one clip-space triangle that never clips at the camera plane (#636)', () => {
  const sky = createScreenSky();
  const position = sky.geometry.getAttribute('position');
  assert.equal(position.count, 3);
  assert.equal(sky.frustumCulled, false);

  const { vertexShader, fragmentShader } = sky.material;
  assert.match(vertexShader, /gl_Position = vec4\( position\.xy, 1\.0, 1\.0 \);/);
  assert.doesNotMatch(vertexShader, /gl_Position\.z = gl_Position\.w/);
  assert.doesNotMatch(vertexShader, /modelViewMatrix/);
  assert.match(fragmentShader, /normalize\( vWorldPosition \)/);
});

test('rebuilt view rays match the camera ray through each pixel far from the origin', () => {
  const camera = new THREE.PerspectiveCamera(58, 2340 / 1080, 0.08, 45000);
  // Beyond the 22.5 km half-size of the old origin-anchored box.
  camera.position.set(31000, 460, -27000);
  camera.lookAt(32000, 520, -28500);
  camera.updateMatrixWorld();

  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0.3, -0.2]]) {
    const expected = new THREE.Vector3(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
    const actual = shaderRay(camera, x, y).normalize();
    assert.ok(actual.distanceTo(expected) < 1e-6, `ray at NDC (${x}, ${y})`);
  }
});

test('view rays stay affine in NDC so the triangle interpolates them exactly', () => {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  camera.setViewOffset(400, 300, 30, 20, 200, 150);
  camera.lookAt(0.4, 0.3, -1);
  camera.updateMatrixWorld();

  const a = shaderRay(camera, -1, -1);
  const b = shaderRay(camera, 3, -1);
  const c = shaderRay(camera, -1, 3);
  // Barycentric blend of the vertex rays equals the ray computed at that pixel.
  const [u, v] = [0.2, 0.35];
  const blended = a.clone().multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
  const direct = shaderRay(camera, -1 + 4 * u, -1 + 4 * v);
  assert.ok(blended.distanceTo(direct) < 1e-9);
});

test('atmosphere installs the screen-space sky', () => {
  const scene = new THREE.Scene();
  const atmosphere = new SkyAtmosphere(scene);
  assert.ok(scene.children.includes(atmosphere.sky));
  assert.equal(atmosphere.sky.geometry.getAttribute('position').count, 3);
  assert.ok(atmosphere.sky.scale.equals(new THREE.Vector3(1, 1, 1)));
});
