import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGlbFile, validateGlbModel } from '../scripts/validate-glb-mesh.mjs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

function exportScene(scene) {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(scene, glb => resolve(glb), reject, { binary: true });
  });
}

test('validateGlbFile validates existing public missile GLBs', async () => {
  for (const file of [
    'public/models/missiles/aim-9x.glb',
    'public/models/missiles/aim-120c.glb',
    'public/models/missile.glb',
    'public/models/missiles/pylon-wingtip.glb',
    'public/models/missiles/pylon-underwing.glb',
  ]) {
    const result = await validateGlbFile(file);
    assert.equal(result.valid, true, `Expected ${file} to be valid, got errors: ${result.errors?.join(', ')}`);
    assert.ok(result.stats.triangles > 0, `${file} should have triangles`);
  }
});

test('validateGlbFile reports non-existent file gracefully', async () => {
  const result = await validateGlbFile('non-existent-model.glb');
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /File not found/);
});

test('validateGlbModel flags inward-pointing radome normals', async () => {
  const scene = new THREE.Scene();
  // Create an inverted lathe geometry (inward normals)
  const points = [];
  const zApex = -1.8, zBase = -1.2, rBase = 0.09;
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    const r = rBase * Math.sin((u * Math.PI) / 2);
    const z = zApex + (zBase - zApex) * u;
    // Without points.reverse(), normals face inward
    points.push(new THREE.Vector2(Math.max(0.0005, r), -z));
  }
  const geo = new THREE.LatheGeometry(points, 16);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ name: 'missile-radome' });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'InvertedRadome';
  scene.add(mesh);

  const glb = await exportScene(scene);
  const result = await validateGlbModel(glb, 'test-inverted-radome');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('inward-pointing normals')), 'Should detect inward normals');
});

test('validateGlbModel flags gap between warning band and fuselage', async () => {
  const scene = new THREE.Scene();
  // Fuselage starting at 0 to 1
  const bodyGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.0, 16);
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.translate(0, 0, 0.5);
  const bodyMesh = new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial({ name: 'missile-body' }));
  bodyMesh.name = 'Body';
  scene.add(bodyMesh);

  // Warning band placed far outside at z = 2.0 (gap!)
  const bandGeo = new THREE.CylinderGeometry(0.081, 0.081, 0.1, 16);
  bandGeo.rotateX(Math.PI / 2);
  bandGeo.translate(0, 0, 2.0);
  const bandMesh = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ name: 'missile-band-yellow' }));
  bandMesh.name = 'DisconnectedBand';
  scene.add(bandMesh);

  const glb = await exportScene(scene);
  const result = await validateGlbModel(glb, 'test-gap-model');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('extends beyond continuous fuselage body')), 'Should detect gap under warning band');
});
