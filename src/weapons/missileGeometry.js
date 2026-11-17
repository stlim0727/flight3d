import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { missileSpec } from './missileSpecs.js';

const sharedMaterials = new Map();

function material(key, options) {
  let value = sharedMaterials.get(key);
  if (!value) {
    value = new THREE.MeshStandardMaterial(options);
    sharedMaterials.set(key, value);
  }
  return value;
}

const bodyMaterial = () => material('missile-body', { color: 0xd9d9d2, roughness: 0.46, metalness: 0.28 });
const finMaterial = () => material('missile-fin', { color: 0xa9ada8, roughness: 0.55, metalness: 0.35 });
const domeMaterial = () => material('missile-dome', { color: 0x20262a, roughness: 0.18, metalness: 0.55 });
const radomeMaterial = () => material('missile-radome', { color: 0xecece5, roughness: 0.62, metalness: 0.05 });
const bandMaterial = () => material('missile-band', { color: 0x8d5b2b, roughness: 0.7, metalness: 0.1 });

// Caches for high-detail GLB models
const gltfTemplates = new Map();
const gltfLoadingPromises = new Map();

export function getMissileModelUrl(type) {
  const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  const filename = type === 'AIM120C' ? 'aim-120c.glb' : 'aim-9x.glb';
  return `${baseUrl}models/missiles/${filename}`;
}

export async function loadMissileModel(type) {
  if (gltfTemplates.has(type)) {
    return gltfTemplates.get(type);
  }
  if (gltfLoadingPromises.has(type)) {
    return gltfLoadingPromises.get(type);
  }
  const promise = (async () => {
    try {
      const url = getMissileModelUrl(type);
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      const scene = gltf.scene || gltf.scenes?.[0];
      if (scene) {
        gltfTemplates.set(type, scene);
        return scene;
      }
    } catch {
      // In non-browser / test environments, fallback to procedural mesh
    }
    return null;
  })();
  gltfLoadingPromises.set(type, promise);
  return promise;
}

export function preloadMissileModels() {
  return Promise.all(['AIM9X', 'AIM120C'].map(loadMissileModel));
}

/** Four radial fins around the Z axis, nose toward -Z. */
function addFinRing(group, { z, chord, span, thickness, radius, phase = Math.PI / 4 }, outList = null) {
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(thickness, span, chord), finMaterial());
    fin.position.set(0, radius + span / 2, 0);
    fin.rotation.z = phase;
    const pivot = new THREE.Group();
    pivot.rotation.z = phase + i * Math.PI / 2;
    pivot.position.z = z;
    pivot.add(fin);
    fin.castShadow = true;
    group.add(pivot);
    if (outList) outList.push(pivot);
  }
}

/**
 * Build one rail missile in the aircraft frame. The origin is the station
 * attach point, the nose points down -Z and the group is cheap enough to keep
 * six copies resident on the airframe.
 */
export function createMissileMesh(type) {
  const spec = missileSpec(type);
  if (!spec) throw new Error(`Unknown missile type: ${type}`);
  const group = new THREE.Group();
  group.name = `Missile_${type}`;
  group.userData.missileType = type;

  const length = spec.lengthM;
  const radius = spec.diameterM / 2;
  const noseLength = length * (type === 'AIM9X' ? 0.16 : 0.2);
  const bodyLength = length - noseLength;
  const isSidewinder = type === 'AIM9X';

  const proceduralMeshes = [];

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, bodyLength, 18, 1, false),
    isSidewinder ? bodyMaterial() : radomeMaterial(),
  );
  body.rotation.x = Math.PI / 2;
  body.position.z = noseLength / 2;
  body.castShadow = true;
  group.add(body);
  proceduralMeshes.push(body);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(radius, noseLength, 18, 1, false),
    isSidewinder ? domeMaterial() : radomeMaterial(),
  );
  // ConeGeometry's apex is +Y; the missile nose points forward (-Z).
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -length / 2 + noseLength / 2;
  nose.castShadow = true;
  group.add(nose);
  proceduralMeshes.push(nose);

  if (isSidewinder) {
    const seekerBand = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.015, radius * 1.015, 0.12, 18, 1, true),
      bandMaterial(),
    );
    seekerBand.rotation.x = Math.PI / 2;
    seekerBand.position.z = -length / 2 + noseLength + 0.05;
    group.add(seekerBand);
    proceduralMeshes.push(seekerBand);
    addFinRing(group, { z: -length / 2 + noseLength + 0.34, chord: 0.2, span: 0.1, thickness: 0.008, radius }, proceduralMeshes);
    addFinRing(group, { z: length / 2 - 0.26, chord: 0.24, span: 0.13, thickness: 0.008, radius }, proceduralMeshes);
  } else {
    addFinRing(group, { z: -0.08, chord: 0.42, span: 0.17, thickness: 0.01, radius, phase: 0 }, proceduralMeshes);
    addFinRing(group, { z: length / 2 - 0.3, chord: 0.34, span: 0.2, thickness: 0.01, radius, phase: 0 }, proceduralMeshes);
  }

  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.9, radius * 0.78, 0.1, 16, 1, true),
    finMaterial(),
  );
  tail.rotation.x = Math.PI / 2;
  tail.position.z = length / 2 - 0.02;
  group.add(tail);
  proceduralMeshes.push(tail);

  const attachGltf = (template) => {
    if (!template || group.userData.gltfAttached) return;
    const gltfInstance = template.clone(true);
    gltfInstance.name = `GLTF_${type}`;
    gltfInstance.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    group.add(gltfInstance);
    group.userData.gltfAttached = true;
    group.userData.gltfInstance = gltfInstance;
    for (const mesh of proceduralMeshes) {
      mesh.visible = false;
    }
  };

  if (gltfTemplates.has(type)) {
    attachGltf(gltfTemplates.get(type));
  } else if (typeof window !== 'undefined') {
    loadMissileModel(type).then(template => {
      if (template) attachGltf(template);
    });
  }

  return group;
}

/**
 * Build one missile pylon / launcher rail in the aircraft frame.
 * Origin (0,0,0) is at the station attach point.
 * The pylon stays attached to the aircraft when the missile is launched,
 * leaving an empty launcher rail with visible guide channel, detent latches,
 * and sway brace pads.
 */
export function createPylonMesh(station) {
  const group = new THREE.Group();
  group.name = `Pylon_${station.id}`;
  group.userData.stationId = station.id;
  group.userData.stationType = station.type;

  const isWingtip = station.id === 'STA 1' || station.id === 'STA 9';
  const isPort = station.position[0] < 0;
  const isAim120 = station.type === 'AIM120C';
  const missileRadius = isAim120 ? 0.089 : 0.0635;

  const pylonMat = () => material('pylon-body', { color: 0x9fa4a5, roughness: 0.52, metalness: 0.22 });
  const railMat = () => material('pylon-rail', { color: 0x3d4348, roughness: 0.45, metalness: 0.65 });
  const steelMat = () => material('pylon-steel', { color: 0x6e767c, roughness: 0.32, metalness: 0.78 });
  const darkMat = () => material('pylon-dark', { color: 0x1d2124, roughness: 0.65, metalness: 0.45 });

  const railLength = isAim120 ? 3.2 : 2.8;
  const railHeight = 0.075;
  const railWidth = 0.075;
  const railY = missileRadius + railHeight / 2;

  if (isWingtip) {
    // LAU-129 Wingtip Launcher Rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(railWidth, railHeight, railLength), railMat());
    rail.position.set(0, railY, 0);
    rail.castShadow = true;
    group.add(rail);

    // Aerodynamic nose wedge at -Z
    const nose = new THREE.Mesh(new THREE.ConeGeometry(railWidth * 0.7, 0.22, 4), pylonMat());
    nose.rotation.x = -Math.PI / 2;
    nose.rotation.z = Math.PI / 4;
    nose.position.set(0, railY, -railLength / 2 - 0.11);
    nose.castShadow = true;
    group.add(nose);

    // Empty bottom guide slot / track (recessed dark channel)
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.015, railLength * 0.88), darkMat());
    slot.position.set(0, missileRadius + 0.007, 0);
    group.add(slot);

    // Detent latches (forward and aft)
    for (const zOffset of [-0.65, 0.65]) {
      const detent = new THREE.Mesh(new THREE.BoxGeometry(railWidth * 0.92, 0.018, 0.065), steelMat());
      detent.position.set(0, missileRadius + 0.009, zOffset);
      group.add(detent);
    }

    // Aft cable bumper
    const aft = new THREE.Mesh(new THREE.BoxGeometry(railWidth * 0.85, railHeight * 0.85, 0.14), steelMat());
    aft.position.set(0, railY, railLength / 2 + 0.07);
    group.add(aft);

    // Wingtip adapter mounting flange
    const bracketX = isPort ? railWidth * 0.45 : -railWidth * 0.45;
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.035, railHeight * 1.1, railLength * 0.45), pylonMat());
    bracket.position.set(bracketX, railY, 0.1);
    group.add(bracket);
  } else {
    // Underwing Pylon & Launcher Rail (STA 2/8, STA 3/7)
    // 1. LAU-129 Launcher Rail at bottom
    const rail = new THREE.Mesh(new THREE.BoxGeometry(railWidth, railHeight, railLength), railMat());
    rail.position.set(0, railY, 0);
    rail.castShadow = true;
    group.add(rail);

    // Aerodynamic nose fairing (-Z)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(railWidth * 0.7, 0.20, 4), pylonMat());
    nose.rotation.x = -Math.PI / 2;
    nose.rotation.z = Math.PI / 4;
    nose.position.set(0, railY, -railLength / 2 - 0.10);
    nose.castShadow = true;
    group.add(nose);

    // Empty bottom guide slot / track
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.015, railLength * 0.88), darkMat());
    slot.position.set(0, missileRadius + 0.007, 0);
    group.add(slot);

    // Empty launch shoes / detents
    for (const zOffset of [-0.7, 0.7]) {
      const detent = new THREE.Mesh(new THREE.BoxGeometry(railWidth * 0.95, 0.02, 0.075), steelMat());
      detent.position.set(0, missileRadius + 0.01, zOffset);
      group.add(detent);
    }

    // Sway brace stabilizer arms (flanking the rail)
    for (const zOffset of [-0.55, 0.55]) {
      for (const side of [-1, 1]) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.045, 0.035), steelMat());
        pad.position.set(side * (railWidth / 2 + 0.01), railY, zOffset);
        group.add(pad);
      }
    }

    // 2. Underwing Pylon Strut (connecting rail to lower wing surface)
    const strutHeight = isAim120 ? 0.44 : 0.42;
    const strutChord = isAim120 ? 1.45 : 1.15;
    const strutThickness = isAim120 ? 0.085 : 0.075;
    const strutCenterY = railY + railHeight / 2 + strutHeight / 2;

    const strut = new THREE.Mesh(new THREE.BoxGeometry(strutThickness, strutHeight, strutChord), pylonMat());
    strut.position.set(0, strutCenterY, 0.05);
    strut.castShadow = true;
    group.add(strut);

    // Wing mounting upper flange
    const flange = new THREE.Mesh(new THREE.BoxGeometry(strutThickness * 1.5, 0.02, strutChord * 1.15), steelMat());
    flange.position.set(0, railY + railHeight / 2 + strutHeight, 0);
    group.add(flange);

    // Aft fairing
    const aft = new THREE.Mesh(new THREE.BoxGeometry(railWidth * 0.85, railHeight * 0.85, 0.15), steelMat());
    aft.position.set(0, railY, railLength / 2 + 0.075);
    group.add(aft);
  }

  return group;
}

/**
 * Aggressor liveries are keyed by callsign so the two patrol slots, the canyon
 * chase and recorded callbacks keep the same paint across respawns and replays.
 * Slots 1/2 are deliberately separated in hue; the canyon aircraft borrows the
 * lizard scheme and an orange flash.
 */
const BANDIT_LIVERIES = Object.freeze([
  { key: 'desert', body: 0xd9c49b, trim: 0x6b3a24, number: '1' },
  { key: 'blue', body: 0x93a8bc, trim: 0xe8eef5, number: '2' },
  { key: 'lizard', body: 0x7e876b, trim: 0xd07b32, number: 'C' },
]);

function banditLivery(callsign) {
  const text = String(callsign).toUpperCase();
  if (text.includes('CANYON')) return BANDIT_LIVERIES[2];
  const slot = text.match(/BANDIT\s*([1-9]\d*)/);
  if (slot) return BANDIT_LIVERIES[(Number(slot[1]) - 1) % BANDIT_LIVERIES.length];
  // Prepare/arena callers can invent callsigns; hash them into a stable scheme.
  let hash = 0;
  for (const character of text) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return BANDIT_LIVERIES[hash % BANDIT_LIVERIES.length];
}

/** Callsign palette and proportions, shared by the procedural proxy and the loaded airframe. */
export function banditSkin(callsign = 'BANDIT') {
  const livery = banditLivery(callsign);
  const scale = callsign.includes('HEAVY') ? [1.18, 1.08, 1.3]
    : callsign.includes('B-1') ? [0.86, 1.04, 1.12] : [1, 1, 1];
  return { ...livery, scale };
}

/** Cheap delta-wing target drone used for the two airborne bandits. */
export function createBanditMesh(callsign = 'BANDIT') {
  const group = new THREE.Group();
  group.name = `Bandit_${callsign}`;
  // Materials are cached by key, so every key carries its color: recoloring one
  // callsign must never repaint the bandits that share the default scheme.
  const { body, trim } = banditSkin(callsign);
  const dark = material(`bandit-body-${body.toString(16)}`,
    { color: body, roughness: 0.62, metalness: 0.3 });
  const trimMaterial = material(`bandit-trim-${trim.toString(16)}`,
    { color: trim, roughness: 0.5, metalness: 0.2 });

  const heavy = callsign.includes('HEAVY'), bomber = callsign.includes('B-1');
  const fighter = callsign.includes('F-') || callsign.includes('Fighter');
  const length = heavy ? 8.8 : bomber ? 8.2 : fighter ? 8.0 : 7.6;
  const radius = heavy ? 0.54 : bomber ? 0.3 : fighter ? 0.35 : 0.45;
  const fuselage = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, heavy ? 0.34 : bomber ? 0.15 : fighter ? 0.2 : 0.28,
      length, heavy ? 16 : 10), dark);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.castShadow = true;
  group.add(fuselage);

  // Every airframe keeps its pointed nose; variants only change its size with the fuselage.
  const noseLength = heavy ? 2.2 : 1.8;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(radius, noseLength, heavy ? 16 : 10), dark);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -length / 2 - noseLength / 2;
  nose.castShadow = true;
  group.add(nose);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(bomber ? 9.6 : 8.4, 0.12, bomber ? 2.6 : 2.1), dark);
  wing.position.set(0, -0.05, 0.55);
  wing.rotation.z = 0.04;
  wing.castShadow = true;
  group.add(wing);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.75), dark);
  tail.position.set(0, 0.18, 3.35);
  tail.castShadow = true;
  group.add(tail);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 1.2), dark);
  fin.position.set(0, 0.78, 3.2);
  fin.castShadow = true;
  group.add(fin);

  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.13, 1.1), trimMaterial);
    tip.position.set(side * 4.1, -0.04, 0.55);
    group.add(tip);
  }

  return group;
}
