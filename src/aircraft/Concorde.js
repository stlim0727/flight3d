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

/**
 * Flight deck extracted from Henry Chi's interior model by
 * scripts/build-concorde-cockpit.mjs and fitted inside this exterior. It loads
 * on the first cockpit entry, like the 737 interior, but the exterior stays
 * visible around it so the drooping nose is seen through the windscreen.
 */
export const CONCORDE_COCKPIT_FILE = 'models/concorde-cockpit.glb';
/**
 * Captain's eye in aircraft metres. It must clear the nose skin at the hinge
 * (y 0.65, z -24.63) so the nose surface is visible ahead and drops away as it droops.
 */
export const CONCORDE_COCKPIT_EYE = Object.freeze({ x: -0.45, y: 0.85, z: -22.15 });

/**
 * The exterior paints its windscreen and side windows dark on the fuselage
 * texture. Triangles in the flight-deck region whose texel is dark become glass.
 */
export const CONCORDE_WINDSCREEN = Object.freeze({
  region: Object.freeze({ minZ: -25, maxZ: -22, minY: 0.2 }),
  // Texture area that holds the flight-deck windows (sampled once at load).
  uv: Object.freeze({ minU: 0.08, maxU: 0.14, minV: 0.03, maxV: 0.17 }),
  darkLuminance: 70
});

/**
 * Partition an indexed geometry's triangles into airframe and window index
 * lists. `isWindow(u, v)` classifies a triangle by its UV centroid; only
 * triangles inside `region` are considered.
 */
export function splitWindscreen(geometry, isWindow, region = CONCORDE_WINDSCREEN.region) {
  const position = geometry.attributes.position, uv = geometry.attributes.uv;
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const vertex = k => (index ? index.getX(k) : k);
  const frame = [], glass = [];
  for (let t = 0; t < count; t += 3) {
    let y = 0, z = 0, u = 0, v = 0;
    for (let k = 0; k < 3; k++) {
      const i = vertex(t + k);
      y += position.getY(i) / 3; z += position.getZ(i) / 3;
      if (uv) { u += uv.getX(i) / 3; v += uv.getY(i) / 3; }
    }
    const candidate = uv && z > region.minZ && z < region.maxZ && y > region.minY;
    (candidate && isWindow(u, v) ? glass : frame).push(vertex(t), vertex(t + 1), vertex(t + 2));
  }
  return { frame, glass };
}

/**
 * Build a window classifier from the fuselage texture by reading only the
 * flight-deck UV area. Returns null where no 2D canvas exists (Node tests).
 */
export function textureWindowSampler(texture, settings = CONCORDE_WINDSCREEN) {
  const image = texture?.image;
  if (!image?.width || typeof document === 'undefined') return null;
  const { minU, maxU, minV, maxV } = settings.uv;
  // glTF textures are not flipped: v = 0 is the top row of the image.
  const flipped = texture.flipY;
  const x0 = Math.floor(minU * image.width), x1 = Math.ceil(maxU * image.width);
  const rowOf = v => (flipped ? 1 - v : v) * image.height;
  const y0 = Math.floor(Math.min(rowOf(minV), rowOf(maxV))), y1 = Math.ceil(Math.max(rowOf(minV), rowOf(maxV)));
  const width = Math.max(1, x1 - x0), height = Math.max(1, y1 - y0);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, x0, y0, width, height, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  return (u, v) => {
    const x = Math.floor(u * image.width) - x0, y = Math.floor(rowOf(v)) - y0;
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const o = (y * width + x) * 4;
    return (pixels[o] + pixels[o + 1] + pixels[o + 2]) / 3 < settings.darkLuminance;
  };
}

/**
 * Visor. The exterior is modelled visor-up: opaque skin rises from the nose
 * hinge to a narrow windscreen strip, so the pilot sees over the nose top only
 * through that strip. Lowering the visor (it is fully down by the 5° take-off
 * nose position) turns that skin into glass and drops it into a well up to
 * `depth` metres deep, which opens the forward-down view over the drooped nose.
 */
export const CONCORDE_VISOR = Object.freeze({
  // Skin between the hinge frame and the windscreen that becomes glass when down.
  zone: Object.freeze({ maxZ: -23.5, minY: 0.35, maxX: 1.0 }),
  // Vertices lowered into the visor well: full depth ahead of `fullZ`, none aft of `maxZ`.
  well: Object.freeze({ fullZ: -24.3, maxZ: -23.85, minY: 0.3, topY: 0.65, maxX: 1.05, depth: 0.35 }),
  fullDownDeg: 5
});

/** Visor travel (0 up, 1 down) for a nose angle in degrees. */
export function concordeVisorFraction(noseDroopDeg) {
  return THREE.MathUtils.clamp(noseDroopDeg / CONCORDE_VISOR.fullDownDeg, 0, 1);
}

/**
 * Prepare the visor from the windscreen split: index lists for both visor
 * states and the rest heights of the well vertices behind the nose hinge.
 */
export function prepareVisor(geometry, { frame, glass }, hinge = CONCORDE_NOSE_HINGE, visor = CONCORDE_VISOR) {
  const position = geometry.attributes.position;
  const { zone, well } = visor;
  const frameDown = [], zoneTriangles = [];
  for (let t = 0; t < frame.length; t += 3) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) {
      const i = frame[t + k];
      x += position.getX(i) / 3; y += position.getY(i) / 3; z += position.getZ(i) / 3;
    }
    const inZone = z > hinge.z && z < zone.maxZ && y > zone.minY && Math.abs(x) < zone.maxX;
    (inZone ? zoneTriangles : frameDown).push(frame[t], frame[t + 1], frame[t + 2]);
  }
  const vertices = [], restY = [], weights = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    // The hinge frame itself belongs to the fixed airframe, so it may move with the well.
    if (z < hinge.z - 1e-3 || z > well.maxZ || y < well.minY || Math.abs(x) > well.maxX) continue;
    const along = 1 - THREE.MathUtils.smoothstep(z, well.fullZ, well.maxZ);
    const up = THREE.MathUtils.smoothstep(y, well.minY, well.topY);
    const weight = along * up;
    if (weight <= 0) continue;
    vertices.push(i); restY.push(y); weights.push(weight);
  }
  return {
    frameUp: frame, glassUp: glass,
    frameDown, glassDown: [...glass, ...zoneTriangles],
    zoneTriangleCount: zoneTriangles.length / 3,
    vertices: Uint32Array.from(vertices), restY: Float32Array.from(restY), weights: Float32Array.from(weights),
    depth: well.depth, fraction: -1, down: null
  };
}

/** Pose the visor: sink the well by `fraction` and switch the zone between skin and glass at half travel. */
export function applyVisor(fuselageGeometry, glassGeometry, rig, fraction) {
  if (!rig || rig.fraction === fraction) return false;
  const position = fuselageGeometry.attributes.position;
  for (let k = 0; k < rig.vertices.length; k++) {
    position.setY(rig.vertices[k], rig.restY[k] - rig.depth * fraction * rig.weights[k]);
  }
  position.needsUpdate = true;
  const down = fraction >= 0.5;
  if (down !== rig.down) {
    fuselageGeometry.setIndex(down ? rig.frameDown : rig.frameUp);
    glassGeometry?.setIndex(down ? rig.glassDown : rig.glassUp);
    rig.down = down;
  }
  rig.fraction = fraction;
  return true;
}

/** Tinted glass: dark like the painted windows outside, nearly clear from the flight deck. */
export function createConcordeWindscreenMaterial() {
  return new THREE.MeshStandardMaterial({
    name: 'Concorde-windscreen-glass', color: 0x1c2630, roughness: 0.08, metalness: 0.2,
    transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide
  });
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

    // The flight deck is a separate small asset loaded on the first cockpit entry.
    this.cockpit = {
      group: new THREE.Group(), gltfCockpitGroup: new THREE.Group(),
      cockpitModelFailed: false, cockpitModelLoading: false, cockpitModelLoaded: false,
      captainEyePos: new THREE.Vector3(CONCORDE_COCKPIT_EYE.x, CONCORDE_COCKPIT_EYE.y, CONCORDE_COCKPIT_EYE.z),
      yokesVisible: true, gltfYokes: [], syncLighting() {},
      toggleYokes() { return this.yokesVisible; }
    };
    this.cockpit.group.name = 'Concorde_Cockpit';
    this.cockpit.group.visible = false;
    this.cockpit.group.add(this.cockpit.gltfCockpitGroup);
    this.gltfGroup.add(this.cockpit.group);
    this.windscreen = null;
    this.visorRig = null;
    this.cockpitUrl = options.cockpitUrl ?? `${import.meta.env?.BASE_URL ?? '/'}${CONCORDE_COCKPIT_FILE}`;
    this.cockpitPromise = null;

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
      });
  }

  /** Start (once) and return the flight-deck download. */
  ensureCockpitModel() {
    if (this.cockpitPromise) return this.cockpitPromise;
    const cockpit = this.cockpit;
    cockpit.cockpitModelLoading = true;
    this.cockpitPromise = new GLTFLoader().loadAsync(this.cockpitUrl)
      .then(gltf => {
        gltf.scene.traverse(node => {
          if (node.isMesh) { node.castShadow = false; node.receiveShadow = true; }
        });
        cockpit.gltfCockpitGroup.add(gltf.scene);
        cockpit.cockpitModelLoaded = true;
        cockpit.onModelReady?.();
      })
      .catch(error => {
        cockpit.cockpitModelFailed = true;
        console.error('Concorde flight deck failed to load:', error);
      })
      .finally(() => { cockpit.cockpitModelLoading = false; });
    return this.cockpitPromise;
  }

  /** Move the painted flight-deck windows into a see-through glass mesh sharing the fuselage vertices. */
  installWindscreen(fuselage) {
    const isWindow = textureWindowSampler(fuselage.material.map);
    if (!isWindow) return;
    const geometry = fuselage.geometry;
    const split = splitWindscreen(geometry, isWindow);
    if (!split.glass.length) return;
    geometry.setIndex(split.frame);
    const glassGeometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) glassGeometry.setAttribute(name, attribute);
    glassGeometry.setIndex(split.glass);
    glassGeometry.boundingSphere = geometry.boundingSphere;
    this.windscreen = new THREE.Mesh(glassGeometry, createConcordeWindscreenMaterial());
    this.windscreen.name = 'Concorde_Windscreen';
    this.windscreen.renderOrder = 2;
    this.gltfGroup.add(this.windscreen);
    this.visorRig = prepareVisor(geometry, split);
  }

  applyNosePose() {
    if (!this.fuselage) return;
    applyNoseDroop(this.fuselage.geometry, this.noseRig, this.noseDroopDeg);
    applyVisor(this.fuselage.geometry, this.windscreen?.geometry, this.visorRig, concordeVisorFraction(this.noseDroopDeg));
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
        this.installWindscreen(mesh);
      }
    }
    this.modelLoaded = this.useGltf = true;
    this.applyNosePose();
  }

  update(dt, state = {}) {
    const extension = clampGearExtension(state.gearState, this.gearExtension);
    this.gearExtension = extension;
    poseConcordeGear(this.gearLegs, extension, state);
    const target = concordeNoseDroopTarget(state);
    this.noseDroopDeg = dt > 0 ? stepNoseDroop(this.noseDroopDeg, target, dt) : target;
    this.applyNosePose();
  }

  /**
   * Unlike the 737, the exterior stays visible in the cockpit view so the nose
   * droop is seen through the windscreen; only the deck and glass change.
   */
  setCockpitMode(isCockpit, showInterior = true) {
    this.isCockpit = isCockpit;
    if (isCockpit) this.ensureCockpitModel();
    this.cockpit.group.visible = isCockpit && showInterior;
    if (this.windscreen) this.windscreen.material.opacity = isCockpit ? 0.12 : 0.7;
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
