import * as THREE from 'three';

/**
 * ControlSurfaceRig — shared procedural control-surface helpers.
 *
 * Provides pure functions for sampling control surface inputs and applying
 * deflections to THREE.Object3D rotations.
 *
 * Rules:
 *  - Pure functions only: no THREE.js side-effects on construction/import.
 *  - Guard against null/undefined mesh targets, preserving no-op safety.
 */

/**
 * Safely extract a finite, clamped control input from flight state.
 *
 * @param {object} state Flight state object.
 * @param {string} name Control property name (e.g. 'aileron', 'elevator', 'rudder').
 * @param {number} [fallback=0] Fallback value if missing or non-finite.
 * @param {number} [min=-1] Minimum clamped value.
 * @param {number} [max=1] Maximum clamped value.
 * @returns {number}
 */
export function getControlInput(state, name, fallback = 0, min = -1, max = 1) {
  if (!state) return fallback;
  const val = state[name];
  const finiteVal = Number.isFinite(val) ? val : fallback;
  return THREE.MathUtils.clamp(finiteVal, min, max);
}

/**
 * Apply a rotation deflection to one Euler axis of a mesh.
 *
 * @param {THREE.Object3D|null|undefined} mesh The surface pivot object.
 * @param {'x'|'y'|'z'} axis Euler axis to rotate about.
 * @param {number} radians Signed deflection in radians.
 */
export function applyDeflection(mesh, axis, radians) {
  if (mesh) mesh.rotation[axis] = radians;
}

/**
 * Apply symmetric or differential deflection to a matched pair of surfaces.
 *
 * Both surfaces rotate by `radians` on `axis`; the right surface is negated
 * when `differential` is true (aileron convention: left trailing-edge-down
 * when positive input, right trailing-edge-up).
 *
 * @param {THREE.Object3D|null|undefined} left Left surface.
 * @param {THREE.Object3D|null|undefined} right Right surface.
 * @param {'x'|'y'|'z'} axis Euler axis.
 * @param {number} radians Deflection magnitude (signed).
 * @param {boolean} [differential=false] Negate right side when true.
 */
export function applyDeflectionPair(left, right, axis, radians, differential = false) {
  applyDeflection(left, axis, radians);
  applyDeflection(right, axis, differential ? -radians : radians);
}
