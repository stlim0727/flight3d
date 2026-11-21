/**
 * @file pilotGeometry.js
 * @description Procedural geometry, PBR materials, and model loading for military flight pilots.
 * Features an authentic ACES II ejection seat (30° reclined), CWU-27/P flight suit,
 * PCU-15/P restraint harness with Koch fittings, tactical AIRSAVE survival vest with radio/beacon pouches,
 * continuous fitted sleeves and HOTAS hands with two-tone Nomex/leather gloves,
 * CSU-13B/P anti-G suit trousers with right-thigh pilot kneeboard,
 * and an articulated Pilot_Head (HGU-55/P helmet with ear cup bulges, dark mirror visor,
 * MBU-12/P oxygen mask, and corrugated hose connecting directly into the chest CRU-60/P regulator).
 */

import * as THREE from 'three';
import { addPilotArms, harnessGeometry } from './pilotFlightGear.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// F-16 ACES II seat recline angle (30 degrees from vertical)
export const SEAT_RECLINE_DEG = 30.0;
export const SEAT_RECLINE_RAD = THREE.MathUtils.degToRad(SEAT_RECLINE_DEG);

/**
 * Standard mounting offset for F-16 cockpit.
 * Positions pilot eyes precisely at F-16 captainEyePos (0.0, 0.94, -3.60)
 * while fitting the seat and rudder pedals within the cockpit tub.
 */
export const F16_PILOT_OFFSET = Object.freeze({
  x: 0.0,
  y: 0.273,
  z: -3.693,
});

const sharedMaterials = new Map();

function getMaterial(name, parameters) {
  let mat = sharedMaterials.get(name);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ name, ...parameters });
    sharedMaterials.set(name, mat);
  }
  return mat;
}

/** PBR material palette with authentic military flight gear finishes */
export function createPilotMaterials() {
  return {
    helmet: getMaterial('pilot-helmet', {
      color: 0x5a6358, // Tactical flight grey-green
      roughness: 0.40,
      metalness: 0.10,
    }),
    helmetTrim: getMaterial('pilot-rubber-trim', {
      color: 0x151715, // Black rubber beading edge
      roughness: 0.85,
      metalness: 0.02,
    }),
    visor: getMaterial('pilot-visor', {
      color: 0x0c0f12, // Deep dark obsidian polycarbonate visor
      roughness: 0.16,
      metalness: 0.75,
    }),
    mask: getMaterial('pilot-mask', {
      color: 0x222624, // Tactical silicone rubber
      roughness: 0.65,
      metalness: 0.05,
    }),
    maskHard: getMaterial('pilot-mask-hard', {
      color: 0x2e3530, // Rigid hardshell over nose bridge
      roughness: 0.45,
      metalness: 0.10,
    }),
    hose: getMaterial('pilot-mask-hose', {
      color: 0x1b1e1c, // Corrugated breathing hose
      roughness: 0.70,
      metalness: 0.05,
    }),
    suit: getMaterial('pilot-suit', {
      color: 0x3d493a, // Sage green CWU-27/P flight suit
      roughness: 0.85,
      metalness: 0.02,
    }),
    vest: getMaterial('pilot-vest', {
      color: 0x283226, // Dark tactical olive survival vest
      roughness: 0.88,
      metalness: 0.02,
    }),
    harness: getMaterial('pilot-harness', {
      color: 0x181c16, // Dark olive/black nylon webbing
      roughness: 0.70,
      metalness: 0.10,
    }),
    hardware: getMaterial('pilot-hardware', {
      color: 0x9da6ab, // Anodized aluminum Koch fittings & buckles
      roughness: 0.30,
      metalness: 0.85,
    }),
    buckle: getMaterial('pilot-harness-buckle', {
      color: 0x8a9296, // Rotary buckle
      roughness: 0.35,
      metalness: 0.85,
    }),
    patch: getMaterial('pilot-patch', {
      color: 0x4f574c, // Subdued tactical patch
      roughness: 0.65,
      metalness: 0.05,
    }),
    flagPatch: getMaterial('pilot-flag-patch', {
      color: 0x656b60, // Subdued flag patch
      roughness: 0.60,
      metalness: 0.05,
    }),
    glovesNomex: getMaterial('pilot-gloves-nomex', {
      color: 0x3d493a, // Sage green Nomex back
      roughness: 0.85,
      metalness: 0.02,
    }),
    glovesLeather: getMaterial('pilot-gloves', {
      color: 0x1a1c1b, // Dark charcoal leather palm & fingers
      roughness: 0.68,
      metalness: 0.06,
    }),
    boots: getMaterial('pilot-boots', {
      color: 0x141617, // Black combat leather boots
      roughness: 0.55,
      metalness: 0.10,
    }),
    kneeboard: getMaterial('pilot-kneeboard', {
      color: 0xd8dde0, // White aluminum checklist kneeboard
      roughness: 0.45,
      metalness: 0.20,
    }),
    seatFrame: getMaterial('pilot-seat-frame', {
      color: 0x2e3338, // ACES II structural chassis
      roughness: 0.55,
      metalness: 0.35,
    }),
    seatCushion: getMaterial('pilot-seat-cushion', {
      color: 0x202426, // Padded seat and back cushions
      roughness: 0.88,
      metalness: 0.05,
    }),
    ejectionHandle: getMaterial('pilot-ejection-handle', {
      color: 0xde9b00, // Safety yellow ejection ring
      roughness: 0.38,
      metalness: 0.10,
    }),
    controls: getMaterial('pilot-cockpit-controls', {
      color: 0x222527, // HOTAS stick and throttle grips
      roughness: 0.50,
      metalness: 0.25,
    }),
  };
}

/**
 * Builds the ACES II ejection seat geometry:
 * Bucket base with lateral guide walls, 30° reclined backrest with vertical guide rails,
 * quilted lumbar cushion, headrest box with parachute pack and twin canopy breaker horns,
 * and center ejection pull loop.
 */
export function buildAcesIISeat(mats) {
  const seatGroup = new THREE.Group();
  seatGroup.name = 'Pilot_Seat';

  // 1. Seat pan / bucket base
  const panGeo = new THREE.BoxGeometry(0.46, 0.12, 0.48);
  const panMesh = new THREE.Mesh(panGeo, mats.seatFrame);
  panMesh.name = 'Pilot_Seat_Pan';
  panMesh.position.set(0, -0.06, -0.15);
  seatGroup.add(panMesh);

  // Seat pan side walls
  for (const side of [-1, 1]) {
    const wallGeo = new THREE.BoxGeometry(0.025, 0.14, 0.44);
    const wall = new THREE.Mesh(wallGeo, mats.seatFrame);
    wall.name = `Pilot_Seat_Wall_${side > 0 ? 'R' : 'L'}`;
    wall.position.set(side * 0.23, 0.01, -0.15);
    seatGroup.add(wall);
  }

  // Seat pan cushion
  const panCushionGeo = new THREE.BoxGeometry(0.42, 0.06, 0.44);
  const panCushion = new THREE.Mesh(panCushionGeo, mats.seatCushion);
  panCushion.name = 'Pilot_Seat_PanCushion';
  panCushion.position.set(0, 0.02, -0.15);
  seatGroup.add(panCushion);

  // 2. Reclined seat back frame (rotated 30° backward around hip axis)
  const backPivot = new THREE.Group();
  backPivot.name = 'Pilot_Seat_BackPivot';
  backPivot.position.set(0, 0.0, 0.05);
  backPivot.rotation.x = SEAT_RECLINE_RAD;
  seatGroup.add(backPivot);

  // Main back bulkhead
  const backBulkheadGeo = new THREE.BoxGeometry(0.44, 0.74, 0.07);
  const backBulkhead = new THREE.Mesh(backBulkheadGeo, mats.seatFrame);
  backBulkhead.name = 'Pilot_Seat_BackBulkhead';
  backBulkhead.position.set(0, 0.37, 0.0);
  backPivot.add(backBulkhead);

  // Vertical twin guide rails
  for (const side of [-1, 1]) {
    const railGeo = new THREE.BoxGeometry(0.04, 0.78, 0.05);
    const rail = new THREE.Mesh(railGeo, mats.seatFrame);
    rail.name = `Pilot_Seat_Rail_${side > 0 ? 'R' : 'L'}`;
    rail.position.set(side * 0.22, 0.39, 0.04);
    backPivot.add(rail);
  }

  // Quilted backrest cushion
  const backCushionGeo = new THREE.BoxGeometry(0.38, 0.60, 0.05);
  const backCushion = new THREE.Mesh(backCushionGeo, mats.seatCushion);
  backCushion.name = 'Pilot_Seat_BackCushion';
  backCushion.position.set(0, 0.32, -0.05);
  backPivot.add(backCushion);

  // 3. Headrest Box & Parachute Container
  const headrestGeo = new THREE.BoxGeometry(0.32, 0.22, 0.16);
  const headrest = new THREE.Mesh(headrestGeo, mats.seatFrame);
  headrest.name = 'Pilot_Seat_Headrest';
  headrest.position.set(0, 0.72, -0.01);
  backPivot.add(headrest);

  // Padded headrest cushion
  const headrestCushionGeo = new THREE.BoxGeometry(0.24, 0.16, 0.05);
  const headrestCushion = new THREE.Mesh(headrestCushionGeo, mats.seatCushion);
  headrestCushion.name = 'Pilot_Seat_HeadrestCushion';
  headrestCushion.position.set(0, 0.72, -0.10);
  backPivot.add(headrestCushion);

  // Twin Canopy Breaker Pitot Horns on top of headrest
  for (const side of [-1, 1]) {
    const hornGeo = new THREE.ConeGeometry(0.020, 0.12, 10);
    hornGeo.rotateX(0.15);
    const horn = new THREE.Mesh(hornGeo, mats.seatFrame);
    horn.name = `Pilot_Seat_CanopyBreaker_${side > 0 ? 'R' : 'L'}`;
    horn.position.set(side * 0.11, 0.88, 0.02);
    backPivot.add(horn);
  }

  // 4. Center Ejection Pull Loop (positioned outside pelvis, between pilot thighs)
  const handleRingGeo = new THREE.TorusGeometry(0.048, 0.012, 10, 20);
  const handleMesh = new THREE.Mesh(handleRingGeo, mats.ejectionHandle);
  handleMesh.name = 'Pilot_Seat_EjectionHandle';
  handleMesh.position.set(0, 0.06, -0.31);
  handleMesh.rotation.x = Math.PI / 4;
  seatGroup.add(handleMesh);

  return seatGroup;
}

/**
 * Builds the articulated and detailed Pilot Body:
 * Reclined torso, continuous shoulder and sleeve contours, PCU-15/P harness with Koch fittings,
 * AIRSAVE survival vest with radio/beacon pockets and patches,
 * arms jointed directly to shoulders with two-tone Nomex/leather gloves gripping throttle and stick,
 * CSU-13B/P anti-G suit with right-thigh kneeboard, and combat boots.
 */
export function buildPilotBody(mats) {
  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'Pilot_Body';

  // 1. Reclined Torso (30° matching ACES II seat back)
  const torsoPivot = new THREE.Group();
  torsoPivot.name = 'Pilot_Torso_Pivot';
  torsoPivot.position.set(0, 0.0, 0.05);
  torsoPivot.rotation.x = SEAT_RECLINE_RAD;
  bodyGroup.add(torsoPivot);

  // Main athletic chest/abdomen volume (front surface at Z = -0.16)
  const chestGeo = new THREE.CylinderGeometry(0.19, 0.15, 0.42, 16);
  chestGeo.scale(1.15, 1.0, 0.70);
  const chestMesh = new THREE.Mesh(chestGeo, mats.suit);
  chestMesh.name = 'Pilot_Body_Chest';
  chestMesh.position.set(0, 0.28, -0.04);
  torsoPivot.add(chestMesh);

  // Mandarin flight suit collar around neck base
  const collarGeo = new THREE.CylinderGeometry(0.082, 0.092, 0.06, 14);
  const collarMesh = new THREE.Mesh(collarGeo, mats.suit);
  collarMesh.name = 'Pilot_Body_Collar';
  collarMesh.position.set(0, 0.48, -0.05);
  torsoPivot.add(collarMesh);

  // Clavicle bridge / shoulder girdle yoke
  const shoulderGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.44, 14);
  shoulderGeo.rotateZ(Math.PI / 2);
  const shoulderMesh = new THREE.Mesh(shoulderGeo, mats.suit);
  shoulderMesh.name = 'Pilot_Body_Shoulders';
  shoulderMesh.position.set(0, 0.44, -0.05);
  torsoPivot.add(shoulderMesh);

  // Tactical Flag Patch on Left Shoulder
  const flagPatchGeo = new THREE.BoxGeometry(0.01, 0.05, 0.08);
  const flagPatch = new THREE.Mesh(flagPatchGeo, mats.flagPatch);
  flagPatch.name = 'Pilot_Body_FlagPatch_L';
  flagPatch.position.set(-0.285, 0.40, -0.05);
  torsoPivot.add(flagPatch);

  // AIRSAVE / Survival Vest Layer over chest (front surface at Z = -0.175)
  const vestGeo = new THREE.CylinderGeometry(0.195, 0.155, 0.32, 16);
  vestGeo.scale(1.16, 1.0, 0.72);
  const vestMesh = new THREE.Mesh(vestGeo, mats.vest);
  vestMesh.name = 'Pilot_Body_Vest';
  vestMesh.position.set(0, 0.27, -0.045);
  torsoPivot.add(vestMesh);

  // Vest Tactical Pockets: Radio pouch on left, beacon pouch on right
  const radioPocketGeo = new THREE.BoxGeometry(0.055, 0.11, 0.035);
  const radioPocket = new THREE.Mesh(radioPocketGeo, mats.vest);
  radioPocket.name = 'Pilot_Body_Vest_Radio_L';
  radioPocket.position.set(-0.11, 0.31, -0.19);
  torsoPivot.add(radioPocket);

  const beaconPocketGeo = new THREE.BoxGeometry(0.055, 0.10, 0.035);
  const beaconPocket = new THREE.Mesh(beaconPocketGeo, mats.vest);
  beaconPocket.name = 'Pilot_Body_Vest_Beacon_R';
  beaconPocket.position.set(0.11, 0.32, -0.19);
  torsoPivot.add(beaconPocket);

  // Pilot Name Tag on Left Chest
  const nameTagGeo = new THREE.BoxGeometry(0.065, 0.030, 0.012);
  const nameTag = new THREE.Mesh(nameTagGeo, mats.patch);
  nameTag.name = 'Pilot_Body_NameTag';
  nameTag.position.set(-0.145, 0.39, -0.149);
  nameTag.rotation.y = 0.48;
  torsoPivot.add(nameTag);

  // Squadron Patch on Right Chest
  const squadronPatchGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.012, 12);
  squadronPatchGeo.rotateX(Math.PI / 2);
  const squadronPatch = new THREE.Mesh(squadronPatchGeo, mats.patch);
  squadronPatch.name = 'Pilot_Body_SquadronPatch';
  squadronPatch.position.set(0.145, 0.39, -0.149);
  squadronPatch.rotation.y = -0.48;
  torsoPivot.add(squadronPatch);

  // Fitted shoulder webbing converges under the central buckle.
  for (const side of [-1, 1]) {
    const sName = side > 0 ? 'R' : 'L';
    const strapGeo = harnessGeometry(side);
    const strap = new THREE.Mesh(strapGeo, mats.harness);
    strap.name = `Pilot_Body_HarnessStrap_${sName}`;
    torsoPivot.add(strap);

    // Silver Koch canopy release fitting at collarbone level
    const kochGeo = new THREE.BoxGeometry(0.035, 0.045, 0.025);
    const koch = new THREE.Mesh(kochGeo, mats.hardware);
    koch.name = `Pilot_Body_KochFitting_${sName}`;
    koch.position.set(side * 0.10, 0.438, -0.171);
    koch.rotation.x = 0.22;
    koch.rotation.z = -side * 0.48;
    torsoPivot.add(koch);
  }

  // CRU-60/P Oxygen Regulator & Intercom Bracket (mounted on the left chest of the vest)
  const cru60Geo = new THREE.BoxGeometry(0.045, 0.055, 0.035);
  const cru60 = new THREE.Mesh(cru60Geo, mats.hardware);
  cru60.name = 'Pilot_Body_CRU60_Regulator';
  cru60.position.set(-0.10, 0.24, -0.20);
  torsoPivot.add(cru60);

  // Central rotary ejection buckle on lower abdomen
  const buckleGeo = new THREE.CylinderGeometry(0.040, 0.040, 0.025, 16);
  buckleGeo.rotateX(Math.PI / 2);
  const buckle = new THREE.Mesh(buckleGeo, mats.buckle);
  buckle.name = 'Pilot_Body_HarnessBuckle';
  buckle.position.set(0, 0.15, -0.18);
  torsoPivot.add(buckle);

  // 2. Legs & CSU-13B/P Anti-G Trousers
  const pelvisGeo = new THREE.BoxGeometry(0.36, 0.14, 0.28);
  const pelvis = new THREE.Mesh(pelvisGeo, mats.suit);
  pelvis.name = 'Pilot_Body_Pelvis';
  pelvis.position.set(0, 0.05, -0.10);
  bodyGroup.add(pelvis);

  for (const side of [-1, 1]) {
    const sName = side > 0 ? 'R' : 'L';
    const thighX = side * 0.115;

    // Muscular thigh
    const thighGeo = new THREE.CylinderGeometry(0.082, 0.070, 0.38, 14);
    thighGeo.rotateX(Math.PI / 2 + 0.12);
    const thigh = new THREE.Mesh(thighGeo, mats.suit);
    thigh.name = `Pilot_Body_Thigh_${sName}`;
    thigh.position.set(thighX, 0.07, -0.28);
    bodyGroup.add(thigh);

    // CSU-13B/P Anti-G suit thigh pressure bladder
    const gPouchGeo = new THREE.BoxGeometry(0.12, 0.030, 0.28);
    const gPouch = new THREE.Mesh(gPouchGeo, mats.harness);
    gPouch.name = `Pilot_Body_GPouch_${sName}`;
    gPouch.position.set(thighX, 0.135, -0.28);
    gPouch.rotation.x = -0.12;
    bodyGroup.add(gPouch);

    // Knee joint
    const kneeGeo = new THREE.SphereGeometry(0.065, 12, 10);
    const knee = new THREE.Mesh(kneeGeo, mats.suit);
    knee.name = `Pilot_Body_Knee_${sName}`;
    knee.position.set(thighX, 0.04, -0.46);
    bodyGroup.add(knee);

    // Calf
    const calfGeo = new THREE.CylinderGeometry(0.068, 0.056, 0.36, 12);
    calfGeo.rotateX(Math.PI / 4 + 0.10);
    const calf = new THREE.Mesh(calfGeo, mats.suit);
    calf.name = `Pilot_Body_Calf_${sName}`;
    calf.position.set(thighX, -0.08, -0.54);
    bodyGroup.add(calf);

    // Flight Combat Boot Mesh
    const bootUpperGeo = new THREE.BoxGeometry(0.095, 0.09, 0.22);
    const bootUpper = new THREE.Mesh(bootUpperGeo, mats.boots);
    bootUpper.name = `Pilot_Body_Boot_${sName}`;
    bootUpper.position.set(thighX, -0.20, -0.68);
    bootUpper.rotation.x = 0.25;

    const bootSoleGeo = new THREE.BoxGeometry(0.10, 0.025, 0.23);
    const bootSole = new THREE.Mesh(bootSoleGeo, mats.boots);
    bootSole.name = `Pilot_Body_Boot_Sole_${sName}`;
    bootSole.position.set(0, -0.05, 0.0);
    bootUpper.add(bootSole);

    bodyGroup.add(bootUpper);
  }

  // Pilot Kneeboard on Right Thigh
  const kneeboardGeo = new THREE.BoxGeometry(0.11, 0.015, 0.16);
  const kneeboard = new THREE.Mesh(kneeboardGeo, mats.kneeboard);
  kneeboard.name = 'Pilot_Body_Kneeboard';
  kneeboard.position.set(0.115, 0.155, -0.28);
  kneeboard.rotation.x = -0.12;
  bodyGroup.add(kneeboard);

  addPilotArms(bodyGroup, mats);

  // Throttle Quadrant grip & base (placed exactly to meet the glove)
  const throttleBase = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.14), mats.controls);
  throttleBase.name = 'Pilot_Body_ThrottleBase';
  throttleBase.position.set(-0.21, 0.15, -0.25);
  bodyGroup.add(throttleBase);

  const throttleGrip = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.075, 0.11), mats.controls);
  throttleGrip.name = 'Pilot_Body_ThrottleGrip';
  throttleGrip.position.set(-0.21, 0.22, -0.25);
  bodyGroup.add(throttleGrip);

  // F-16 Sidestick Controller (pedestal + grip meeting the right glove)
  const stickBaseGeo = new THREE.CylinderGeometry(0.025, 0.038, 0.10, 12);
  const stickBase = new THREE.Mesh(stickBaseGeo, mats.controls);
  stickBase.name = 'Pilot_Body_StickBase';
  stickBase.position.set(0.21, 0.14, -0.25);
  bodyGroup.add(stickBase);

  const stickGripGeo = new THREE.CylinderGeometry(0.020, 0.018, 0.12, 12);
  stickGripGeo.rotateX(0.12);
  const stickGrip = new THREE.Mesh(stickGripGeo, mats.controls);
  stickGrip.name = 'Pilot_Body_StickGrip';
  stickGrip.position.set(0.21, 0.22, -0.25);
  bodyGroup.add(stickGrip);

  const stickHeadGeo = new THREE.BoxGeometry(0.032, 0.030, 0.038);
  const stickHead = new THREE.Mesh(stickHeadGeo, mats.controls);
  stickHead.name = 'Pilot_Body_StickHead';
  stickHead.position.set(0.21, 0.28, -0.26);
  bodyGroup.add(stickHead);

  return bodyGroup;
}

/**
 * Builds the articulated and detailed Pilot Head assembly:
 * Muscular neck cylinder with turtleneck collar, HGU-55/P lightweight helmet
 * with aerodynamic ear cup bulges and rubber rim trim, dark obsidian mirror visor,
 * MBU-12/P oxygen mask with silicone seal and exhalation valve, cheek bayonet retention straps,
 * and corrugated breathing hose connecting down to the chest CRU-60/P regulator.
 */
export function buildPilotHead(mats) {
  const headGroup = new THREE.Group();
  headGroup.name = 'Pilot_Head';

  // Head pivot point atop the reclined torso
  headGroup.position.set(0, 0.483, 0.213);

  // 1. Neck cylinder with flight suit collar underneath
  const neckGeo = new THREE.CylinderGeometry(0.065, 0.075, 0.09, 14);
  neckGeo.rotateX(-0.15); // Forward compensation from 30° reclined torso
  const neck = new THREE.Mesh(neckGeo, mats.suit);
  neck.name = 'Pilot_Head_Neck';
  neck.position.set(0, 0.04, -0.01);
  headGroup.add(neck);

  // 2. HGU-55/P Helmet Shell
  const helmetCenter = new THREE.Vector3(0, 0.16, -0.02);

  // Main helmet dome
  const domeGeo = new THREE.SphereGeometry(0.125, 22, 18);
  domeGeo.scale(0.96, 1.05, 1.04);
  const dome = new THREE.Mesh(domeGeo, mats.helmet);
  dome.name = 'Pilot_Head_HelmetDome';
  dome.position.copy(helmetCenter);
  headGroup.add(dome);

  // Aerodynamic Ear Cup Bulges (distinctive HGU-55/P low-profile ear domes)
  for (const side of [-1, 1]) {
    const sName = side > 0 ? 'R' : 'L';
    const earGeo = new THREE.SphereGeometry(0.045, 12, 10);
    earGeo.scale(0.55, 1.15, 1.0);
    const ear = new THREE.Mesh(earGeo, mats.helmet);
    ear.name = `Pilot_Head_EarCup_${sName}`;
    ear.position.set(side * 0.122, helmetCenter.y - 0.02, helmetCenter.z - 0.01);
    headGroup.add(ear);

    // Visor friction pivot dial
    const pivotDialGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.01, 10);
    pivotDialGeo.rotateZ(Math.PI / 2);
    const dial = new THREE.Mesh(pivotDialGeo, mats.hardware);
    dial.name = `Pilot_Head_VisorDial_${sName}`;
    dial.position.set(side * 0.135, helmetCenter.y + 0.02, helmetCenter.z - 0.02);
    headGroup.add(dial);
  }

  // Black rubber edge beading rim
  const rimGeo = new THREE.TorusGeometry(0.116, 0.011, 10, 24);
  rimGeo.rotateX(Math.PI / 2 + 0.10);
  const rim = new THREE.Mesh(rimGeo, mats.helmetTrim);
  rim.name = 'Pilot_Head_HelmetRim';
  rim.position.set(0, helmetCenter.y - 0.07, helmetCenter.z + 0.01);
  headGroup.add(rim);

  // Helmet brow guard / visor housing cover (facing forward in negative Z)
  const browGeo = new THREE.CylinderGeometry(0.127, 0.129, 0.035, 18, 1, false, Math.PI * 0.78, Math.PI * 0.44);
  const brow = new THREE.Mesh(browGeo, mats.helmet);
  brow.name = 'Pilot_Head_Brow';
  brow.position.set(0, helmetCenter.y + 0.08, helmetCenter.z);
  headGroup.add(brow);

  // Center visor track guide
  const trackGeo = new THREE.BoxGeometry(0.022, 0.07, 0.012);
  const track = new THREE.Mesh(trackGeo, mats.hardware);
  track.name = 'Pilot_Head_VisorTrack';
  track.position.set(0, helmetCenter.y + 0.09, helmetCenter.z - 0.13);
  headGroup.add(track);

  // 3. Tinted Dark Mirror Visor (facing forward in negative Z)
  const visorGeo = new THREE.SphereGeometry(0.130, 22, 16, Math.PI * 0.22, Math.PI * 0.56, Math.PI * 0.24, Math.PI * 0.38);
  visorGeo.rotateY(Math.PI);
  visorGeo.scale(0.98, 1.02, 1.06);
  const visor = new THREE.Mesh(visorGeo, mats.visor);
  visor.name = 'Pilot_Head_Visor';
  visor.position.set(0, helmetCenter.y + 0.01, helmetCenter.z - 0.01);
  headGroup.add(visor);

  // 4. MBU-12/P Oxygen Mask
  // Silicone rubber face cone
  const maskConeGeo = new THREE.ConeGeometry(0.065, 0.11, 14);
  maskConeGeo.rotateX(-Math.PI / 2 - 0.25);
  const maskCone = new THREE.Mesh(maskConeGeo, mats.mask);
  maskCone.name = 'Pilot_Head_OxygenMask';
  maskCone.position.set(0, helmetCenter.y - 0.065, helmetCenter.z - 0.115);
  headGroup.add(maskCone);

  // Rigid plastic hardshell over nose bridge
  const hardshellGeo = new THREE.BoxGeometry(0.06, 0.05, 0.04);
  const hardshell = new THREE.Mesh(hardshellGeo, mats.maskHard);
  hardshell.name = 'Pilot_Head_MaskHardshell';
  hardshell.position.set(0, helmetCenter.y - 0.045, helmetCenter.z - 0.135);
  headGroup.add(hardshell);

  // Exhalation valve disc in front
  const valveGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.015, 12);
  valveGeo.rotateX(Math.PI / 2);
  const valve = new THREE.Mesh(valveGeo, mats.maskHard);
  valve.name = 'Pilot_Head_ExhalationValve';
  valve.position.set(0, helmetCenter.y - 0.095, helmetCenter.z - 0.138);
  headGroup.add(valve);

  // Stainless steel bayonet retention straps on cheeks
  for (const side of [-1, 1]) {
    const sName = side > 0 ? 'R' : 'L';
    const strapGeo = new THREE.BoxGeometry(0.015, 0.010, 0.09);
    strapGeo.rotateY(side * 0.45);
    const strap = new THREE.Mesh(strapGeo, mats.hardware);
    strap.name = `Pilot_Head_Bayonet_${sName}`;
    strap.position.set(side * 0.085, helmetCenter.y - 0.045, helmetCenter.z - 0.07);
    headGroup.add(strap);
  }

  // 5. Corrugated Flexible Oxygen Hose
  // Routes from mask bottom, curving across left chest directly into the CRU-60/P chest regulator!
  const hosePoints = [
    new THREE.Vector3(0, helmetCenter.y - 0.095, helmetCenter.z - 0.125),
    new THREE.Vector3(-0.025, helmetCenter.y - 0.15, helmetCenter.z - 0.145),
    new THREE.Vector3(-0.055, helmetCenter.y - 0.22, helmetCenter.z - 0.170),
    new THREE.Vector3(-0.080, helmetCenter.y - 0.28, helmetCenter.z - 0.195),
    new THREE.Vector3(-0.100, helmetCenter.y - 0.34, helmetCenter.z - 0.225),
  ];
  const hoseCurve = new THREE.CatmullRomCurve3(hosePoints);
  const hoseGeo = new THREE.TubeGeometry(hoseCurve, 24, 0.016, 10, false);
  const hose = new THREE.Mesh(hoseGeo, mats.hose);
  hose.name = 'Pilot_Head_OxygenHose';
  headGroup.add(hose);

  return headGroup;
}

/**
 * Builds the complete procedural F-16 pilot and ACES II ejection seat scene.
 * Returns { root, seat, body, head } with named hierarchies.
 */
export function buildF16PilotScene() {
  const mats = createPilotMaterials();
  const root = new THREE.Group();
  root.name = 'F16_Pilot_Model';

  const seat = buildAcesIISeat(mats);
  const body = buildPilotBody(mats);
  const head = buildPilotHead(mats);

  root.add(seat);
  root.add(body);
  root.add(head);

  return { root, seat, body, head };
}

let pilotTemplate = null;
let pilotLoadingPromise = null;

/**
 * Returns the URL path to the pilot model GLB.
 */
export function getPilotModelUrl(variant = 'f16') {
  const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  return `${baseUrl}models/pilot-${variant}.glb`;
}

/**
 * Loads the pilot GLB model template asynchronously with caching.
 */
export async function loadPilotModel(variant = 'f16') {
  if (pilotTemplate) return pilotTemplate;
  if (pilotLoadingPromise) return pilotLoadingPromise;

  pilotLoadingPromise = (async () => {
    try {
      const url = getPilotModelUrl(variant);
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      const scene = gltf.scene || gltf.scenes?.[0];
      if (scene) {
        pilotTemplate = scene;
        return scene;
      }
    } catch {
      // In test / headless offline environments, procedural fallback is used
    }
    return null;
  })();

  return pilotLoadingPromise;
}

/**
 * Creates a pilot mesh group ready to mount in an aircraft cockpit.
 * Synchronously builds the full procedural pilot hierarchy, and swaps
 * to the cloned GLTF asset once loaded.
 */
export function createPilotMesh(variant = 'f16') {
  const group = new THREE.Group();
  group.name = `Pilot_${variant.toUpperCase()}`;

  // 1. Build synchronous procedural hierarchy immediately
  const { root, seat, body, head } = buildF16PilotScene();
  group.add(root);
  group.userData.head = head;
  group.userData.body = body;
  group.userData.seat = seat;
  group.userData.activeScene = root;

  // 2. Load authored GLB model asynchronously if available
  if (typeof window !== 'undefined') {
    group.ready = loadPilotModel(variant).then(template => {
      if (!template) return;
      // Replace procedural root with cloned authored GLB scene
      group.remove(root);
      const clone = template.clone(true);
      clone.name = 'F16_Pilot_GLB';
      group.add(clone);
      group.userData.activeScene = clone;
      group.userData.head = clone.getObjectByName('Pilot_Head');
      group.userData.body = clone.getObjectByName('Pilot_Body');
      group.userData.seat = clone.getObjectByName('Pilot_Seat');
      if (group.userData.isCockpit !== undefined) {
        setPilotCockpitMode(group, group.userData.isCockpit, group.userData.showInterior, group.userData.cockpitOptions);
      }
      group.userData.onSwap?.();
    }).catch(() => {
      // Procedural fallback remains active
    });
  } else {
    group.ready = Promise.resolve();
  }

  return group;
}

/**
 * Toggles visibility for first-person cockpit view vs external camera views.
 * In cockpit view: hides the head/visor so the eye position has an unobstructed view,
 * but keeps the body (torso, arms on HOTAS, G-suit legs) visible when looking down.
 * In external views: full pilot with helmet, visor, and mask is visible through the canopy.
 */
export function setPilotCockpitMode(pilotGroup, isCockpit, showInterior = true, options = {}) {
  if (!pilotGroup || !pilotGroup.userData) return;
  pilotGroup.userData.isCockpit = isCockpit;
  pilotGroup.userData.showInterior = showInterior;
  pilotGroup.userData.cockpitOptions = options;

  const head = pilotGroup.userData.head;
  const body = pilotGroup.userData.body;
  const seat = pilotGroup.userData.seat;

  if (isCockpit) {
    if (head) head.visible = Boolean(options.showHead);
    if (body) body.visible = showInterior;
    if (seat) seat.visible = showInterior;
  } else {
    if (head) head.visible = true;
    if (body) body.visible = true;
    if (seat) seat.visible = true;
  }
}

/**
 * Dynamic pilot physiology updates (G-force head lag & roll bank head tilt).
 * Advances using dt and freezes when simulation or replay playback is paused (dt <= 0).
 */
export function updatePilotDynamics(pilotGroup, state = {}, dt = 0.016) {
  if (!pilotGroup || !pilotGroup.userData) return;
  if (!dt || dt <= 0) return;
  const head = pilotGroup.userData.head;
  if (!head || !head.visible) return;

  const gZ = state.gForce ?? 1.0;
  const rollRate = state.rollRate ?? 0.0;

  // High-G head compression / downward pitch under positive G load
  const targetPitch = -THREE.MathUtils.clamp((gZ - 1.0) * 0.018, -0.04, 0.12);
  const pitchDecay = 1 - Math.exp(-12.0 * dt);
  head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, targetPitch, pitchDecay);

  // Turn coordination head roll into the turn
  const targetRoll = -THREE.MathUtils.clamp(rollRate * 0.04, -0.12, 0.12);
  const rollDecay = 1 - Math.exp(-9.0 * dt);
  head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, targetRoll, rollDecay);
}
