import * as THREE from 'three';

/**
 * Windshield aperture geometry of the 737 flight deck, in local aircraft space
 * (forward = -Z, captain = -X). This is the single source of truth shared by the
 * interior framing (`Cockpit.js`) and the deck sunlight rig (`CockpitSunShadow.js`),
 * which must agree on where the outside world can actually reach the interior.
 */
export const WINDSHIELD_PANES = Object.freeze([
  Object.freeze({ name: 'GLTF_Glass_1L', center: Object.freeze([-0.25, 0.83, -12.92]), size: Object.freeze([0.68, 0.44]), rotation: Object.freeze([0.47, 0.22, -0.06]) }),
  Object.freeze({ name: 'GLTF_Glass_1R', center: Object.freeze([0.25, 0.83, -12.92]), size: Object.freeze([0.68, 0.44]), rotation: Object.freeze([0.47, -0.22, 0.06]) }),
  Object.freeze({ name: 'GLTF_Glass_2L', center: Object.freeze([-0.85, 0.95, -12.45]), size: Object.freeze([0.72, 0.44]), rotation: Object.freeze([-0.12, 1.10, 0]) }),
  Object.freeze({ name: 'GLTF_Glass_2R', center: Object.freeze([0.85, 0.95, -12.45]), size: Object.freeze([0.72, 0.44]), rotation: Object.freeze([-0.12, -1.10, 0]) }),
]);

/**
 * No.3 fixed side windows. Dimensions/placement are a fitted approximation:
 * see docs/development/cockpit-side-windows.md for the source and derivation.
 * No.4/5 are optional eyebrow windows, not additional aft side windows.
 */
export const SIDE_WINDOW_PANES = Object.freeze([-1, 1].map(side => Object.freeze({
  name: side < 0 ? 'GLTF_Glass_3L' : 'GLTF_Glass_3R',
  center: Object.freeze([side * 0.70, 0.95, -11.79]),
  size: Object.freeze([0.60, 0.44]),
  rotation: Object.freeze([0.70, -side * 1.22, 0]),
})));

// Separate consumers without duplicating any windshield geometry. Each
// side opening is optical-only until a matching visible asset is available.
export const VISIBLE_GLASS = WINDSHIELD_PANES;
export const APERTURE_OPENINGS = Object.freeze([...WINDSHIELD_PANES, ...SIDE_WINDOW_PANES]);

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

const _paneEuler = new THREE.Euler();
const _paneQuat = new THREE.Quaternion();
const _paneNormal = new THREE.Vector3();
const _deckToPane = new THREE.Vector3();
const _scanDir = new THREE.Vector3();

/**
 * Unit normal of a pane, pointing out of the deck.
 *
 * A plane has two sides and the authored profile carries no convention, so the
 * deck anchor decides: the outside is the direction away from the interior.
 */
export function paneOutwardNormal(pane, target = new THREE.Vector3()) {
  _paneEuler.set(pane.rotation[0], pane.rotation[1], pane.rotation[2]);
  target.set(0, 0, 1).applyQuaternion(_paneQuat.setFromEuler(_paneEuler));
  _deckToPane.set(
    pane.center[0] - DECK_SUN_ANCHOR.x,
    pane.center[1] - DECK_SUN_ANCHOR.y,
    pane.center[2] - DECK_SUN_ANCHOR.z,
  );
  if (target.dot(_deckToPane) < 0) target.negate();
  return target;
}

/**
 * Parallel-beam flux through the aperture, as the projected area normal to the sun
 * in square metres. A pane edge-on to the sun contributes nothing and one facing it
 * contributes its full area, which is what an opening does; the sum is independent of
 * where in the deck the receiver sits.
 */
export function directAdmittance(sunDirLocal, panes = APERTURE_OPENINGS) {
  let flux = 0;
  for (const pane of panes) {
    const cosine = paneOutwardNormal(pane, _paneNormal).dot(sunDirLocal);
    if (cosine > 0) flux += cosine * pane.size[0] * pane.size[1];
  }
  return flux;
}

let _referenceAdmittance = null;

/**
 * `directAdmittance` at the sun bearing that pushes the most light through, scanned
 * from the pane data. Dividing by it puts the deck sun on a 0..1 scale that survives a
 * change of aperture profile, where a hand-picked constant would silently rescale it.
 */
export function referenceDirectAdmittance(panes = APERTURE_OPENINGS) {
  if (panes !== APERTURE_OPENINGS) return scanReferenceAdmittance(panes);
  _referenceAdmittance ??= scanReferenceAdmittance(panes);
  return _referenceAdmittance;
}

function scanReferenceAdmittance(panes) {
  let best = 0;
  for (let elevation = 0; elevation <= 90; elevation += 2) {
    for (let azimuth = 0; azimuth < 360; azimuth += 2) {
      // Same spherical convention SkyAtmosphere uses for the sun.
      _scanDir.setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(90 - elevation),
        THREE.MathUtils.degToRad(azimuth),
      );
      best = Math.max(best, directAdmittance(_scanDir, panes));
    }
  }
  return best;
}
