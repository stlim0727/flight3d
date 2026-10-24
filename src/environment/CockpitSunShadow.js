import * as THREE from 'three';
import {
  APERTURE_OPENINGS,
  DECK_SUN_ANCHOR,
  DECK_SUN_STANDOFF,
  DECK_SUN_AFT_REACH,
  DECK_SUN_RADIUS,
  DECK_SUN_CLIP_T,
  directAdmittance,
  referenceDirectAdmittance,
  paneOutwardNormal,
} from '../aircraft/CockpitAperture.js';


/** Square size of the windshield cookie texture in pixels. */
export const COOKIE_SIZE = 256;

/** Bounce is baked separately; direct sun has no artificial background spill. */
export const COOKIE_LEAK = 0;

/** Radians the deck-local sun may move before the cookie is repainted. */
export const COOKIE_REDRAW_ANGLE = 0.008;

/** Time constant, in seconds, for the deck sun fading in and out with the camera mode. */
const MODE_TIME_CONSTANT = 0.12;

/** Fractional horizontal sun component below which the deck-horizontal axis is carried over. */
const AXIS_CARRY_THRESHOLD = 0.1;

const _aircraftMatrix = new THREE.Matrix4();
const _localScale = new THREE.Vector3(1, 1, 1);
const _paneMatrix = new THREE.Matrix4();
const _paneCenter = new THREE.Vector3();
const _paneQuat = new THREE.Quaternion();
const _paneEuler = new THREE.Euler();
const _paneNormal = new THREE.Vector3();
const _invQuat = new THREE.Quaternion();
const _point = new THREE.Vector3();
const _corner = new THREE.Vector3();
const _lightLocal = new THREE.Vector3();

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Shadow-image axes, in aircraft-local coordinates.
 *
 * The shadow camera aims along the sun vector, but its roll is free. Deriving it from the
 * deck instead of from world up keeps the cookie and the shadow map fixed relative to the
 * interior, so the sunlight pattern depends only on where the sun is *in the aircraft* and
 * one repaint covers every pitch and bank. The axis is the deck-horizontal line
 * perpendicular to the sun; it degenerates only for a sun straight overhead, where the
 * previous axis, re-orthogonalised, lets the pattern roll instead of jumping.
 */
export function cookieAxes(sunDirLocal, previousX, axes = { x: new THREE.Vector3(), y: new THREE.Vector3() }) {
  const horizontal = Math.hypot(sunDirLocal.x, sunDirLocal.z);
  if (previousX && previousX.lengthSq() > 0.5 && horizontal < AXIS_CARRY_THRESHOLD) {
    axes.x.copy(previousX).addScaledVector(sunDirLocal, -previousX.dot(sunDirLocal));
    if (axes.x.lengthSq() < 1e-12) axes.x.set(0, 0, -1);
    else axes.x.normalize();
  } else if (horizontal > 1e-6) {
    axes.x.set(sunDirLocal.z, 0, -sunDirLocal.x).divideScalar(horizontal);
  } else {
    axes.x.set(0, 0, -1);
  }
  axes.y.crossVectors(sunDirLocal, axes.x).normalize();
  return axes;
}

/**
 * The windshield openings as seen from the deck sun, in cookie texture coordinates.
 *
 * A point and its shadow along the light ray share texture coordinates, so projecting the
 * real pane rectangles is enough: whatever surface the beam lands on is lit by the same
 * quad. Returned quads are reused between calls; canvas rows are flipped so that v = 0 is
 * the bottom of the texture, which is how a canvas maps to a three.js texture.
 */
export function projectPanesForCookie({
  sunDirLocal,
  axes,
  angle,
  panes = APERTURE_OPENINGS,
  anchor = DECK_SUN_ANCHOR,
  standOff = DECK_SUN_STANDOFF,
  quads = [],
}) {
  _lightLocal.copy(anchor).addScaledVector(sunDirLocal, standOff);
  const scale = 1 / Math.tan(angle);
  quads.length = 0;

  for (let i = 0; i < panes.length; i++) {
    const pane = panes[i];
    const quad = quads[i] ??= [];
    quad.length = 0;
    // A pane opens only toward the exterior. Projecting its back face would
    // otherwise paint a beam through the opposite, closed side of the fuselage.
    if (paneOutwardNormal(pane, _paneNormal).dot(sunDirLocal) <= 0) continue;
    _paneCenter.set(pane.center[0], pane.center[1], pane.center[2]);
    _paneEuler.set(pane.rotation[0], pane.rotation[1], pane.rotation[2]);
    _paneQuat.setFromEuler(_paneEuler);
    _paneMatrix.compose(_paneCenter, _paneQuat, _localScale);

    const halfW = pane.size[0] / 2;
    const halfH = pane.size[1] / 2;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      _corner.set(sx * halfW, sy * halfH, 0).applyMatrix4(_paneMatrix);
      _point.copy(_corner).sub(_lightLocal);
      // Camera space looks along -sunDir, so depth in front of the light is negative here.
      const depth = -_point.dot(sunDirLocal);
      if (depth <= 0) {
        quad.length = 0;
        break;
      }
      quad.push(
        0.5 + 0.5 * scale * (_point.dot(axes.x) / depth),
        0.5 - 0.5 * scale * (_point.dot(axes.y) / depth),
      );
    }
  }
  return quads;
}

/**
 * Paints one cookie: light everywhere the sun may not reach the deck, openings where the
 * windshield is. The shipped airframe skin is a closed low-poly tube without glass cut-outs,
 * so the openings have to be drawn here rather than left to the geometry.
 */
export function drawCockpitCookie(ctx, quads, size = COOKIE_SIZE, leak = COOKIE_LEAK) {
  const shade = Math.round(255 * leak);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#ffffff';
  ctx.lineJoin = 'round';
  for (const quad of quads) {
    if (quad.length < 8) continue;
    ctx.beginPath();
    ctx.moveTo(quad[0] * size, quad[1] * size);
    for (let i = 2; i < 8; i += 2) ctx.lineTo(quad[i] * size, quad[i + 1] * size);
    ctx.closePath();
    ctx.fill();
    // Feathered edge: a point source is not a slide projector.
    for (const [width, alpha] of [[1.5, 0.15]]) {
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }
}

/**
 * Pose of the deck sun rig for one frame.
 *
 * `t(P) = sunDir · (P - anchor)` measures how far along the sun vector a point sits, so a
 * light standing `standOff` along it sees that point at depth `standOff - t(P)`. The near
 * plane includes the entire window frame. Closed exterior shadow proxies are excluded
 * specifically from this light's depth pass, so no pillar needs to be clipped away.
 *
 * Returns a shared object; the vectors are overwritten by the next call.
 */
export function computeDeckSunPose({
  position,
  quaternion,
  sunDir,
  panes = APERTURE_OPENINGS,
  anchor = DECK_SUN_ANCHOR,
  standOff = DECK_SUN_STANDOFF,
  aftReach = DECK_SUN_AFT_REACH,
  radius = DECK_SUN_RADIUS,
  clipT = DECK_SUN_CLIP_T,
  pose = {},
}) {
  _aircraftMatrix.compose(position, quaternion, _localScale);
  _invQuat.copy(quaternion).invert();

  pose.anchorWorld = (pose.anchorWorld ?? new THREE.Vector3()).copy(anchor).applyMatrix4(_aircraftMatrix);
  pose.lightPosition = (pose.lightPosition ?? new THREE.Vector3())
    .copy(pose.anchorWorld).addScaledVector(sunDir, standOff);
  pose.targetPosition = (pose.targetPosition ?? new THREE.Vector3()).copy(pose.anchorWorld);
  pose.sunDirLocal = (pose.sunDirLocal ?? new THREE.Vector3())
    .copy(sunDir).applyQuaternion(_invQuat).normalize();

  // Measured in the deck frame, where the panes are authored: no world-space round trip,
  // so only the sun's direction relative to the aircraft matters. A sun below the
  // horizon still clears the pane normals, so the horizon gate stays in update().
  const reference = referenceDirectAdmittance(panes);
  pose.admittance = reference > 0
    ? Math.min(1, directAdmittance(pose.sunDirLocal, panes) / reference) : 0;
  pose.apertureClipT = clipT;
  pose.near = Math.max(0.25, standOff - clipT);
  pose.far = Math.max(pose.near + 0.5, standOff + aftReach);
  pose.angle = Math.min(Math.PI / 2 - 0.01, Math.atan2(radius, pose.far) * 1.04);
  return pose;
}

/**
 * Sunlight inside the flight deck.
 *
 * The airframe shadow proxy keeps the exterior sun out of the deck, which otherwise leaves
 * the interior lit only by its own flood lights and therefore independent of the time of
 * day, the heading and the weather. This rig adds one localized light aimed through the
 * windshield, masked by a cookie painted from the real pane geometry, so the deck shell,
 * glareshield, yokes and seats carry the window pattern.
 *
 * It is a SpotLight rather than a second DirectionalLight on purpose: three treats a
 * fragment outside a shadow frustum as fully lit, so a tight directional light would add
 * unshadowed sun to the terrain, clouds and airport. The spot cone contributes zero outside
 * itself, and with `decay = 0` it behaves as parallel sun over the deck. The cookie rides on
 * that same cone, which is why no extra shadow caster is needed and the main sun's map stays
 * untouched.
 */
export class CockpitSunShadow {
  constructor(scene, { mapSize = 1024, size = COOKIE_SIZE } = {}) {
    this.pose = {};
    this.axes = { x: new THREE.Vector3(0, 0, -1), y: new THREE.Vector3(1, 0, 0) };
    this.light = new THREE.SpotLight(0xffffff, 0, 0, 0.14, 0.12, 0);
    this.light.name = 'Cockpit_Sun';
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(mapSize, mapSize);
    this.light.shadow.bias = -0.00008;
    this.light.shadow.normalBias = 0.005;
    this.light.shadow.camera.userData.cockpitSun = true;
    // The rig is always in the scene: adding or removing a shadow light would change
    // the compiled shader defines, and the pass is skipped by freezing the map instead.
    this.light.shadow.autoUpdate = false;
    this.light.shadow.needsUpdate = true;
    this.modeFactor = 0;
    this.cockpitActive = false;
    this.mapPending = true;
    scene.add(this.light, this.light.target);

    this.size = size;
    this.canvas = null;
    this.context = null;
    this.texture = null;
    this._drawnSunDir = new THREE.Vector3(0, 0, 1);
    this._previousAxis = new THREE.Vector3();
    this._quads = [];
    this.initCookie();
  }

  /** Canvas is a browser API; headless builds keep the rig unmapped and unpatterned. */
  initCookie() {
    if (typeof document === 'undefined') return;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.light.map = this.texture;
  }

  /** True when the deck-local sun moved enough that map and openings are stale. */
  sunMoved(sunDirLocal) {
    return sunDirLocal.angleTo(this._drawnSunDir) > COOKIE_REDRAW_ANGLE;
  }

  repaintCookie() {
    if (!this.context) return;
    const quads = projectPanesForCookie({
      sunDirLocal: this.pose.sunDirLocal,
      axes: this.axes,
      angle: this.pose.angle,
      quads: this._quads,
    });
    // The opaque boundary stays black; indirect illumination comes from the bake.
    drawCockpitCookie(this.context, quads, this.size, COOKIE_LEAK * this.pose.admittance);
    this.texture.needsUpdate = true;
  }

  /** @param {number} mapSize Square shadow map resolution for the current quality tier. */
  setQuality(mapSize) {
    this.light.shadow.mapSize.set(mapSize, mapSize);
    this.light.shadow.map?.dispose();
    this.light.shadow.map = null;
    this.mapPending = true;
    this.light.shadow.needsUpdate = true;
  }

  /**
   * @param {object} state
   * @param {THREE.Vector3} state.position Aircraft world position.
   * @param {THREE.Quaternion} state.quaternion Aircraft world orientation.
   * @param {THREE.Vector3} state.sunDir Unit vector toward the sun.
   * @param {THREE.Color} state.sunColor Ambient sun colour.
   * @param {number} state.sunIntensity Ambient sun intensity, weather included.
   * @param {boolean} state.cockpitActive 3D virtual cockpit is being rendered.
   * @param {number} state.dt Elapsed seconds for the mode ramp.
   * @returns {number} Legacy aperture diagnostic in 0..1, independent of flood control.
   */
  update({ position, quaternion, sunDir, sunColor, sunIntensity, cockpitActive, dt, casterState }) {
    computeDeckSunPose({ position, quaternion, sunDir, pose: this.pose });

    const sunDirLocal = this.pose.sunDirLocal;
    cookieAxes(sunDirLocal, this._previousAxis, this.axes);
    this._previousAxis.copy(this.axes.x);

    const sunMoved = this.sunMoved(sunDirLocal);
    if (sunMoved) {
      this._drawnSunDir.copy(sunDirLocal);
      this.repaintCookie();
    }
    if (cockpitActive && !this.cockpitActive) this.mapPending = true;
    this.cockpitActive = cockpitActive;

    const target = cockpitActive ? 1 : 0;
    const blend = 1 - Math.exp(-Math.max(0, dt) / MODE_TIME_CONSTANT);
    this.modeFactor += (target - this.modeFactor) * blend;

    this.light.position.copy(this.pose.lightPosition);
    this.light.target.position.copy(this.pose.targetPosition);
    this.light.angle = this.pose.angle;
    this.light.color.copy(sunColor);
    // The cookie already projects the aperture area. Multiplying beam intensity
    // by that area again would dim each surviving ray and count the loss twice.
    this.sourceIntensity = sunIntensity;
    this.light.intensity = sunIntensity * this.modeFactor;
    this.light.intensity *= smoothstep(-0.03, 0.08, sunDir.y);

    const shadowCamera = this.light.shadow.camera;
    shadowCamera.near = this.pose.near;
    shadowCamera.far = this.pose.far;
    // A camera up parallel to the shadow image's y axis makes lookAt reproduce exactly the
    // deck-fixed basis the cookie was painted with, whatever the aircraft attitude is.
    shadowCamera.up.copy(this.axes.y).applyQuaternion(quaternion);
    // SpotLightShadow.updateMatrices only rebuilds the projection when its own fov, aspect
    // or far change, so the slab we just set needs an explicit rebuild.
    shadowCamera.updateProjectionMatrix();
    // A frozen body-fixed depth image still needs a new world-to-shadow matrix
    // when the aircraft translates or rotates with the same local sun bearing.
    this.light.updateMatrixWorld();
    this.light.target.updateMatrixWorld();
    this.light.shadow.updateMatrices(this.light);

    // Keep pending changes until the renderer consumes them. Simulation substeps,
    // a model finishing its load, or moving controls can all precede one render.
    const castersMoved = casterState !== this._casterState;
    this._casterState = casterState;
    this.light.shadow.needsUpdate ||= sunMoved || this.mapPending || (cockpitActive && castersMoved);
    this.mapPending = false;

    return this.daylight;
  }

  /** Legacy aperture diagnostic only; never controls floods or indirect light. */
  get daylight() {
    return Math.min(1, (this.pose.admittance ?? 0) * this.light.intensity / Math.max(1e-9, this.sourceIntensity ?? 0));
  }
}
