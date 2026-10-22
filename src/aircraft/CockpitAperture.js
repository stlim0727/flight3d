import * as THREE from 'three';

/**
 * Windshield aperture geometry of the 737 flight deck, in local aircraft space
 * (forward = -Z, captain = -X). This is the single source of truth shared by the
 * interior framing (`Cockpit.js`) and the deck sunlight rig (`CockpitSunShadow.js`),
 * which must agree on where the outside world can actually reach the interior.
 */
export const WINDSHIELD_PANES = Object.freeze([
  Object.freeze({ name: 'GLTF_Glass_1L', center: Object.freeze([-0.25, 0.83, -12.92]), size: Object.freeze([0.68, 0.44]), rotation: Object.freeze([-0.47, 0.22, -0.06]) }),
  Object.freeze({ name: 'GLTF_Glass_1R', center: Object.freeze([0.25, 0.83, -12.92]), size: Object.freeze([0.68, 0.44]), rotation: Object.freeze([-0.47, -0.22, 0.06]) }),
  Object.freeze({ name: 'GLTF_Glass_2L', center: Object.freeze([-0.85, 0.95, -12.45]), size: Object.freeze([0.72, 0.44]), rotation: Object.freeze([-0.12, 1.10, 0]) }),
  Object.freeze({ name: 'GLTF_Glass_2R', center: Object.freeze([0.85, 0.95, -12.45]), size: Object.freeze([0.72, 0.44]), rotation: Object.freeze([-0.12, -1.10, 0]) }),
]);

/** Optical centre of the flight deck, between the captain eye point and the glass. */
export const DECK_SUN_ANCHOR = new THREE.Vector3(-0.1, 0.95, -12.4);

/** Distance the sun rig stands off along the sun vector: large keeps rays near-parallel. */
export const DECK_SUN_STANDOFF = 40;

/** How far aft of the anchor the shadow slab and light cone must reach (seats, overhead). */
export const DECK_SUN_AFT_REACH = 5.2;

/** Radius perpendicular to the sun vector that must stay inside the light cone. */
export const DECK_SUN_RADIUS = 2.9;

/**
 * Sunward reach of the interior shadow slab. Include the complete window frame
 * from every admitted sun bearing; exterior proxies opt out of this light's pass
 * explicitly instead of clipping the pillars along with the airframe skin.
 */
export const DECK_SUN_CLIP_T = 2.2;
