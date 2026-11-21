/**
 * @file civilPilotGeometry.js
 * @description Procedural seated pilots for the Boeing 737 flight deck and the Cessna 172 cabin.
 *
 * Styles follow the F-16 pilot's procedural approach (named Pilot_Seat / Pilot_Body / Pilot_Head
 * groups, shared PBR materials, head hidden in the occupant's own first-person view), but dress
 * and pose the figure for civil cockpits:
 *  - airline captain / first officer: black double-breasted uniform with gold buttons, wings and
 *    sleeve stripes (4 captain, 3 first officer), white shirt and black tie, peaked cap with a gold
 *    badge, aviator sunglasses;
 *  - Cessna private pilot: brown leather flight jacket with knit collar, cuffs and patches, white
 *    scarf, leather flying helmet with goggles on the forehead, tan gloves, khaki trousers and
 *    brown boots.
 *
 * The figure is authored in real metres around the hip (H-point), +Y up and -Z forward, then the
 * mount scales it to the cockpit model (the 737 deck is authored at roughly 0.58 of full size).
 * Arms and legs are rigid segments posed by two-bone IK towards cockpit targets in the mount's
 * parent frame, so hands can follow the animated 737 yokes without rebuilding geometry. Static
 * parts are merged per material to keep each pilot to a small number of draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { setPilotCockpitMode } from './pilotGeometry.js';

// Torso leans back from vertical in the upright civil seats.
export const CIVIL_SEAT_RECLINE_RAD = 0.18;

// Segment reference lengths in metres (shoulder→elbow, elbow→wrist, hip→knee, knee→ankle).
const UPPER_ARM = 0.30;
const FOREARM = 0.26;
const THIGH = 0.44;
const SHIN = 0.43;
const GRIP_FROM_WRIST = 0.065;
// Limbs may lengthen this much to reach a cockpit control that sits beyond a nominal reach.
const MAX_LIMB_STRETCH = 1.3;

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);

// Skeleton landmarks in the torso frame (before recline) and the head frame.
const SHOULDER_TORSO = new THREE.Vector3(0.20, 0.49, 0.0);
const NECK_TORSO = new THREE.Vector3(0, 0.57, 0.01);
const HIP_JOINT = new THREE.Vector3(0.095, 0.0, -0.02);
const EYE_IN_HEAD = new THREE.Vector3(0, 0.125, -0.085);

const sharedMaterials = new Map();

function material(name, parameters) {
  let mat = sharedMaterials.get(name);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ name, ...parameters });
    sharedMaterials.set(name, mat);
  }
  return mat;
}

function skinMaterial() {
  return material('pilot-civil-skin', { color: 0xc48f72, roughness: 0.62, metalness: 0.0 });
}

/** Airline uniform palette: black wool, white shirt, gold braid. */
export function createAirlinerMaterials() {
  return {
    skin: skinMaterial(),
    hair: material('pilot-airline-hair', { color: 0x2b2019, roughness: 0.8, metalness: 0.0 }),
    jacket: material('pilot-airline-uniform', { color: 0x15171c, roughness: 0.78, metalness: 0.02 }),
    trousers: material('pilot-airline-trousers', { color: 0x15171c, roughness: 0.8, metalness: 0.02 }),
    shirt: material('pilot-airline-shirt', { color: 0xf1f1ec, roughness: 0.7, metalness: 0.0 }),
    tie: material('pilot-airline-tie', { color: 0x0c0d10, roughness: 0.55, metalness: 0.05 }),
    gold: material('pilot-airline-gold', { color: 0xc9a23a, roughness: 0.35, metalness: 0.8 }),
    shoes: material('pilot-airline-shoes', { color: 0x0b0b0d, roughness: 0.3, metalness: 0.15 }),
    cap: material('pilot-airline-cap', { color: 0x14161b, roughness: 0.7, metalness: 0.02 }),
    capVisor: material('pilot-airline-cap-visor', { color: 0x09090b, roughness: 0.18, metalness: 0.2 }),
    lens: material('pilot-airline-sunglass-lens', { color: 0x0d1115, roughness: 0.08, metalness: 0.7 }),
  };
}

/** Vintage private-pilot palette: brown leather, white scarf, khaki trousers. */
export function createCessnaMaterials() {
  return {
    skin: skinMaterial(),
    jacket: material('pilot-cessna-leather-jacket', { color: 0x6b3f22, roughness: 0.55, metalness: 0.05 }),
    knit: material('pilot-cessna-knit', { color: 0x3b2416, roughness: 0.9, metalness: 0.0 }),
    trousers: material('pilot-cessna-khaki', { color: 0x9c8a62, roughness: 0.9, metalness: 0.0 }),
    scarf: material('pilot-cessna-scarf', { color: 0xeee8da, roughness: 0.85, metalness: 0.0 }),
    gloves: material('pilot-cessna-gloves', { color: 0xb07a45, roughness: 0.6, metalness: 0.02 }),
    boots: material('pilot-cessna-boots', { color: 0x58301b, roughness: 0.45, metalness: 0.05 }),
    helmet: material('pilot-cessna-leather-helmet', { color: 0x5a3820, roughness: 0.5, metalness: 0.05 }),
    goggleFrame: material('pilot-cessna-goggle-frame', { color: 0x2f2a25, roughness: 0.4, metalness: 0.5 }),
    lens: material('pilot-cessna-goggle-lens', { color: 0x8ea3ad, roughness: 0.06, metalness: 0.75 }),
    hardware: material('pilot-cessna-hardware', { color: 0xa8a49a, roughness: 0.3, metalness: 0.85 }),
    patchRed: material('pilot-cessna-patch-red', { color: 0x8e2a22, roughness: 0.7, metalness: 0.0 }),
    patchGreen: material('pilot-cessna-patch-green', { color: 0x4d5a3c, roughness: 0.7, metalness: 0.0 }),
  };
}

export const CIVIL_PILOT_STYLES = Object.freeze({
  airlineCaptain: { outfit: 'airline', sleeveStripes: 4, recline: CIVIL_SEAT_RECLINE_RAD },
  airlineFirstOfficer: { outfit: 'airline', sleeveStripes: 3, recline: CIVIL_SEAT_RECLINE_RAD },
  // Sits up and leans towards the Cessna's deep-set yoke.
  cessna: { outfit: 'cessna', recline: 0.02 },
});

function mesh(geometry, mat, position, rotation) {
  const m = new THREE.Mesh(geometry, mat);
  if (position) m.position.copy(position);
  if (rotation) m.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
  return m;
}

function v(x, y, z) {
  return new THREE.Vector3(x, y, z);
}

function ellipsoid(radii, segments = 14) {
  const g = new THREE.SphereGeometry(1, segments, Math.max(6, Math.round(segments * 0.7)));
  g.scale(radii[0], radii[1], radii[2]);
  return g;
}

/** Segment along local +Y from 0 to length, tapering from rootRadius to tipRadius. */
function segmentGeometry(length, rootRadius, tipRadius, depthScale = 1, segments = 12) {
  const g = new THREE.CylinderGeometry(tipRadius, rootRadius, length, segments);
  g.translate(0, length / 2, 0);
  if (depthScale !== 1) g.scale(1, 1, depthScale);
  return g;
}

function ring(radius, height, y) {
  const g = new THREE.CylinderGeometry(radius, radius, height, 14, 1, true);
  g.translate(0, y, 0);
  return g;
}

/**
 * Replace every mesh below root by one merged mesh per material, baked into root's frame.
 * Keeps the procedural description readable while costing one draw call per material.
 */
export function mergeByMaterial(root, prefix) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map();
  const victims = [];
  root.traverse(node => {
    if (!node.isMesh) return;
    const transform = new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld);
    const geometry = node.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    }
    if (!geometry.index) {
      const count = geometry.attributes.position.count;
      geometry.setIndex([...Array(count).keys()]);
    }
    geometry.applyMatrix4(transform);
    if (transform.determinant() < 0) {
      const index = geometry.index.array;
      for (let i = 0; i < index.length; i += 3) {
        const t = index[i + 1];
        index[i + 1] = index[i + 2];
        index[i + 2] = t;
      }
    }
    if (!buckets.has(node.material)) buckets.set(node.material, []);
    buckets.get(node.material).push(geometry);
    victims.push(node);
  });
  for (const node of victims) node.parent.remove(node);
  // Drop now-empty helper groups left behind by the procedural layout.
  for (const child of [...root.children]) {
    if (!child.isMesh && child.children.length === 0) root.remove(child);
  }
  for (const [mat, geometries] of buckets) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach(g => g.dispose());
    merged.computeBoundingSphere();
    const out = new THREE.Mesh(merged, mat);
    out.name = `${prefix}_${mat.name}`;
    root.add(out);
  }
  return root;
}

function buildAirlineTorso(torso, mats) {
  torso.add(mesh(ellipsoid([0.18, 0.11, 0.135]), mats.trousers, v(0, 0.06, 0.0)));
  const abdomen = new THREE.CylinderGeometry(0.155, 0.168, 0.24, 16);
  abdomen.scale(1, 1, 0.74);
  torso.add(mesh(abdomen, mats.jacket, v(0, 0.2, 0.0)));
  const chest = new THREE.CylinderGeometry(0.192, 0.158, 0.28, 16);
  chest.scale(1, 1, 0.66);
  torso.add(mesh(chest, mats.jacket, v(0, 0.38, 0.0)));
  const yoke = new THREE.CapsuleGeometry(0.066, 0.3, 6, 12);
  yoke.rotateZ(Math.PI / 2);
  torso.add(mesh(yoke, mats.jacket, v(0, 0.495, 0.0)));

  // White shirt V and black tie between the lapels.
  const shirt = new THREE.CylinderGeometry(0.0, 0.07, 0.17, 3, 1);
  shirt.rotateY(Math.PI);
  shirt.rotateX(Math.PI);
  shirt.scale(1, 1, 0.12);
  torso.add(mesh(shirt, mats.shirt, v(0, 0.455, -0.123)));
  const tie = new THREE.BoxGeometry(0.03, 0.2, 0.012);
  torso.add(mesh(tie, mats.tie, v(0, 0.42, -0.131)));
  const knot = new THREE.BoxGeometry(0.03, 0.026, 0.02);
  torso.add(mesh(knot, mats.tie, v(0, 0.52, -0.13)));

  // Double-breasted lapels and gold buttons.
  for (const side of [-1, 1]) {
    const lapel = new THREE.BoxGeometry(0.05, 0.2, 0.01);
    torso.add(mesh(lapel, mats.jacket, v(side * 0.06, 0.45, -0.132), { z: side * 0.32 }));
    for (let row = 0; row < 3; row++) {
      const button = new THREE.SphereGeometry(0.0095, 8, 6);
      torso.add(mesh(button, mats.gold, v(side * 0.055, 0.34 - row * 0.075, -0.126 + row * 0.004)));
    }
  }
  // Gold wings above the left breast pocket.
  const wings = new THREE.BoxGeometry(0.075, 0.014, 0.006);
  torso.add(mesh(wings, mats.gold, v(-0.1, 0.45, -0.122), { y: 0.35 }));
  // Epaulettes with gold bars over the shoulders.
  for (const side of [-1, 1]) {
    const epaulette = new THREE.BoxGeometry(0.055, 0.008, 0.11);
    torso.add(mesh(epaulette, mats.jacket, v(side * 0.15, 0.563, 0.0), { z: -side * 0.12 }));
    const bar = new THREE.BoxGeometry(0.057, 0.004, 0.012);
    torso.add(mesh(bar, mats.gold, v(side * 0.15, 0.568, -0.03), { z: -side * 0.12 }));
  }
}

function buildCessnaTorso(torso, mats) {
  torso.add(mesh(ellipsoid([0.18, 0.11, 0.135]), mats.trousers, v(0, 0.06, 0.0)));
  // Bomber jacket: ribbed waistband, blouson body, broad shoulders.
  const waist = new THREE.CylinderGeometry(0.168, 0.172, 0.06, 16);
  waist.scale(1, 1, 0.76);
  torso.add(mesh(waist, mats.knit, v(0, 0.12, 0.0)));
  const abdomen = new THREE.CylinderGeometry(0.17, 0.175, 0.2, 16);
  abdomen.scale(1, 1, 0.76);
  torso.add(mesh(abdomen, mats.jacket, v(0, 0.25, 0.0)));
  const chest = new THREE.CylinderGeometry(0.198, 0.172, 0.24, 16);
  chest.scale(1, 1, 0.7);
  torso.add(mesh(chest, mats.jacket, v(0, 0.4, 0.0)));
  const yoke = new THREE.CapsuleGeometry(0.07, 0.3, 6, 12);
  yoke.rotateZ(Math.PI / 2);
  torso.add(mesh(yoke, mats.jacket, v(0, 0.495, 0.0)));
  // Knit collar and front zipper.
  const collar = new THREE.TorusGeometry(0.08, 0.022, 8, 16);
  collar.rotateX(Math.PI / 2);
  torso.add(mesh(collar, mats.knit, v(0, 0.55, 0.0)));
  const zipper = new THREE.BoxGeometry(0.008, 0.36, 0.006);
  torso.add(mesh(zipper, mats.hardware, v(0, 0.33, -0.139)));
  // Flapped chest pockets carrying squadron-style patches.
  for (const side of [-1, 1]) {
    const pocket = new THREE.BoxGeometry(0.1, 0.08, 0.014);
    torso.add(mesh(pocket, mats.jacket, v(side * 0.085, 0.3, -0.132), { y: -side * 0.18 }));
    const flap = new THREE.BoxGeometry(0.104, 0.025, 0.018);
    torso.add(mesh(flap, mats.knit, v(side * 0.085, 0.345, -0.133), { y: -side * 0.18 }));
    const patch = new THREE.CylinderGeometry(0.032, 0.032, 0.006, 14);
    patch.rotateX(Math.PI / 2);
    torso.add(mesh(patch, side < 0 ? mats.patchRed : mats.patchGreen,
      v(side * 0.105, 0.42, -0.126), { y: -side * 0.35 }));
  }
  // Shoulder patches on the upper sleeves are added with the arms.
}

function addScarf(head, mats) {
  // White scarf wrapped round the neck, its ends puffed into the open jacket front. It belongs
  // to the head group (head-pivot frame) so the occupant's own first-person view hides it.
  const wrap = new THREE.TorusGeometry(0.062, 0.025, 8, 18);
  wrap.rotateX(Math.PI / 2 - 0.15);
  head.add(mesh(wrap, mats.scarf, v(0, 0.005, -0.01)));
  head.add(mesh(ellipsoid([0.04, 0.065, 0.028], 12), mats.scarf, v(0.012, -0.068, -0.13), { z: -0.15 }));
}

function buildHeadBase(head, mats) {
  const neck = new THREE.CylinderGeometry(0.05, 0.055, 0.11, 12);
  head.add(mesh(neck, mats.skin, v(0, 0.0, 0.0)));
  head.add(mesh(ellipsoid([0.078, 0.108, 0.098], 18), mats.skin, v(0, 0.115, -0.005)));
  // Jaw and chin under the face.
  head.add(mesh(ellipsoid([0.066, 0.05, 0.07]), mats.skin, v(0, 0.055, -0.03)));
  const nose = new THREE.ConeGeometry(0.014, 0.035, 8);
  nose.rotateX(-Math.PI / 2 + 0.35);
  head.add(mesh(nose, mats.skin, v(0, 0.1, -0.104)));
  for (const side of [-1, 1]) {
    head.add(mesh(ellipsoid([0.012, 0.028, 0.02], 8), mats.skin, v(side * 0.079, 0.11, 0.0)));
  }
}

function buildAirlineHead(head, mats) {
  buildHeadBase(head, mats);
  // Shirt collar rides with the head so the first-person view does not look into it.
  const collar = new THREE.CylinderGeometry(0.062, 0.07, 0.045, 14);
  head.add(mesh(collar, mats.shirt, v(0, -0.015, -0.01)));
  // Short hair under the cap at the back and sides.
  // Back half only (SphereGeometry phi 0..π spans +Z, behind the face).
  const hair = new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI, Math.PI * 0.3, Math.PI * 0.26);
  hair.scale(0.82, 1.1, 1.0);
  head.add(mesh(hair, mats.hair, v(0, 0.118, 0.006)));

  // Peaked cap: crown, black band with gold cord, glossy visor and badge.
  const capY = 0.195;
  const band = new THREE.CylinderGeometry(0.088, 0.086, 0.04, 20);
  band.scale(0.9, 1, 1.06);
  head.add(mesh(band, mats.capVisor, v(0, capY, -0.006)));
  const crown = new THREE.CylinderGeometry(0.118, 0.09, 0.05, 22);
  crown.scale(0.92, 1, 1.08);
  head.add(mesh(crown, mats.cap, v(0, capY + 0.044, -0.012), { x: 0.1 }));
  const top = new THREE.CylinderGeometry(0.118, 0.118, 0.006, 22);
  top.scale(0.92, 1, 1.08);
  head.add(mesh(top, mats.cap, v(0, capY + 0.072, -0.016), { x: 0.1 }));
  const visor = new THREE.CylinderGeometry(0.105, 0.105, 0.006, 20, 1, false, Math.PI * 0.62, Math.PI * 0.76);
  visor.scale(0.92, 1, 1.12);
  head.add(mesh(visor, mats.capVisor, v(0, capY - 0.022, -0.012), { x: -0.25 }));
  const cord = new THREE.TorusGeometry(0.083, 0.0035, 6, 20, Math.PI * 0.7);
  cord.rotateX(Math.PI / 2);
  cord.rotateY(Math.PI * 0.15);
  cord.scale(0.92, 1, 1.12);
  head.add(mesh(cord, mats.gold, v(0, capY - 0.008, -0.01)));
  const badge = new THREE.BoxGeometry(0.036, 0.026, 0.008);
  head.add(mesh(badge, mats.gold, v(0, capY + 0.03, -0.104), { x: 0.2 }));

  // Aviator sunglasses.
  for (const side of [-1, 1]) {
    const lens = new THREE.CylinderGeometry(0.021, 0.019, 0.006, 14);
    lens.rotateX(Math.PI / 2);
    lens.scale(1.05, 0.85, 1);
    head.add(mesh(lens, mats.lens, v(side * 0.031, 0.125, -0.094), { y: side * 0.12 }));
    const arm = new THREE.BoxGeometry(0.004, 0.004, 0.09);
    head.add(mesh(arm, mats.gold, v(side * 0.072, 0.13, -0.05)));
  }
  const bridge = new THREE.BoxGeometry(0.02, 0.004, 0.004);
  head.add(mesh(bridge, mats.gold, v(0, 0.133, -0.1)));
}

function buildCessnaHead(head, mats) {
  buildHeadBase(head, mats);
  // Leather flying helmet covering crown, back and ears, with chin strap.
  // Crown cap stops above the brow; the back half wraps down to the nape.
  const crown = new THREE.SphereGeometry(0.106, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.36);
  crown.scale(0.84, 1.08, 1.0);
  head.add(mesh(crown, mats.helmet, v(0, 0.112, 0.004)));
  const nape = new THREE.SphereGeometry(0.106, 14, 8, 0, Math.PI, Math.PI * 0.36, Math.PI * 0.3);
  nape.scale(0.84, 1.08, 1.0);
  head.add(mesh(nape, mats.helmet, v(0, 0.112, 0.004)));
  for (const side of [-1, 1]) {
    head.add(mesh(ellipsoid([0.02, 0.048, 0.04], 10), mats.helmet, v(side * 0.082, 0.085, 0.006)));
    const strap = new THREE.BoxGeometry(0.008, 0.06, 0.016);
    head.add(mesh(strap, mats.helmet, v(side * 0.066, 0.035, -0.04), { x: 0.5, z: side * 0.25 }));
  }
  // Goggles pushed up on the forehead with a strap round the helmet.
  // The strap hugs the helmet: high over the brow, lower at the back.
  const strapBand = new THREE.TorusGeometry(0.1, 0.007, 6, 24);
  strapBand.rotateX(Math.PI / 2);
  strapBand.scale(0.85, 1, 1.0);
  head.add(mesh(strapBand, mats.goggleFrame, v(0, 0.155, 0.002), { x: 0.35 }));
  for (const side of [-1, 1]) {
    const frame = new THREE.CylinderGeometry(0.026, 0.028, 0.022, 16);
    frame.rotateX(Math.PI / 2 - 0.6);
    head.add(mesh(frame, mats.goggleFrame, v(side * 0.034, 0.19, -0.087), { y: side * 0.25 }));
    const lens = new THREE.CircleGeometry(0.021, 16);
    lens.rotateX(-0.6);
    head.add(mesh(lens, mats.lens, v(side * 0.036, 0.196, -0.098), { y: side * 0.25 }));
  }
  // Round spectacles from the reference outfit.
  for (const side of [-1, 1]) {
    const rim = new THREE.TorusGeometry(0.018, 0.0028, 6, 16);
    head.add(mesh(rim, mats.goggleFrame, v(side * 0.031, 0.125, -0.096), { y: side * 0.12 }));
  }
}

function addHand(hand, mats, outfit, side) {
  const glove = outfit === 'cessna' ? mats.gloves : mats.skin;
  // Fist closed around a control horn; built along +Y from the wrist.
  hand.add(mesh(ellipsoid([0.04, 0.052, 0.03]), glove, v(0, 0.05, 0.0)));
  hand.add(mesh(ellipsoid([0.013, 0.03, 0.013], 8), glove, v(-side * 0.03, 0.045, -0.02), { z: side * 0.5 }));
  if (outfit === 'cessna') {
    // Gauntlet cuff flaring over the jacket cuff.
    hand.add(mesh(new THREE.CylinderGeometry(0.044, 0.05, 0.05, 12), mats.gloves, v(0, -0.002, 0.0)));
  } else {
    hand.add(mesh(new THREE.CylinderGeometry(0.038, 0.04, 0.022, 12), mats.shirt, v(0, -0.004, 0.0)));
  }
}

function createArm(mats, style, side) {
  const outfit = style.outfit;
  const arm = new THREE.Group();
  arm.name = `Pilot_Arm_${side > 0 ? 'R' : 'L'}`;
  const upper = new THREE.Group();
  upper.name = `${arm.name}_Upper`;
  const fore = new THREE.Group();
  fore.name = `${arm.name}_Fore`;
  const hand = new THREE.Group();
  hand.name = `${arm.name}_Hand`;
  arm.add(upper, fore, hand);

  const sleeve = mats.jacket;
  upper.add(mesh(segmentGeometry(UPPER_ARM, 0.056, 0.046), sleeve));
  upper.add(mesh(new THREE.SphereGeometry(0.062, 12, 9), sleeve));
  upper.add(mesh(new THREE.SphereGeometry(0.047, 10, 8), sleeve, v(0, UPPER_ARM, 0)));
  fore.add(mesh(segmentGeometry(FOREARM, 0.046, 0.038), sleeve));
  if (outfit === 'airline') {
    for (let i = 0; i < style.sleeveStripes; i++) {
      fore.add(mesh(ring(0.0408, 0.007, FOREARM - 0.03 - i * 0.014), mats.gold));
    }
  } else {
    fore.add(mesh(ring(0.0405, 0.04, FOREARM - 0.02), mats.knit));
    const patch = new THREE.CylinderGeometry(0.025, 0.025, 0.006, 12);
    patch.rotateZ(Math.PI / 2);
    upper.add(mesh(patch, side < 0 ? mats.patchGreen : mats.patchRed, v(side * 0.054, 0.08, 0)));
  }
  addHand(hand, mats, outfit, side);

  for (const segment of [upper, fore, hand]) mergeByMaterial(segment, segment.name);
  return { arm, upper, fore, hand };
}

function createLeg(mats, style, side) {
  const leg = new THREE.Group();
  leg.name = `Pilot_Leg_${side > 0 ? 'R' : 'L'}`;
  const thigh = new THREE.Group();
  thigh.name = `${leg.name}_Thigh`;
  const shin = new THREE.Group();
  shin.name = `${leg.name}_Shin`;
  const foot = new THREE.Group();
  foot.name = `${leg.name}_Foot`;
  leg.add(thigh, shin, foot);

  thigh.add(mesh(segmentGeometry(THIGH, 0.088, 0.064), mats.trousers));
  thigh.add(mesh(new THREE.SphereGeometry(0.09, 12, 9), mats.trousers));
  thigh.add(mesh(new THREE.SphereGeometry(0.064, 12, 9), mats.trousers, v(0, THIGH, 0)));
  shin.add(mesh(segmentGeometry(SHIN, 0.061, 0.048), mats.trousers));
  const shoe = style.outfit === 'cessna' ? mats.boots : mats.shoes;
  if (style.outfit === 'cessna') {
    // Lace-up boots reach above the ankle; the trousers are tucked in.
    shin.add(mesh(segmentGeometry(0.15, 0.056, 0.052), mats.boots, v(0, SHIN - 0.15, 0)));
  }
  // Foot built forward along -Z from the ankle.
  foot.add(mesh(new THREE.BoxGeometry(0.1, 0.075, 0.27), shoe, v(0, -0.035, -0.07)));
  foot.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), shoe, v(0, -0.01, 0.0)));
  for (const segment of [thigh, shin, foot]) mergeByMaterial(segment, segment.name);
  return { leg, thigh, shin, foot };
}

/** Builds the civil pilot hierarchy (no seat: the cockpit models provide their own). */
export function buildCivilPilotScene(styleName = 'airlineCaptain') {
  const style = CIVIL_PILOT_STYLES[styleName];
  if (!style) throw new Error(`Unknown civil pilot style: ${styleName}`);
  const mats = style.outfit === 'cessna' ? createCessnaMaterials() : createAirlinerMaterials();
  const root = new THREE.Group();
  root.name = `Civil_Pilot_${styleName}`;

  const seat = new THREE.Group();
  seat.name = 'Pilot_Seat';
  const body = new THREE.Group();
  body.name = 'Pilot_Body';
  const torso = new THREE.Group();
  torso.name = 'Pilot_Torso';
  torso.rotation.x = style.recline;
  body.add(torso);

  const head = new THREE.Group();
  head.name = 'Pilot_Head';
  head.position.copy(NECK_TORSO).applyEuler(torso.rotation);

  if (style.outfit === 'cessna') {
    buildCessnaTorso(torso, mats);
    addScarf(head, mats);
    buildCessnaHead(head, mats);
  } else {
    buildAirlineTorso(torso, mats);
    buildAirlineHead(head, mats);
  }
  mergeByMaterial(torso, 'Pilot_Torso');
  mergeByMaterial(head, 'Pilot_Head');

  const limbs = {
    arms: [-1, 1].map(side => createArm(mats, style, side)),
    legs: [-1, 1].map(side => createLeg(mats, style, side)),
  };
  for (const { arm } of limbs.arms) body.add(arm);
  for (const { leg } of limbs.legs) body.add(leg);

  root.add(seat, body, head);
  const eye = EYE_IN_HEAD.clone().add(head.position);
  return { root, seat, body, head, limbs, style, eye };
}

/** Pilot-frame shoulder joint (real metres). */
export function civilShoulderJoint(side, recline = CIVIL_SEAT_RECLINE_RAD) {
  return v(side * SHOULDER_TORSO.x, SHOULDER_TORSO.y, SHOULDER_TORSO.z)
    .applyEuler(new THREE.Euler(recline, 0, 0));
}

/** Pilot-frame eye point used to align the occupant with the cockpit camera. */
export function civilPilotEye(recline = CIVIL_SEAT_RECLINE_RAD) {
  return NECK_TORSO.clone().applyEuler(new THREE.Euler(recline, 0, 0)).add(EYE_IN_HEAD);
}

const scratch = {
  a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(),
  q: new THREE.Quaternion(),
};

/**
 * Two-bone IK. Writes the joint and end positions; returns the stretch factor applied when the
 * target lies beyond the nominal reach.
 */
export function solveTwoBone(root, target, l1, l2, pole, outJoint, outEnd) {
  const toTarget = scratch.a.subVectors(target, root);
  let distance = toTarget.length();
  const dir = distance > 1e-6 ? toTarget.divideScalar(distance) : scratch.a.set(0, -1, 0);
  let stretch = 1;
  const reach = (l1 + l2) * 0.985;
  if (distance > reach) {
    stretch = Math.min(MAX_LIMB_STRETCH, distance / reach);
    l1 *= stretch;
    l2 *= stretch;
  }
  distance = THREE.MathUtils.clamp(distance, Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.9999);
  const cosRoot = THREE.MathUtils.clamp((l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance), -1, 1);
  const along = l1 * cosRoot;
  const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const bend = scratch.b.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-10) bend.set(0, 0, -1).addScaledVector(dir, -dir.z);
  bend.normalize();
  outJoint.copy(root).addScaledVector(dir, along).addScaledVector(bend, height);
  outEnd.copy(root).addScaledVector(dir, distance);
  return stretch;
}

function aimSegment(segment, from, to, referenceLength) {
  const direction = scratch.c.subVectors(to, from);
  const length = direction.length();
  segment.position.copy(from);
  if (length > 1e-6) segment.quaternion.setFromUnitVectors(UP, direction.divideScalar(length));
  segment.scale.set(1, Math.max(length, 1e-3) / referenceLength, 1);
}

const joint = new THREE.Vector3();
const end = new THREE.Vector3();
const wristTarget = new THREE.Vector3();
const shoulder = new THREE.Vector3();
const hip = new THREE.Vector3();
const pole = new THREE.Vector3();

/** Poses one arm so its fist closes on gripTarget (pilot frame, real metres). */
export function poseCivilArm(limb, side, gripTarget, recline = CIVIL_SEAT_RECLINE_RAD) {
  shoulder.copy(civilShoulderJoint(side, recline));
  // Wrist sits behind the grip along the shoulder→grip line.
  wristTarget.subVectors(gripTarget, shoulder).normalize().multiplyScalar(-GRIP_FROM_WRIST).add(gripTarget);
  pole.set(side * 0.75, -1, 0.35);
  const stretch = solveTwoBone(shoulder, wristTarget, UPPER_ARM, FOREARM, pole, joint, end);
  aimSegment(limb.upper, shoulder, joint, UPPER_ARM);
  aimSegment(limb.fore, joint, end, FOREARM);
  limb.hand.position.copy(end);
  limb.hand.quaternion.copy(limb.fore.quaternion);
  return stretch;
}

/** Poses one leg with the ankle at ankleTarget and the sole pointing along toeDirection. */
export function poseCivilLeg(limb, side, ankleTarget, toeDirection) {
  hip.set(side * HIP_JOINT.x, HIP_JOINT.y, HIP_JOINT.z);
  pole.set(side * 0.12, 1, -0.7);
  const stretch = solveTwoBone(hip, ankleTarget, THIGH, SHIN, pole, joint, end);
  aimSegment(limb.thigh, hip, joint, THIGH);
  aimSegment(limb.shin, joint, end, SHIN);
  limb.foot.position.copy(end);
  scratch.d.copy(toeDirection).normalize();
  limb.foot.quaternion.setFromUnitVectors(FORWARD, scratch.d);
  return stretch;
}

/** Rest pose for hands when no control is available: on the thighs. */
export function civilRestGrip(side) {
  return v(side * 0.12, 0.12, -0.3);
}

/**
 * Creates a mountable civil pilot.
 *
 * mounts: { cockpit: {position, scale}, exterior?: {position, scale} } in the parent frame.
 * targets (parent frame): { grips: [left, right], ankles: [left, right], toeDirection }.
 */
export function createCivilPilot(styleName, { mounts, targets, name } = {}) {
  const { root, seat, body, head, limbs, style, eye } = buildCivilPilotScene(styleName);
  const group = new THREE.Group();
  group.name = name ?? `Pilot_${styleName}`;
  group.add(root);
  group.userData.head = head;
  group.userData.body = body;
  group.userData.seat = seat;
  group.userData.activeScene = root;
  group.userData.limbs = limbs;
  group.userData.style = style;
  group.userData.eye = eye;
  group.userData.mounts = mounts;
  group.userData.targets = targets;
  group.userData.gripOverride = null;
  group.ready = Promise.resolve();
  applyCivilPilotMount(group, 'exterior');
  return group;
}

const parentPoint = new THREE.Vector3();

function toPilotFrame(pilot, point, out) {
  return out.copy(point).sub(pilot.position).divideScalar(pilot.scale.x);
}

/** Moves the pilot to the requested mount and re-solves the limbs against its targets. */
export function applyCivilPilotMount(pilot, mode = 'exterior') {
  const mounts = pilot?.userData?.mounts;
  if (!mounts) return;
  const mount = mounts[mode] ?? mounts.exterior ?? mounts.cockpit;
  if (!mount) return;
  pilot.position.copy(mount.position);
  pilot.scale.setScalar(mount.scale);
  pilot.userData.mountMode = mode;
  poseCivilLegs(pilot);
  poseCivilHands(pilot, pilot.userData.gripOverride);
}

export function poseCivilLegs(pilot) {
  const { targets, limbs } = pilot.userData;
  if (!targets?.ankles) return;
  limbs.legs.forEach((limb, i) => {
    const side = i === 0 ? -1 : 1;
    poseCivilLeg(limb, side, toPilotFrame(pilot, targets.ankles[i], parentPoint), targets.toeDirection);
  });
}

/**
 * Poses both hands. grips (parent frame) overrides the static targets, e.g. with the animated
 * yoke horns; null grips fall back to the static targets, and 'rest' lays the hands on the thighs.
 */
export function poseCivilHands(pilot, grips = null) {
  const { targets, limbs, style } = pilot.userData;
  let maxStretch = 1;
  limbs.arms.forEach((limb, i) => {
    const side = i === 0 ? -1 : 1;
    const source = grips === 'rest' ? null : (grips?.[i] ?? targets?.grips?.[i]);
    const local = source ? toPilotFrame(pilot, source, parentPoint) : civilRestGrip(side);
    maxStretch = Math.max(maxStretch, poseCivilArm(limb, side, local, style.recline));
  });
  return maxStretch;
}

/**
 * Cockpit/exterior visibility and mount. The occupant's own head hides in first person, like the
 * F-16 pilot; ownView false keeps the head (a first officer seen from the captain's seat).
 */
export function setCivilPilotView(pilot, isCockpit, showInterior = true, { ownView = true } = {}) {
  if (!pilot?.userData) return;
  const mode = isCockpit && ownView ? 'cockpit' : 'exterior';
  if (pilot.userData.mountMode !== mode) applyCivilPilotMount(pilot, mode);
  setPilotCockpitMode(pilot, isCockpit, showInterior, { showHead: !ownView });
}

/** Counts render meshes for draw-call budgeting. */
export function countPilotMeshes(pilot) {
  let count = 0;
  pilot.traverse(node => { if (node.isMesh) count++; });
  return count;
}

function seatedTargets({ grips, toes, scale }) {
  // Ankle sits behind and above the ball of the foot on the pedal.
  return {
    grips: grips.map(p => v(...p)),
    ankles: toes.map(([x, y, z]) => v(x, y + 0.07 * scale, z + 0.14 * scale)),
    toeDirection: v(0, -0.35, -1).normalize(),
  };
}

function eyeAlignedMount(eye, scale, styleName) {
  const eyeLocal = civilPilotEye(CIVIL_PILOT_STYLES[styleName].recline);
  return { position: v(...eye).sub(eyeLocal.multiplyScalar(scale)), scale };
}

// Boeing 737 flight deck, measured from b737-cockpit-medium.glb in aircraft coordinates:
// yoke horns at the extremes of each GLTF yoke pivot, rudder pedal footplates, captain eye from
// BOEING_737_800.cockpit.captainEyePos. The deck is modelled at ~0.58 of full size.
export const B737_PILOT_SCALE = 0.58;
export const B737_CAPTAIN_EYE = Object.freeze([-0.303, 0.88, -12.35]);
export const B737_FIRST_OFFICER_EYE = Object.freeze([0.257, 0.88, -12.38]);

export function createB737Pilots() {
  const s = B737_PILOT_SCALE;
  const captain = createCivilPilot('airlineCaptain', {
    name: 'Pilot_B737_Captain',
    mounts: { cockpit: eyeAlignedMount(B737_CAPTAIN_EYE, s, 'airlineCaptain') },
    targets: seatedTargets({
      scale: s,
      grips: [[-0.395, 0.655, -12.692], [-0.211, 0.655, -12.692]],
      toes: [[-0.376, 0.37, -12.97], [-0.231, 0.37, -12.97]],
    }),
  });
  const firstOfficer = createCivilPilot('airlineFirstOfficer', {
    name: 'Pilot_B737_FirstOfficer',
    mounts: { cockpit: eyeAlignedMount(B737_FIRST_OFFICER_EYE, s, 'airlineFirstOfficer') },
    targets: seatedTargets({
      scale: s,
      grips: [[0.162, 0.655, -12.692], [0.345, 0.655, -12.692]],
      toes: [[0.188, 0.37, -12.97], [0.332, 0.37, -12.97]],
    }),
  });
  return { captain, firstOfficer };
}

// Cessna 172 cabin from c172.glb (aircraft coordinates): left yoke horns, left rudder pedals,
// seat cushion top at y≈0.02 and seat back face at z≈-0.85. With the upright, slightly forward
// posture the eye-aligned hip lands on the front half of the cushion, a few centimetres clear of
// the seat back, so one mount serves both the cockpit camera and the exterior windows.
export const C172_PILOT_SCALE = 0.95;
export const C172_PILOT_EYE = Object.freeze([-0.22, 0.72, -1.18]);

export function createC172Pilot() {
  const s = C172_PILOT_SCALE;
  return createCivilPilot('cessna', {
    name: 'Pilot_C172',
    mounts: { cockpit: eyeAlignedMount(C172_PILOT_EYE, s, 'cessna') },
    targets: seatedTargets({
      scale: s,
      grips: [[-0.285, 0.275, -1.69], [-0.095, 0.275, -1.69]],
      toes: [[-0.33, -0.17, -1.86], [-0.22, -0.17, -1.86]],
    }),
  });
}
