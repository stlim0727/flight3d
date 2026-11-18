import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MISSILE_TYPES, F16_MISSILE_STATIONS } from '../src/weapons/missileSpecs.js';
import { createMissileMesh, createPylonMesh, getMissileModelUrl } from '../src/weapons/missileGeometry.js';
import { F16 } from '../src/aircraft/F16.js';

function parseGlbBuffer(filePath) {
  const buf = fs.readFileSync(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, '', gltf => resolve(gltf), reject);
  });
}

test('missile GLB files exist on disk in public/models/', () => {
  const files = [
    'public/models/missiles/aim-9x.glb',
    'public/models/missiles/aim-120c.glb',
    'public/models/missile.glb',
  ];
  for (const file of files) {
    assert.ok(fs.existsSync(file), `Expected file ${file} to exist`);
    const stat = fs.statSync(file);
    assert.ok(stat.size > 50000, `File ${file} should have meaningful size (>50KB), got ${stat.size} bytes`);
  }
});

test('AIM-9X GLB model parses and validates high-detail geometry', async () => {
  const gltf = await parseGlbBuffer('public/models/missiles/aim-9x.glb');
  assert.ok(gltf.scene, 'GLTF scene exists');

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = new THREE.Vector3();
  box.getSize(size);

  const spec = MISSILE_TYPES.AIM9X;
  // Forward axis is -Z: nose at -Z, tail at +Z
  assert.ok(box.min.z < 0, `Nose apex must be in -Z, got min.z = ${box.min.z}`);
  assert.ok(box.max.z > 0, `Tail nozzle must be in +Z, got max.z = ${box.max.z}`);

  // Length should match 3.02m (allowing slight extension for TVC vanes at tail)
  assert.ok(Math.abs(size.z - spec.lengthM) < 0.05, `Expected length ~${spec.lengthM}m, got ${size.z.toFixed(3)}m`);

  // Count meshes and triangles
  let triangleCount = 0;
  let meshCount = 0;
  const materialNames = new Set();
  gltf.scene.traverse(node => {
    if (node.isMesh) {
      meshCount++;
      const pos = node.geometry.attributes.position;
      triangleCount += node.geometry.index ? node.geometry.index.count / 3 : pos.count / 3;
      if (node.material?.name) materialNames.add(node.material.name);
    }
  });

  assert.ok(meshCount >= 5, `Expected multiple material sub-meshes, got ${meshCount}`);
  assert.ok(triangleCount > 2000, `Expected detailed geometry (>2000 tris), got ${triangleCount}`);
  assert.ok(materialNames.has('missile-glass') || materialNames.has('missile-dark'), 'Expected optical dome / seeker material');
  assert.ok(materialNames.has('missile-band-yellow'), 'Expected yellow hazard band');
  assert.ok(materialNames.has('missile-band-brown'), 'Expected brown motor band');
  assert.ok(materialNames.has('missile-nozzle'), 'Expected nozzle material');
});

test('AIM-120C GLB model parses and validates high-detail geometry', async () => {
  const gltf = await parseGlbBuffer('public/models/missiles/aim-120c.glb');
  assert.ok(gltf.scene, 'GLTF scene exists');

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = new THREE.Vector3();
  box.getSize(size);

  const spec = MISSILE_TYPES.AIM120C;
  // Forward axis is -Z: nose at -Z, tail at +Z
  assert.ok(box.min.z < 0, `Nose apex must be in -Z, got min.z = ${box.min.z}`);
  assert.ok(box.max.z > 0, `Tail nozzle must be in +Z, got max.z = ${box.max.z}`);

  // Length should match 3.66m
  assert.ok(Math.abs(size.z - spec.lengthM) < 0.02, `Expected length ~${spec.lengthM}m, got ${size.z.toFixed(3)}m`);

  // Count meshes and triangles
  let triangleCount = 0;
  let meshCount = 0;
  const materialNames = new Set();
  gltf.scene.traverse(node => {
    if (node.isMesh) {
      meshCount++;
      const pos = node.geometry.attributes.position;
      triangleCount += node.geometry.index ? node.geometry.index.count / 3 : pos.count / 3;
      if (node.material?.name) materialNames.add(node.material.name);
    }
  });

  assert.ok(meshCount >= 5, `Expected multiple material sub-meshes, got ${meshCount}`);
  assert.ok(triangleCount > 2000, `Expected detailed geometry (>2000 tris), got ${triangleCount}`);
  assert.ok(materialNames.has('missile-radome'), 'Expected radome material');
  assert.ok(materialNames.has('missile-band-yellow'), 'Expected yellow hazard band');
  assert.ok(materialNames.has('missile-band-brown'), 'Expected brown motor band');
  assert.ok(materialNames.has('missile-nozzle'), 'Expected nozzle material');
});

test('createMissileMesh maintains backward compatibility and provides asset URL helper', () => {
  for (const type of ['AIM9X', 'AIM120C']) {
    const mesh = createMissileMesh(type);
    assert.ok(mesh instanceof THREE.Group);
    assert.equal(mesh.userData.missileType, type);
    const cone = mesh.children.find(child => child.geometry?.type === 'ConeGeometry');
    assert.ok(cone, 'Direct child must include nose cone for backward compatibility');

    const url = getMissileModelUrl(type);
    assert.ok(url.endsWith('.glb'), `URL must point to glb: ${url}`);
  }
});

test('pylon GLB models parse and validate geometry', async () => {
  for (const filename of ['pylon-wingtip.glb', 'pylon-underwing.glb']) {
    const gltf = await parseGlbBuffer(`public/models/missiles/${filename}`);
    assert.ok(gltf.scene, `${filename} must have scene`);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    assert.ok(size.z > 2.0, `${filename} must have rail length > 2m, got ${size.z}`);
  }
});

test('createPylonMesh creates authentic pylons for all 6 F-16 stations', () => {
  assert.equal(F16_MISSILE_STATIONS.length, 6);
  for (const station of F16_MISSILE_STATIONS) {
    const pylon = createPylonMesh(station);
    assert.ok(pylon instanceof THREE.Group);
    assert.equal(pylon.userData.stationId, station.id);
    assert.equal(pylon.userData.stationType, station.type);
    assert.ok(pylon.children.length >= 3, `Station ${station.id} pylon must have multiple sub-meshes`);
  }
});

test('F-16 transforms into empty pylons after missile launch', () => {
  const f16 = new F16({ exteriorOnly: true });
  assert.equal(f16.pylonMeshes.length, 6, 'F16 must have 6 pylon meshes');
  assert.equal(f16.missileMeshes.length, 6, 'F16 must have 6 missile meshes');
  assert.ok(f16.pylonsGroup.visible, 'Pylons group must be visible');

  // Initially all 6 missiles loaded
  assert.ok(f16.missileLoaded.every(loaded => loaded === true));
  assert.ok(f16.missileMeshes.every(m => m.visible === true));
  assert.ok(f16.pylonMeshes.every(p => p.visible === true));

  // Fire station 0 (STA 1): missile disappears, empty pylon remains!
  f16.setMissileLoaded(0, false);
  assert.equal(f16.missileLoaded[0], false);
  assert.equal(f16.missileMeshes[0].visible, false, 'Fired missile must be hidden');
  assert.equal(f16.pylonMeshes[0].visible, true, 'Empty pylon must stay visible at station 0');

  // Fire all remaining missiles: all stations remain as empty pylons
  f16.setMissileLoadout([]);
  for (let i = 0; i < 6; i++) {
    assert.equal(f16.missileMeshes[i].visible, false, `Missile ${i} must be hidden`);
    assert.equal(f16.pylonMeshes[i].visible, true, `Pylon ${i} must remain visible as empty pylon`);
  }

  // Rearm: missiles return onto the pylons
  f16.setMissileLoadout([true, true, true, true, true, true]);
  for (let i = 0; i < 6; i++) {
    assert.equal(f16.missileMeshes[i].visible, true, `Missile ${i} visible after rearm`);
    assert.equal(f16.pylonMeshes[i].visible, true, `Pylon ${i} visible`);
  }
});

test('AIM-120C radome normals face outward from missile centerline', async () => {
  const gltf = await parseGlbBuffer('public/models/missiles/aim-120c.glb');
  let radomeMesh = null;
  gltf.scene.traverse(node => {
    if (node.isMesh && node.material?.name === 'missile-radome') {
      radomeMesh = node;
    }
  });
  assert.ok(radomeMesh, 'AIM-120C radome mesh must exist');
  const pos = radomeMesh.geometry.attributes.position;
  const norm = radomeMesh.geometry.attributes.normal;
  assert.ok(pos && norm, 'Radome must have position and normal attributes');

  let outwardCount = 0;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const nx = norm.getX(i);
    const ny = norm.getY(i);
    const dot = px * nx + py * ny;
    if (dot > 0) outwardCount++;
  }
  assert.equal(
    outwardCount,
    pos.count,
    `All ${pos.count} radome normals must face outward (got ${outwardCount})`
  );
});

test('fin geometries have outward-facing surface normals without inverted winding', async () => {
  for (const filename of ['aim-9x.glb', 'aim-120c.glb']) {
    const gltf = await parseGlbBuffer(`public/models/missiles/${filename}`);
    let finMesh = null;
    gltf.scene.traverse(node => {
      if (node.isMesh && node.material?.name === 'missile-fin') {
        finMesh = node;
      }
    });
    assert.ok(finMesh, `${filename} must have missile-fin mesh`);
    const pos = finMesh.geometry.attributes.position;
    const norm = finMesh.geometry.attributes.normal;
    assert.ok(pos.count >= 100, `${filename} fin mesh must have detailed geometry`);

    for (let i = 0; i < norm.count; i++) {
      const len = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i));
      assert.ok(Math.abs(len - 1.0) < 0.02, `Normal ${i} should be unit vector, got length ${len}`);
    }
  }
});

test('fuselage main body is continuous beneath hazard warning bands (no gap)', async () => {
  for (const filename of ['aim-9x.glb', 'aim-120c.glb']) {
    const gltf = await parseGlbBuffer(`public/models/missiles/${filename}`);
    let bodyMesh = null;
    let yellowBand = null;
    let brownBand = null;

    gltf.scene.traverse(node => {
      if (node.isMesh) {
        if (node.material?.name === 'missile-body') bodyMesh = node;
        if (node.material?.name === 'missile-band-yellow') yellowBand = node;
        if (node.material?.name === 'missile-band-brown') brownBand = node;
      }
    });

    assert.ok(bodyMesh, `${filename} must have body mesh`);
    assert.ok(yellowBand, `${filename} must have yellow warning band`);
    assert.ok(brownBand, `${filename} must have brown warning band`);

    const bodyBox = new THREE.Box3().setFromObject(bodyMesh);
    const yellowBox = new THREE.Box3().setFromObject(yellowBand);
    const brownBox = new THREE.Box3().setFromObject(brownBand);

    // Both warning bands must be positioned within the continuous body z-span
    assert.ok(
      yellowBox.min.z >= bodyBox.min.z - 0.05 && yellowBox.max.z <= bodyBox.max.z + 0.05,
      `Yellow band [${yellowBox.min.z.toFixed(2)}, ${yellowBox.max.z.toFixed(2)}] must be within body [${bodyBox.min.z.toFixed(2)}, ${bodyBox.max.z.toFixed(2)}]`
    );
    assert.ok(
      brownBox.min.z >= bodyBox.min.z - 0.05 && brownBox.max.z <= bodyBox.max.z + 0.05,
      `Brown band [${brownBox.min.z.toFixed(2)}, ${brownBox.max.z.toFixed(2)}] must be within body [${bodyBox.min.z.toFixed(2)}, ${bodyBox.max.z.toFixed(2)}]`
    );
  }
});


