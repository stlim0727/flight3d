import * as THREE from 'three';
import { gearSupportHeight } from '../gearVisualContact.js';

/**
 * GearKinematicsRig — shared landing gear kinematic and suspension helpers.
 *
 * Shared across Boeing737, Cessna172, and F16 for:
 *  - Clamping extension ratios to [0, 1]
 *  - Calculating standard gear retraction fold angles
 *  - Determining collapsed state from gearDamage maps
 *  - Computing suspension contact displacement offsets
 *
 * Rules:
 *  - Pure functions only: no THREE.js side-effects on construction/import.
 */

/**
 * Clamp gear extension state to [0, 1].
 *
 * @param {number|undefined} gearState Current or commanded gear state.
 * @param {number} [fallback=1.0] Default if undefined.
 * @returns {number} Extension in [0, 1].
 */
export function clampGearExtension(gearState, fallback = 1.0) {
  const val = gearState !== undefined ? gearState : fallback;
  return THREE.MathUtils.clamp(Number.isFinite(val) ? val : fallback, 0, 1);
}

/**
 * Calculate standard right-angle fold rotation for a given extension ratio.
 *
 * @param {number} extension Normalized gear extension (0 = retracted, 1 = deployed).
 * @param {number} [maxAngle=Math.PI * 0.5] Maximum fold angle in radians (default 90°).
 * @returns {number} Fold angle in radians.
 */
export function calculateGearFold(extension, maxAngle = Math.PI * 0.5) {
  return (1 - extension) * maxAngle;
}

/**
 * Check if a gear leg is collapsed according to gearDamage state.
 *
 * @param {object|undefined} gearDamage Damage map { nose, mainLeft, mainRight }.
 * @param {string} id Gear identifier ('nose', 'mainLeft', 'mainRight').
 * @returns {boolean} True if the leg is collapsed.
 */
export function isGearCollapsed(gearDamage, id) {
  return gearDamage?.[id] === 'collapsed';
}

/**
 * Compute suspension vertical contact displacement offset.
 *
 * @param {object} contacts Aircraft gear contacts configuration.
 * @param {object|undefined} compressions Compression values from flight state.
 * @param {{x: number, y: number, z: number}} contact Neutral tire contact point.
 * @returns {number} Vertical offset relative to neutral contact.
 */
export function computeGearContactOffset(contacts, compressions, contact) {
  return gearSupportHeight(contacts, compressions, contact.x, contact.z) - contact.y;
}
