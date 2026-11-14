import * as THREE from 'three';

/**
 * Sun shadows beyond the airframe's own map (#745).
 *
 * The sun's shadow map is a 32–120 m box around the aircraft so that gear and wing shadows
 * keep centimetre texels; ridges, trees and buildings further out cast nothing. This adds a
 * second, coarse depth map over a few kilometres around the camera. Receivers opt in with
 * `applyFarSunShadow(material)` and multiply the sun's direct light by it; casters opt in
 * with `castFarSunShadow(object)`. Nothing else in the scene changes, so the near map, the
 * flight deck light and every material that does not opt in render exactly as before.
 *
 * The map is fixed in world space between refreshes and snapped to its texel grid, so it is
 * redrawn only when the camera has moved a few percent of its width, the sun has moved, or
 * it has grown old enough that asynchronously loaded scenery may be missing.
 */

/** Cockpit occlusion owns layers 1 and 2. */
export const FAR_SUN_SHADOW_LAYER = 5;

// Light-plane distances as a fraction of the map's full width.
const FADE_START = 0.35; // full strength inside 0.7 × range
const FADE_END = 0.44;
const EDGE_FADE = 0.03;
// The fade above is centred on the live focus while the map lags by up to this much of its
// half-width, so FADE_END + REFRESH_FRACTION / 2 must stay inside 0.5 - EDGE_FADE.
const REFRESH_FRACTION = 0.06;

const WORLD_FLOOR_M = -100;
const WORLD_CEILING_M = 9000;
// A low sun reaches the ceiling tens of kilometres up-sun; the terrain itself ends first.
const MAX_REACH_M = 30000;
const MAX_AGE_MS = 4000;
const SUN_MOVE_COS = Math.cos(THREE.MathUtils.degToRad(0.1));
// Below about 2° the sun's direct term is already fading and the box becomes a sliver.
const SUN_FADE_LOW = 0.035;
const SUN_FADE_HIGH = 0.12;
// The map holds only faces turned away from the sun (three's own convention for one-sided
// materials), and only faces turned towards it look themselves up; the others are shadowed
// outright. A lit surface is then never compared with its own depth, so texels metres wide
// need no slope bias — which at a low sun would have to exceed the height of a tree. This
// is depth-precision slack only.
const BIAS_M = 0.5;

function comparisonDepthTexture(size) {
  // Same layout as three's own PCF shadow maps: a comparison depth texture, linear taps.
  const depth = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
  depth.format = THREE.DepthFormat;
  depth.compareFunction = THREE.LessEqualCompare;
  depth.minFilter = depth.magFilter = THREE.LinearFilter;
  return depth;
}

// Bound whenever there is no map. A shadow sampler left without a comparison texture fails
// draw validation and the whole mesh disappears, even though a zero strength never reads it;
// three's own stand-in for a null shadow sampler is never uploaded.
const NO_MAP = comparisonDepthTexture(1);
NO_MAP.name = 'farSunShadowNone';
NO_MAP.needsUpdate = true;

/** Shared by reference with every opted-in material, so one write updates them all. */
export const farSunShadowUniforms = {
  uFarSunShadowMap: { value: NO_MAP },
  uFarSunShadowMatrix: { value: new THREE.Matrix4() },
  // Live focus in map UV, for the distance fade.
  uFarSunShadowFocus: { value: new THREE.Vector2(0.5, 0.5) },
  // x: strength 0..1, y: depth bias, z: texel size in UV.
  uFarSunShadowParams: { value: new THREE.Vector4(0, 0, 0, 0) },
};

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _up = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const UV_FROM_CLIP = new THREE.Matrix4().set(
  0.5, 0, 0, 0.5,
  0, 0.5, 0, 0.5,
  0, 0, 0.5, 0.5,
  0, 0, 0, 1,
);

/**
 * Place an orthographic box of `halfSize` looking down the sun's rays at `focus`.
 *
 * The centre is snapped to the map's texel grid in the light plane, so a refresh a few
 * texels along does not make shadow edges crawl. Depth runs from the world ceiling up-sun
 * to the world floor down-sun, widened by the height the tilted box itself spans, so a
 * ridge outside the box horizontally still casts into it.
 */
export function farSunShadowPlacement(sunDirection, focus, halfSize, mapSize, out = {}) {
  _z.copy(sunDirection).normalize();
  if (Math.abs(_z.y) > 0.99) _up.set(0, 0, 1); else _up.set(0, 1, 0);
  _x.crossVectors(_up, _z).normalize();
  _y.crossVectors(_z, _x);
  const texel = 2 * halfSize / mapSize;
  const u = Math.round(focus.dot(_x) / texel) * texel;
  const v = Math.round(focus.dot(_y) / texel) * texel;
  const centre = (out.centre ??= new THREE.Vector3())
    .set(0, 0, 0).addScaledVector(_x, u).addScaledVector(_y, v).addScaledVector(_z, focus.dot(_z));
  const sin = Math.max(_z.y, 1e-3);
  const tilt = halfSize * Math.abs(_y.y);
  const toSun = THREE.MathUtils.clamp((WORLD_CEILING_M - centre.y + tilt) / sin, 10, MAX_REACH_M);
  const away = THREE.MathUtils.clamp((centre.y - WORLD_FLOOR_M + tilt) / sin, 10, MAX_REACH_M);
  out.position = (out.position ??= new THREE.Vector3()).copy(centre).addScaledVector(_z, toSun + 1);
  out.quaternion = (out.quaternion ??= new THREE.Quaternion())
    .setFromRotationMatrix(_basis.makeBasis(_x, _y, _z));
  out.axisU = (out.axisU ??= new THREE.Vector3()).copy(_x);
  out.axisV = (out.axisV ??= new THREE.Vector3()).copy(_y);
  out.u = u;
  out.v = v;
  out.near = 1;
  out.far = 1 + toSun + away;
  out.texel = texel;
  return out;
}

/** Let `root`'s meshes be drawn into the far map. The layer is not inherited, so traverse. */
export function castFarSunShadow(root, cast = true) {
  root?.traverse?.((node) => {
    if (!node.isMesh) return;
    if (cast) node.layers.enable(FAR_SUN_SHADOW_LAYER); else node.layers.disable(FAR_SUN_SHADOW_LAYER);
  });
  return root;
}

const PARS_VERTEX = `
uniform mat4 uFarSunShadowMatrix;
varying vec3 vFarSunShadowCoord;`;

const MAIN_VERTEX = `
{
  vec4 farSunShadowWorld = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    farSunShadowWorld = batchingMatrix * farSunShadowWorld;
  #endif
  #ifdef USE_INSTANCING
    farSunShadowWorld = instanceMatrix * farSunShadowWorld;
  #endif
  vFarSunShadowCoord = ( uFarSunShadowMatrix * modelMatrix * farSunShadowWorld ).xyz;
}`;

const PARS_FRAGMENT = `
uniform highp sampler2DShadow uFarSunShadowMap;
uniform vec2 uFarSunShadowFocus;
uniform vec4 uFarSunShadowParams;
varying vec3 vFarSunShadowCoord;
float farSunShadowVisibility() {
  float strength = uFarSunShadowParams.x;
  if ( strength <= 0.0 ) return 1.0;
  vec3 c = vFarSunShadowCoord;
  vec2 edge = min( c.xy, 1.0 - c.xy );
  float fade = smoothstep( 0.0, ${EDGE_FADE.toFixed(3)}, min( edge.x, edge.y ) )
    * ( 1.0 - smoothstep( ${FADE_START.toFixed(3)}, ${FADE_END.toFixed(3)}, distance( c.xy, uFarSunShadowFocus ) ) );
  if ( fade <= 0.0 || c.z <= 0.0 || c.z >= 1.0 ) return 1.0;
  // A triangle that shows the sun its back is in the map itself, so comparing it with its
  // own depth would only stripe it. It is in its own shadow by construction: leaving it to a
  // smoothed shading normal lights single triangles inside a ridge's cast shadow. It faces
  // the sun when screen and map see it wound the same way.
  vec2 dx = dFdx( c.xy );
  vec2 dy = dFdy( c.xy );
  if ( ( dx.x * dy.y - dx.y * dy.x > 0.0 ) != gl_FrontFacing ) return 1.0 - fade * strength;
  float depth = c.z - uFarSunShadowParams.y;
  vec2 tap = vec2( 0.5 * uFarSunShadowParams.z );
  float lit = 0.25 * (
    texture( uFarSunShadowMap, vec3( c.xy + tap * vec2( -1.0, -1.0 ), depth ) ) +
    texture( uFarSunShadowMap, vec3( c.xy + tap * vec2( 1.0, -1.0 ), depth ) ) +
    texture( uFarSunShadowMap, vec3( c.xy + tap * vec2( -1.0, 1.0 ), depth ) ) +
    texture( uFarSunShadowMap, vec3( c.xy + tap * vec2( 1.0, 1.0 ), depth ) ) );
  return 1.0 - ( 1.0 - lit ) * fade * strength;
}`;

const COMMON = '#include <common>';
const PROJECT = '#include <project_vertex>';
const LIGHTS = '#include <lights_fragment_begin>';
const SUN_TERM = 'getDirectionalLightInfo( directionalLight, directLight );';

/** three's direct-light loop with the far map multiplied into every directional light. */
export function farSunShadowLightsChunk(chunk = THREE.ShaderChunk.lights_fragment_begin) {
  if (!chunk.includes(SUN_TERM)) return null;
  return `float farSunShadowTerm = farSunShadowVisibility();\n${
    chunk.replace(SUN_TERM, `${SUN_TERM}\n\t\tdirectLight.color *= farSunShadowTerm;`)}`;
}

let warned = false;

/**
 * Make a lit built-in material receive the far map. Chains any existing `onBeforeCompile`
 * and program cache key. A shader without the expected anchors is left untouched rather
 * than half-patched.
 */
export function applyFarSunShadow(material) {
  if (!material || material.userData?.farSunShadow) return material;
  material.userData = material.userData || {};
  material.userData.farSunShadow = true;
  const previousCompile = material.onBeforeCompile;
  const previousKey = typeof material.customProgramCacheKey === 'function'
    ? material.customProgramCacheKey.bind(material) : null;
  const previousSource = typeof previousCompile === 'function' ? previousCompile.toString() : '';
  material.onBeforeCompile = function (shader, renderer) {
    if (typeof previousCompile === 'function') previousCompile.call(this, shader, renderer);
    const lights = farSunShadowLightsChunk();
    const { vertexShader: vertex, fragmentShader: fragment } = shader;
    if (!lights || !vertex?.includes(COMMON) || !vertex.includes(PROJECT)
      || !fragment?.includes(COMMON) || !fragment.includes(LIGHTS)) {
      if (!warned) console.warn('[FarSunShadow] shader anchors missing; material left unshadowed', this.name || this.type);
      warned = true;
      return;
    }
    Object.assign(shader.uniforms, farSunShadowUniforms);
    shader.vertexShader = vertex
      .replace(COMMON, `${COMMON}${PARS_VERTEX}`)
      .replace(PROJECT, `${PROJECT}${MAIN_VERTEX}`);
    shader.fragmentShader = fragment
      .replace(COMMON, `${COMMON}${PARS_FRAGMENT}`)
      .replace(LIGHTS, lights);
  };
  // three keys programs on onBeforeCompile's source, which is now this wrapper for every
  // opted-in material, so the hook it wraps has to stay part of the key.
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|farSunShadow|${previousSource}`;
  material.needsUpdate = true;
  return material;
}

export class FarSunShadow {
  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2);
    this.camera.layers.set(FAR_SUN_SHADOW_LAYER);
    // Back faces only; see BIAS_M. A one-sided wall facing the sun therefore casts nothing.
    this.depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.BackSide });
    this.mapSize = 0;
    this.range = 0;
    this.target = null;
    this.placement = {};
    this.rendered = null; // what the map on screen was drawn from
    this.renderCount = 0;
  }

  /** `mapSize` 0 turns the pass off and frees the map. */
  setQuality(mapSize = 0, range = 0) {
    const size = mapSize > 0 && range > 0 ? mapSize : 0;
    if (size === this.mapSize && range === this.range) return;
    this.mapSize = size;
    this.range = range;
    this.disposeTarget();
  }

  /** The casters changed in a way the refresh rules cannot see; redraw on the next frame. */
  invalidate() {
    this.rendered = null;
  }

  disposeTarget() {
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    this.target = null;
    this.rendered = null;
    farSunShadowUniforms.uFarSunShadowMap.value = NO_MAP;
    farSunShadowUniforms.uFarSunShadowParams.value.x = 0;
  }

  dispose() {
    this.disposeTarget();
    this.depthMaterial.dispose();
  }

  ensureTarget(renderer) {
    const size = Math.min(this.mapSize, renderer.capabilities?.maxTextureSize ?? this.mapSize);
    if (this.target?.width === size) return size;
    this.disposeTarget();
    this.target = new THREE.WebGLRenderTarget(size, size);
    this.target.depthTexture = comparisonDepthTexture(size);
    this.target.depthTexture.name = 'farSunShadowMap';
    return size;
  }

  /**
   * Refresh the map if its inputs moved, and publish this frame's uniforms. Call before the
   * near map's own refresh decision, immediately before `renderer.render`.
   *
   * @param {object} frame
   * @param {THREE.WebGLRenderer} frame.renderer
   * @param {THREE.Scene} frame.scene
   * @param {THREE.Camera} frame.camera view camera
   * @param {THREE.Vector3} frame.sunDirection towards the sun
   * @param {number} frame.strength 0..1 darkness of a fully occluded texel, weather included
   * @param {(x: number, z: number) => number} [frame.groundHeightAt]
   * @param {number} [frame.now] milliseconds
   * @returns {boolean} whether the map was redrawn
   */
  update({ renderer, scene, camera, sunDirection, strength = 1, groundHeightAt, now = performance.now() }) {
    const params = farSunShadowUniforms.uFarSunShadowParams.value;
    const sunHeight = sunDirection.y / (sunDirection.length() || 1);
    const amount = strength * THREE.MathUtils.smoothstep(sunHeight, SUN_FADE_LOW, SUN_FADE_HIGH);
    if (!renderer?.shadowMap?.enabled || this.mapSize <= 0 || !(amount > 0)) {
      params.x = 0;
      return false;
    }
    const size = this.ensureTarget(renderer);
    // Centre on the ground under the camera: from altitude the camera's own height would
    // slide the box off the terrain it is looking down at.
    _focus.copy(camera.position);
    const ground = groundHeightAt?.(_focus.x, _focus.z);
    if (Number.isFinite(ground)) _focus.y = Math.min(_focus.y, ground);
    const place = farSunShadowPlacement(sunDirection, _focus, this.range, size, this.placement);
    const last = this.rendered;
    const refresh = REFRESH_FRACTION * this.range;
    const stale = !last
      || now - last.at > MAX_AGE_MS
      || last.sun.dot(_z) < SUN_MOVE_COS
      || Math.abs(place.u - last.u) > refresh
      || Math.abs(place.v - last.v) > refresh;
    if (stale) this.render(renderer, scene, place, size, now);
    const drawn = this.rendered;
    farSunShadowUniforms.uFarSunShadowFocus.value.set(
      0.5 + (_focus.dot(drawn.axisU) - drawn.u) / (2 * this.range),
      0.5 + (_focus.dot(drawn.axisV) - drawn.v) / (2 * this.range),
    );
    params.x = amount;
    return stale;
  }

  render(renderer, scene, place, size, now) {
    const camera = this.camera;
    camera.left = camera.bottom = -this.range;
    camera.right = camera.top = this.range;
    camera.near = place.near;
    camera.far = place.far;
    camera.position.copy(place.position);
    camera.quaternion.copy(place.quaternion);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const shadowMap = renderer.shadowMap;
    const saved = {
      target: renderer.getRenderTarget(),
      override: scene.overrideMaterial,
      autoUpdate: shadowMap.autoUpdate,
      needsUpdate: shadowMap.needsUpdate,
    };
    // This render must not consume the lights' own pending shadow refreshes: three would
    // build them with this camera's layer mask and then mark them done.
    shadowMap.autoUpdate = false;
    shadowMap.needsUpdate = false;
    scene.overrideMaterial = this.depthMaterial;
    try {
      renderer.setRenderTarget(this.target);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = saved.override;
      shadowMap.autoUpdate = saved.autoUpdate;
      shadowMap.needsUpdate = saved.needsUpdate;
      renderer.setRenderTarget(saved.target);
    }

    farSunShadowUniforms.uFarSunShadowMap.value = this.target.depthTexture;
    farSunShadowUniforms.uFarSunShadowMatrix.value
      .multiplyMatrices(UV_FROM_CLIP, camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    const params = farSunShadowUniforms.uFarSunShadowParams.value;
    params.y = BIAS_M / (place.far - place.near);
    params.z = 1 / size;
    const drawn = (this.rendered ??= { sun: new THREE.Vector3(), axisU: new THREE.Vector3(), axisV: new THREE.Vector3() });
    drawn.at = now;
    drawn.sun.copy(_z);
    drawn.axisU.copy(place.axisU);
    drawn.axisV.copy(place.axisV);
    drawn.u = place.u;
    drawn.v = place.v;
    this.renderCount += 1;
  }
}
