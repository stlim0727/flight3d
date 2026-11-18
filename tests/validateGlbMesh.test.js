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

test('validateGlbModel flags inverted fin triangle winding', async () => {
  const scene = new THREE.Scene();
  // Build a faceted fin wedge with inverted triangle winding
  const yRoot = 0.08, yTip = 0.28;
  const rootChord = 0.2, tipChord = 0.08;
  const tMid = 0.003, tEdge = 0.001;
  const zLead = -0.1, zTrail = 0.1;

  const v = [
    [0, yRoot, zLead],
    [tMid, yRoot, zLead + rootChord * 0.35],
    [-tMid, yRoot, zLead + rootChord * 0.35],
    [tEdge, yRoot, zTrail],
    [-tEdge, yRoot, zTrail],
    [0, yTip, zLead + 0.05],
    [tMid * 0.7, yTip, zLead + 0.05 + tipChord * 0.35],
    [-tMid * 0.7, yTip, zLead + 0.05 + tipChord * 0.35],
    [tEdge * 0.7, yTip, zLead + 0.05 + tipChord],
    [-tEdge * 0.7, yTip, zLead + 0.05 + tipChord],
  ];

  // Inverted winding (swapped b and c)
  const invertedTris = [
    v[0], v[1], v[5],
    v[1], v[6], v[5],
    v[0], v[5], v[2],
    v[2], v[5], v[7],
    v[1], v[3], v[6],
    v[3], v[8], v[6],
    v[2], v[7], v[4],
    v[4], v[7], v[9],
    v[3], v[4], v[8],
    v[4], v[9], v[8],
    v[5], v[6], v[7],
    v[6], v[8], v[7],
    v[7], v[8], v[9],
  ];

  const positions = [];
  for (const pt of invertedTris) {
    positions.push(...pt);
  }
  const finGeo = new THREE.BufferGeometry();
  finGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  finGeo.computeVertexNormals();

  const finMesh = new THREE.Mesh(finGeo, new THREE.MeshBasicMaterial({ name: 'missile-fin' }));
  finMesh.name = 'InvertedFin';
  scene.add(finMesh);

  const glb = await exportScene(scene);
  const result = await validateGlbModel(glb, 'test-inverted-fin');
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(e => e.includes('inverted triangle winding') || e.includes('pointing inward')),
    'Should detect inverted fin triangle winding'
  );
});

test('validateGlbModel flags gap between disconnected body cylinders under warning band', async () => {
  const scene = new THREE.Scene();
  // Two disconnected body cylinders merged together into one mesh:
  // Section 1: z = 0.0 to 1.0
  // Section 2: z = 1.4 to 2.4
  // Internal gap between 1.0 and 1.4!
  const sec1 = new THREE.CylinderGeometry(0.08, 0.08, 1.0, 16);
  sec1.rotateX(Math.PI / 2);
  sec1.translate(0, 0, 0.5);

  const sec2 = new THREE.CylinderGeometry(0.08, 0.08, 1.0, 16);
  sec2.rotateX(Math.PI / 2);
  sec2.translate(0, 0, 1.9);

  // Group them as body
  const bodyGroup = new THREE.Group();
  bodyGroup.add(new THREE.Mesh(sec1, new THREE.MeshBasicMaterial({ name: 'missile-body' })));
  bodyGroup.add(new THREE.Mesh(sec2, new THREE.MeshBasicMaterial({ name: 'missile-body' })));
  scene.add(bodyGroup);

  // Warning band placed at z = 1.2 (in the gap between 1.0 and 1.4, yet inside overall bounds [0.0, 2.4]!)
  const bandGeo = new THREE.CylinderGeometry(0.081, 0.081, 0.1, 16);
  bandGeo.rotateX(Math.PI / 2);
  bandGeo.translate(0, 0, 1.2);
  const bandMesh = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ name: 'missile-band-yellow' }));
  bandMesh.name = 'CollarInGap';
  scene.add(bandMesh);

  const glb = await exportScene(scene);
  const result = await validateGlbModel(glb, 'test-gap-model');
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(e => e.includes('covers a hollow fuselage gap')),
    `Should detect gap inside merged body bounds, got: ${result.errors.join('; ')}`
  );
});
