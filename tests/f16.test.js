import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { F16, F16_SCALE, F16_CENTER_X, splitF16Gear, createF16CanopyMaterial } from '../src/aircraft/F16.js';
import { AircraftBreakup } from '../src/effects/AircraftBreakup.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { F16_FALCON } from '../src/config/aircraftConfigs.js';
import { CollisionDetector, F16_COLLISION_PROBES } from '../src/physics/CollisionDetector.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { solveTrim } from '../src/physics/TrimSolver.js';

const bytes = readFileSync(new URL('../public/models/f-16.glb', import.meta.url));
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const binaryStart = 28 + jsonLength;
function deployedGearGeometry() {
  const primitive = gltf.meshes[gltf.nodes.find(n => n.name === 'Object_16').mesh].primitives[0];
  const geometry = new THREE.BufferGeometry();
  const accessor = gltf.accessors[primitive.attributes.POSITION];
  const view = gltf.bufferViews[accessor.bufferView];
  const start = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const positions = new Float32Array(accessor.count * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = bytes.readFloatLE(start + i * 4);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const index = gltf.accessors[primitive.indices];
  const iv = gltf.bufferViews[index.bufferView];
  const offset = binaryStart + (iv.byteOffset ?? 0) + (index.byteOffset ?? 0);
  const indices = Array.from({ length: index.count }, (_, i) => index.componentType === 5125
    ? bytes.readUInt32LE(offset + i * 4) : bytes.readUInt16LE(offset + i * 2));
  geometry.setIndex(indices);
  const transform = new THREE.Matrix4().makeTranslation(0, 0, F16_CENTER_X * F16_SCALE)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeScale(F16_SCALE, F16_SCALE, F16_SCALE))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  return geometry.applyMatrix4(transform);
}

test('supplied F16 gear separates into three nonempty legs without losing triangles', () => {
  const geometry = deployedGearGeometry();
  const parts = splitF16Gear(geometry);
  assert.equal(Object.values(parts).reduce((n, p) => n + p.attributes.position.count, 0), geometry.index.count);
  for (const part of Object.values(parts)) {
    assert.ok(part.attributes.position.count > 100);
    assert.ok([...part.attributes.position.array].every(Number.isFinite));
  }
  assert.ok(parts.nose.boundingBox.max.z < 0);
  assert.ok(parts.mainLeft.boundingBox.min.x < 0);
  assert.ok(parts.mainRight.boundingBox.max.x > 0);
});

test('gear retracts and extends repeatedly from continuous telemetry without accumulating rotation', () => {
  const aircraft = Object.create(F16.prototype);
  aircraft.group = new THREE.Group();
  aircraft.gltfGroup = new THREE.Group();
  aircraft.group.add(aircraft.gltfGroup);
  aircraft.gearLegs = {};
  aircraft.gearExtension = 1;
  aircraft.lightsOn = true;
  aircraft.stowedGear = new THREE.Group();
  aircraft.installGear(new THREE.Mesh(deployedGearGeometry(), new THREE.MeshStandardMaterial()));
  for (const extension of [1, .5, 0, .25, 1, 0, 1]) {
    aircraft.update(.016, { gearState: extension });
    for (const leg of Object.values(aircraft.gearLegs)) {
      assert.equal(leg.visible, extension > 0);
      assert.ok(Number.isFinite(leg.rotation.x + leg.rotation.z));
      if (extension === 1) assert.equal(Math.abs(leg.rotation.x) + Math.abs(leg.rotation.z), 0);
    }
    assert.equal(aircraft.stowedGear.visible, extension < .999);
  }
});

test('F16 uses its own contact envelope, cockpit, and noncommercial source attribution', () => {
  const detector = Object.create(CollisionDetector.prototype);
  detector.loadAircraftConfig(F16_FALCON);
  assert.equal(detector.probePoints.length, F16_COLLISION_PROBES.length);
  assert.ok(detector.probePoints.every(p => Math.abs(p.pos.x) < 5 && Math.abs(p.pos.z) < 9));
  assert.ok(F16_FALCON.landingGear.bodySupportPoints.every(p => Math.abs(p.position[2]) <= 8));
  assert.ok(gltf.nodes.some(n => n.name.startsWith('F-16-cockpit')));
  assert.equal(gltf.asset.extras.author.split(' ')[0], 'bohmerang');
  assert.match(gltf.asset.extras.license, /CC-BY-NC-SA-4.0/);
});

async function loadUntexturedAsset() {
  // Preserve the actual GLB hierarchy and geometry; only omit DOM image decoding.
  const asset = structuredClone(gltf);
  asset.materials = asset.materials.map(({ name, alphaMode, doubleSided }) => ({ name, alphaMode, doubleSided }));
  delete asset.images;
  delete asset.textures;
  delete asset.samplers;
  const text = Buffer.from(JSON.stringify(asset));
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const header = Buffer.from(bytes.subarray(0, 20));
  const binary = bytes.subarray(20 + jsonLength);
  header.writeUInt32LE(20 + padded.length + binary.length, 8);
  header.writeUInt32LE(padded.length, 12);
  const buffer = Buffer.concat([header, padded, binary]);
  return new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
}

test('loaded F16 breaks into complete wreckage and restores its aircraft/camera across repeated crashes', async t => {
  const loaded = await loadUntexturedAsset();
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => loaded);
  const aircraft = new F16();
  await aircraft.ready;
  assert.equal(aircraft.modelLoaded, true);
  const scene = new THREE.Scene();
  scene.add(aircraft.group);
  const breakup = new AircraftBreakup(scene);
  const camera = new THREE.PerspectiveCamera(75, 0.6, 0.08, 45000);
  const system = new CameraSystem(camera, null);
  system.loadAircraftConfig(F16_FALCON);
  const vertices = object => {
    let count = 0;
    object.traverseVisible(mesh => {
      if (mesh.isMesh) count += mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count;
    });
    return count;
  };
  for (const [cycle, gearState] of [1, .35, 0].entries()) {
    aircraft.group.position.set(7000 + cycle * 100, 500, 3000);
    aircraft.group.rotation.set(.1, .7, .2);
    aircraft.update(0, { gearState });
    aircraft.setCockpitMode(true);
    system.setMode(CameraSystem.MODES.COCKPIT, true);
    aircraft.triggerCrashVisuals();
    const expectedVertices = vertices(aircraft.group);
    assert.ok(expectedVertices > 30000, 'actual airframe and cockpit geometry is present');
    breakup.spawn(aircraft, new THREE.Vector3(50, -8, 0));
    assert.equal(aircraft.group.visible, false, 'the intact F16 must leave the crash view');
    assert.ok(breakup.pieces.length >= 4, 'crash must produce structural wreckage');
    assert.equal(breakup.pieces.reduce((sum, piece) => sum + vertices(piece.object), 0), expectedVertices,
      'cockpit, exterior, and currently visible gear must each appear exactly once');
    assert.ok(breakup.target.distanceTo(aircraft.group.position) < 20, 'camera target follows this crash, not world origin or the previous crash');
    system.beginCrashView(breakup);
    assert.equal(system.mode, CameraSystem.MODES.CHASE);
    assert.ok(camera.position.distanceTo(breakup.target) > breakup.radius);
    assert.equal(system.setMode(CameraSystem.MODES.COCKPIT, true), false);
    breakup.update(.25, { getHeight: () => 0 });
    assert.ok(breakup.pieces.every(piece => piece.object.position.toArray().every(Number.isFinite)));
    breakup.clear();
    system.endCrashView();
    aircraft.resetCrashVisuals();
    assert.equal(aircraft.group.visible, true);
    assert.equal(aircraft.isCrashed, false);
    assert.equal(system.mode, CameraSystem.MODES.COCKPIT);
    assert.equal(system.crashView, null);
    assert.equal(breakup.pieces.length, 0);
    assert.deepEqual(scene.children, [aircraft.group], 'reset removes generated wreckage only');
    aircraft.update(0, { gearState: 1 });
    assert.ok(Object.values(aircraft.gearLegs).every(leg => leg.visible && leg.rotation.x === 0 && leg.rotation.z === 0));
  }
});

test('F16 cockpit stays on its centerline through portrait resize, snap and aircraft changes', () => {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 1000);
  const system = new CameraSystem(camera, { addEventListener() {}, style: {} });
  const aircraft = new THREE.Object3D();
  aircraft.updateMatrixWorld(true);
  system.loadAircraftConfig(F16_FALCON);
  system.setMode(CameraSystem.MODES.COCKPIT, true);
  for (const aspect of [16 / 9, 390 / 844, 16 / 9]) {
    camera.aspect = aspect;
    system.snapToTarget(aircraft);
    assert.equal(camera.position.x, 0);
    system.update(1 / 60, aircraft, { onGround: true });
    assert.equal(camera.position.x, 0);
  }
  camera.aspect = 390 / 844;
  system.loadAircraftConfig({ id: 'B738' });
  system.snapToTarget(aircraft);
  assert.equal(camera.position.x, -0.34, 'other aircraft retain portrait framing');
  system.loadAircraftConfig(F16_FALCON);
  system.snapToTarget(aircraft);
  assert.equal(camera.position.x, 0);
});

test('F16 trim solver yields feasible idle solution for high-speed level flight', () => {
  const aero = new Aerodynamics(F16_FALCON);
  const engines = new EngineModel(F16_FALCON);
  const solution = solveTrim(aero, engines, {
    iasKnots: 300,
    altitudeMeters: 4500,
    flightPathAngleDeg: 0,
    flapsIndex: 0,
    gearState: 0,
    spoilers: 0
  });
  assert.equal(solution.feasible, true);
  assert.equal(solution.reason, 'idle');
  assert.ok(solution.handsOffTrimDeg >= -5 && solution.handsOffTrimDeg <= 12);
});

test('F16 canopy curved glass material has physical reflection, clearcoat, and view-dependent Fresnel', () => {
  const exteriorMat = createF16CanopyMaterial(false);
  assert.equal(exteriorMat.isMeshPhysicalMaterial, true);
  assert.equal(exteriorMat.transparent, true);
  assert.equal(exteriorMat.depthWrite, false);
  assert.equal(exteriorMat.side, THREE.DoubleSide);
  assert.equal(exteriorMat.opacity, 0.30);
  assert.equal(exteriorMat.roughness, 0.04);
  assert.equal(exteriorMat.metalness, 0.08);
  assert.equal(exteriorMat.clearcoat, 1.0);
  assert.equal(exteriorMat.clearcoatRoughness, 0.03);
  assert.equal(exteriorMat.ior, 1.54);
  assert.equal(exteriorMat.envMapIntensity, 2.5);

  const cockpitMat = createF16CanopyMaterial(true);
  assert.equal(cockpitMat.side, THREE.DoubleSide);
  assert.equal(cockpitMat.opacity, 0.25);

  // Verify onBeforeCompile replaces opaque_fragment with curved Fresnel reflection
  const shader = { fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  cockpitMat.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('fresnel'));
  assert.ok(shader.fragmentShader.includes('canopyAlpha'));
  assert.ok(shader.fragmentShader.includes('canopySpecular'));
  assert.ok(shader.fragmentShader.includes('itoTint'));
});

test('loaded F16 configures canopy mesh and responds to cockpit mode transitions', async t => {
  const loaded = await loadUntexturedAsset();
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => loaded);
  const aircraft = new F16();
  await aircraft.ready;
  assert.ok(aircraft.canopyMesh, 'canopy mesh must be identified');
  assert.ok(aircraft.canopyMaterial, 'canopy material must be assigned');
  assert.equal(aircraft.canopyMaterial.isMeshPhysicalMaterial, true);
  assert.equal(aircraft.canopyMesh.castShadow, false);
  assert.equal(aircraft.canopyMesh.receiveShadow, false);

  // Exterior mode initially
  aircraft.setCockpitMode(false);
  assert.equal(aircraft.canopyMaterial.side, THREE.DoubleSide);
  assert.equal(aircraft.canopyMaterial.opacity, 0.30);

  // Switch to cockpit mode
  aircraft.setCockpitMode(true);
  assert.equal(aircraft.canopyMaterial.side, THREE.DoubleSide);
  assert.equal(aircraft.canopyMaterial.opacity, 0.25);

  // Switch back to exterior mode
  aircraft.setCockpitMode(false);
  assert.equal(aircraft.canopyMaterial.side, THREE.DoubleSide);
  assert.equal(aircraft.canopyMaterial.opacity, 0.30);
});
