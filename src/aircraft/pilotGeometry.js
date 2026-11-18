/**
 * @file pilotGeometry.js
 * @description Procedural geometry, PBR materials, and model loading for military flight pilots.
 * Features an authentic ACES II ejection seat (30° reclined), CWU-27/P flight suit,
 * PCU-15/P restraint harness, articulated HOTAS arms, CSU-13B/P anti-G suit,
 * and an articulated Pilot_Head (HGU-55/P helmet, dark mirror visor, MBU-12/P oxygen mask).
 */

import * as THREE from 'three';
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
  y: 0.276,
  z: -3.630,
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
      color: 0x626960, // Tactical flight grey-green
      roughness: 0.42,
      metalness: 0.15,
    }),
    visor: getMaterial('pilot-visor', {
      color: 0x14181c, // High-gloss dark obsidian mirror
      roughness: 0.08,
      metalness: 0.88,
    }),
    mask: getMaterial('pilot-mask', {
      color: 0x222624, // Tactical silicone rubber
      roughness: 0.65,
      metalness: 0.05,
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
    harness: getMaterial('pilot-harness', {
      color: 0x1c201a, // Dark olive nylon webbing & hardware
      roughness: 0.70,
      metalness: 0.12,
    }),
    buckle: getMaterial('pilot-harness-buckle', {
      color: 0x8a9296, // Anodized aluminum harness buckle
      roughness: 0.35,
      metalness: 0.85,
    }),
    gloves: getMaterial('pilot-gloves', {
      color: 0x2d342c, // Grey leather flight gloves
      roughness: 0.75,
      metalness: 0.05,
    }),
    boots: getMaterial('pilot-boots', {
      color: 0x161819, // Black combat leather boots
      roughness: 0.55,
      metalness: 0.10,
    }),
    seatFrame: getMaterial('pilot-seat-frame', {
      color: 0x2e3338, // ACES II structural chassis
      roughness: 0.55,
      metalness: 0.35,
    }),
    seatCushion: getMaterial('pilot-seat-cushion', {
      color: 0x24282a, // Padded seat and back cushions
      roughness: 0.88,
      metalness: 0.05,
    }),
    ejectionHandle: getMaterial('pilot-ejection-handle', {
      color: 0xd99800, // Safety yellow ejection ring
      roughness: 0.40,
      metalness: 0.10,
    }),
    controls: getMaterial('pilot-cockpit-controls', {
      color: 0x25282a, // HOTAS stick and throttle grips
      roughness: 0.50,
      metalness: 0.25,
    }),
  };
}

/**
 * Builds the ACES II ejection seat geometry:
 * Bucket base, 30° reclined backrest, lateral guide rails, headrest box,
 * twin canopy breaker horns, and center ejection pull loop.
 */
export function buildAcesIISeat(mats) {
  const seatGroup = new THREE.Group();
  seatGroup.name = 'Pilot_Seat';

  // 1. Seat pan / bucket base
  const panGeo = new THREE.BoxGeometry(0.44, 0.12, 0.46);
  const panMesh = new THREE.Mesh(panGeo, mats.seatFrame);
  panMesh.name = 'Pilot_Seat_Pan';
  panMesh.position.set(0, -0.06, -0.15);
  seatGroup.add(panMesh);

  // Seat pan cushion
  const panCushionGeo = new THREE.BoxGeometry(0.40, 0.05, 0.42);
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

  // Main backrest bulkhead
  const backGeo = new THREE.BoxGeometry(0.42, 0.64, 0.08);
  const backMesh = new THREE.Mesh(backGeo, mats.seatFrame);
  backMesh.name = 'Pilot_Seat_BackBulkhead';
  backMesh.position.set(0, 0.32, 0.0);
  backPivot.add(backMesh);

  // Ergonomic back cushion with lumbar support
  const backCushionGeo = new THREE.BoxGeometry(0.36, 0.58, 0.06);
  const backCushion = new THREE.Mesh(backCushionGeo, mats.seatCushion);
  backCushion.name = 'Pilot_Seat_BackCushion';
  backCushion.position.set(0, 0.32, -0.05);
  backPivot.add(backCushion);

  // Lateral armor / seat guide side plates
  for (const side of [-1, 1]) {
    const sidePlateGeo = new THREE.BoxGeometry(0.02, 0.56, 0.18);
    const sidePlate = new THREE.Mesh(sidePlateGeo, mats.seatFrame);
    sidePlate.name = `Pilot_Seat_SidePlate_${side > 0 ? 'R' : 'L'}`;
    sidePlate.position.set(side * 0.22, 0.30, 0.02);
    backPivot.add(sidePlate);
  }

  // 3. Headrest assembly atop backrest
  const headrestGeo = new THREE.BoxGeometry(0.24, 0.22, 0.16);
  const headrest = new THREE.Mesh(headrestGeo, mats.seatCushion);
  headrest.name = 'Pilot_Seat_Headrest';
  headrest.position.set(0, 0.72, -0.02);
  backPivot.add(headrest);

  // Canopy breaker horns (emergency pitots on ACES II headrest corners)
  for (const side of [-1, 1]) {
    const hornGeo = new THREE.ConeGeometry(0.016, 0.08, 8);
    hornGeo.rotateX(Math.PI / 2);
    const horn = new THREE.Mesh(hornGeo, mats.seatFrame);
    horn.name = `Pilot_Seat_BreakerHorn_${side > 0 ? 'R' : 'L'}`;
    horn.position.set(side * 0.10, 0.84, -0.06);
    backPivot.add(horn);
  }

  // 4. Dual guide rails running up behind seat
  for (const side of [-1, 1]) {
    const railGeo = new THREE.BoxGeometry(0.03, 0.90, 0.04);
    const rail = new THREE.Mesh(railGeo, mats.seatFrame);
    rail.name = `Pilot_Seat_Rail_${side > 0 ? 'R' : 'L'}`;
    rail.position.set(side * 0.16, 0.45, 0.08);
    backPivot.add(rail);
  }

  // 5. Center lower ejection handle (between pilot's thighs)
  const loopCurve = new THREE.EllipseCurve(0, 0, 0.06, 0.04, 0, Math.PI, false, 0);
  const loopPoints = loopCurve.getPoints(12).map(p => new THREE.Vector3(p.x, p.y, 0));
  const loopGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loopPoints), 16, 0.009, 8, false);
  const handleMesh = new THREE.Mesh(loopGeo, mats.ejectionHandle);
  handleMesh.name = 'Pilot_Seat_EjectionHandle';
  handleMesh.position.set(0, 0.05, -0.28);
  handleMesh.rotation.x = Math.PI / 4;
  seatGroup.add(handleMesh);

  return seatGroup;
}

/**
 * Builds the Pilot Body (torso, harness, legs, G-suit, boots, HOTAS controls).
 * Stays visible in both exterior view and 1st-person cockpit view (looking down).
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

  // Main chest/abdomen volume
  const chestGeo = new THREE.CylinderGeometry(0.18, 0.15, 0.44, 16);
  chestGeo.scale(1.15, 1.0, 0.75);
  const chestMesh = new THREE.Mesh(chestGeo, mats.suit);
  chestMesh.name = 'Pilot_Body_Chest';
  chestMesh.position.set(0, 0.28, -0.10);
  torsoPivot.add(chestMesh);

  // Shoulders yoke
  const shoulderGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.42, 12);
  shoulderGeo.rotateZ(Math.PI / 2);
  const shoulderMesh = new THREE.Mesh(shoulderGeo, mats.suit);
  shoulderMesh.name = 'Pilot_Body_Shoulders';
  shoulderMesh.position.set(0, 0.46, -0.10);
  torsoPivot.add(shoulderMesh);

  // PCU-15/P Restraint Harness Straps over chest
  for (const side of [-1, 1]) {
    const strapGeo = new THREE.BoxGeometry(0.045, 0.40, 0.02);
    const strap = new THREE.Mesh(strapGeo, mats.harness);
    strap.name = `Pilot_Body_HarnessStrap_${side > 0 ? 'R' : 'L'}`;
    strap.position.set(side * 0.10, 0.28, -0.18);
    strap.rotation.z = -side * 0.08;
    torsoPivot.add(strap);
  }

  // Central harness release rotary buckle
  const buckleGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.025, 16);
  buckleGeo.rotateX(Math.PI / 2);
  const buckle = new THREE.Mesh(buckleGeo, mats.buckle);
  buckle.name = 'Pilot_Body_HarnessBuckle';
  buckle.position.set(0, 0.18, -0.19);
  torsoPivot.add(buckle);

  // 2. Legs & CSU-13B/P Anti-G Trousers
  const pelvisGeo = new THREE.BoxGeometry(0.34, 0.14, 0.26);
  const pelvis = new THREE.Mesh(pelvisGeo, mats.suit);
  pelvis.name = 'Pilot_Body_Pelvis';
  pelvis.position.set(0, 0.05, -0.10);
  bodyGroup.add(pelvis);

  for (const side of [-1, 1]) {
    const sName = side > 0 ? 'R' : 'L';
    const thighX = side * 0.11;

    const thighGeo = new THREE.CylinderGeometry(0.075, 0.065, 0.36, 14);
    thighGeo.rotateX(Math.PI / 2 + 0.12);
    const thigh = new THREE.Mesh(thighGeo, mats.suit);
    thigh.name = `Pilot_Body_Thigh_${sName}`;
    thigh.position.set(thighX, 0.07, -0.28);
    bodyGroup.add(thigh);

    const gPouchGeo = new THREE.BoxGeometry(0.11, 0.025, 0.26);
    const gPouch = new THREE.Mesh(gPouchGeo, mats.harness);
    gPouch.name = `Pilot_Body_GPouch_${sName}`;
    gPouch.position.set(thighX, 0.13, -0.28);
    gPouch.rotation.x = -0.12;
    bodyGroup.add(gPouch);

    const calfGeo = new THREE.CylinderGeometry(0.065, 0.055, 0.36, 12);
    calfGeo.rotateX(Math.PI / 4 + 0.10);
    const calf = new THREE.Mesh(calfGeo, mats.suit);
    calf.name = `Pilot_Body_Calf_${sName}`;
    calf.position.set(thighX, -0.06, -0.52);
    bodyGroup.add(calf);

    const bootGeo = new THREE.BoxGeometry(0.09, 0.09, 0.20);
    const boot = new THREE.Mesh(bootGeo, mats.boots);
    boot.name = `Pilot_Body_Boot_${sName}`;
    boot.position.set(thighX, -0.18, -0.66);
    boot.rotation.x = 0.25;
    bodyGroup.add(boot);
  }

  // 3. Arms & HOTAS Controls
  // Left arm on throttle (console side)
  const leftUpperArmGeo = new THREE.CylinderGeometry(0.055, 0.048, 0.28, 12);
  leftUpperArmGeo.rotateX(0.40);
  leftUpperArmGeo.rotateZ(0.25);
  const leftUpperArm = new THREE.Mesh(leftUpperArmGeo, mats.suit);
  leftUpperArm.name = 'Pilot_Body_ArmUpper_L';
  leftUpperArm.position.set(-0.24, 0.30, -0.06);
  bodyGroup.add(leftUpperArm);

  const leftForearmGeo = new THREE.CylinderGeometry(0.048, 0.042, 0.26, 12);
  leftForearmGeo.rotateX(Math.PI / 2 - 0.20);
  const leftForearm = new THREE.Mesh(leftForearmGeo, mats.suit);
  leftForearm.name = 'Pilot_Body_Forearm_L';
  leftForearm.position.set(-0.23, 0.16, -0.22);
  bodyGroup.add(leftForearm);

  const leftGloveGeo = new THREE.BoxGeometry(0.075, 0.06, 0.10);
  const leftGlove = new THREE.Mesh(leftGloveGeo, mats.gloves);
  leftGlove.name = 'Pilot_Body_Glove_L';
  leftGlove.position.set(-0.23, 0.17, -0.34);
  bodyGroup.add(leftGlove);

  const throttleGripGeo = new THREE.BoxGeometry(0.05, 0.07, 0.09);
  const throttleGrip = new THREE.Mesh(throttleGripGeo, mats.controls);
  throttleGrip.name = 'Pilot_Body_ThrottleGrip';
  throttleGrip.position.set(-0.23, 0.13, -0.34);
  bodyGroup.add(throttleGrip);

  // Right arm on F-16 Sidestick Controller (right console)
  const rightUpperArmGeo = new THREE.CylinderGeometry(0.055, 0.048, 0.28, 12);
  rightUpperArmGeo.rotateX(0.40);
  rightUpperArmGeo.rotateZ(-0.22);
  const rightUpperArm = new THREE.Mesh(rightUpperArmGeo, mats.suit);
  rightUpperArm.name = 'Pilot_Body_ArmUpper_R';
  rightUpperArm.position.set(0.23, 0.30, -0.06);
  bodyGroup.add(rightUpperArm);

  const rightForearmGeo = new THREE.CylinderGeometry(0.048, 0.042, 0.25, 12);
  rightForearmGeo.rotateX(Math.PI / 2 - 0.15);
  const rightForearm = new THREE.Mesh(rightForearmGeo, mats.suit);
  rightForearm.name = 'Pilot_Body_Forearm_R';
  rightForearm.position.set(0.22, 0.16, -0.20);
  bodyGroup.add(rightForearm);

  const rightGloveGeo = new THREE.BoxGeometry(0.07, 0.08, 0.08);
  const rightGlove = new THREE.Mesh(rightGloveGeo, mats.gloves);
  rightGlove.name = 'Pilot_Body_Glove_R';
  rightGlove.position.set(0.22, 0.17, -0.30);
  bodyGroup.add(rightGlove);

  const stickBaseGeo = new THREE.CylinderGeometry(0.022, 0.035, 0.08, 12);
  const stickBase = new THREE.Mesh(stickBaseGeo, mats.controls);
  stickBase.name = 'Pilot_Body_StickBase';
  stickBase.position.set(0.22, 0.09, -0.30);
  bodyGroup.add(stickBase);

  const stickGripGeo = new THREE.CylinderGeometry(0.018, 0.016, 0.10, 10);
  stickGripGeo.rotateX(0.10);
  const stickGrip = new THREE.Mesh(stickGripGeo, mats.controls);
  stickGrip.name = 'Pilot_Body_StickGrip';
  stickGrip.position.set(0.22, 0.17, -0.30);
  bodyGroup.add(stickGrip);

  return bodyGroup;
}

/**
 * Builds the articulated Pilot Head assembly:
 * Neck pivot, HGU-55/P helmet shell, curved dark mirror visor,
 * MBU-12/P oxygen mask, cheek retention bayonets, and corrugated oxygen hose.
 * Mounted in a dedicated Pilot_Head node for first-person occlusion and G-load tilt.
 */
export function buildPilotHead(mats) {
  const headGroup = new THREE.Group();
  headGroup.name = 'Pilot_Head';

  // Head pivot point is located at the base of the skull / neck
  headGroup.position.set(0, 0.48, -0.06);

  // 1. Neck cylinder
  const neckGeo = new THREE.CylinderGeometry(0.065, 0.075, 0.10, 14);
  neckGeo.rotateX(SEAT_RECLINE_RAD * 0.5);
  const neck = new THREE.Mesh(neckGeo, mats.suit);
  neck.name = 'Pilot_Head_Neck';
  neck.position.set(0, 0.04, -0.01);
  headGroup.add(neck);

  // 2. HGU-55/P Helmet Shell
  const helmetCenter = new THREE.Vector3(0, 0.16, -0.01);

  const domeGeo = new THREE.SphereGeometry(0.125, 20, 16);
  domeGeo.scale(0.96, 1.05, 1.04);
  const dome = new THREE.Mesh(domeGeo, mats.helmet);
  dome.name = 'Pilot_Head_HelmetDome';
  dome.position.copy(helmetCenter);
  headGroup.add(dome);

  for (const side of [-1, 1]) {
    const sName = side > 0 ? 'R' : 'L';
    const earGeo = new THREE.CylinderGeometry(0.042, 0.046, 0.022, 14);
    earGeo.rotateZ(Math.PI / 2);
    const ear = new THREE.Mesh(earGeo, mats.helmet);
    ear.name = `Pilot_Head_EarCup_${sName}`;
    ear.position.set(side * 0.118, helmetCenter.y - 0.02, helmetCenter.z);
    headGroup.add(ear);

    const clipGeo = new THREE.BoxGeometry(0.008, 0.016, 0.024);
    const clip = new THREE.Mesh(clipGeo, mats.buckle);
    clip.name = `Pilot_Head_MaskClip_${sName}`;
    clip.position.set(side * 0.126, helmetCenter.y - 0.04, helmetCenter.z - 0.03);
    headGroup.add(clip);
  }

  const napeGeo = new THREE.CylinderGeometry(0.105, 0.115, 0.06, 16, 1, true, 0, Math.PI);
  const nape = new THREE.Mesh(napeGeo, mats.helmet);
  nape.name = 'Pilot_Head_NapeGuard';
  nape.position.set(0, helmetCenter.y - 0.09, helmetCenter.z + 0.02);
  headGroup.add(nape);

  // 3. Tinted Mirror Visor
  const visorGeo = new THREE.SphereGeometry(0.132, 20, 14, Math.PI * 0.22, Math.PI * 0.56, Math.PI * 0.24, Math.PI * 0.38);
  visorGeo.scale(0.98, 1.02, 1.06);
  const visor = new THREE.Mesh(visorGeo, mats.visor);
  visor.name = 'Pilot_Head_Visor';
  visor.position.copy(helmetCenter);
  headGroup.add(visor);

  const browGeo = new THREE.BoxGeometry(0.16, 0.025, 0.04);
  const brow = new THREE.Mesh(browGeo, mats.helmet);
  brow.name = 'Pilot_Head_VisorBrow';
  brow.position.set(0, helmetCenter.y + 0.09, helmetCenter.z - 0.11);
  brow.rotation.x = -0.35;
  headGroup.add(brow);

  // 4. MBU-12/P Oxygen Mask
  const maskGeo = new THREE.ConeGeometry(0.062, 0.11, 14);
  maskGeo.rotateX(-Math.PI / 2 + 0.25);
  maskGeo.scale(0.95, 1.15, 0.85);
  const mask = new THREE.Mesh(maskGeo, mats.mask);
  mask.name = 'Pilot_Head_OxygenMask';
  mask.position.set(0, helmetCenter.y - 0.05, helmetCenter.z - 0.115);
  headGroup.add(mask);

  for (const side of [-1, 1]) {
    const sName = side > 0 ? 'R' : 'L';
    const strapGeo = new THREE.BoxGeometry(0.06, 0.014, 0.006);
    strapGeo.rotateY(side * 0.45);
    const strap = new THREE.Mesh(strapGeo, mats.harness);
    strap.name = `Pilot_Head_MaskStrap_${sName}`;
    strap.position.set(side * 0.085, helmetCenter.y - 0.045, helmetCenter.z - 0.075);
    headGroup.add(strap);
  }

  // 5. Corrugated Flexible Oxygen Hose
  const hosePoints = [
    new THREE.Vector3(0, helmetCenter.y - 0.09, helmetCenter.z - 0.12),
    new THREE.Vector3(-0.02, helmetCenter.y - 0.14, helmetCenter.z - 0.13),
    new THREE.Vector3(-0.04, helmetCenter.y - 0.20, helmetCenter.z - 0.11),
    new THREE.Vector3(-0.05, helmetCenter.y - 0.28, helmetCenter.z - 0.09),
  ];
  const hoseCurve = new THREE.CatmullRomCurve3(hosePoints);
  const hoseGeo = new THREE.TubeGeometry(hoseCurve, 20, 0.016, 10, false);
  const hose = new THREE.Mesh(hoseGeo, mats.hose);
  hose.name = 'Pilot_Head_OxygenHose';
  headGroup.add(hose);

  return headGroup;
}

/**
 * Builds the complete F-16 pilot model hierarchy.
 */
export function buildF16PilotScene() {
  const root = new THREE.Group();
  root.name = 'F16_Pilot_Model';

  const mats = createPilotMaterials();

  const seat = buildAcesIISeat(mats);
  const body = buildPilotBody(mats);
  const head = buildPilotHead(mats);

  root.add(seat);
  root.add(body);
  root.add(head);

  root.userData.head = head;
  root.userData.body = body;
  root.userData.seat = seat;

  return { root, seat, body, head };
}

// Cache for loaded GLTF templates
let pilotTemplate = null;
let pilotLoadingPromise = null;

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
    loadPilotModel(variant).then(template => {
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
    }).catch(() => {
      // Procedural fallback remains active
    });
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
  const head = pilotGroup.userData.head;
  const body = pilotGroup.userData.body;
  const seat = pilotGroup.userData.seat;

  if (isCockpit) {
    if (head) head.visible = options.hideHead ? false : true;
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
 */
export function updatePilotDynamics(pilotGroup, state = {}) {
  if (!pilotGroup || !pilotGroup.userData) return;
  const head = pilotGroup.userData.head;
  if (!head || !head.visible) return;

  const gZ = state.gForce ?? 1.0;
  const rollRate = state.rollRate ?? 0.0;

  // High-G head compression / downward pitch under positive G load
  const targetPitch = -THREE.MathUtils.clamp((gZ - 1.0) * 0.018, -0.04, 0.12);
  head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, targetPitch, 0.2);

  // Turn coordination head roll into the turn
  const targetRoll = -THREE.MathUtils.clamp(rollRate * 0.04, -0.12, 0.12);
  head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, targetRoll, 0.15);
}
