import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {
  CONCORDE_COCKPIT_EYE, CONCORDE_GEAR_LAYOUT, CONCORDE_MODEL_MATRIX, CONCORDE_NOSE_HINGE, CONCORDE_NOSE_POSITIONS_DEG,
  CONCORDE_VISOR, Concorde, applyNoseDroop, applyVisor, buildConcordeGear, concordeNoseDroopTarget, concordeVisorFraction,
  poseConcordeGear, prepareNoseDroop, prepareVisor, splitWindscreen, stepNoseDroop, textureWindowSampler
} from '../src/aircraft/Concorde.js';
import { COCKPIT_SOURCE, fuselageEnvelope } from '../scripts/build-concorde-cockpit.mjs';

const bytes = readFileSync(new URL('../public/models/concorde.glb', import.meta.url));
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const binaryStart = 28 + jsonLength;

function readAccessor(index) {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  const start = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (accessor.componentType === 5126) {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type];
    const stride = (view.byteStride ?? size * 4) / 4;
    return Float32Array.from({ length: accessor.count * size },
      (_, i) => bytes.readFloatLE(start + (Math.floor(i / size) * stride + i % size) * 4));
  }
  const read = accessor.componentType === 5125 ? (o => bytes.readUInt32LE(o)) : (o => bytes.readUInt16LE(o));
  const width = accessor.componentType === 5125 ? 4 : 2;
  return Array.from({ length: accessor.count }, (_, i) => read(start + i * width));
}

/** Mount every authored mesh as Concorde.installModel does: drop the display root, map to aircraft axes. */
function mountedMeshes() {
  const meshes = new Map();
  const visit = (index, parent, isDisplayRoot) => {
    const node = gltf.nodes[index];
    const local = new THREE.Matrix4();
    if (!isDisplayRoot && node.matrix) local.fromArray(node.matrix);
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      const geometry = new THREE.BufferGeometry();
      const primitive = gltf.meshes[node.mesh].primitives[0];
      geometry.setAttribute('position', new THREE.BufferAttribute(readAccessor(primitive.attributes.POSITION), 3));
      if (primitive.attributes.NORMAL !== undefined) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(readAccessor(primitive.attributes.NORMAL), 3));
      }
      if (primitive.indices !== undefined) geometry.setIndex(readAccessor(primitive.indices));
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(CONCORDE_MODEL_MATRIX, world));
      meshes.set(node.name, geometry);
    }
    for (const child of node.children ?? []) visit(child, world, false);
  };
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, new THREE.Matrix4(), true);
  return meshes;
}

const meshes = mountedMeshes();
const airframeBounds = () => {
  const box = new THREE.Box3();
  for (const geometry of meshes.values()) { geometry.computeBoundingBox(); box.union(geometry.boundingBox); }
  return box;
};

test('supplied Concorde carries its CC BY 4.0 attribution and ships a matching notice', () => {
  assert.match(gltf.asset.extras.author, /manilov\.ap/);
  assert.match(gltf.asset.extras.license, /CC-BY-4\.0/);
  assert.match(gltf.asset.extras.source, /6d95290363474798a429a38bbf9ad49d/);
  const notice = new URL('../public/models/concorde.LICENSE.txt', import.meta.url);
  assert.ok(existsSync(notice));
  assert.match(readFileSync(notice, 'utf8'), /manilov\.ap[\s\S]*CC BY 4\.0/);
});

test('mounted Concorde is 1:1 metres, nose forward along -Z, standing on its gear at fin height 12.2 m', () => {
  const box = airframeBounds();
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 25.6) < 0.05, `wingspan ${size.x}`);
  assert.ok(Math.abs(size.z - 61.07) < 0.05, `length ${size.z}`);
  const fuselage = meshes.get('S01-FACES');
  fuselage.computeBoundingBox();
  // The fuselage, not the fin, reaches furthest forward.
  assert.equal(fuselage.boundingBox.min.z, box.min.z);
  const fin = meshes.get('SShape07-FACES');
  fin.computeBoundingBox();
  assert.ok(fin.boundingBox.getCenter(new THREE.Vector3()).z > 10, 'fin sits aft');
  assert.ok(Math.abs(box.max.y - CONCORDE_GEAR_LAYOUT.groundY - 12.2) < 0.1, `static height ${box.max.y - CONCORDE_GEAR_LAYOUT.groundY}`);
});

test('nose hinge sits on the regular fuselage frame ahead of the windscreen', () => {
  const position = meshes.get('S01-FACES').attributes.position;
  let ring = 0, lowest = Infinity;
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(position.getZ(i) - CONCORDE_NOSE_HINGE.z) < 1e-3) {
      ring++;
      lowest = Math.min(lowest, position.getY(i));
    }
  }
  assert.ok(ring >= 56, `hinge frame vertices ${ring}`);
  assert.ok(Math.abs(lowest - CONCORDE_NOSE_HINGE.y) < 0.01, `hinge on lower skin ${lowest}`);
});

test('nose droops rigidly about the hinge and restores exactly', () => {
  const geometry = meshes.get('S01-FACES').clone();
  const rest = Float32Array.from(geometry.attributes.position.array);
  const rig = prepareNoseDroop(geometry);
  assert.ok(rig.indices.length > 400);
  let tip = 0;
  for (let k = 1; k < rig.indices.length; k++) if (rig.positions[k * 3 + 2] < rig.positions[tip * 3 + 2]) tip = k;
  const tipIndex = rig.indices[tip];
  const arm = Math.hypot(rig.positions[tip * 3 + 1] - CONCORDE_NOSE_HINGE.y, rig.positions[tip * 3 + 2] - CONCORDE_NOSE_HINGE.z);

  assert.equal(applyNoseDroop(geometry, rig, CONCORDE_NOSE_POSITIONS_DEG.landing), true);
  const position = geometry.attributes.position;
  assert.ok(position.getY(tipIndex) < rest[tipIndex * 3 + 1] - 1, 'tip drops by more than a metre at 12.5 degrees');
  const movedArm = Math.hypot(position.getY(tipIndex) - CONCORDE_NOSE_HINGE.y, position.getZ(tipIndex) - CONCORDE_NOSE_HINGE.z);
  assert.ok(Math.abs(movedArm - arm) < 1e-4, 'rotation keeps the distance to the hinge');
  for (let i = 0; i < position.count; i++) {
    if (rest[i * 3 + 2] >= CONCORDE_NOSE_HINGE.z) assert.equal(position.getZ(i), rest[i * 3 + 2]);
  }
  const normal = geometry.attributes.normal;
  assert.ok(Math.abs(Math.hypot(normal.getX(tipIndex), normal.getY(tipIndex), normal.getZ(tipIndex)) - 1) < 1e-3);

  assert.equal(applyNoseDroop(geometry, rig, CONCORDE_NOSE_POSITIONS_DEG.landing), false, 'unchanged angle is a no-op');
  applyNoseDroop(geometry, rig, 0);
  for (let i = 0; i < rest.length; i++) assert.ok(Math.abs(position.array[i] - rest[i]) < 1e-5);
});

test('nose schedule: up with gear retracted, 5 degrees on the ground, 12.5 airborne with gear down', () => {
  assert.equal(concordeNoseDroopTarget({ gearState: 0, onGround: false }), 0);
  assert.equal(concordeNoseDroopTarget({ gearState: 1, onGround: true }), 5);
  assert.equal(concordeNoseDroopTarget({ gearState: 1, onGround: false }), 12.5);
  assert.equal(concordeNoseDroopTarget({ gearState: 1, noseDroopDeg: 0 }), 0);
  assert.equal(concordeNoseDroopTarget({ noseDroopDeg: 40 }), 12.5);
  assert.equal(stepNoseDroop(0, 12.5, 1), 3.5);
  assert.equal(stepNoseDroop(12, 12.5, 1), 12.5);
  assert.equal(stepNoseDroop(5, 0, 0), 5);
});

test('procedural gear rests every tyre on the ground and stows forward / inboard', () => {
  const { group, legs } = buildConcordeGear();
  poseConcordeGear(legs, 1);
  group.updateMatrixWorld(true);
  for (const leg of Object.values(legs)) {
    const box = new THREE.Box3().setFromObject(leg);
    assert.ok(Math.abs(box.min.y - CONCORDE_GEAR_LAYOUT.groundY) < 0.01, `${leg.name} rests at ${box.min.y}`);
  }
  // Main bogies stay ahead of the engine intakes and outboard of the belly.
  const intakes = meshes.get('vint01-FACES');
  intakes.computeBoundingBox();
  const right = new THREE.Box3().setFromObject(legs.mainRight);
  assert.ok(right.max.z < intakes.boundingBox.min.z, `bogie ${right.max.z} vs intake ${intakes.boundingBox.min.z}`);
  assert.ok(right.min.x > 1.6, `bogie clears the 1.55 m half-width fuselage (${right.min.x})`);

  const deployed = Object.fromEntries(Object.entries(legs).map(([id, leg]) => [id, new THREE.Box3().setFromObject(leg).getCenter(new THREE.Vector3())]));
  poseConcordeGear(legs, 0.5);
  group.updateMatrixWorld(true);
  const centre = id => new THREE.Box3().setFromObject(legs[id]).getCenter(new THREE.Vector3());
  assert.ok(centre('nose').z < deployed.nose.z, 'nose leg swings forward');
  assert.ok(centre('mainLeft').x > deployed.mainLeft.x, 'left main swings inboard');
  assert.ok(centre('mainRight').x < deployed.mainRight.x, 'right main swings inboard');

  poseConcordeGear(legs, 0);
  assert.ok(Object.values(legs).every(leg => !leg.visible));
  poseConcordeGear(legs, 1, { gearDamage: { nose: 'collapsed' } });
  assert.equal(legs.nose.visible, false);
  assert.equal(legs.mainLeft.visible, true);
  poseConcordeGear(legs, 1, { compressions: { mainLeft: 0.2 } });
  assert.equal(legs.mainLeft.userData.truck.position.y, 0.2);
});

const exteriorPath = new URL('../public/models/concorde.glb', import.meta.url);
const cockpitPath = new URL('../public/models/concorde-cockpit.glb', import.meta.url);

function readCockpit() {
  const data = readFileSync(cockpitPath);
  const length = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + length).toString());
  const start = 28 + length;
  const primitive = json.meshes[0].primitives[0];
  const accessor = json.accessors[primitive.attributes.POSITION];
  const view = json.bufferViews[accessor.bufferView];
  const offset = start + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const points = Array.from({ length: accessor.count }, (_, i) =>
    new THREE.Vector3(data.readFloatLE(offset + i * 12), data.readFloatLE(offset + i * 12 + 4), data.readFloatLE(offset + i * 12 + 8)));
  return { json, primitive, points, size: data.byteLength };
}

test('flight deck is one small vertex-coloured mesh carrying its CC BY attribution', () => {
  const { json, primitive, size } = readCockpit();
  assert.equal(json.meshes.length, 1);
  assert.equal(json.materials.length, 1);
  assert.ok(primitive.attributes.COLOR_0 !== undefined, 'vertex colours');
  assert.equal(primitive.attributes.NORMAL, undefined, 'flat shaded at runtime');
  const triangles = json.accessors[primitive.indices].count / 3;
  assert.ok(triangles > 3000 && triangles < 8000, `triangles ${triangles}`);
  assert.ok(size < 250_000, `bytes ${size}`);
  const extras = json.scenes[0].extras;
  assert.equal(extras.author, COCKPIT_SOURCE.author);
  assert.equal(extras.license, COCKPIT_SOURCE.license);
  const notice = readFileSync(new URL('../public/models/concorde-cockpit.LICENSE.txt', import.meta.url), 'utf8');
  assert.match(notice, /Henry Chi[\s\S]*CC BY 4\.0/);
});

test('flight deck stays inside the exterior fuselage and the eye sits inside it, above the hinge skin', () => {
  const envelope = fuselageEnvelope(exteriorPath, 0);
  const { points } = readCockpit();
  const outside = points.filter(point => !envelope.contains(point));
  assert.equal(outside.length, 0, `${outside.length} deck vertices outside the skin`);
  const eye = new THREE.Vector3(CONCORDE_COCKPIT_EYE.x, CONCORDE_COCKPIT_EYE.y, CONCORDE_COCKPIT_EYE.z);
  assert.ok(envelope.contains(eye));
  assert.ok(eye.z > CONCORDE_NOSE_HINGE.z, 'eye aft of the hinge');
  // The pilot sees over the nose skin at the hinge frame (y 0.65).
  assert.ok(eye.y > 0.65 + 0.1);
  const ahead = points.filter(point => point.z < eye.z);
  assert.ok(ahead.length > 100);
  assert.ok(ahead.every(point => point.y < eye.y), 'nothing ahead of the eye rises into the forward view');
});

test('windscreen split moves classified triangles in the flight-deck region only', () => {
  const geometry = meshes.get('S01-FACES').clone();
  const total = geometry.index.count;
  const { frame, glass } = splitWindscreen(geometry, () => true);
  assert.equal(frame.length + glass.length, total);
  const position = geometry.attributes.position;
  for (let t = 0; t < glass.length; t += 3) {
    const z = (position.getZ(glass[t]) + position.getZ(glass[t + 1]) + position.getZ(glass[t + 2])) / 3;
    assert.ok(z > -25 && z < -22);
  }
  assert.equal(splitWindscreen(geometry, () => false).glass.length, 0);
  assert.equal(textureWindowSampler({ image: { width: 4, height: 4 } }), null, 'no canvas in Node');
});

test('visor lowers into a well behind the hinge, turns the zone into glass, and restores', () => {
  const geometry = meshes.get('S01-FACES').clone();
  const rest = Float32Array.from(geometry.attributes.position.array);
  const split = splitWindscreen(geometry, () => false);
  const glassGeometry = new THREE.BufferGeometry();
  const rig = prepareVisor(geometry, split);
  assert.ok(rig.zoneTriangleCount > 30, `zone ${rig.zoneTriangleCount}`);
  assert.ok(rig.vertices.length > 10);
  const position = geometry.attributes.position;
  for (const i of rig.vertices) assert.ok(position.getZ(i) >= CONCORDE_NOSE_HINGE.z - 1e-3, 'well never moves drooping nose vertices');

  assert.equal(concordeVisorFraction(0), 0);
  assert.equal(concordeVisorFraction(CONCORDE_NOSE_POSITIONS_DEG.takeoff), 1);
  assert.equal(concordeVisorFraction(CONCORDE_NOSE_POSITIONS_DEG.landing), 1);

  applyVisor(geometry, glassGeometry, rig, 1);
  let deepest = 0;
  for (let k = 0; k < rig.vertices.length; k++) {
    const drop = rest[rig.vertices[k] * 3 + 1] - position.getY(rig.vertices[k]);
    assert.ok(drop >= 0 && drop <= CONCORDE_VISOR.well.depth + 1e-6);
    deepest = Math.max(deepest, drop);
  }
  assert.ok(deepest > 0.25, `well depth ${deepest}`);
  assert.equal(geometry.index.count + glassGeometry.index.count, split.frame.length + split.glass.length);
  assert.equal(glassGeometry.index.count / 3, rig.zoneTriangleCount);

  applyVisor(geometry, glassGeometry, rig, 0);
  for (let i = 0; i < rest.length; i++) assert.equal(position.array[i], rest[i]);
  assert.equal(geometry.index.count, split.frame.length);
  assert.equal(glassGeometry.index.count, 0);
});

test('cockpit mode keeps the exterior and starts the flight-deck download once', () => {
  const concorde = new Concorde({ modelUrl: 'data:,', cockpitUrl: 'data:,' });
  concorde.ready.catch(() => {});
  assert.equal(concorde.cockpit.group.visible, false);
  concorde.setCockpitMode(true);
  const first = concorde.cockpitPromise;
  assert.ok(first);
  concorde.setCockpitMode(false);
  concorde.setCockpitMode(true);
  assert.equal(concorde.cockpitPromise, first);
  assert.equal(concorde.gltfGroup.visible, true);
  assert.equal(concorde.cockpit.group.visible, true);
  concorde.setCockpitMode(true, false);
  assert.equal(concorde.cockpit.group.visible, false);
  assert.ok(concorde.cockpit.captainEyePos.equals(new THREE.Vector3(CONCORDE_COCKPIT_EYE.x, CONCORDE_COCKPIT_EYE.y, CONCORDE_COCKPIT_EYE.z)));
});
