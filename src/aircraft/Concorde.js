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
 * concorde-interior.glb (Henry Chi, CC BY 4.0) is a SketchUp export in
 * arbitrary units with a cabin and flight deck. Below the Sketchfab Z-up root
 * it runs +X aft, +Y up, +Z port. It is scaled to the real 61.66 m length (its
 * span then reads 28.7 m, 12% wide: the source proportions are approximate) and
 * placed with the same nose tip (-29.80 m), symmetry plane and 12.2 m static
 * fin height as the exterior profile so gear and physics layouts are shared.
 */
export const CONCORDE_INTERIOR_SCALE = 61.66 / 855.54;
export const CONCORDE_INTERIOR_MATRIX = new THREE.Matrix4().makeTranslation(2.58, -1.76, -9.99)
  .multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2))
  .multiply(new THREE.Matrix4().makeScale(CONCORDE_INTERIOR_SCALE, CONCORDE_INTERIOR_SCALE, CONCORDE_INTERIOR_SCALE));

const box = (min, max) => Object.freeze(new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)));

/** Per-asset mounting, droop hinge, gear and cockpit data. Both share the procedural gear positions. */
export const CONCORDE_PROFILES = Object.freeze({
  exterior: Object.freeze({
    id: 'exterior',
    file: 'models/concorde.glb',
    matrix: CONCORDE_MODEL_MATRIX,
    discardDisplayRoot: true,
    hinge: CONCORDE_NOSE_HINGE,
    droopMeshes: Object.freeze([CONCORDE_FUSELAGE_MESH]),
    gearLayout: CONCORDE_GEAR_LAYOUT,
    gearStripVolumes: Object.freeze([]),
    glassMaterials: Object.freeze([]),
    cockpitEye: null
  }),
  interior: Object.freeze({
    id: 'interior',
    file: 'models/concorde-interior.glb',
    matrix: CONCORDE_INTERIOR_MATRIX,
    discardDisplayRoot: false,
    // Last fuselage frame ahead of the windscreen (source X -13.84 after scaling).
    hinge: Object.freeze({ z: -23.83, y: -1.41 }),
    droopMeshes: 'all',
    gearLayout: Object.freeze({
      ...CONCORDE_GEAR_LAYOUT,
      nose: Object.freeze({ ...CONCORDE_GEAR_LAYOUT.nose, mountY: -1.5 }),
      main: Object.freeze({ ...CONCORDE_GEAR_LAYOUT.main, mountY: -1.1 })
    }),
    // The authored gear is static and 1.3 m short; strip it below the skin for the procedural legs.
    gearStripVolumes: Object.freeze([
      box([-1, -4.6, -19.2], [1, -1.5, -16.2]),
      box([-3.7, -4.6, 9.6], [-1.5, -1.12, 13.0]),
      box([1.5, -4.6, 9.6], [3.7, -1.12, 13.0])
    ]),
    glassMaterials: Object.freeze(['Translucent_Glass_Gray']),
    // Captain's side, ahead of the seat backs (z -21.67) and over the glareshield (y 0.43, z -22.52).
    cockpitEye: Object.freeze({ x: -0.7, y: 0.62, z: -22.0 })
  })
});

/** Drop triangles whose centroid lies inside any volume; returns null when nothing is left. */
export function stripTriangles(geometry, volumes) {
  if (!volumes?.length) return geometry;
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.attributes.position;
  const keep = [];
  const centroid = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    centroid.set(
      (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3,
      (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3,
      (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3);
    if (!volumes.some(volume => volume.containsPoint(centroid))) keep.push(i, i + 1, i + 2);
  }
  if (keep.length === position.count) return geometry;
  if (!keep.length) return null;
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const values = new attribute.array.constructor(keep.length * attribute.itemSize);
    keep.forEach((vertex, i) => {
      for (let j = 0; j < attribute.itemSize; j++) values[i * attribute.itemSize + j] = attribute.array[vertex * attribute.itemSize + j];
    });
    result.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
  }
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

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
    this.profile = CONCORDE_PROFILES[options.profile ?? 'exterior'] ?? CONCORDE_PROFILES.exterior;
    /** One rig per mesh with vertices ahead of the hinge. */
    this.noseRigs = [];
    this.fuselage = null;

    const gear = buildConcordeGear(this.profile.gearLayout);
    this.gearGroup = gear.group;
    this.gearLegs = gear.legs;
    this.gltfGroup.add(this.gearGroup);

    // The exterior asset has no flight deck; the interior asset's deck stays in the airframe meshes.
    this.cockpit = {
      group: new THREE.Group(), gltfCockpitGroup: new THREE.Group(),
      cockpitModelFailed: false, cockpitModelLoading: true,
      yokesVisible: true, gltfYokes: [], syncLighting() {},
      toggleYokes() { return this.yokesVisible; }
    };
    this.gltfGroup.add(this.cockpit.group);

    const url = options.modelUrl ?? `${import.meta.env?.BASE_URL ?? '/'}${this.profile.file}`;
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

  /** Bake every authored mesh into the aircraft frame using the profile's mount. */
  installModel(scene) {
    const profile = this.profile;
    const displayRoot = scene.children[0];
    if (displayRoot && profile.discardDisplayRoot) {
      displayRoot.position.set(0, 0, 0);
      displayRoot.quaternion.identity();
      displayRoot.scale.setScalar(1);
    }
    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse(node => { if (node.isMesh) meshes.push(node); });
    const toAircraft = new THREE.Matrix4();
    for (const source of meshes) {
      toAircraft.multiplyMatrices(profile.matrix, source.matrixWorld);
      const geometry = stripTriangles(source.geometry.clone().applyMatrix4(toAircraft), profile.gearStripVolumes);
      if (!geometry) continue;
      const material = source.material.clone();
      if (profile.glassMaterials.includes(material.name)) {
        // Keep the windscreen readable from the flight deck.
        material.transparent = true;
        material.opacity = Math.min(material.opacity, 0.18);
        material.depthWrite = false;
        material.side = THREE.DoubleSide;
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = source.name;
      mesh.castShadow = mesh.receiveShadow = !material.transparent;
      this.gltfGroup.add(mesh);
      // GLTFLoader de-duplicates a mesh node sharing its parent's name with a numeric suffix.
      const authoredName = source.parent?.name && source.name.startsWith(source.parent.name) ? source.parent.name : source.name;
      if (profile.droopMeshes === 'all' || profile.droopMeshes.includes(authoredName)) {
        const rig = prepareNoseDroop(geometry, profile.hinge);
        if (rig.indices.length) this.noseRigs.push({ geometry, rig });
      }
      if (authoredName === CONCORDE_FUSELAGE_MESH) this.fuselage = mesh;
    }
    this.modelLoaded = this.useGltf = true;
    this.cockpit.onModelReady?.();
    this.applyNoseDroop();
  }

  applyNoseDroop() {
    for (const { geometry, rig } of this.noseRigs) applyNoseDroop(geometry, rig, this.noseDroopDeg);
  }

  update(dt, state = {}) {
    const extension = clampGearExtension(state.gearState, this.gearExtension);
    this.gearExtension = extension;
    poseConcordeGear(this.gearLegs, extension, state);
    const target = concordeNoseDroopTarget(state);
    this.noseDroopDeg = dt > 0 ? stepNoseDroop(this.noseDroopDeg, target, dt) : target;
    this.applyNoseDroop();
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
