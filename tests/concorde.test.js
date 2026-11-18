import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {
  CONCORDE_GEAR_LAYOUT, CONCORDE_NOSE_HINGE, CONCORDE_NOSE_POSITIONS_DEG, CONCORDE_PROFILES,
  applyNoseDroop, buildConcordeGear, concordeNoseDroopTarget, poseConcordeGear, prepareNoseDroop, stepNoseDroop,
  stripTriangles
} from '../src/aircraft/Concorde.js';

function readGlb(file) {
  const bytes = readFileSync(new URL(`../public/${file}`, import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binaryStart = 28 + jsonLength;
  const readAccessor = index => {
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
  };
  return { gltf, readAccessor };
}

/** Mount every authored mesh as Concorde.installModel does for `profile`, keyed by node name. */
function mountedMeshes(profile) {
  const { gltf, readAccessor } = readGlb(profile.file);
  const meshes = new Map();
  const visit = (index, parent, isDisplayRoot) => {
    const node = gltf.nodes[index];
    const local = new THREE.Matrix4();
    if (!(isDisplayRoot && profile.discardDisplayRoot) && node.matrix) local.fromArray(node.matrix);
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      const geometry = new THREE.BufferGeometry();
      const primitive = gltf.meshes[node.mesh].primitives[0];
      geometry.setAttribute('position', new THREE.BufferAttribute(readAccessor(primitive.attributes.POSITION), 3));
      if (primitive.attributes.NORMAL !== undefined) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(readAccessor(primitive.attributes.NORMAL), 3));
      }
      if (primitive.indices !== undefined) geometry.setIndex(readAccessor(primitive.indices));
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(profile.matrix, world));
      meshes.set(node.name, geometry);
    }
    for (const child of node.children ?? []) visit(child, world, false);
  };
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, new THREE.Matrix4(), true);
  return { gltf, meshes };
}

const unionBounds = geometries => {
  const box = new THREE.Box3();
  for (const geometry of geometries) { geometry.computeBoundingBox(); box.union(geometry.boundingBox); }
  return box;
};
const { gltf, meshes } = mountedMeshes(CONCORDE_PROFILES.exterior);
const airframeBounds = () => unionBounds(meshes.values());

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

test('stripTriangles drops only triangles centred inside a volume', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5, 6, 5, 5, 5, 6, 5], 3));
  const inside = new THREE.Box3(new THREE.Vector3(4, 4, 4), new THREE.Vector3(7, 7, 7));
  const result = stripTriangles(geometry, [inside]);
  assert.equal(result.attributes.position.count, 3);
  assert.equal(stripTriangles(geometry, []), geometry);
  assert.equal(stripTriangles(geometry, [new THREE.Box3(new THREE.Vector3(-9, -9, -9), new THREE.Vector3(9, 9, 9))]), null);
});

test('interior Concorde shares the exterior frame: 61.66 m, nose tip -29.8 m, 12.2 m fin above ground', () => {
  const profile = CONCORDE_PROFILES.interior;
  const { gltf: interior, meshes: parts } = mountedMeshes(profile);
  assert.match(interior.asset.extras.author, /Henry Chi/);
  assert.match(interior.asset.extras.license, /CC-BY-4\.0/);
  const notice = new URL('../public/models/concorde-interior.LICENSE.txt', import.meta.url);
  assert.ok(existsSync(notice));
  assert.match(readFileSync(notice, 'utf8'), /Henry Chi[\s\S]*CC BY 4\.0/);

  const box = unionBounds(parts.values());
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - 61.66) < 0.05, `length ${size.z}`);
  assert.ok(Math.abs(box.min.z + 29.8) < 0.05, `nose tip ${box.min.z}`);
  assert.ok(Math.abs(box.max.y - profile.gearLayout.groundY - 12.2) < 0.05, `fin height ${box.max.y - profile.gearLayout.groundY}`);
  assert.ok(Math.abs(box.min.x + box.max.x) < 0.6, `span centred ${box.min.x}..${box.max.x}`);
});

test('interior profile strips the short authored gear and leaves wing and belly skin', () => {
  const profile = CONCORDE_PROFILES.interior;
  const { meshes: parts } = mountedMeshes(profile);
  let removed = 0, lowest = Infinity;
  for (const geometry of parts.values()) {
    const before = (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    const stripped = stripTriangles(geometry, profile.gearStripVolumes);
    const after = stripped ? stripped.attributes.position.count / 3 : 0;
    removed += before - after;
    if (stripped) { stripped.computeBoundingBox(); lowest = Math.min(lowest, stripped.boundingBox.min.y); }
  }
  assert.ok(removed > 1000, `removed ${removed} gear triangles`);
  // Without its gear the airframe sits clear of the ground the procedural legs reach.
  assert.ok(lowest > profile.gearLayout.groundY + 2, `lowest remaining skin ${lowest}`);
  const wing = parts.get('Object_6');
  const kept = stripTriangles(wing, profile.gearStripVolumes);
  assert.ok(kept.attributes.position.count / 3 > ((wing.index?.count ?? wing.attributes.position.count) / 3) - 12, 'wing skin is kept');
});

test('interior nose droop pivots on the frame ahead of the windscreen and the deck camera sits inside', () => {
  const profile = CONCORDE_PROFILES.interior;
  const { meshes: parts } = mountedMeshes(profile);
  let frame = 0, ahead = 0;
  for (const geometry of parts.values()) {
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getZ(i) - profile.hinge.z) < 0.02) frame++;
      if (position.getZ(i) < profile.hinge.z - 1e-3) ahead++;
    }
  }
  assert.ok(frame >= 8, `hinge frame vertices ${frame}`);
  assert.ok(ahead > 100, `droop vertices ${ahead}`);
  const glass = [...parts.entries()].find(([name]) => name === 'Object_25')[1];
  glass.computeBoundingBox();
  assert.ok(glass.boundingBox.min.z > profile.hinge.z, 'windscreen stays behind the hinge');
  const eye = new THREE.Vector3(profile.cockpitEye.x, profile.cockpitEye.y, profile.cockpitEye.z);
  const skin = parts.get('Object_20');
  skin.computeBoundingBox();
  assert.ok(skin.boundingBox.containsPoint(eye), 'eye inside the fuselage');
  assert.ok(eye.z > profile.hinge.z, 'eye behind the drooping nose');
});
