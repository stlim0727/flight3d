import * as THREE from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { useProjectionDepth } from './CockpitDepth.js';

// Layer zero remains the beauty view. These layers isolate the AO geometry and
// the emissive instruments, which are redrawn unchanged after the AO composite.
const DECK_LAYER = 1;
const DISPLAY_LAYER = 2;
const AO_FAR = 8;

export class CockpitOcclusion {
  constructor(scene, camera, cockpit) {
    this.scene = scene;
    this.camera = camera;
    this.cockpit = cockpit;
    this.aoCamera = camera.clone();
    // SSAOPass snapshots this range when it constructs its depth uniforms.
    this.aoCamera.far = AO_FAR;
    this.aoCamera.updateProjectionMatrix();
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
    useProjectionDepth(this.pass.normalMaterial);
    this.pass.kernelRadius = 0.3;
    // three's blur is a single 3x3 box at half resolution, which leaves the
    // SSAO blue-noise dither visible as a dot grid on broad lit surfaces
    // (seats, floor panels). A dual-scale 3x3 averages several noise periods
    // while the tight ring keeps contact edges.
    this.pass.blurMaterial.fragmentShader = `
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      varying vec2 vUv;
      void main() {
        vec2 texel = 1.0 / resolution;
        float sum = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2( float( x ), float( y ) ) * texel;
            sum += texture2D( tDiffuse, vUv + offset ).r;
            sum += texture2D( tDiffuse, vUv + offset * 2.5 ).r;
          }
        }
        gl_FragColor = vec4( vec3( clamp( sum / 18.0, 0.0, 1.0 ) ), 1.0 );
      }
    `;
    this.pass.blurMaterial.needsUpdate = true;
    // SSAOPass expresses its depth rejection bounds in normalized linear depth.
    this.pass.minDistance = 0.003 / (AO_FAR - this.aoCamera.near);
    this.pass.maxDistance = 0.45 / (AO_FAR - this.aoCamera.near);
    const copy = this.pass.copyMaterial;
    copy.uniforms.deckDepth = { value: this.pass.normalRenderTarget.depthTexture };
    copy.fragmentShader = copy.fragmentShader.replace('uniform float opacity;',
      'uniform float opacity;\nuniform sampler2D deckDepth;').replace(
      'gl_FragColor = opacity * texel;',
      // Correct metre-based depth produces substantially more occlusion. Keep
      // contact shading from overpowering the independent cast-sunlight bands.
      `float ao = texture2D( deckDepth, vUv ).r >= 1.0 ? 1.0 : max( 0.75, pow( texel.r, 1.2 ) );
      gl_FragColor = vec4( vec3( ao ), 1.0 );`
    );
  }

  render(renderer, quality, reduced = false) {
    if (!this.enabled || quality === 'performance' || !this.cockpit.gltfCockpitLoaded) return;
    if (!this.pass) this.init();
    const camera = this.aoCamera;
    camera.copy(this.camera);
    camera.far = AO_FAR; // Cockpit metres, independent of the 45 km exterior depth range.
    camera.layers.set(DECK_LAYER);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.getDrawingBufferSize(this.size);
    const scale = Math.min(quality === 'high' ? 0.75 : 0.5, 960 / this.size.x);
    // While the photo cockpit is only a transitional head-turn view, the cabin
    // fills the viewport so the depth early-out never fires; quarter the AO
    // budget there instead of paying the steady forward-view cost.
    const aoScale = reduced ? Math.min(scale, 480 / this.size.x) : scale;
    const w = Math.max(1, Math.round(this.size.x * aoScale));
    const h = Math.max(1, Math.round(this.size.y * aoScale));
    if (this.pass.width !== w || this.pass.height !== h) this.pass.setSize(w, h);
    // Keep linearization and metre-based rejection consistent with the camera,
    // including near-plane and FOV changes that happen without resizing targets.
    for (const material of [this.pass.ssaoMaterial, this.pass.depthRenderMaterial]) {
      material.uniforms.cameraNear.value = camera.near;
      material.uniforms.cameraFar.value = camera.far;
    }
    this.pass.minDistance = 0.003 / (camera.far - camera.near);
    this.pass.maxDistance = 0.45 / (camera.far - camera.near);
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

  canWarm(quality) {
    return !this.pass && this.enabled && quality !== 'performance' && quality !== 'ultraLow' && this.cockpit.gltfCockpitLoaded;
  }

  // Photo mode looking forward never runs render(), so a lazy init() would land
  // its construction, shader compilation and target sizing on the first
  // look-away frame (~100ms hitch). Pay that cost here instead: one screen
  // beauty pass with the interior forced visible and unculled, then both AO
  // scale tiers. The normal renderScene later in the frame redraws the screen.
  warm(renderer, quality) {
    if (!this.canWarm(quality)) return;
    const deck = this.cockpit.gltfCockpitGroup;
    // Photo mode hides the whole cockpit.group ancestor; un-hide it too or the
    // warm draw stays invisible and compiles nothing.
    const deckWasVisible = deck.visible;
    const groupWasVisible = this.cockpit.group.visible;
    deck.visible = true;
    this.cockpit.group.visible = true;
    const previous = renderer.getRenderTarget();
    const scratch = new THREE.WebGLRenderTarget(8, 8);
    try {
      const camera = this.camera;
      const layers = camera.layers.mask;
      const frustumState = [];
      try {
        camera.layers.set(0);
        deck.traverse(node => {
          if (!node.isMesh) return;
          frustumState.push([node, node.frustumCulled]);
          node.frustumCulled = false; // ensure aft-facing deck batches really draw
        });
        // Screen output so the sRGB program variants match the real frames.
        // The beauty draw compiles the deck with the cockpit sun shadow state;
        // this frame's visible draw is overwritten by the normal renderScene
        // immediately after.
        renderer.setRenderTarget(null);
        renderer.render(this.scene, this.camera);
        this.render(renderer, quality || 'balanced');
        // Pre-size both AO tiers so neither the first look-forward nor the
        // first reduced look-away frame reallocates render targets.
        renderer.setRenderTarget(scratch);
        this.render(renderer, quality || 'balanced', true);
      } finally {
        for (const [node, was] of frustumState) node.frustumCulled = was;
        camera.layers.mask = layers;
      }
    } finally {
      deck.visible = deckWasVisible;
      this.cockpit.group.visible = groupWasVisible;
      renderer.setRenderTarget(previous);
      scratch.dispose();
    }
  }

  dispose() {
    this.pass?.dispose();
    this.pass = null;
  }
}
