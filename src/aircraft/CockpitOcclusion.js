import * as THREE from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

// Layer zero remains the beauty view. These layers isolate the AO geometry and
// the emissive instruments, which are redrawn unchanged after the AO composite.
const DECK_LAYER = 1;
const DISPLAY_LAYER = 2;

export class CockpitOcclusion {
  constructor(scene, camera, cockpit) {
    this.scene = scene;
    this.camera = camera;
    this.cockpit = cockpit;
    this.aoCamera = camera.clone();
    this.pass = null;
    this.size = new THREE.Vector2();
    this.enabled = true;
  }

  init() {
    this.cockpit.gltfCockpitGroup.traverse(node => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some(m => m.transparent)) return;
      node.layers.enable(materials.every(m => m.isMeshBasicMaterial) ? DISPLAY_LAYER : DECK_LAYER);
    });
    this.pass = new SSAOPass(this.scene, this.aoCamera, 1, 1, 16);
    this.pass.renderToScreen = true;
    this.pass.normalMaterial.side = THREE.DoubleSide;
    this.pass.kernelRadius = 0.3;
    // SSAOPass expresses its depth rejection bounds in normalized linear depth.
    this.pass.minDistance = 0.003 / (8 - this.camera.near);
    this.pass.maxDistance = 0.45 / (8 - this.camera.near);
    const copy = this.pass.copyMaterial;
    copy.uniforms.deckDepth = { value: this.pass.normalRenderTarget.depthTexture };
    copy.fragmentShader = copy.fragmentShader.replace('uniform float opacity;',
      'uniform float opacity;\nuniform sampler2D deckDepth;').replace(
      'gl_FragColor = opacity * texel;',
      `float ao = texture2D( deckDepth, vUv ).r >= 1.0 ? 1.0 : max( 0.45, pow( texel.r, 2.4 ) );
      gl_FragColor = vec4( vec3( ao ), 1.0 );`
    );
  }

  render(renderer, quality) {
    if (!this.enabled || quality === 'performance' || !this.cockpit.gltfCockpitLoaded) return;
    if (!this.pass) this.init();
    const camera = this.aoCamera;
    camera.copy(this.camera);
    camera.far = 8; // Cockpit metres, independent of the 45 km exterior depth range.
    camera.layers.set(DECK_LAYER);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.getDrawingBufferSize(this.size);
    const scale = Math.min(quality === 'high' ? 0.75 : 0.5, 960 / this.size.x);
    const w = Math.max(1, Math.round(this.size.x * scale));
    const h = Math.max(1, Math.round(this.size.y * scale));
    if (this.pass.width !== w || this.pass.height !== h) this.pass.setSize(w, h);
    // Projection also changes with cockpit look/portrait FOV without a resize.
    this.pass.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
    this.pass.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);

    const target = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const shadowDirty = renderer.shadowMap.needsUpdate;
    const override = this.scene.overrideMaterial;
    const layers = this.camera.layers.mask;
    try {
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      this.pass.renderToScreen = target === null;
      this.pass.render(renderer, null, target);
      renderer.autoClear = false;
      this.camera.layers.set(DISPLAY_LAYER);
      renderer.render(this.scene, this.camera);
    } finally {
      this.pass._restoreVisibility();
      this.camera.layers.mask = layers;
      this.scene.overrideMaterial = override;
      renderer.setRenderTarget(target);
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = shadowAuto;
      renderer.shadowMap.needsUpdate = shadowDirty;
    }
  }

  dispose() {
    this.pass?.dispose();
    this.pass = null;
  }
}
