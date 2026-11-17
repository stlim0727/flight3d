import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MISSILE_TYPES } from '../src/weapons/missileSpecs.js';
import { createMissileMesh, getMissileModelUrl } from '../src/weapons/missileGeometry.js';

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
