import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyFlatShading } from '../config/renderQuality.js';
import { clampGearExtension, calculateGearFold, isGearCollapsed } from './common/GearKinematicsRig.js';

const deg = THREE.MathUtils.degToRad;

/**
 * concorde.glb (manilov.ap, CC BY 4.0) is authored at 1:1 metres below its
 * Sketchfab root: +X port, +Y aft, +Z up, wingspan 25.60 m, length 61.07 m.
 * The root's arbitrary display rotation is discarded and the remaining frame is
 * mapped to the simulator's aircraft frame (+X starboard, +Y up, -Z nose):
 *   aircraft = (-x, z - CENTRE_Z, y - CENTRE_Y)
 * CENTRE_Y places the reference point near the mid-range centre of gravity,
 * 29.8 m aft of the nose tip; CENTRE_Z sits on the fuselage centreline.
 */
export const CONCORDE_MODEL_CENTRE = Object.freeze({ y: -3.0, z: 2.5 });
export const CONCORDE_MODEL_MATRIX = new THREE.Matrix4().set(
  -1, 0, 0, 0,
  0, 0, 1, -CONCORDE_MODEL_CENTRE.z,
  0, 1, 0, -CONCORDE_MODEL_CENTRE.y,
  0, 0, 0, 1
);

/**
 * The fuselage is one mesh. Its last regular 56-vertex frame ahead of the
 * windscreen lies at model Y = -27.6347; everything ahead of it droops about a
 * lateral hinge on the lower skin of that frame (model Z = 1.369). The frame
 * itself stays fixed, so only the bay just ahead of it stretches.
 */
export const CONCORDE_NOSE_HINGE = Object.freeze({ z: -27.6347 - CONCORDE_MODEL_CENTRE.y, y: 1.369 - CONCORDE_MODEL_CENTRE.z });
export const CONCORDE_FUSELAGE_MESH = 'S01-FACES';

/** Real nose positions: 0° supersonic/cruise, 5° taxi and take-off, 12.5° landing. */
export const CONCORDE_NOSE_POSITIONS_DEG = Object.freeze({ up: 0, takeoff: 5, landing: 12.5 });
export const CONCORDE_NOSE_RATE_DEG_PER_SEC = 3.5;

/**
 * Procedural gear layout in aircraft metres. Wheelbase 18.2 m and main track
 * 7.72 m follow published Concorde dimensions; tyres are 31x10.5 (nose) and
 * 47x15.75 (main). Ground sits 5.40 m below the reference point, matching the
 * model's 12.2 m static fin height.
 */
export const CONCORDE_GEAR_LAYOUT = Object.freeze({
  groundY: -5.40,
  nose: Object.freeze({ id: 'nose', x: 0, z: -15.5, mountY: -1.55, wheelRadius: 0.40, wheelWidth: 0.27, wheelSpacing: 0.36 }),
  main: Object.freeze({ x: 3.86, z: 2.7, mountY: -1.55, wheelRadius: 0.60, wheelWidth: 0.40, axleSpacing: 1.65, wheelSpacing: 0.86 })
});

/**
 * Select the commanded nose position. An explicit `noseDroopDeg` wins; otherwise
 * the nose follows the gear the way crews flew it: up with the gear retracted,
 * 5° on the ground and 12.5° when airborne with the gear down.
 */
export function concordeNoseDroopTarget(state = {}) {
  if (Number.isFinite(state.noseDroopDeg)) {
    return THREE.MathUtils.clamp(state.noseDroopDeg, 0, CONCORDE_NOSE_POSITIONS_DEG.landing);
  }
  const gear = Number.isFinite(state.gearState) ? state.gearState : 1;
  if (gear < 0.5) return CONCORDE_NOSE_POSITIONS_DEG.up;
  return state.onGround ? CONCORDE_NOSE_POSITIONS_DEG.takeoff : CONCORDE_NOSE_POSITIONS_DEG.landing;
}

/** Move `current` toward `target` at `rate` degrees per second. */
export function stepNoseDroop(current, target, dt, rate = CONCORDE_NOSE_RATE_DEG_PER_SEC) {
  if (!(dt > 0)) return current;
  const step = rate * dt;
  return Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step;
}

/**
 * Capture the rest pose of the vertices ahead of the hinge so droop can be
 * re-applied from an exact baseline at any angle without accumulating error.
 */
export function prepareNoseDroop(geometry, hinge = CONCORDE_NOSE_HINGE) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const indices = [];
  for (let i = 0; i < position.count; i++) {
    if (position.getZ(i) < hinge.z - 1e-3) indices.push(i);
  }
  return {
    hinge,
    indices: Uint32Array.from(indices),
    positions: Float32Array.from(indices.flatMap(i => [position.getX(i), position.getY(i), position.getZ(i)])),
    normals: normal ? Float32Array.from(indices.flatMap(i => [normal.getX(i), normal.getY(i), normal.getZ(i)])) : null,
    angleDeg: 0
  };
}

/** Rotate the prepared nose vertices about the lateral hinge; positive is nose down. */
export function applyNoseDroop(geometry, rig, angleDeg) {
  if (!rig || rig.angleDeg === angleDeg) return false;
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  // Nose-down about +X: the forward (-Z) tip moves to -Y.
  const angle = -deg(angleDeg);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const { y: hy, z: hz } = rig.hinge;
  for (let k = 0; k < rig.indices.length; k++) {
    const i = rig.indices[k], o = k * 3;
    const y = rig.positions[o + 1] - hy, z = rig.positions[o + 2] - hz;
    position.setXYZ(i, rig.positions[o], hy + y * cos - z * sin, hz + y * sin + z * cos);
    if (normal && rig.normals) {
      const ny = rig.normals[o + 1], nz = rig.normals[o + 2];
      normal.setXYZ(i, rig.normals[o], ny * cos - nz * sin, ny * sin + nz * cos);
    }
  }
  position.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  geometry.computeBoundingSphere();
  rig.angleDeg = angleDeg;
  return true;
}

function gearMaterials() {
  return {
    strut: new THREE.MeshStandardMaterial({ name: 'Concorde-gear-strut', color: 0x9aa3ad, metalness: 0.75, roughness: 0.32 }),
    piston: new THREE.MeshStandardMaterial({ name: 'Concorde-gear-piston', color: 0xf4f6f8, metalness: 0.95, roughness: 0.1 }),
    tire: new THREE.MeshStandardMaterial({ name: 'Concorde-gear-tire', color: 0x1a1c20, roughness: 0.9, metalness: 0.05 }),
    rim: new THREE.MeshStandardMaterial({ name: 'Concorde-gear-rim', color: 0xd7dde4, metalness: 0.7, roughness: 0.3 })
  };
}

function makeWheel(radius, width, materials) {
  const wheel = new THREE.Group();
  const tireGeometry = new THREE.CylinderGeometry(radius, radius, width, 20);
  tireGeometry.rotateZ(Math.PI / 2);
  const rimGeometry = new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, width + 0.02, 16);
  rimGeometry.rotateZ(Math.PI / 2);
  wheel.add(new THREE.Mesh(tireGeometry, materials.tire), new THREE.Mesh(rimGeometry, materials.rim));
  return wheel;
}

function makeTube(radius, from, to, material) {
  const direction = new THREE.Vector3().subVectors(to, from);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 12), material);
  tube.position.copy(from).addScaledVector(direction, 0.5);
  tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return tube;
}

/**
 * Build the nose leg (twin wheels, retracts forward) and two main legs with
 * four-wheel bogies (retract inboard). Each leg is a pivot group at its mount;
 * `truck` carries the oleo piston and wheels for suspension travel.
 */
export function buildConcordeGear(layout = CONCORDE_GEAR_LAYOUT) {
  const materials = gearMaterials();
  const group = new THREE.Group();
  group.name = 'Concorde_LandingGear';
  const legs = {};

  const nose = layout.nose;
  const noseHubY = layout.groundY + nose.wheelRadius - nose.mountY;
  const noseRoot = new THREE.Group();
  noseRoot.name = 'Concorde_Gear_nose';
  noseRoot.position.set(nose.x, nose.mountY, nose.z);
  noseRoot.add(makeTube(0.13, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, noseHubY * 0.55, 0), materials.strut));
  const noseTruck = new THREE.Group();
  noseTruck.add(makeTube(0.085, new THREE.Vector3(0, noseHubY * 0.5, 0), new THREE.Vector3(0, noseHubY, 0), materials.piston));
  for (const side of [-1, 1]) {
    const wheel = makeWheel(nose.wheelRadius, nose.wheelWidth, materials);
    wheel.position.set(side * nose.wheelSpacing, noseHubY, 0);
    noseTruck.add(wheel);
  }
  noseTruck.add(makeTube(0.05, new THREE.Vector3(-nose.wheelSpacing, noseHubY, 0), new THREE.Vector3(nose.wheelSpacing, noseHubY, 0), materials.strut));
  noseRoot.add(noseTruck);
  noseRoot.userData = { id: 'nose', truck: noseTruck };
  legs.nose = noseRoot;

  const main = layout.main;
  const mainHubY = layout.groundY + main.wheelRadius - main.mountY;
  for (const [id, side] of [['mainLeft', -1], ['mainRight', 1]]) {
    const root = new THREE.Group();
    root.name = `Concorde_Gear_${id}`;
    root.position.set(side * main.x, main.mountY, main.z);
    root.add(makeTube(0.19, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, mainHubY * 0.6, 0), materials.strut));
    const truck = new THREE.Group();
    truck.add(makeTube(0.13, new THREE.Vector3(0, mainHubY * 0.55, 0), new THREE.Vector3(0, mainHubY, 0), materials.piston));
    const halfBase = main.axleSpacing / 2;
    truck.add(makeTube(0.1, new THREE.Vector3(0, mainHubY, -halfBase), new THREE.Vector3(0, mainHubY, halfBase), materials.strut));
    for (const z of [-halfBase, halfBase]) {
      truck.add(makeTube(0.07, new THREE.Vector3(-main.wheelSpacing / 2, mainHubY, z), new THREE.Vector3(main.wheelSpacing / 2, mainHubY, z), materials.strut));
      for (const x of [-1, 1]) {
        const wheel = makeWheel(main.wheelRadius, main.wheelWidth, materials);
        wheel.position.set(x * main.wheelSpacing / 2, mainHubY, z);
        truck.add(wheel);
      }
    }
    root.add(truck);
    root.userData = { id, side, truck };
    legs[id] = root;
  }

  group.add(legs.nose, legs.mainLeft, legs.mainRight);
  group.traverse(node => { if (node.isMesh) node.castShadow = node.receiveShadow = true; });
  return { group, legs, materials };
}

/** Pose the gear: fold by extension, travel trucks by suspension compression. */
export function poseConcordeGear(legs, extension, state = {}) {
  const fold = calculateGearFold(extension);
  for (const leg of Object.values(legs)) {
    const { id, side, truck } = leg.userData;
    if (id === 'nose') leg.rotation.x = fold;          // swings forward into the nose bay
    else leg.rotation.z = -side * fold;                // swings inboard under the belly
    truck.position.y = extension > 0.999 ? Math.max(0, state.compressions?.[id] ?? 0) : 0;
    leg.visible = extension > 0.001 && !isGearCollapsed(state.gearDamage, id);
  }
}

export class Concorde {
  constructor(options = {}) {
    this.options = options;
    this.group = new THREE.Group();
    this.group.name = 'Aircraft_Concorde';
    this.gltfGroup = new THREE.Group();
    this.gltfGroup.name = 'GLTF_Concorde';
    this.group.add(this.gltfGroup);
    this.lightsGroup = new THREE.Group();
    this.gltfGroup.add(this.lightsGroup);
    this.lightsOn = true;
    this.useGltf = false;
    this.loadingGltf = true;
    this.modelLoaded = false;
    this.isCrashed = false;
    this.flatShading = false;
    this.gearExtension = 1;
    this.noseDroopDeg = CONCORDE_NOSE_POSITIONS_DEG.takeoff;
    this.noseRig = null;
    this.fuselage = null;

    const gear = buildConcordeGear();
    this.gearGroup = gear.group;
    this.gearLegs = gear.legs;
    this.gltfGroup.add(this.gearGroup);

    // No flight-deck interior ships with this asset; the cockpit view sits in the airframe.
    this.cockpit = {
      group: new THREE.Group(), gltfCockpitGroup: new THREE.Group(),
      cockpitModelFailed: false, cockpitModelLoading: true,
      yokesVisible: true, gltfYokes: [], syncLighting() {},
      toggleYokes() { return this.yokesVisible; }
    };
    this.gltfGroup.add(this.cockpit.group);

    const url = options.modelUrl ?? `${import.meta.env?.BASE_URL ?? '/'}models/concorde.glb`;
    this.ready = new GLTFLoader().loadAsync(url)
      .then(gltf => {
        this.installModel(gltf.scene);
        if (this.flatShading) applyFlatShading(this.group, true);
      })
      .catch(error => {
        this.cockpit.cockpitModelFailed = true;
        console.error('Concorde model failed to load:', error);
      })
      .finally(() => {
        this.loadingGltf = false;
        this.cockpit.cockpitModelLoading = false;
      });
  }

  /** Bake every authored mesh into the aircraft frame, discarding the Sketchfab display root. */
  installModel(scene) {
    const displayRoot = scene.children[0];
    if (displayRoot) {
      displayRoot.position.set(0, 0, 0);
      displayRoot.quaternion.identity();
      displayRoot.scale.setScalar(1);
    }
    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse(node => { if (node.isMesh) meshes.push(node); });
    const toAircraft = new THREE.Matrix4();
    for (const source of meshes) {
      toAircraft.multiplyMatrices(CONCORDE_MODEL_MATRIX, source.matrixWorld);
      const geometry = source.geometry.clone().applyMatrix4(toAircraft);
      const mesh = new THREE.Mesh(geometry, source.material.clone());
      // GLTFLoader de-duplicates the authored node names with a numeric suffix.
      mesh.name = source.name.replace(/_\d+$/, '');
      mesh.castShadow = mesh.receiveShadow = true;
      this.gltfGroup.add(mesh);
      if (mesh.name === CONCORDE_FUSELAGE_MESH) {
        this.fuselage = mesh;
        this.noseRig = prepareNoseDroop(geometry);
      }
    }
    this.modelLoaded = this.useGltf = true;
    this.cockpit.onModelReady?.();
    applyNoseDroop(this.fuselage?.geometry, this.noseRig, this.noseDroopDeg);
  }

  update(dt, state = {}) {
    const extension = clampGearExtension(state.gearState, this.gearExtension);
    this.gearExtension = extension;
    poseConcordeGear(this.gearLegs, extension, state);
    const target = concordeNoseDroopTarget(state);
    this.noseDroopDeg = dt > 0 ? stepNoseDroop(this.noseDroopDeg, target, dt) : target;
    if (this.fuselage) applyNoseDroop(this.fuselage.geometry, this.noseRig, this.noseDroopDeg);
  }

  setCockpitMode(isCockpit, showInterior = true) {
    this.isCockpit = isCockpit;
    this.cockpit.group.visible = isCockpit ? showInterior : true;
  }

  triggerCrashVisuals() {
    this.isCrashed = true;
    this.lightsGroup.visible = false;
  }

  resetCrashVisuals() {
    this.isCrashed = false;
    this.lightsGroup.visible = this.lightsOn;
  }

  setFlatShading(flatShading) {
    this.flatShading = Boolean(flatShading);
    applyFlatShading(this.group, this.flatShading);
  }
}
