import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FAR_SUN_SHADOW_LAYER, FarSunShadow, applyFarSunShadow, castFarSunShadow,
  farSunShadowLightsChunk, farSunShadowPlacement, farSunShadowUniforms,
} from '../src/environment/FarSunShadow.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';
import { RENDER_QUALITY } from '../src/config/renderQuality.js';

const sunAt = (elevationDeg, azimuthDeg = 200) => new THREE.Vector3().setFromSphericalCoords(
  1, THREE.MathUtils.degToRad(90 - elevationDeg), THREE.MathUtils.degToRad(azimuthDeg));

/** Stands in for WebGLRenderer: records what each far pass was drawn with. */
function fakeRenderer() {
  const renderer = {
    passes: [],
    target: null,
    capabilities: { maxTextureSize: 8192 },
    shadowMap: { enabled: true, autoUpdate: true, needsUpdate: true },
    getRenderTarget() { return this.target; },
    setRenderTarget(target) { this.target = target; },
    clear() {},
    render(scene, camera) {
      this.passes.push({
        target: this.target,
        override: scene.overrideMaterial,
        layers: camera.layers.mask,
        // three skips every light's shadow pass only in this state.
        shadowPassSkipped: this.shadowMap.autoUpdate === false && this.shadowMap.needsUpdate === false,
      });
    },
  };
  return renderer;
}

function frame(overrides = {}) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(1200, 900, -3400);
  return {
    renderer: fakeRenderer(), scene: new THREE.Scene(), camera,
    sunDirection: sunAt(35), strength: 1, groundHeightAt: () => 40, now: 0, ...overrides,
  };
}

test('the box is texel-snapped on the focus and its depth spans floor to ceiling', () => {
  for (const elevation of [4, 20, 35, 65, 89.9]) {
    const sun = sunAt(elevation);
    const focus = new THREE.Vector3(5321.7, 180, -7411.3);
    const place = farSunShadowPlacement(sun, focus, 3000, 2048);
    const camera = new THREE.OrthographicCamera(-3000, 3000, 3000, -3000, place.near, place.far);
    camera.position.copy(place.position);
    camera.quaternion.copy(place.quaternion);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const ndc = focus.clone().project(camera);
    const halfTexelNdc = 1 / 2048;
    assert.ok(Math.abs(ndc.x) <= halfTexelNdc + 1e-9 && Math.abs(ndc.y) <= halfTexelNdc + 1e-9,
      `focus stays within half a texel of the centre at ${elevation} deg`);
    assert.ok(Math.abs(place.u / place.texel - Math.round(place.u / place.texel)) < 1e-6);

    // The camera looks down the rays: straight up-sun of the focus is the same texel, nearer.
    const upSun = focus.clone().addScaledVector(sun, 500).project(camera);
    assert.ok(Math.abs(upSun.x - ndc.x) < 1e-9 && Math.abs(upSun.y - ndc.y) < 1e-9);
    assert.ok(upSun.z < ndc.z);

    // Receivers and casters at any altitude over the covered ground are inside the depth range,
    // unless a low sun pushes them past the reach the terrain itself ends at.
    if (elevation < 20) continue;
    for (const [dx, dz] of [[0, 0], [2900, 0], [0, -2900], [-2000, 2000]]) {
      for (const y of [-100, 0, 4000, 9000]) {
        const depth = new THREE.Vector3(focus.x + dx, y, focus.z + dz).project(camera).z;
        assert.ok(depth > -1 && depth < 1, `y=${y} at ${elevation} deg is inside the depth range`);
      }
    }
  }
});

test('the map is redrawn only when the camera, the sun or its age moved past the limits', () => {
  const shadow = new FarSunShadow();
  shadow.setQuality(2048, 3000);
  const f = frame();
  assert.equal(shadow.update(f), true, 'first frame draws');
  assert.equal(shadow.update({ ...f, now: 16 }), false, 'an unmoved camera reuses the map');

  // 6% of the half-width is 180 m in the light plane; 100 m of flight stays inside it.
  f.camera.position.x += 100;
  assert.equal(shadow.update({ ...f, now: 32 }), false);
  const focusUv = farSunShadowUniforms.uFarSunShadowFocus.value.clone();
  assert.ok(focusUv.distanceTo(new THREE.Vector2(0.5, 0.5)) > 0.005, 'the fade follows the live camera');
  assert.ok(focusUv.distanceTo(new THREE.Vector2(0.5, 0.5)) < 0.03, 'and stays inside the refresh margin');

  f.camera.position.x += 400;
  assert.equal(shadow.update({ ...f, now: 48 }), true, 'past the margin it redraws');
  assert.ok(farSunShadowUniforms.uFarSunShadowFocus.value.distanceTo(new THREE.Vector2(0.5, 0.5)) < 0.001);

  assert.equal(shadow.update({ ...f, now: 64, sunDirection: sunAt(35.05) }), false, 'sun jitter is ignored');
  assert.equal(shadow.update({ ...f, now: 80, sunDirection: sunAt(36) }), true, 'a moved sun redraws');
  assert.equal(shadow.update({ ...f, now: 96, sunDirection: sunAt(36) }), false);
  assert.equal(shadow.update({ ...f, now: 5000, sunDirection: sunAt(36) }), true, 'an old map redraws');
  shadow.invalidate();
  assert.equal(shadow.update({ ...f, now: 5016, sunDirection: sunAt(36) }), true);
  assert.equal(shadow.renderCount, f.renderer.passes.length);
});

test('the far pass draws only its own layer and leaves renderer state as it found it', () => {
  const shadow = new FarSunShadow();
  shadow.setQuality(2048, 3000);
  const f = frame();
  const previousTarget = { name: 'callers-target' };
  const previousOverride = new THREE.MeshBasicMaterial();
  f.renderer.target = previousTarget;
  f.scene.overrideMaterial = previousOverride;
  shadow.update(f);

  const [pass] = f.renderer.passes;
  assert.equal(pass.target, shadow.target);
  assert.equal(pass.override, shadow.depthMaterial);
  assert.equal(pass.layers, 1 << FAR_SUN_SHADOW_LAYER);
  assert.equal(pass.shadowPassSkipped, true, 'the pass must not consume the lights\' pending refreshes');
  assert.equal(f.renderer.target, previousTarget);
  assert.equal(f.scene.overrideMaterial, previousOverride);
  assert.deepEqual(f.renderer.shadowMap, { enabled: true, autoUpdate: true, needsUpdate: true });

  assert.equal(farSunShadowUniforms.uFarSunShadowMap.value, shadow.target.depthTexture);
  assert.equal(shadow.target.depthTexture.compareFunction, THREE.LessEqualCompare);
  const params = farSunShadowUniforms.uFarSunShadowParams.value;
  assert.equal(params.x, 1);
  assert.ok(params.y > 0 && params.y < 1e-3, 'bias is a small fraction of the depth range');
  assert.equal(params.z, 1 / 2048);

  // World to map UV: the ground under the camera is the centre texel.
  const uv = new THREE.Vector3(f.camera.position.x, 40, f.camera.position.z)
    .applyMatrix4(farSunShadowUniforms.uFarSunShadowMatrix.value);
  assert.ok(Math.abs(uv.x - 0.5) < 1e-3 && Math.abs(uv.y - 0.5) < 1e-3 && uv.z > 0 && uv.z < 1);
});

test('no pass and no darkening when shadows are off, the sun is down or the tier has no map', () => {
  const params = farSunShadowUniforms.uFarSunShadowParams.value;
  const shadow = new FarSunShadow();
  const off = frame();
  assert.equal(shadow.update(off), false, 'no map size yet');
  assert.equal(params.x, 0);

  shadow.setQuality(2048, 3000);
  const cases = [
    ['renderer shadows disabled', (f) => { f.renderer.shadowMap.enabled = false; }],
    ['sun below the horizon', (f) => { f.sunDirection = sunAt(-10); }],
    ['overcast removed the shadow', (f) => { f.strength = 0; }],
  ];
  for (const [label, change] of cases) {
    const f = frame();
    shadow.update(f);
    assert.equal(params.x, 1);
    const drawn = f.renderer.passes.length;
    change(f);
    shadow.invalidate();
    assert.equal(shadow.update({ ...f, now: 16 }), false, label);
    assert.equal(f.renderer.passes.length, drawn, label);
    assert.equal(params.x, 0, label);
  }

  const low = frame({ sunDirection: sunAt(4) });
  shadow.update(low);
  assert.ok(params.x > 0 && params.x < 1, 'a sun near the horizon fades the far shadow in');

  shadow.setQuality(0, 0);
  assert.equal(shadow.target, null);
  assert.equal(params.x, 0);
  // Never null: a shadow sampler without a comparison depth texture fails draw validation.
  const none = farSunShadowUniforms.uFarSunShadowMap.value;
  assert.ok(none.isDepthTexture && none.compareFunction === THREE.LessEqualCompare && none.version > 0);
});

test('only balanced and high pay for the far map, and SkyAtmosphere forwards the preset', () => {
  assert.ok(RENDER_QUALITY.high.farShadowMapSize > 0 && RENDER_QUALITY.balanced.farShadowMapSize > 0);
  assert.equal(RENDER_QUALITY.performance.farShadowMapSize, 0);
  assert.equal(RENDER_QUALITY.ultraLow.farShadowMapSize, 0);
  for (const tier of ['high', 'balanced']) {
    assert.ok(0.7 * RENDER_QUALITY[tier].farShadowRange >= 2000, `${tier} holds full strength to 2 km`);
  }

  const renderer = fakeRenderer();
  const sky = new SkyAtmosphere(new THREE.Scene());
  sky.renderer = renderer;
  const camera = new THREE.PerspectiveCamera();
  sky.setFarShadowQuality(RENDER_QUALITY.balanced.farShadowMapSize, RENDER_QUALITY.balanced.farShadowRange);
  sky.prepareRender(camera, new THREE.Vector3(), () => 0);
  assert.equal(renderer.passes.length, 1);
  sky.setFarShadowQuality(RENDER_QUALITY.performance.farShadowMapSize, RENDER_QUALITY.performance.farShadowRange);
  sky.prepareRender(camera, new THREE.Vector3(), () => 0);
  assert.equal(renderer.passes.length, 1);
  assert.equal(farSunShadowUniforms.uFarSunShadowParams.value.x, 0);
});

test('receivers get the far term on the sun and keep the hook they already had', () => {
  assert.ok(farSunShadowLightsChunk(), 'three still has the directional-light line this patches');
  assert.equal(farSunShadowLightsChunk('void main() {}'), null);

  const material = new THREE.MeshStandardMaterial();
  material.onBeforeCompile = (shader) => { shader.uniforms.uEarlier = { value: 7 }; };
  material.customProgramCacheKey = () => 'earlier-key';
  assert.equal(applyFarSunShadow(material), material);
  const hook = material.onBeforeCompile;
  applyFarSunShadow(material);
  assert.equal(material.onBeforeCompile, hook, 'applying twice does not wrap twice');

  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  assert.equal(shader.uniforms.uEarlier.value, 7);
  for (const [name, uniform] of Object.entries(farSunShadowUniforms)) {
    assert.equal(shader.uniforms[name], uniform, `${name} is shared by reference`);
  }
  assert.match(shader.vertexShader, /vFarSunShadowCoord = \( uFarSunShadowMatrix \* modelMatrix/);
  assert.match(shader.fragmentShader, /float farSunShadowVisibility\(\)/);
  assert.match(shader.fragmentShader,
    /getDirectionalLightInfo\( directionalLight, directLight \);\s*directLight\.color \*= farSunShadowTerm;/);
  assert.ok(!shader.fragmentShader.includes('#include <lights_fragment_begin>'));

  // Two opted-in materials with different earlier hooks must not share a program.
  const plain = applyFarSunShadow(new THREE.MeshStandardMaterial());
  assert.notEqual(material.customProgramCacheKey(), plain.customProgramCacheKey());
  assert.match(material.customProgramCacheKey(), /^earlier-key\|farSunShadow\|/);

  // A shader without the anchors is left exactly as it was.
  const custom = { uniforms: {}, vertexShader: 'void main() {}', fragmentShader: 'void main() {}' };
  const warn = console.warn;
  console.warn = () => {};
  try { plain.onBeforeCompile(custom, null); } finally { console.warn = warn; }
  assert.deepEqual(custom, { uniforms: {}, vertexShader: 'void main() {}', fragmentShader: 'void main() {}' });
});

test('casters opt in per mesh without leaving the default layer', () => {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh();
  const child = new THREE.Mesh();
  mesh.add(child);
  group.add(mesh);
  castFarSunShadow(group);
  for (const node of [mesh, child]) {
    assert.ok(node.layers.isEnabled(FAR_SUN_SHADOW_LAYER));
    assert.ok(node.layers.isEnabled(0), 'still drawn by the view camera and the near shadow pass');
  }
  assert.ok(!group.layers.isEnabled(FAR_SUN_SHADOW_LAYER));
  castFarSunShadow(group, false);
  assert.ok(!mesh.layers.isEnabled(FAR_SUN_SHADOW_LAYER));
});
