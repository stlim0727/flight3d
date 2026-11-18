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

test('validateGlbModel flags a single inverted triangle in an otherwise valid fin', async () => {
  const scene = new THREE.Scene();
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

  // All triangles wound outward EXCEPT triangle 0 which is swapped:
  const trisWithOneInverted = [
    // Triangle 0 INVERTED (swapped 5 and 1):
    v[0], v[1], v[5],
    // Remaining triangles correctly wound:
    v[1], v[5], v[6],
    v[0], v[2], v[5],
    v[2], v[7], v[5],
    v[1], v[6], v[3],
    v[3], v[6], v[8],
    v[2], v[4], v[7],
    v[4], v[9], v[7],
    v[3], v[8], v[4],
    v[4], v[8], v[9],
    v[5], v[7], v[6],
    v[6], v[7], v[8],
    v[7], v[9], v[8],
  ];

  const positions = [];
  for (const pt of trisWithOneInverted) positions.push(...pt);
  const finGeo = new THREE.BufferGeometry();
  finGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  finGeo.computeVertexNormals();

  const finMesh = new THREE.Mesh(finGeo, new THREE.MeshBasicMaterial({ name: 'missile-fin' }));
  finMesh.name = 'SingleInvertedTriFin';
  scene.add(finMesh);

  const glb = await exportScene(scene);
  const result = await validateGlbModel(glb, 'test-single-inverted-tri');
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(e => e.includes('triangle face(s) with inverted winding')),
    `Should flag single inverted triangle, got: ${result.errors.join('; ')}`
  );
});

test('validateGlbModel handles transformed root nodes without false gap or fin winding errors', async () => {
  const scene = new THREE.Scene();
  // Valid continuous body from z = 0.0 to 2.0
  const bodyGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.0, 16);
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.translate(0, 0, 1.0);
  const bodyMesh = new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial({ name: 'missile-body' }));
  scene.add(bodyMesh);

  // Warning collar at z = 0.5 (sitting on top of body)
  const bandGeo = new THREE.CylinderGeometry(0.081, 0.081, 0.1, 16);
  bandGeo.rotateX(Math.PI / 2);
  bandGeo.translate(0, 0, 0.5);
  const bandMesh = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ name: 'missile-band-yellow' }));
  scene.add(bandMesh);

  // Valid fin along root centerline
  const yRoot = 0.08, yTip = 0.28;
  const rootChord = 0.2, tipChord = 0.08;
  const tMid = 0.003, tEdge = 0.001;
  const zLead = 0.5, zTrail = 0.7;

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

  const validTris = [
    v[0], v[5], v[1],
    v[1], v[5], v[6],
    v[0], v[2], v[5],
    v[2], v[7], v[5],
    v[1], v[6], v[3],
    v[3], v[6], v[8],
    v[2], v[4], v[7],
    v[4], v[9], v[7],
    v[3], v[8], v[4],
    v[4], v[8], v[9],
    v[5], v[7], v[6],
    v[6], v[7], v[8],
    v[7], v[9], v[8],
  ];

  const positions = [];
  for (const pt of validTris) positions.push(...pt);
  const finGeo = new THREE.BufferGeometry();
  finGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  finGeo.computeVertexNormals();
  const finMesh = new THREE.Mesh(finGeo, new THREE.MeshBasicMaterial({ name: 'missile-fin' }));
  scene.add(finMesh);

  // Apply significant root transform (translation + rotation)
  scene.position.set(15, -25, 40);
  scene.rotation.y = 0.75;
  scene.updateMatrixWorld(true);

  const glb = await exportScene(scene);
  const result = await validateGlbModel(glb, 'test-transformed-root');
  assert.equal(result.valid, true, `Transformed valid model should pass, got errors: ${result.errors.join('; ')}`);
});

test('validateGlbModel flags GLB scene with no meshes', async () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.name = 'EmptyGroup';
  scene.add(group);

  const glb = await exportScene(scene);
  const result = await validateGlbModel(glb, 'test-empty-scene');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('no meshes')), 'Should flag scene with no meshes');
});

test('validateGlbModel flags warning bands without missile-body mesh', async () => {
  const scene = new THREE.Scene();
  const bandGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 16);
  const bandMesh = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ name: 'missile-band-yellow' }));
  bandMesh.name = 'OrphanBand';
  scene.add(bandMesh);

  const glb = await exportScene(scene);
  const result = await validateGlbModel(glb, 'test-orphan-band');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('no missile-body mesh')), 'Should flag warning band without body');
});

test('validateGlbModel supports multiple missile-body meshes under warning bands', async () => {
  const scene = new THREE.Scene();
  // Forward body section from z = -1.0 to 0.0
  const forwardGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.0, 16);
  forwardGeo.rotateX(Math.PI / 2);
  forwardGeo.translate(0, 0, -0.5);
  const forwardMesh = new THREE.Mesh(forwardGeo, new THREE.MeshBasicMaterial({ name: 'missile-body' }));
  forwardMesh.name = 'BodyForward';
  scene.add(forwardMesh);

  // Aft body section from z = 0.0 to 1.0
  const aftGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.0, 16);
  aftGeo.rotateX(Math.PI / 2);
  aftGeo.translate(0, 0, 0.5);
  const aftMesh = new THREE.Mesh(aftGeo, new THREE.MeshBasicMaterial({ name: 'missile-body' }));
  aftMesh.name = 'BodyAft';
  scene.add(aftMesh);

  // Warning band placed on forward body section around z = -0.5
  const bandGeo = new THREE.CylinderGeometry(0.082, 0.082, 0.1, 16);
  bandGeo.rotateX(Math.PI / 2);
  bandGeo.translate(0, 0, -0.5);
  const bandMesh = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ name: 'missile-band-yellow' }));
  bandMesh.name = 'BandForward';
  scene.add(bandMesh);

  const glb = await exportScene(scene);
  const result = await validateGlbModel(glb, 'test-multi-body');
  assert.equal(result.valid, true, `Multiple body meshes covering the band should pass, got: ${result.errors.join('; ')}`);
});




